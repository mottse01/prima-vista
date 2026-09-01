// Exercise generator.
//
// Produces a fully spelled, phrase-shaped piano exercise from a parameter set
// and a seed. Deterministic: the same seed *and parameters* always yield the
// same music, which is what makes exact exercise links shareable and assignable.

import {
  TPQ, clamp, fromDia, isChordTone, spellInKey, spellChordTone, tonicLetter, KEY_NAMES,
} from './theory.js';
import { getCell, metricWeight, resolveCells, timeSig } from './rhythm.js';
import { planProgression, spellVoicing, voiceChord } from './harmony.js';
import { reviewMusicality } from './musicality.js';
import { makeRng } from './rng.js';

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

/** Fill one measure with rhythm cells drawn from the allowed vocabulary. */
function fillMeasure(rng, ts, cellIds, { restRate, offsetTicks, requiredTag = null }) {
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

    // Adaptive drills promise to put the diagnosed rhythm into the music, not
    // merely make it one of many possibilities. Put one legal focus cell at
    // the opening of an assigned bar; the rest of the line remains varied.
    const focused = pos === 0 && requiredTag
      ? usable.filter((c) => c.tags.includes(requiredTag))
      : [];
    const cell = focused.length ? rng.pick(focused) : rng.weighted(usable, weights);
    let t = offsetTicks + pos;
    for (const ev of cell.events) {
      events.push({ onset: t, duration: ev.d, rest: ev.rest, tags: cell.tags, cellId: cell.id });
      t += ev.d;
    }
    pos += cell.ticks;
  }
  return events;
}

/**
 * Give an exercise an audible form before choosing any notes.
 *
 * Each four-bar phrase states a two-bar idea and answers it. Longer exercises
 * introduce a contrasting B idea before returning to A. The apostrophes mean
 * variation, not literal duplication, which is how short pedagogical studies
 * stay recognisable without becoming memorisation drills.
 */
export function planMusicalForm(measures) {
  const phraseCount = Math.max(1, Math.ceil(measures / 4));
  let name;
  let sections;
  if (phraseCount === 1) { name = 'Four-bar phrase'; sections = ['A']; }
  else if (phraseCount === 2) { name = 'Parallel period'; sections = ['A', 'A′']; }
  else if (phraseCount === 3) { name = 'Ternary miniature'; sections = ['A', 'B', 'A′']; }
  else if (phraseCount === 4) { name = 'Rounded binary'; sections = ['A', 'A′', 'B', 'A″']; }
  else if (phraseCount === 5) { name = 'Arch form'; sections = ['A', 'B', 'C', 'B′', 'A′']; }
  else if (phraseCount === 6) { name = 'Extended ternary'; sections = ['A', 'A′', 'B', 'B′', 'A', 'A″']; }
  else {
    name = 'AABA song form';
    sections = ['A', 'A′', 'A', 'A″', 'B', 'B′', 'A', 'A‴'];
  }

  while (sections.length < phraseCount) sections.splice(sections.length - 1, 0, 'B′');
  sections = sections.slice(0, phraseCount);

  const plan = [];
  for (let m = 0; m < measures; m++) {
    const phrase = Math.min(sections.length - 1, Math.floor(m / 4));
    const section = sections[phrase];
    const base = section.charAt(0);
    const barInPhrase = m % 4;
    const motifBar = barInPhrase % 2;
    const variant = (section.match(/[′″‴]/g) || []).reduce((count, mark) => (
      count + (mark === '′' ? 1 : mark === '″' ? 2 : 3)
    ), 0);
    plan.push({
      measure: m,
      phrase,
      section,
      motifKey: `${base}${motifBar}`,
      role: phrase === 0 && barInPhrase < 2
        ? 'statement'
        : base === 'B' && !plan.some((p) => p.motifKey === `${base}${motifBar}`)
          ? 'contrast'
          : variant >= 2 || (phrase === sections.length - 1 && base === 'A')
            ? 'return'
            : 'echo',
      shift: variant === 1 ? (base === 'A' ? 1 : -1) : 0,
      cadence: barInPhrase === 3 || m === measures - 1,
    });
  }

  return { name, label: sections.join('–'), sections, plan, phraseLength: 4 };
}

