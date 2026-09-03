#!/usr/bin/env python3
"""Mine licensed piano MusicXML into reproducible style data.

This program is deliberately conservative: ambiguous rights, non-piano files,
and malformed scores are logged and excluded rather than guessed into a pack.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from music21 import chord, converter, interval, key, meter, note, roman, stream


ALLOWED_LICENSES = {"PUBLIC-DOMAIN", "PD", "CC0", "CC0-1.0", "CC-BY-4.0"}
BLOCKED_TOKENS = {"NC", "NONCOMMERCIAL", "SA", "SHAREALIKE"}


@dataclass(frozen=True)
class Source:
    path: Path
    source: str
    source_id: str
    genre: str
    composer: str
    work: str
    license: str
    no_license_conflict: bool

    @classmethod
    def from_json(cls, value: dict) -> "Source":
        required = {"path", "source", "source_id", "genre", "license"}
        missing = required - value.keys()
        if missing:
            raise ValueError(f"manifest record missing {sorted(missing)}")
        return cls(
            path=Path(value["path"]), source=str(value["source"]),
            source_id=str(value["source_id"]), genre=str(value["genre"]),
            composer=str(value.get("composer", "Unknown")), work=str(value.get("work", "Untitled")),
            license=str(value["license"]), no_license_conflict=bool(value.get("no_license_conflict", False)),
        )


def license_decision(source: Source) -> tuple[bool, str]:
    normalized = source.license.upper().replace("_", "-")
    if any(token in normalized.split("-") for token in BLOCKED_TOKENS):
        return False, "noncommercial or sharealike license"
    if normalized not in ALLOWED_LICENSES:
        return False, "license is not on the commercial allowlist"
    if source.source.upper() == "PDMX" and not source.no_license_conflict:
        return False, "PDMX record is outside no_license_conflict"
    return True, "accepted"


def provenance_db(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE IF NOT EXISTS provenance (
        source_id TEXT PRIMARY KEY, source TEXT NOT NULL, path TEXT NOT NULL,
        genre TEXT NOT NULL, composer TEXT, work TEXT, license TEXT NOT NULL,
        sha256 TEXT, accepted INTEGER NOT NULL, reason TEXT NOT NULL
    )""")
    return db


def sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def log_source(db: sqlite3.Connection, source: Source, accepted: bool, reason: str) -> None:
    db.execute("INSERT OR REPLACE INTO provenance VALUES (?,?,?,?,?,?,?,?,?,?)", (
        source.source_id, source.source, str(source.path), source.genre, source.composer,
        source.work, source.license, sha256(source.path), int(accepted), reason,
    ))
    db.commit()


def piano_parts(score: stream.Score) -> tuple[stream.Part, stream.Part] | None:
    parts = list(score.parts)
    if len(parts) != 2:
        return None
    return parts[0], parts[1]


def normalized_score(score: stream.Score) -> tuple[stream.Score, key.Key]:
    detected = score.analyze("key")
    target = key.Key("a", "minor") if detected.mode == "minor" else key.Key("C", "major")
    shift = interval.Interval(detected.tonic, target.tonic)
    return score.transpose(shift), target


def meter_name(score: stream.Score) -> str:
    signature = next(iter(score.recurse().getElementsByClass(meter.TimeSignature)), None)
    return signature.ratioString if signature else "4/4"


def quantized_chords(score: stream.Score) -> list[str]:
    labels: list[str] = []
    detected = score.analyze("key")
    for measure in score.chordify().recurse().getElementsByClass(stream.Measure):
        sounding = [item for item in measure.notes if isinstance(item, chord.Chord) and len(item.pitches) >= 2]
        if not sounding:
            continue
        representative = max(sounding, key=lambda item: item.quarterLength * len(item.pitches))
        try:
            labels.append(roman.romanNumeralFromChord(representative, detected).figure)
        except Exception:
            continue
    return labels


def rhythm_cells(part: stream.Part) -> collections.Counter[str]:
    counts: collections.Counter[str] = collections.Counter()
    for measure in part.getElementsByClass(stream.Measure):
        events = []
        for item in measure.notesAndRests:
            duration = round(float(item.quarterLength), 4)
            events.append(("r" if item.isRest else "n", duration))
        if events:
            counts[json.dumps(events, separators=(",", ":"))] += 1
    return counts


