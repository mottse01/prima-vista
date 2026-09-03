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
    bucket_audited: bool
    date: str
    tags: tuple[str, ...]

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
            bucket_audited=bool(value.get("bucket_audited", False)),
            date=str(value.get("date", "")), tags=tuple(map(str, value.get("tags", []))),
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
        sha256 TEXT, accepted INTEGER NOT NULL, reason TEXT NOT NULL,
        bucket_audited INTEGER NOT NULL, work_date TEXT, tags_json TEXT
    )""")
    columns = {row[1] for row in db.execute("PRAGMA table_info(provenance)")}
    for name, definition in {
        "bucket_audited": "INTEGER NOT NULL DEFAULT 0",
        "work_date": "TEXT",
        "tags_json": "TEXT",
    }.items():
        if name not in columns:
            db.execute(f"ALTER TABLE provenance ADD COLUMN {name} {definition}")
    db.commit()
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
    db.execute("INSERT OR REPLACE INTO provenance VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        source.source_id, source.source, str(source.path), source.genre, source.composer,
        source.work, source.license, sha256(source.path), int(accepted), reason,
        int(source.bucket_audited), source.date, json.dumps(source.tags),
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


def quantized_chords(score: stream.Score, slots_per_measure: int = 2) -> list[str]:
    labels: list[str] = []
    detected = score.analyze("key")
    for measure in score.chordify().recurse().getElementsByClass(stream.Measure):
        sounding = [item for item in measure.notes if isinstance(item, chord.Chord) and len(item.pitches) >= 2]
        if not sounding:
            continue
        bar_length = float(measure.barDuration.quarterLength or measure.duration.quarterLength or 4)
        for slot in range(slots_per_measure):
            start = slot * bar_length / slots_per_measure
            end = (slot + 1) * bar_length / slots_per_measure
            candidates = [item for item in sounding if start <= float(item.offset) < end]
            if not candidates:
                candidates = sounding
            representative = max(candidates, key=lambda item: float(item.quarterLength) * len(item.pitches))
            try:
                labels.append(roman.romanNumeralFromChord(representative, detected).figure)
            except Exception:
                continue
    return labels


def collapse_repeats(values: Sequence[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        if not out or out[-1] != value:
            out.append(value)
    return out


def phrase_cadences(chords: Sequence[str], slots_per_measure: int = 2) -> list[tuple[str, ...]]:
    """Approximate phrase boundaries every four bars for later hand audit."""
    out: list[tuple[str, ...]] = []
    stride = slots_per_measure * 4
    for end in range(stride, len(chords) + 1, stride):
        window = collapse_repeats(chords[max(0, end - 6):end])
        if len(window) >= 2:
            out.append(tuple(window[-3:]))
    if chords and (not out or len(chords) % stride):
        window = collapse_repeats(chords[-6:])
        if len(window) >= 2:
            out.append(tuple(window[-3:]))
    return out


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


def levenshtein(a: Sequence, b: Sequence) -> int:
    row = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        diagonal = row[0]
        row[0] = i
        for j, right in enumerate(b, 1):
            above = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, diagonal + int(left != right))
            diagonal = above
    return row[-1]


def unit_signature(measures: Sequence[stream.Measure]) -> tuple[list[tuple[float, float]], list[int]]:
    rhythm: list[tuple[float, float]] = []
    pitches: list[int] = []
    cursor = 0.0
    for measure in measures:
        for item in measure.notesAndRests:
            if isinstance(item, note.Note):
                rhythm.append((round(cursor + float(item.offset), 4), round(float(item.quarterLength), 4)))
                pitches.append(item.pitch.midi)
        cursor += float(measure.barDuration.quarterLength or measure.duration.quarterLength or 4)
    intervals = [max(-7, min(7, right - left)) for left, right in zip(pitches, pitches[1:])]
    return rhythm, intervals


def signature_similarity(left: tuple[list, list], right: tuple[list, list]) -> float:
    rhythm = levenshtein(left[0], right[0]) / max(1, len(left[0]), len(right[0]))
    contour = levenshtein(left[1], right[1]) / max(1, len(left[1]), len(right[1]))
    return max(0.0, 1 - rhythm * 0.55 - contour * 0.45)


def coherence_samples(part: stream.Part) -> list[float]:
    measures = list(part.getElementsByClass(stream.Measure))
    values: list[float] = []
    for start in range(0, len(measures) - 7, 4):
        units = [unit_signature(measures[start + offset:start + offset + 2]) for offset in range(0, 8, 2)]
        pairs = [signature_similarity(units[i], units[j]) for i in range(len(units)) for j in range(i + 1, len(units))]
        if pairs:
            values.append(sum(pairs) / len(pairs))
    return values


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


def fragment_level(events: Sequence[dict]) -> int:
    durations = [event["dur"] for event in events]
    degrees = [event["degree"] + event["octave_offset"] * 7 for event in events]
    max_leap = max((abs(right - left) for left, right in zip(degrees, degrees[1:])), default=0)
    smallest = min(durations, default=4)
    return max(1, min(10, 1 + int(max_leap >= 3) + int(max_leap >= 5)
                      + int(smallest <= 0.5) + int(smallest <= 0.25) * 2 + int(len(events) >= 12)))


def fragment_contour(events: Sequence[dict]) -> str:
    degrees = [event["degree"] + event["octave_offset"] * 7 for event in events]
    if len(degrees) < 2:
        return "static"
    peak = degrees.index(max(degrees))
    if 0 < peak < len(degrees) - 1:
        return "arch"
    if degrees[-1] > degrees[0]:
        return "ascending"
    if degrees[-1] < degrees[0]:
        return "descending"
    return "wave"


def fragments(part: stream.Part, source: Source, tonic: key.Key, harmonic_labels: Sequence[str]) -> Iterable[dict]:
    measures = list(part.getElementsByClass(stream.Measure))
    for index in range(0, len(measures) - 1, 2):
        pair = measures[index:index + 2]
        events = []
        clean = True
        for bar, measure in enumerate(pair):
            bar_total = float(measure.barDuration.quarterLength or measure.duration.quarterLength or 4)
            sounding_total = 0.0
            for item in measure.notesAndRests:
                if not isinstance(item, note.Note):
                    if item.isRest and float(item.quarterLength) > 0:
                        clean = False
                    continue
                degree = tonic.getScaleDegreeFromPitch(item.pitch)
                if degree is None:
                    clean = False
                    continue
                sounding_total += float(item.quarterLength)
                events.append({
                    "degree": degree, "octave_offset": item.pitch.octave - 4,
                    "dur": float(item.quarterLength), "bar": bar,
                })
            if abs(sounding_total - bar_total) > 0.001:
                clean = False
        if len(events) < 3 or not clean:
            continue
        role = "opening" if index == 0 else "cadential" if index + 2 >= len(measures) else "continuation"
        yield {
            "id": f"{source.source_id.replace(':', '_')}_{index + 1}",
            "genre": source.genre, "level": fragment_level(events), "meter": meter_name(part), "bars": 2,
            "role": role, "harmonic_context": [harmonic_labels[index * 2], harmonic_labels[(index + 1) * 2]]
            if len(harmonic_labels) > (index + 1) * 2 else [], "events": events,
            "contour": fragment_contour(events), "lh_compatible": [],
            "provenance": {
                "source_id": source.source_id, "source": source.source,
                "composer": source.composer, "work": source.work,
                "measures": [index + 1, index + 2], "license": source.license,
                "source_sha256": sha256(source.path),
                "no_license_conflict": source.no_license_conflict,
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
    chords = quantized_chords(normalized, 2)
    intervals, steps, motions = melodic_intervals(right)
    return {
        "meter": meter_name(normalized), "chords": chords,
        "bigrams": collections.Counter(zip(chords, chords[1:])),
        "trigrams": collections.Counter(zip(chords, chords[1:], chords[2:])),
        "cadences": phrase_cadences(chords, 2), "rhythms": rhythm_cells(right),
        "intervals": intervals, "steps": steps, "motions": motions,
        "lh_vectors": lh_vectors(left), "coherence": coherence_samples(right),
        "fragments": list(fragments(right, source, tonic, chords)),
    }


def serial_counter(counter: collections.Counter) -> dict[str, int]:
    return {"|".join(map(str, key if isinstance(key, tuple) else [key])): value for key, value in counter.most_common()}


def quantile(values: Sequence[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = round((len(ordered) - 1) * probability)
    return ordered[index]


def cadence_kind(formula: Sequence[str], degrees: dict[str, int]) -> str | None:
    mapped = [degrees.get(value) for value in formula]
    if None in mapped or len(mapped) < 2:
        return None
    if mapped[-1] == 4:
        return "half"
    if mapped[-2:] == [4, 0]:
        return "authentic"
    if mapped[-2:] == [3, 0]:
        return "plagal"
    if mapped[-2:] == [4, 5]:
        return "deceptive"
    return None


def emit_genre(genre: str, analyses: list[dict], out: Path, apply_coherence: bool = False) -> None:
    bigrams: collections.Counter = collections.Counter()
    trigrams: collections.Counter = collections.Counter()
    cadences: collections.Counter = collections.Counter()
    rhythms: collections.Counter = collections.Counter()
    intervals: collections.Counter = collections.Counter()
    vectors: list[list[float]] = []
    fragment_rows: list[dict] = []
    coherence: list[float] = []
    steps = motions = 0
    for result in analyses:
        merge_counts(bigrams, result["bigrams"]); merge_counts(trigrams, result["trigrams"])
        cadences.update(result["cadences"]); merge_counts(rhythms, result["rhythms"])
        merge_counts(intervals, result["intervals"]); vectors.extend(result["lh_vectors"])
        coherence.extend(result["coherence"])
        fragment_rows.extend(result["fragments"]); steps += result["steps"]; motions += result["motions"]
    centroids, assignments = kmeans(vectors)
    payload = {
        "genre": genre, "score_count": len(analyses), "chord_bigrams": serial_counter(bigrams),
        "chord_trigrams": serial_counter(trigrams), "cadences": serial_counter(cadences),
        "rhythm_cells": serial_counter(rhythms), "melodic_intervals": serial_counter(intervals),
        "step_ratio": steps / motions if motions else 1,
        "coherence": {
            "samples": len(coherence), "p10": quantile(coherence, 0.1),
            "median": quantile(coherence, 0.5), "p90": quantile(coherence, 0.9),
        },
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
        trigram_rows: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        for (left, middle, right), count in trigrams.items():
            if left in vocabulary and middle in vocabulary and right in vocabulary:
                trigram_rows[f"{left}|{middle}"][right] += count
        pack["harmony"]["trigram_transitions"] = {
            context: {right: round(count / sum(counts.values()), 6) for right, count in counts.most_common()}
            for context, counts in trigram_rows.items()
        }
        degrees = pack["harmony"].get("roman_degrees", {})
        mined_cadences: dict[str, list[list[str]]] = collections.defaultdict(list)
        for formula, _count in cadences.most_common():
            if all(value in vocabulary for value in formula):
                kind = cadence_kind(formula, degrees)
                if kind and list(formula) not in mined_cadences[kind]:
                    mined_cadences[kind].append(list(formula))
        for kind, formulas in mined_cadences.items():
            pack["harmony"]["cadences"][kind] = formulas[:6]
        pack["melody"]["step_ratio_target"] = round(payload["step_ratio"], 4)
        if apply_coherence and len(coherence) >= 20:
            lower = round(max(0, quantile(coherence, 0.1) or 0), 4)
            upper = round(min(1, quantile(coherence, 0.9) or 1), 4)
            if lower < upper:
                pack["validator"]["coherence_min"] = lower
                pack["validator"]["coherence_max"] = upper
        snapshot = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
        pack["provenance"] = {
            "model": "corpus-mined-awaiting-hand-audit",
            "corpus_snapshot": snapshot,
            "score_count": len(analyses),
            "notes": "Transitions, trigrams, cadence candidates, motion and coherence mined; texture clusters require hand labels.",
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
    parser.add_argument("--apply-coherence-calibration", action="store_true",
                        help="write p10/p90 corpus coherence into emitted packs (requires >=20 samples)")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    db = provenance_db(args.out / "provenance.sqlite")
    by_genre: dict[str, list[dict]] = collections.defaultdict(list)
    for source in read_manifest(args.manifest):
        allowed, reason = license_decision(source)
        if not allowed:
            log_source(db, source, False, reason)
            continue
        if not source.bucket_audited:
            log_source(db, source, False, "genre bucket has not been hand-audited")
            continue
        try:
            result = analyze_source(source)
        except Exception as exc:
            log_source(db, source, False, f"parse/analysis failure: {exc}")
            continue
        log_source(db, source, True, "accepted and analyzed")
        by_genre[source.genre].append(result)
    for genre, analyses in sorted(by_genre.items()):
        emit_genre(genre, analyses, args.out, args.apply_coherence_calibration)


if __name__ == "__main__":
    main()