function realiseCadenceAttack(events, arrivalOnset) {
  const realised = [];
  for (const event of events) {
    const end = event.onset + event.duration;
    if (event.onset < arrivalOnset && arrivalOnset < end) {
      realised.push({ ...event, duration: arrivalOnset - event.onset });
      realised.push({
        ...event,
        onset: arrivalOnset,
        duration: end - arrivalOnset,
        rest: false,
        tags: [...event.tags, 'cadence-arrival'],
        motifIndex: Number(event.motifIndex || 0) + 0.5,
        cadenceArrival: true,
      });
    } else if (event.onset === arrivalOnset) {
      realised.push({
        ...event,
        rest: false,
        tags: [...event.tags, 'cadence-arrival'],
        cadenceArrival: true,
      });
    } else {
      realised.push(event);
    }
  }
  return realised;
}

/** Rhythm for the whole line, with motivic echoes and cadential arrivals. */
function buildRhythm(
  rng,
  ts,
  cellIds,
  measures,
  restRate,
  focusTags = [],
  form = planMusicalForm(measures),
  chordsPerMeasure = 1,
) {
  const out = [];
  const required = [...new Set(focusTags)].slice(0, Math.max(0, measures - 1));
  const prototypes = new Map();
  let focusIndex = 0;

  for (let m = 0; m < measures; m++) {
    const offsetTicks = m * ts.ticks;
    const spec = form.plan[m];
    if (m === measures - 1) {
      const slotTicks = ts.ticks / chordsPerMeasure;
      for (let slot = 0; slot < chordsPerMeasure; slot++) {
        out.push({
          onset: offsetTicks + slot * slotTicks,
          duration: slotTicks,
          rest: false,
          tags: ['final', 'cadence', slot === chordsPerMeasure - 1 ? 'cadence-arrival' : 'cadence-approach'],
          cellId: 'final',
          motifKey: null,
          motifIndex: slot,
          motifRole: 'cadence',
          motifShift: 0,
          cadenceArrival: slot === chordsPerMeasure - 1,
          section: spec?.section || 'A',
        });
      }
      continue;
    }

    let relative = prototypes.get(spec.motifKey);
    if (!relative) {
      const generated = fillMeasure(rng, ts, cellIds, {
        restRate,
        offsetTicks: 0,
        requiredTag: required[focusIndex] || null,
      });
      if (required[focusIndex]) focusIndex += 1;
      relative = generated.map((event, motifIndex) => ({ ...event, motifIndex }));
      prototypes.set(spec.motifKey, relative);
    }

    let measureEvents = relative.map((event) => ({
      ...event,
      onset: event.onset + offsetTicks,
      motifKey: spec.motifKey,
      motifRole: spec.role,
      motifShift: spec.shift,
      section: spec.section,
      tags: spec.cadence ? [...event.tags, 'phrase-end'] : event.tags,
    }));
    if (spec.cadence) {
      const arrivalOnset = offsetTicks + ts.ticks - ts.ticks / chordsPerMeasure;
      measureEvents = realiseCadenceAttack(measureEvents, arrivalOnset);
    }
    out.push(...measureEvents);
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
    focusIntervals = [], cadences = [],
  } = opts;

  const notes = [];
  let prev = null;
  let lastLeap = 0;
  let lastLeapDir = 0;
  let focusIndex = 0;
  const motifPitches = new Map();

  const sounded = rhythm.filter((e) => !e.rest);
  const cadenceByMeasure = new Map(cadences.map((item) => [item.measure, item]));
  const lastSoundedByMeasure = new Map();
  sounded.forEach((event, i) => lastSoundedByMeasure.set(Math.floor(event.onset / ts.ticks), i));

  for (let i = 0; i < sounded.length; i++) {
    const ev = sounded[i];
    const measure = Math.floor(ev.onset / ts.ticks);
    const within = ev.onset - measure * ts.ticks;
    const weight = metricWeight(ts, within);
    const cadence = cadenceByMeasure.get(measure);
    const isCadenceArrival = Boolean(ev.cadenceArrival)
      || Boolean(cadence && lastSoundedByMeasure.get(measure) === i);
    const chord = isCadenceArrival && cadence
      ? chords[cadence.slots[cadence.slots.length - 1]]
      : chordAt(chords, ts, chordsPerMeasure, ev.onset);
    const isLast = i === sounded.length - 1;
    const target = archTarget(measure, measures, lowDia, highDia);
    const motifId = ev.motifKey ? `${ev.motifKey}:${ev.motifIndex}` : null;
    const remembered = motifId ? motifPitches.get(motifId) : null;
    const motifTarget = remembered == null ? null : remembered + (ev.motifShift || 0);

    // Decide whether this slot must be a chord tone.
    let requireChordTone;
    if (isLast || isCadenceArrival || weight === 2) requireChordTone = true;
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
    if (isCadenceArrival) {
      // The melodic arrival defines the cadence: tonic for PAC/plagal, the
      // third for IAC, dominant for half cadences, and vi/VI for deceptive ones.
      const targets = candidates.filter((d) => scaleDegree(key, d) === cadence.melodyDegree);
      const pool = targets.length ? targets : candidates;
      chosen = nearest(pool, prev ? prev.dia : target);
    } else if (!prev) {
      const pool = candidates.filter((d) => Math.abs(d - target) <= 3);
      chosen = (pool.length ? pool : candidates)[rng.int((pool.length ? pool : candidates).length)];
    } else {
      const focus = focusIntervals[focusIndex];
      let focusApplied = false;
      if (focus) {
        const matches = (d) => {
          const distance = Math.abs(d - prev.dia);
          if (focus === 'step') return distance === 1;
          if (focus === 'skip') return distance === 2;
          return focus === 'leap' && distance >= 3 && distance <= maxLeap;
        };
        let focused = candidates.filter(matches);
        if (!focused.length) {
          focused = Array.from({ length: highDia - lowDia + 1 }, (_, j) => lowDia + j).filter(matches);
        }
        if (focused.length) {
          candidates = focused;
          focusIndex += 1;
          focusApplied = true;
        }
      }

      if (motifTarget != null && !focusApplied) {
        let legal = candidates.filter((d) => Math.abs(d - prev.dia) <= maxLeap);
        if (lastLeap >= 3) {
          const resolving = legal.filter((d) => (
            Math.abs(d - prev.dia) === 1
            && Math.sign(d - prev.dia) !== Math.sign(lastLeapDir)
          ));
          if (resolving.length) legal = resolving;
        }
        if (legal.length) {
          const closest = Math.min(...legal.map((d) => Math.abs(d - motifTarget)));
          candidates = legal.filter((d) => Math.abs(d - motifTarget) === closest);
        }
      }

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
        // Echo the stated motif clearly, while allowing the current harmony to
        // bend it by a nearby scale step. A focused adaptive interval wins.
        if (motifTarget != null && !focusApplied) {
          w *= 0.55 + 16 * Math.exp(-Math.abs(d - motifTarget) * 1.25);
        }
        return Math.max(w, 0.005);
      });
      chosen = rng.weighted(candidates, weights);
    }

    lastLeapDir = prev ? Math.sign(chosen - prev.dia) : 0;
    lastLeap = prev ? Math.abs(chosen - prev.dia) : 0;

    // Spell it. Chromatic inflection turns a stepwise passing tone into an
    // accidental, which is how accidentals actually appear in real music.
    let p;
    const stepwiseRun = prev && Math.abs(chosen - prev.dia) === 1 && !isCadenceArrival && weight === 0;
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
      motifKey: ev.motifKey || null,
      motifRole: ev.motifRole || null,
      section: ev.section || null,
      cadence: isCadenceArrival ? cadence.id : null,
    });
    if (motifId && !motifPitches.has(motifId)) motifPitches.set(motifId, chosen);
    prev = p;
  }

  // Re-interleave rests so the engraver sees a continuous stream.
  const rests = rhythm.filter((e) => e.rest).map((e) => ({
    onset: e.onset, duration: e.duration, rest: true, pitches: [], tags: e.tags, cellId: e.cellId,
    motifKey: e.motifKey || null, motifRole: e.motifRole || null, section: e.section || null,
  }));
  return [...notes, ...rests].sort((a, b) => a.onset - b.onset);
}

