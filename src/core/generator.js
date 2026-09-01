// Exercise generator.
//
// Produces a fully spelled, phrase-shaped piano exercise from a parameter set
// and a seed. Deterministic: the same seed and parameters always yield the
// same music, which is what makes exercises shareable and assignable.

import {
  TPQ, clamp, fromDia, isChordTone, spellInKey, spellChordTone, tonicLetter, KEY_NAMES,
} from './theory.js';
import { getCell, metricWeight, resolveCells, timeSig } from './rhythm.js';
import { planProgression, spellVoicing, voiceChord } from './harmony.js';
import { makeRng } from './rng.js';

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

/** Fill one measure with rhythm cells drawn from the allowed vocabulary. */
function fillMeasure(rng, ts, cellIds, { restRate, offsetTicks }) {
  const meter = ts.compound ? 'compound' : 'simple';
  const cells = cellIds.map(getCell).filter((c) => c && c.meter === meter);
  const fallback = getCell(ts.compound ? 'cdq' : 'q');
  const events = [];
  let pos = 0;
  let guard = 0;

  while (pos < ts.ticks && guard++ < 128) {
    const remaining = ts.ticks - pos;
    let usable = cells.filter((c) => c.ticks <= remaining);
    if (!usable.length) usable = [fallback];

    const onBeat = pos % ts.beat === 0;
    const weights = usable.map((c) => {
      let w = 1;
      if (c.tags.includes('rest')) w *= restRate * 3;
      // Longer values open a bar naturally but clutter it mid-measure.
      if (c.ticks > ts.beat) w *= pos === 0 ? 1.1 : 0.45;
      // Keep plain beats common enough that lines stay readable.
      if (c.tags.includes('quarter')) w *= 1.4;
      // Don't start a multi-beat figure off the beat.
      if (!onBeat && c.ticks > ts.beat) w = 0.001;
      return Math.max(w, 0.001);
    });

    const cell = rng.weighted(usable, weights);
    let t = offsetTicks + pos;
    for (const ev of cell.events) {
      events.push({ onset: t, duration: ev.d, rest: ev.rest, tags: cell.tags, cellId: cell.id });
      t += ev.d;
    }
    pos += cell.ticks;
  }
  return events;
}