def melodic_intervals(part: stream.Part) -> tuple[collections.Counter[int], int, int]:
    pitches = [item.pitch.midi for item in part.recurse().notes if isinstance(item, note.Note)]
    values = [b - a for a, b in zip(pitches, pitches[1:])]
    return collections.Counter(values), sum(abs(value) <= 2 for value in values), len(values)


def lh_vectors(part: stream.Part) -> list[list[float]]:
    vectors = []
    for measure in part.getElementsByClass(stream.Measure):
        attacks = list(measure.notes)
        if not attacks:
            continue
        midis = [pitch.midi for item in attacks for pitch in item.pitches]
        positions = [round(float(item.offset), 3) for item in attacks]
        chord_sizes = [len(item.pitches) for item in attacks]
        vectors.append([
            len(attacks), sum(chord_sizes) / len(chord_sizes), max(midis) - min(midis),
            sum(positions) / len(positions), len(set(positions)),
        ])
    return vectors


def euclidean(a: Sequence[float], b: Sequence[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def kmeans(vectors: list[list[float]], k: int = 6, rounds: int = 30) -> tuple[list[list[float]], list[int]]:
    if not vectors:
        return [], []
    k = min(k, len(vectors))
    centroids = [vectors[round(index * (len(vectors) - 1) / max(1, k - 1))][:] for index in range(k)]
    assignments = [0] * len(vectors)
    for _ in range(rounds):
        next_assignments = [min(range(k), key=lambda index: euclidean(vector, centroids[index])) for vector in vectors]
        if next_assignments == assignments:
            break
        assignments = next_assignments
        for index in range(k):
            members = [vector for vector, group in zip(vectors, assignments) if group == index]
            if members:
                centroids[index] = [sum(column) / len(members) for column in zip(*members)]
    return centroids, assignments


def fragments(part: stream.Part, source: Source, tonic: key.Key) -> Iterable[dict]:
    measures = list(part.getElementsByClass(stream.Measure))
    for index in range(0, len(measures) - 1, 2):
        pair = measures[index:index + 2]
        events = []
        for bar, measure in enumerate(pair):
            for item in measure.notesAndRests:
                if not isinstance(item, note.Note):
                    continue
                degree = tonic.getScaleDegreeFromPitch(item.pitch)
                if degree is None:
                    continue
                events.append({
                    "degree": degree, "octave_offset": item.pitch.octave - 4,
                    "dur": float(item.quarterLength), "bar": bar,
                })
        if len(events) < 3:
            continue
        role = "opening" if index == 0 else "cadential" if index + 2 >= len(measures) else "continuation"
        yield {
            "id": f"{source.source_id.replace(':', '_')}_{index + 1}",
            "genre": source.genre, "level": 1, "meter": meter_name(part), "bars": 2,
            "role": role, "harmonic_context": [], "events": events,
            "contour": "derived", "lh_compatible": [],
            "provenance": {
                "source_id": source.source_id, "source": source.source,
                "composer": source.composer, "work": source.work,
                "measures": [index + 1, index + 2], "license": source.license,
            },
        }


def merge_counts(target: collections.Counter, values: collections.Counter) -> None:
    target.update(values)


def analyze_source(source: Source) -> dict:
    score = converter.parse(source.path)
    parts = piano_parts(score)
    if not parts:
        raise ValueError("score is not a two-part/two-staff piano score")
    normalized, tonic = normalized_score(score)
    normalized_parts = piano_parts(normalized)
    assert normalized_parts is not None
    right, left = normalized_parts
    chords = quantized_chords(normalized)
    intervals, steps, motions = melodic_intervals(right)
    return {
        "meter": meter_name(normalized), "chords": chords,
        "bigrams": collections.Counter(zip(chords, chords[1:])),
        "trigrams": collections.Counter(zip(chords, chords[1:], chords[2:])),
        "cadence": tuple(chords[-3:]), "rhythms": rhythm_cells(right),
        "intervals": intervals, "steps": steps, "motions": motions,
        "lh_vectors": lh_vectors(left), "fragments": list(fragments(right, source, tonic)),
    }


def serial_counter(counter: collections.Counter) -> dict[str, int]:
    return {"|".join(map(str, key if isinstance(key, tuple) else [key])): value for key, value in counter.most_common()}


def emit_genre(genre: str, analyses: list[dict], out: Path) -> None:
    bigrams: collections.Counter = collections.Counter()
    trigrams: collections.Counter = collections.Counter()
    cadences: collections.Counter = collections.Counter()
    rhythms: collections.Counter = collections.Counter()
    intervals: collections.Counter = collections.Counter()
    vectors: list[list[float]] = []
    fragment_rows: list[dict] = []
    steps = motions = 0
    for result in analyses:
        merge_counts(bigrams, result["bigrams"]); merge_counts(trigrams, result["trigrams"])
        cadences[result["cadence"]] += 1; merge_counts(rhythms, result["rhythms"])
        merge_counts(intervals, result["intervals"]); vectors.extend(result["lh_vectors"])
        fragment_rows.extend(result["fragments"]); steps += result["steps"]; motions += result["motions"]
    centroids, assignments = kmeans(vectors)
    payload = {
        "genre": genre, "score_count": len(analyses), "chord_bigrams": serial_counter(bigrams),
        "chord_trigrams": serial_counter(trigrams), "cadences": serial_counter(cadences),
        "rhythm_cells": serial_counter(rhythms), "melodic_intervals": serial_counter(intervals),
        "step_ratio": steps / motions if motions else 1,
        "lh_clusters": [{"cluster": index, "centroid": centroid, "count": assignments.count(index), "label": None}
                        for index, centroid in enumerate(centroids)],
    }
    (out / "analysis").mkdir(parents=True, exist_ok=True)
    (out / "fragments").mkdir(parents=True, exist_ok=True)
    (out / "analysis" / f"{genre}.json").write_text(json.dumps(payload, indent=2) + "\n")
    (out / "fragments" / f"{genre}.json").write_text(json.dumps(fragment_rows, indent=2) + "\n")
    template_path = Path(__file__).resolve().parents[2] / "src" / "data" / "style-packs" / f"{genre}.json"
    if template_path.is_file():
        pack = json.loads(template_path.read_text())
        vocabulary = set(pack.get("harmony", {}).get("vocabulary", []))
        rows: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        for (left, right), count in bigrams.items():
            if left in vocabulary and right in vocabulary:
                rows[left][right] += count
        for left, counts in rows.items():
            total = sum(counts.values())
            if total:
                pack["harmony"]["transitions"][left] = {
                    right: round(count / total, 6) for right, count in counts.most_common()
                }
        pack["melody"]["step_ratio_target"] = round(payload["step_ratio"], 4)
        snapshot = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
        pack["provenance"] = {
            "model": "corpus-mined-awaiting-hand-audit",
            "corpus_snapshot": snapshot,
            "score_count": len(analyses),
            "notes": "Transition rows and motion target mined; cadence and texture labels require hand audit.",
        }
        (out / "style-packs").mkdir(parents=True, exist_ok=True)
        (out / "style-packs" / f"{genre}.json").write_text(json.dumps(pack, indent=2) + "\n")


def read_manifest(path: Path) -> Iterable[Source]:
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            yield Source.from_json(json.loads(line))
        except Exception as exc:
            raise ValueError(f"{path}:{number}: {exc}") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    db = provenance_db(args.out / "provenance.sqlite")
    by_genre: dict[str, list[dict]] = collections.defaultdict(list)
    for source in read_manifest(args.manifest):
        allowed, reason = license_decision(source)
        if not allowed:
            log_source(db, source, False, reason)
            continue
        try:
            result = analyze_source(source)
        except Exception as exc:
            log_source(db, source, False, f"parse/analysis failure: {exc}")
            continue
        log_source(db, source, True, "accepted and analyzed")
        by_genre[source.genre].append(result)
    for genre, analyses in sorted(by_genre.items()):
        emit_genre(genre, analyses, args.out)


if __name__ == "__main__":
    main()