function scaleDegree(key, dia) {
  return (((dia - tonicLetter(key)) % 7) + 7) % 7;
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
  const rhythm = buildRhythm(
    rng, opts.ts, opts.cellIds, opts.measures, opts.restRate, [], opts.form, opts.chordsPerMeasure,
  );
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

function composeCandidate(userParams = {}, attempt = 0) {
  const params = { ...DEFAULT_PARAMS, ...userParams };
  const seed = params.seed >>> 0;
  const candidateSeed = attempt === 0 ? seed : (seed + Math.imul(attempt, 0x9e3779b9)) >>> 0;
  const rng = makeRng(candidateSeed);
  const key = { fifths: params.keyFifths, mode: params.keyMode };
  const ts = timeSig(params.timeSignature);
  const measures = params.measures;
  const form = planMusicalForm(measures);
  // A harmonic rhythm only works if each chord slot is a whole number of beats.
  const slot = ts.ticks / params.chordsPerMeasure;
  const chordsPerMeasure = Number.isInteger(slot) && slot % ts.beat === 0
    ? params.chordsPerMeasure : 1;
  // Levels and the custom panel speak in rhythm tags; resolve to legal cells.
  const cells = params.cells && params.cells.length
    ? resolveCells(null, ts).concat(params.cells).filter((id, i, a) => a.indexOf(id) === i)
    : resolveCells(params.rhythmTags, ts);

  const leadLow = params.hands === 'lh' ? params.lhLow : params.rhLow;
  const leadHigh = params.hands === 'lh' ? params.lhHigh : params.rhHigh;
  const melodyDegrees = [...new Set(Array.from(
    { length: Math.max(0, leadHigh - leadLow + 1) },
    (_, i) => scaleDegree(key, leadLow + i),
  ))];

  const harmonyPlan = planProgression(rng, {
    measures,
    chordsPerMeasure,
    allowSevenths: params.allowSevenths,
    allowInversions: params.allowInversions,
    mode: key.mode,
    form,
    melodyDegrees,
  });
  const { chords } = harmonyPlan;

  const staves = { rh: [], lh: [] };
  const wantsRh = params.hands === 'both' || params.hands === 'rh';
  const wantsLh = params.hands === 'both' || params.hands === 'lh';

  if (wantsRh) {
    const rhythm = buildRhythm(
      rng, ts, cells, measures, params.restRate, params.focusRhythmTags, form, chordsPerMeasure,
    );
    staves.rh = assignPitches(rng, {
      key, ts, chords, chordsPerMeasure, rhythm, measures,
      lowDia: params.rhLow, highDia: params.rhHigh,
      maxLeap: params.maxLeap, stepwiseBias: params.stepwiseBias,
      nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
      focusIntervals: params.focusIntervals,
      cadences: harmonyPlan.progression.cadences,
    });
  }

  if (wantsLh) {
    if (params.lhStyle === 'melodic') {
      staves.lh = buildLeftHandMelody(rng, {
        key, ts, chords, chordsPerMeasure, measures,
        form,
        cellIds: params.lhCells || cells,
        restRate: params.restRate,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: Math.min(params.maxLeap, 4), stepwiseBias: Math.min(0.85, params.stepwiseBias + 0.1),
        nonChordRate: params.nonChordRate * 0.7, chromaticRate: 0,
        cadences: harmonyPlan.progression.cadences,
      });
    } else if (params.hands === 'lh') {
      // Left hand alone gets the melody, not an accompaniment pattern.
      const rhythm = buildRhythm(
        rng, ts, cells, measures, params.restRate, params.focusRhythmTags, form, chordsPerMeasure,
      );
      staves.lh = assignPitches(rng, {
        key, ts, chords, chordsPerMeasure, rhythm, measures,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: params.maxLeap, stepwiseBias: params.stepwiseBias,
        nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
        focusIntervals: params.focusIntervals,
        cadences: harmonyPlan.progression.cadences,
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
  const title = `Motivic Study in ${key.mode === 'minor' ? keyName.toUpperCase() : keyName} ${key.mode}, ${ORDINALS[seed % ORDINALS.length]}`;

  return {
    seed,
    key,
    ts,
    tempo: params.tempo,
    measures,
    chords,
    chordsPerMeasure,
    harmony: harmonyPlan.progression,
    form: { name: form.name, label: form.label, sections: form.sections, phraseLength: form.phraseLength },
    staves,
    slurs,
    title,
    params,
    totalTicks: measures * ts.ticks,
  };
}

const COMPOSITION_CANDIDATES = 4;

/**
 * Compose several deterministic candidates, run the same musicality rubric on
 * each, and retain the strongest one. The public seed remains stable, so exact
 * links still regenerate the same accepted exercise.
 */
export function generateExercise(userParams = {}) {
  let best = null;
  let bestReview = null;
  let selectedAttempt = 0;

  for (let attempt = 0; attempt < COMPOSITION_CANDIDATES; attempt++) {
    const candidate = composeCandidate(userParams, attempt);
    const review = reviewMusicality(candidate);
    const stronger = !best
      || (review.passed && !bestReview.passed)
      || (review.passed === bestReview.passed && review.score > bestReview.score);
    if (stronger) {
      best = candidate;
      bestReview = review;
      selectedAttempt = attempt;
    }
  }

  best.compositionReview = {
    ...bestReview,
    candidates: COMPOSITION_CANDIDATES,
    selectedAttempt,
  };
  return best;
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