/** Rhythm for the whole line, with a held final bar so the exercise lands. */
function buildRhythm(rng, ts, cellIds, measures, restRate) {
  const out = [];
  for (let m = 0; m < measures; m++) {
    const offsetTicks = m * ts.ticks;
    if (m === measures - 1) {
      out.push({ onset: offsetTicks, duration: ts.ticks, rest: false, tags: ['final'], cellId: 'final' });
      continue;
    }
    out.push(...fillMeasure(rng, ts, cellIds, { restRate, offsetTicks }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Melody
// ---------------------------------------------------------------------------

/** Phrase arch: rise toward the middle of the line, fall back at the cadence. */
function archTarget(m, measures, lowDia, highDia) {
  if (measures <= 1) return (lowDia + highDia) / 2;
  const x = m / (measures - 1);
  const shape = Math.sin(Math.PI * x); // 0 -> 1 -> 0
  return lowDia + (highDia - lowDia) * (0.3 + 0.5 * shape);
}

function chordAt(chords, ts, chordsPerMeasure, onset) {
  const measure = Math.floor(onset / ts.ticks);
  const within = onset - measure * ts.ticks;
  const slotTicks = ts.ticks / chordsPerMeasure;
  const slot = Math.min(chordsPerMeasure - 1, Math.floor(within / slotTicks));
  return chords[Math.min(chords.length - 1, measure * chordsPerMeasure + slot)];
}

/**
 * Assign pitches to a rhythmic line.
 *
 * Strong beats take chord tones; weaker positions may take passing or
 * neighbour tones. Leaps are bounded and resolved by step in the opposite
 * direction, which is what keeps generated melodies singable.
 */
function assignPitches(rng, opts) {
  const {
    key, ts, chords, chordsPerMeasure, rhythm, measures,
    lowDia, highDia, maxLeap, stepwiseBias, nonChordRate, chromaticRate,
  } = opts;

  const notes = [];
  let prev = null;
  let lastLeap = 0;
  let lastLeapDir = 0;

  const sounded = rhythm.filter((e) => !e.rest);

  for (let i = 0; i < sounded.length; i++) {
    const ev = sounded[i];
    const measure = Math.floor(ev.onset / ts.ticks);
    const within = ev.onset - measure * ts.ticks;
    const weight = metricWeight(ts, within);
    const chord = chordAt(chords, ts, chordsPerMeasure, ev.onset);
    const isLast = i === sounded.length - 1;
    const target = archTarget(measure, measures, lowDia, highDia);

    // Decide whether this slot must be a chord tone.
    let requireChordTone;
    if (isLast || weight === 2) requireChordTone = true;
    else if (weight === 1) requireChordTone = rng.chance(1 - nonChordRate * 0.5);
    else requireChordTone = rng.chance(1 - nonChordRate);
    if (lastLeap >= 3) requireChordTone = false; // a leap wants a stepwise answer

    let candidates = [];
    for (let d = lowDia; d <= highDia; d++) {
      if (requireChordTone && !isChordTone(key, chord, d)) continue;
      candidates.push(d);
    }
    if (!candidates.length) {
      for (let d = lowDia; d <= highDia; d++) candidates.push(d);
    }

    let chosen;
    if (isLast) {
      // Land on the tonic, in the octave closest to where the line has been.
      const tonics = candidates.filter((d) => isTonic(key, d));
      const pool = tonics.length ? tonics : candidates;
      chosen = nearest(pool, prev ? prev.dia : target);
    } else if (!prev) {
      const pool = candidates.filter((d) => Math.abs(d - target) <= 3);
      chosen = (pool.length ? pool : candidates)[rng.int((pool.length ? pool : candidates).length)];
    } else {
      const weights = candidates.map((d) => {
        const dist = Math.abs(d - prev.dia);
        if (dist > maxLeap) return 0;
        // Answer a leap by stepping back the other way.
        if (lastLeap >= 3) {
          if (dist !== 1) return 0.02;
          const back = Math.sign(d - prev.dia) !== Math.sign(lastLeapDir);
          return back ? 6 : 0.4;
        }
        let w;
        if (dist === 0) w = 0.15;
        else if (dist === 1) w = stepwiseBias * 6;
        else if (dist === 2) w = (1 - stepwiseBias) * 5;
        else w = (1 - stepwiseBias) * 3 / dist;
        // Pull toward the phrase arch.
        w *= Math.exp(-Math.abs(d - target) / 5);
        return Math.max(w, 0.005);
      });
      chosen = rng.weighted(candidates, weights);
    }

    lastLeapDir = prev ? Math.sign(chosen - prev.dia) : 0;
    lastLeap = prev ? Math.abs(chosen - prev.dia) : 0;

    // Spell it. Chromatic inflection turns a stepwise passing tone into an
    // accidental, which is how accidentals actually appear in real music.
    let p;
    const stepwiseRun = prev && Math.abs(chosen - prev.dia) === 1 && !isLast && weight === 0;
    if (chromaticRate > 0 && stepwiseRun && !isChordTone(key, chord, chosen) && rng.chance(chromaticRate)) {
      const dir = Math.sign(chosen - prev.dia);
      const base = spellInKey(key, chosen);
      p = fromDia(chosen, clamp(base.alter + dir, -2, 2));
    } else {
      p = spellChordTone(key, chord, chosen);
    }

    notes.push({
      onset: ev.onset,
      duration: ev.duration,
      rest: false,
      pitches: [p],
      tags: ev.tags,
      cellId: ev.cellId,
      chordTone: isChordTone(key, chord, chosen),
    });
    prev = p;
  }

  // Re-interleave rests so the engraver sees a continuous stream.
  const rests = rhythm.filter((e) => e.rest).map((e) => ({
    onset: e.onset, duration: e.duration, rest: true, pitches: [], tags: e.tags, cellId: e.cellId,
  }));
  return [...notes, ...rests].sort((a, b) => a.onset - b.onset);
}

function isTonic(key, dia) {
  return ((dia % 7) + 7) % 7 === tonicLetter(key);
}

function nearest(pool, ref) {
  let best = pool[0];
  let bestD = Infinity;
  for (const d of pool) {
    const dist = Math.abs(d - ref);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Left-hand textures
// ---------------------------------------------------------------------------

/** Largest offered subdivision that divides the slot exactly. */
function pickUnit(slotTicks, candidates) {
  for (const u of candidates) if (slotTicks % u === 0) return u;
  return candidates[candidates.length - 1];
}

function buildLeftHand(rng, opts) {
  const { key, ts, chords, chordsPerMeasure, measures, style, lowDia, highDia } = opts;
  const notes = [];
  const slotTicks = ts.ticks / chordsPerMeasure;
  let prevVoicing = null;
  let spelledFallback = null;

  for (let m = 0; m < measures; m++) {
    for (let s = 0; s < chordsPerMeasure; s++) {
      const chord = chords[Math.min(chords.length - 1, m * chordsPerMeasure + s)];
      const onset = m * ts.ticks + s * slotTicks;
      const voicing = voiceChord(key, chord, prevVoicing, { lowDia, highDia });
      prevVoicing = voicing;
      const spelled = spellVoicing(key, chord, voicing);
      spelledFallback = spelled[0];
      const isFinal = m === measures - 1;

      if (isFinal || style === 'sustained') {
        notes.push(mk(onset, slotTicks, spelled, ['blocked']));
        continue;
      }

      switch (style) {
        case 'roots':
          notes.push(mk(onset, slotTicks, [spelled[0]], ['root']));
          break;
        case 'blocked':
          notes.push(mk(onset, slotTicks, spelled, ['blocked']));
          break;
        case 'alberti': {
          // low - high - middle - high, the classical figure.
          const order = [0, spelled.length - 1, Math.min(1, spelled.length - 1), spelled.length - 1];
          const unit = pickUnit(slotTicks, [TPQ / 2, TPQ]);
          tile(onset, slotTicks, unit, (i) => [spelled[order[i % order.length]]], 'alberti');
          break;
        }
        case 'broken': {
          const unit = pickUnit(slotTicks, ts.compound ? [TPQ * 1.5, TPQ / 2] : [TPQ, TPQ / 2]);
          tile(onset, slotTicks, unit, (i) => [spelled[i % 2 === 0 ? 0 : Math.min(2, spelled.length - 1)]], 'broken');
          break;
        }
        case 'waltz': {
          // Needs at least a two-note upper chord; a cramped range gives none.
          const upper = spelled.length > 1 ? spelled.slice(1) : spelled;
          if (ts.beats === 3 && !ts.compound) {
            notes.push(mk(onset, ts.beat, [spelled[0]], ['bass']));
            notes.push(mk(onset + ts.beat, ts.beat, upper, ['chord']));
            notes.push(mk(onset + 2 * ts.beat, ts.beat, upper, ['chord']));
          } else {
            notes.push(mk(onset, slotTicks, spelled, ['blocked']));
          }
          break;
        }
        default:
          notes.push(mk(onset, slotTicks, spelled, ['blocked']));
      }
    }
  }

  // Merge repeated blocked chords across a bar so ties/held notes read cleanly.
  return notes.sort((a, b) => a.onset - b.onset);

  function mk(onset, duration, pitches, tags) {
    return {
      onset, duration, rest: false, tags, cellId: 'lh',
      pitches: pitches.length ? pitches : [spelledFallback],
    };
  }

  /** Repeat a figure across a slot, never spilling past its end. */
  function tile(onset, slotTicks, unit, pick, tag) {
    let t = 0;
    for (let i = 0; t < slotTicks; i++) {
      const d = Math.min(unit, slotTicks - t);
      notes.push(mk(onset + t, d, pick(i), [tag]));
      t += d;
    }
  }
}

/** An independent left-hand melodic line, for two-voice contrapuntal levels. */
function buildLeftHandMelody(rng, opts) {
  const rhythm = buildRhythm(rng, opts.ts, opts.cellIds, opts.measures, opts.restRate);
  return assignPitches(rng, { ...opts, rhythm });
}

// ---------------------------------------------------------------------------
// Ornamental detail
// ---------------------------------------------------------------------------

const DYNAMIC_WORDS = ['p', 'mp', 'mf', 'f'];

function addDynamics(rng, notes, ts, measures) {
  const first = notes.find((n) => !n.rest);
  if (!first) return;
  const start = rng.pick(DYNAMIC_WORDS.slice(0, 3));
  first.dynamic = start;
  if (measures >= 8) {
    const mid = notes.find((n) => n.onset >= Math.floor(measures / 2) * ts.ticks && !n.rest);
    if (mid) {
      const others = DYNAMIC_WORDS.filter((d) => d !== start);
      mid.dynamic = rng.pick(others);
    }
  }
}

function addArticulations(rng, notes, ts) {
  for (const n of notes) {
    if (n.rest) continue;
    const within = n.onset % ts.ticks;
    if (n.duration <= TPQ / 2 && rng.chance(0.12)) n.articulation = 'staccato';
    else if (within === 0 && rng.chance(0.1)) n.articulation = 'accent';
    else if (n.duration >= TPQ * 2 && rng.chance(0.15)) n.articulation = 'tenuto';
  }
}

function buildSlurs(rng, notes, ts, measures) {
  const slurs = [];
  for (let m = 0; m + 1 < measures; m += 2) {
    const from = notes.find((n) => !n.rest && n.onset >= m * ts.ticks);
    const within = notes.filter((n) => !n.rest && n.onset < (m + 2) * ts.ticks);
    const to = within[within.length - 1];
    if (from && to && to.onset > from.onset) slurs.push({ hand: 'rh', from: from.onset, to: to.onset });
  }
  return slurs;
}

/** Naive but useful fingering hints: step to a neighbouring finger, reset on a leap. */
function addFingerings(notes) {
  let finger = 1;
  let prevDia = null;
  for (const n of notes) {
    if (n.rest || !n.pitches.length) continue;
    const dia = n.pitches[0].dia;
    if (prevDia === null) finger = 1;
    else {
      const step = dia - prevDia;
      if (Math.abs(step) === 0) { /* keep the finger */ }
      else if (Math.abs(step) === 1) finger = clamp(finger + Math.sign(step), 1, 5);
      else finger = clamp(finger + step, 1, 5);
    }
    n.fingering = finger;
    prevDia = dia;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const DEFAULT_PARAMS = {
  keyMode: 'major',
  keyFifths: 0,
  timeSignature: '4/4',
  measures: 8,
  tempo: 72,
  hands: 'both',
  rhythmTags: ['eighth'],
  cells: null,
  rhLow: 28, rhHigh: 35,     // C4 – B4 by default
  lhLow: 18, lhHigh: 25,     // F2 – F3
  maxLeap: 3,
  stepwiseBias: 0.72,
  nonChordRate: 0.3,
  chromaticRate: 0,
  lhStyle: 'blocked',
  lhCells: null,
  chordsPerMeasure: 1,
  allowSevenths: false,
  allowInversions: false,
  dynamics: true,
  articulations: false,
  slurs: false,
  fingerings: false,
  restRate: 0.12,
};

const ORDINALS = ['No. 1', 'No. 2', 'No. 3', 'No. 4', 'No. 5', 'No. 6', 'No. 7', 'No. 8', 'No. 9', 'No. 10'];

export function generateExercise(userParams = {}) {
  const params = { ...DEFAULT_PARAMS, ...userParams };
  const seed = params.seed >>> 0;
  const rng = makeRng(seed);
  const key = { fifths: params.keyFifths, mode: params.keyMode };
  const ts = timeSig(params.timeSignature);
  const measures = params.measures;
  // A harmonic rhythm only works if each chord slot is a whole number of beats.
  const slot = ts.ticks / params.chordsPerMeasure;
  const chordsPerMeasure = Number.isInteger(slot) && slot % ts.beat === 0
    ? params.chordsPerMeasure : 1;
  // Levels and the custom panel speak in rhythm tags; resolve to legal cells.
  const cells = params.cells && params.cells.length
    ? resolveCells(null, ts).concat(params.cells).filter((id, i, a) => a.indexOf(id) === i)
    : resolveCells(params.rhythmTags, ts);

  const chords = planProgression(rng, {
    measures,
    chordsPerMeasure,
    allowSevenths: params.allowSevenths,
    allowInversions: params.allowInversions,
    mode: key.mode,
  });

  const staves = { rh: [], lh: [] };
  const wantsRh = params.hands === 'both' || params.hands === 'rh';
  const wantsLh = params.hands === 'both' || params.hands === 'lh';

  if (wantsRh) {
    const rhythm = buildRhythm(rng, ts, cells, measures, params.restRate);
    staves.rh = assignPitches(rng, {
      key, ts, chords, chordsPerMeasure, rhythm, measures,
      lowDia: params.rhLow, highDia: params.rhHigh,
      maxLeap: params.maxLeap, stepwiseBias: params.stepwiseBias,
      nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
    });
  }

  if (wantsLh) {
    if (params.lhStyle === 'melodic') {
      staves.lh = buildLeftHandMelody(rng, {
        key, ts, chords, chordsPerMeasure, measures,
        cellIds: params.lhCells || cells,
        restRate: params.restRate,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: Math.min(params.maxLeap, 4), stepwiseBias: Math.min(0.85, params.stepwiseBias + 0.1),
        nonChordRate: params.nonChordRate * 0.7, chromaticRate: 0,
      });
    } else if (params.hands === 'lh') {
      // Left hand alone gets the melody, not an accompaniment pattern.
      const rhythm = buildRhythm(rng, ts, cells, measures, params.restRate);
      staves.lh = assignPitches(rng, {
        key, ts, chords, chordsPerMeasure, rhythm, measures,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: params.maxLeap, stepwiseBias: params.stepwiseBias,
        nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
      });
    } else {
      staves.lh = buildLeftHand(rng, {
        key, ts, chords, chordsPerMeasure, measures,
        style: params.lhStyle, lowDia: params.lhLow, highDia: params.lhHigh,
      });
    }
  }

  for (const hand of ['rh', 'lh']) {
    for (const n of staves[hand]) n.hand = hand;
  }

  const lead = staves.rh.length ? staves.rh : staves.lh;
  if (params.dynamics) addDynamics(rng, lead, ts, measures);
  if (params.articulations) addArticulations(rng, lead, ts);
  if (params.fingerings && staves.rh.length) addFingerings(staves.rh);
  const slurs = params.slurs && staves.rh.length ? buildSlurs(rng, staves.rh, ts, measures) : [];

  const keyName = KEY_NAMES[key.mode][String(key.fifths)];
  const title = `Study in ${key.mode === 'minor' ? keyName.toUpperCase() : keyName} ${key.mode}, ${ORDINALS[seed % ORDINALS.length]}`;

  return {
    seed,
    key,
    ts,
    tempo: params.tempo,
    measures,
    chords,
    chordsPerMeasure,
    staves,
    slurs,
    title,
    params,
    totalTicks: measures * ts.ticks,
  };
}

/** Flat, time-ordered list of expected note events — the grader's reference. */
export function expectedEvents(score) {
  const out = [];
  for (const hand of ['rh', 'lh']) {
    for (const note of score.staves[hand] || []) {
      if (note.rest) continue;
      for (const p of note.pitches) {
        out.push({
          midi: p.midi,
          pitch: p,
          onset: note.onset,
          duration: note.duration,
          hand,
          tags: note.tags,
          cellId: note.cellId,
        });
      }
    }
  }
  return out.sort((a, b) => a.onset - b.onset || a.midi - b.midi);
}

/** Convert ticks to seconds at the score's tempo (tempo is per quarter note). */
export function ticksToSeconds(score, ticks) {
  return (ticks / TPQ) * (60 / score.tempo);
}
