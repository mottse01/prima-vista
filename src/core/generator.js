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
import { validateExercise } from './validator.js';
import { makeRng } from './rng.js';
import { formForStyle, resolveCompositionStyle } from './compositionStyles.js';
import { levelById } from './levels.js';
import { repertoireExercise } from './repertoire.js';
import { chooseFragment } from './fragments.js';

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
export function planMusicalForm(measures, styleId = 'classical_early', rng = null, level = 1) {
  return formForStyle(styleId, measures, rng, level);
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

/** Give continuation/chorus phrases perceptibly greater rhythmic momentum. */
function transformRhythm(events, ts, spec, canSubdivide) {
  if (!canSubdivide || !spec || spec.density < 3) return events;
  const transformed = [];
  for (const event of events) {
    const maySplit = !event.rest
      && event.duration >= ts.beat
      && event.duration % 2 === 0;
    if (!maySplit) {
      transformed.push(event);
      continue;
    }
    const half = event.duration / 2;
    transformed.push({ ...event, duration: half, tags: [...event.tags, 'formal-fragment'] });
    transformed.push({
      ...event,
      onset: event.onset + half,
      duration: half,
      motifIndex: Number(event.motifIndex || 0) + 0.5,
      tags: [...event.tags, 'formal-fragment'],
    });
  }
  return transformed;
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
  fragment = null,
  fragmentShift = 0,
) {
  const out = [];
  const required = [...new Set(focusTags)].slice(0, Math.max(0, measures - 1));
  const firstUnit = form.units?.[0] || { bars: [0, Math.min(1, measures - 1)] };
  const motifBars = Math.max(1, firstUnit.bars[1] - firstUnit.bars[0] + 1);
  const canSubdivide = cellIds.some((id) => {
    const cell = getCell(id);
    return cell?.tags?.some((tag) => ['eighth', 'sixteenth', 'triplet'].includes(tag));
  });
  const prototypes = Array.from({ length: motifBars }, (_, index) => {
    const fragmentEvents = fragment?.events?.filter((event) => event.bar === index);
    if (fragmentEvents?.length) {
      let onset = 0;
      return fragmentEvents.map((event, motifIndex) => {
        const duration = event.dur * TPQ;
        const value = {
          onset, duration, rest: false, tags: ['fragment-library'], cellId: fragment.id,
          motifIndex: `${index}:${motifIndex}`, fragmentDegree: event.degree,
          fragmentShift,
        };
        onset += duration;
        return value;
      });
    }
    let events = [];
    // Once subdivisions are in the learner's vocabulary, avoid skeletal
    // one- or two-attack bars. Besides reading more idiomatically, a denser
    // motif carries enough information for independently seeded studies to
    // remain genuinely distinct.
    for (let draw = 0; draw < 5; draw++) {
      events = fillMeasure(rng, ts, cellIds, {
        restRate, offsetTicks: 0, requiredTag: required[index] || null,
      });
      if (!canSubdivide || events.filter((event) => !event.rest).length >= 3) break;
    }
    return events.map((event, motifIndex) => ({ ...event, motifIndex: `${index}:${motifIndex}` }));
  });

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

    const unit = form.units?.[spec.unitIndex] || firstUnit;
    const barInUnit = m - unit.bars[0];
    const relative = prototypes[barInUnit % motifBars];

    const shaped = transformRhythm(relative, ts, spec, canSubdivide);
    let measureEvents = shaped.map((event) => ({
      ...event,
      onset: event.onset + offsetTicks,
      motifKey: 'motif',
      motifRole: spec.role,
      motifShift: spec.shift,
      section: spec.section,
      phraseFunction: spec.phraseFunction,
      formalTransform: spec.transform,
      tags: [
        ...event.tags,
        ...(spec.cadence ? ['phrase-end'] : []),
        ...(spec.transform && spec.transform !== 'motif' ? [`transform-${spec.transform}`] : []),
      ],
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
    focusIntervals = [], cadences = [], compositionStyle = null, form = null,
  } = opts;

  const styledStepwiseBias = clamp(
    stepwiseBias + (compositionStyle?.stepwiseAdjustment || 0), 0.25, 0.96,
  );
  const styledNonChordRate = clamp(
    nonChordRate * (compositionStyle?.nonChordMultiplier || 1), 0, 0.75,
  );
  const motifStrength = compositionStyle?.motifStrength || 16;

  const notes = [];
  let prev = null;
  let lastLeap = 0;
  let lastLeapDir = 0;
  let focusIndex = 0;
  let prevChord = null;
  const motifPitches = new Map();
  let motifAnchor = null;

  const sounded = rhythm.filter((e) => !e.rest);
  const cadenceByMeasure = new Map(cadences.map((item) => [item.measure, item]));
  const lastSoundedByMeasure = new Map();
  sounded.forEach((event, i) => lastSoundedByMeasure.set(Math.floor(event.onset / ts.ticks), i));
  const phraseStartIndices = new Set();
  const firstByPhrase = new Map();
  sounded.forEach((event, i) => {
    const phraseIndex = form?.plan?.[Math.floor(event.onset / ts.ticks)]?.unitIndex ?? 0;
    if (!firstByPhrase.has(phraseIndex)) {
      firstByPhrase.set(phraseIndex, i);
      phraseStartIndices.add(i);
    }
  });
  const highestEnergy = Math.max(1, ...(form?.phrases || []).map((item) => item.energy || 1));
  const desiredClimax = Math.round((sounded.length - 1) * (compositionStyle?.climaxPosition || 0.62));
  const climaxPool = sounded
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => (
      index > 0
      && index < sounded.length - 1
      && !event.cadenceArrival
      && (form?.plan?.[Math.floor(event.onset / ts.ticks)]?.energy || 1) === highestEnergy
    ));
  const climaxIndex = (climaxPool.length ? climaxPool : sounded.map((event, index) => ({ event, index })))
    .sort((a, b) => Math.abs(a.index - desiredClimax) - Math.abs(b.index - desiredClimax))[0]?.index ?? 0;
  const climaxEvent = sounded[climaxIndex];
  const climaxChord = climaxEvent ? chordAt(chords, ts, chordsPerMeasure, climaxEvent.onset) : chords[0];
  const climaxCandidates = [];
  for (let dia = lowDia; dia <= highDia; dia++) {
    if (isChordTone(key, climaxChord, dia)) climaxCandidates.push(dia);
  }
  const climaxDia = climaxCandidates.at(-1) ?? highDia;

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
    const phraseSpec = form?.plan?.[measure] || null;
    const target = archTarget(measure, measures, lowDia, highDia)
      + (phraseSpec?.registerShift || 0);
    const motifId = ev.motifKey ? `${ev.motifKey}:${ev.motifIndex}` : null;
    const remembered = motifId ? motifPitches.get(motifId) : null;
    let motifTarget = remembered == null ? null : remembered + (ev.motifShift || 0);
    if (motifTarget != null && motifAnchor != null && ev.formalTransform === 'invert') {
      motifTarget = motifAnchor - (remembered - motifAnchor);
    } else if (motifTarget != null && motifAnchor != null && ev.formalTransform === 'expand_intervals') {
      motifTarget = motifAnchor + Math.round((remembered - motifAnchor) * 1.35);
    }

    // Decide whether this slot must be a chord tone.
    let requireChordTone;
    if (isLast || isCadenceArrival || weight === 2 || phraseStartIndices.has(i) || i === climaxIndex) requireChordTone = true;
    else if (weight === 1) requireChordTone = rng.chance(1 - styledNonChordRate * 0.5);
    else requireChordTone = rng.chance(1 - styledNonChordRate);
    if (lastLeap >= 3) requireChordTone = false; // a leap wants a stepwise answer

    let candidates = [];
    for (let d = lowDia; d <= highDia; d++) {
      if (i !== climaxIndex && highDia - lowDia >= 4 && d >= climaxDia) continue;
      if (requireChordTone && !isChordTone(key, chord, d)) continue;
      candidates.push(d);
    }
    if (!candidates.length) {
      for (let d = lowDia; d <= highDia; d++) candidates.push(d);
    }

    let chosen;
    const fragmentTarget = ev.fragmentDegree
      ? (ev.fragmentDegree - 1 + (ev.fragmentShift || 0) + 70) % 7
      : null;
    if (i === climaxIndex) {
      chosen = climaxDia;
    } else if (isCadenceArrival) {
      // The melodic arrival defines the cadence: tonic for PAC/plagal, the
      // third for IAC, dominant for half cadences, and vi/VI for deceptive ones.
      const targets = candidates.filter((d) => scaleDegree(key, d) === cadence.melodyDegree);
      const pool = targets.length ? targets : candidates;
      chosen = nearest(pool, prev ? prev.dia : target);
    } else if (fragmentTarget != null && remembered == null) {
      const pool = candidates.filter((dia) => scaleDegree(key, dia) === fragmentTarget);
      chosen = nearest(pool.length ? pool : candidates, prev ? prev.dia : target);
    } else if (!prev) {
      const pool = candidates.filter((d) => Math.abs(d - target) <= 3);
      chosen = (pool.length ? pool : candidates)[rng.int((pool.length ? pool : candidates).length)];
    } else {
      // Resolve the two strongest tonal tendencies before applying decorative
      // motif preferences: the leading tone rises, and a chordal seventh falls.
      const previousDegree = scaleDegree(key, prev.dia);
      const previousWasLeading = previousDegree === 6 && prevChord?.fn === 'D';
      const previousWasSeventh = prevChord?.seventh
        && previousDegree === (prevChord.degree + 6) % 7;
      const tendencyTarget = previousWasLeading
        ? prev.dia + 1
        : previousWasSeventh ? prev.dia - 1 : null;
      if (tendencyTarget != null && candidates.includes(tendencyTarget)) {
        candidates = [tendencyTarget];
      }
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
        else if (dist === 1) w = styledStepwiseBias * 6;
        else if (dist === 2) w = (1 - styledStepwiseBias) * 5;
        else w = (1 - styledStepwiseBias) * 3 / dist;
        // Pull toward the phrase arch.
        w *= Math.exp(-Math.abs(d - target) / 5);
        // Echo the stated motif clearly, while allowing the current harmony to
        // bend it by a nearby scale step. A focused adaptive interval wins.
        if (motifTarget != null && !focusApplied) {
          w *= 0.55 + motifStrength * Math.exp(-Math.abs(d - motifTarget) * 1.25);
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
    const blueDegree = scaleDegree(key, chosen);
    const blueInflection = compositionStyle?.id === 'blues'
      && !isCadenceArrival
      && weight === 0
      && [2, 4, 6].includes(blueDegree)
      && rng.chance(compositionStyle.blueNoteRate || 0);
    if (blueInflection) {
      const base = spellInKey(key, chosen);
      p = fromDia(chosen, clamp(base.alter - 1, -2, 2));
    } else if (chromaticRate > 0 && stepwiseRun && !isChordTone(key, chord, chosen) && rng.chance(chromaticRate)) {
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
      tags: blueInflection ? [...ev.tags, 'blue-note'] : ev.tags,
      cellId: ev.cellId,
      chordTone: isChordTone(key, chord, chosen),
      motifKey: ev.motifKey || null,
      motifRole: ev.motifRole || null,
      section: ev.section || null,
      phraseFunction: ev.phraseFunction || phraseSpec?.function || null,
      formalTransform: ev.formalTransform || phraseSpec?.transform || null,
      energy: phraseSpec?.energy || 1,
      structural: i === climaxIndex ? 'climax' : phraseStartIndices.has(i) ? 'phrase-start' : null,
      cadence: isCadenceArrival ? cadence.id : null,
    });
    if (motifId && !motifPitches.has(motifId)) {
      motifPitches.set(motifId, chosen);
      if (motifAnchor == null) motifAnchor = chosen;
    }
    prev = p;
    prevChord = chord;
  }

  annotateMelodicFunctions(notes, key, chords, ts, chordsPerMeasure);

  // Re-interleave rests so the engraver sees a continuous stream.
  const rests = rhythm.filter((e) => e.rest).map((e) => ({
    onset: e.onset, duration: e.duration, rest: true, pitches: [], tags: e.tags, cellId: e.cellId,
    motifKey: e.motifKey || null, motifRole: e.motifRole || null, section: e.section || null,
    phraseFunction: e.phraseFunction || null, formalTransform: e.formalTransform || null,
  }));
  return [...notes, ...rests].sort((a, b) => a.onset - b.onset);
}

/** Classify decorative notes and record whether directed tendencies resolve. */
function annotateMelodicFunctions(notes, key, chords, ts, chordsPerMeasure) {
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const prev = notes[i - 1] || null;
    const next = notes[i + 1] || null;
    const chord = chordAt(chords, ts, chordsPerMeasure, note.onset);
    if (!note.chordTone) {
      const into = prev ? note.pitches[0].dia - prev.pitches[0].dia : null;
      const out = next ? next.pitches[0].dia - note.pitches[0].dia : null;
      if (into != null && out != null && Math.abs(into) === 1 && Math.abs(out) === 1) {
        if (Math.sign(into) === Math.sign(out)) note.nonChordKind = 'passing';
        else if (prev.pitches[0].dia === next.pitches[0].dia) note.nonChordKind = 'neighbour';
        else note.nonChordKind = 'embellishing';
      } else if (next && note.pitches[0].dia === next.pitches[0].dia) {
        note.nonChordKind = 'anticipation';
      } else {
        note.nonChordKind = 'appoggiatura';
      }
    } else {
      note.nonChordKind = null;
    }

    const degree = scaleDegree(key, note.pitches[0].dia);
    const chordalSeventh = chord.seventh && degree === (chord.degree + 6) % 7;
    const leadingTone = degree === 6 && chord.fn === 'D';
    if (leadingTone || chordalSeventh) {
      const expected = leadingTone ? note.pitches[0].dia + 1 : note.pitches[0].dia - 1;
      note.tendency = leadingTone ? 'leading-tone' : 'chordal-seventh';
      note.tendencyResolved = Boolean(next && next.pitches[0].dia === expected);
    }
  }
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
  const {
    key, ts, chords, chordsPerMeasure, measures, style, lowDia, highDia, form, compositionStyle,
    maxSimultaneous = 5,
  } = opts;
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
      const spelled = spellVoicing(key, chord, voicing).slice(0, maxSimultaneous);
      spelledFallback = spelled[0];
      const isFinal = m === measures - 1;
      const phraseSpec = form?.plan?.[m] || null;
      const sectionLift = compositionStyle?.id === 'pop' && (phraseSpec?.energy || 1) >= 3;

      if (isFinal || style === 'sustained') {
        notes.push(mk(onset, slotTicks, spelled, ['blocked']));
        continue;
      }

      switch (style) {
        case 'roots':
          notes.push(mk(onset, slotTicks, [spelled[0]], ['root']));
          if (sectionLift && spelled.at(-1)?.midi !== spelled[0]?.midi) {
            notes[notes.length - 1].pitches = [spelled[0], spelled.at(-1)];
            notes[notes.length - 1].tags.push('section-lift');
          }
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

function addDynamics(rng, notes, ts, measures, style) {
  const first = notes.find((n) => !n.rest);
  if (!first) return;
  const words = style.pack.expression.dynamics;
  const start = rng.pick(words.slice(0, Math.max(1, words.length - 1)));
  first.dynamic = start;
  if (measures >= 8) {
    const mid = notes.find((n) => n.onset >= Math.floor(measures / 2) * ts.ticks && !n.rest);
    if (mid) {
      const others = words.filter((d) => d !== start);
      mid.dynamic = rng.pick(others);
    }
  }
}

function addArticulations(rng, notes, ts, style) {
  const allowed = style.pack.expression.articulations;
  for (const n of notes) {
    if (n.rest) continue;
    const within = n.onset % ts.ticks;
    const candidates = allowed.filter((item) => (
      item === 'staccato' ? n.duration <= TPQ
        : item === 'tenuto' ? n.duration >= TPQ
          : item === 'accent' ? within === 0
            : false
    ));
    if (candidates.length && rng.chance(0.12)) n.articulation = rng.pick(candidates);
  }
}

function addOrnaments(rng, notes, level, style) {
  const policy = style.pack.expression.ornaments;
  const supported = policy.allowed.filter((name) => ['turn', 'mordent'].includes(name));
  if (level < policy.min_level || !supported.length) return;
  for (const note of notes) {
    if (!note.rest && note.chordTone && rng.chance(policy.density)) note.ornament = rng.pick(supported);
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
  generatorVersion: 2,
  sourceMode: 'generated',
  repertoireId: 'beethoven-ode-to-joy-theme',
  compositionStyle: 'auto',
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
  const style = resolveCompositionStyle(rng, params.compositionStyle, {
    timeSignature: params.timeSignature,
    measures,
    lhStyle: params.lhStyle,
    keyMode: params.keyMode,
    level: params.level || 10,
  });
  const level = params.level || 10;
  const constraints = params.level ? levelById(params.level).constraints : { simultaneous_notes: 5 };
  const form = planMusicalForm(measures, style.id, rng, level);
  const fragment = params.sourceMode === 'recombined'
    ? chooseFragment(rng, { meter: params.timeSignature, level })
    : null;
  const fragmentShift = fragment ? rng.pick([-2, -1, 1, 2]) : 0;
  // A harmonic rhythm only works if each chord slot is a whole number of beats.
  const slot = ts.ticks / params.chordsPerMeasure;
  const chordsPerMeasure = Number.isInteger(slot) && slot % ts.beat === 0
    ? params.chordsPerMeasure : 1;
  // Levels and the custom panel speak in rhythm tags; resolve to legal cells.
  const levelCells = params.cells && params.cells.length
    ? resolveCells(null, ts).concat(params.cells).filter((id, i, a) => a.indexOf(id) === i)
    : resolveCells(params.rhythmTags, ts);
  const packCells = new Set(style.pack.rhythm_cells
    .filter((cell) => cell.min_level <= level && cell.meter === (ts.compound ? 'compound' : 'simple'))
    .map((cell) => cell.id));
  const cells = levelCells.filter((id) => packCells.has(id));
  for (const tag of params.focusRhythmTags || []) {
    for (const id of levelCells) {
      if (getCell(id)?.tags?.includes(tag) && !cells.includes(id)) cells.push(id);
    }
  }
  if (!cells.length) cells.push(...levelCells.filter((id) => ['q', 'h', 'w', 'cdq', 'cdh'].includes(id)));

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
    compositionStyle: style.id,
  });
  const { chords } = harmonyPlan;

  const staves = { rh: [], lh: [] };
  const wantsRh = params.hands === 'both' || params.hands === 'rh';
  const wantsLh = params.hands === 'both' || params.hands === 'lh';

  if (wantsRh) {
    const rhythm = buildRhythm(
      rng, ts, cells, measures, params.restRate, params.focusRhythmTags, form, chordsPerMeasure,
      fragment, fragmentShift,
    );
    staves.rh = assignPitches(rng, {
      key, ts, chords, chordsPerMeasure, rhythm, measures,
      lowDia: params.rhLow, highDia: params.rhHigh,
      maxLeap: params.maxLeap, stepwiseBias: params.stepwiseBias,
      nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
      focusIntervals: params.focusIntervals,
      cadences: harmonyPlan.progression.cadences,
      compositionStyle: style,
      form,
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
        cadences: harmonyPlan.progression.cadences,
        compositionStyle: style,
        form,
      });
    } else if (params.hands === 'lh') {
      // Left hand alone gets the melody, not an accompaniment pattern.
      const rhythm = buildRhythm(
        rng, ts, cells, measures, params.restRate, params.focusRhythmTags, form, chordsPerMeasure,
        fragment, fragmentShift,
      );
      staves.lh = assignPitches(rng, {
        key, ts, chords, chordsPerMeasure, rhythm, measures,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: params.maxLeap, stepwiseBias: params.stepwiseBias,
        nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
        focusIntervals: params.focusIntervals,
        cadences: harmonyPlan.progression.cadences,
        compositionStyle: style,
        form,
      });
    } else {
      staves.lh = buildLeftHand(rng, {
        key, ts, chords, chordsPerMeasure, measures,
        style: params.lhStyle, lowDia: params.lhLow, highDia: params.lhHigh,
        form, compositionStyle: style, maxSimultaneous: constraints.simultaneous_notes,
      });
    }
  }

  for (const hand of ['rh', 'lh']) {
    for (const n of staves[hand]) n.hand = hand;
  }

  const lead = staves.rh.length ? staves.rh : staves.lh;
  if (params.dynamics) addDynamics(rng, lead, ts, measures, style);
  if (params.articulations) addArticulations(rng, lead, ts, style);
  addOrnaments(rng, lead, level, style);
  if (params.fingerings && staves.rh.length) addFingerings(staves.rh);
  const slurs = params.slurs && staves.rh.length ? buildSlurs(rng, staves.rh, ts, measures) : [];

  const keyName = KEY_NAMES[key.mode][String(key.fifths)];
  const title = `${style.title} in ${key.mode === 'minor' ? keyName.toUpperCase() : keyName} ${key.mode}, ${ORDINALS[seed % ORDINALS.length]}`;

  return {
    seed,
    key,
    ts,
    tempo: params.tempo,
    measures,
    chords,
    chordsPerMeasure,
    style: {
      id: style.id,
      label: style.label,
      description: style.description,
    },
    harmony: harmonyPlan.progression,
    form: {
      id: form.id,
      name: form.name,
      label: form.label,
      sections: form.sections,
      phrases: form.phrases,
      phraseLength: form.phraseLength,
      styleId: form.styleId,
      units: form.units,
      plan: form.plan,
    },
    staves,
    slurs,
    title,
    params,
    generatorVersion: 2,
    stylePackVersion: style.version,
    development: {
      motif: form.units[0],
      transforms: form.units.slice(1).map((unit) => ({
        unit: unit.index, transform: unit.transform, value: unit.transform_value || 0,
      })),
    },
    constraints: params.level ? levelById(params.level).constraints : null,
    fragment: fragment ? { id: fragment.id, shift: fragmentShift, provenance: fragment.provenance } : null,
    totalTicks: measures * ts.ticks,
  };
}

const COMPOSITION_CANDIDATES = 20;

function constraintsFor(score) {
  if (score.params.level) return levelById(score.params.level).constraints;
  const shortest = [...score.staves.rh, ...score.staves.lh]
    .reduce((value, note) => Math.min(value, note.duration), Infinity);
  return {
    key_signature_accidentals: 7,
    hand_shifts: 99,
    max_melodic_interval: score.params.maxLeap + 1,
    smallest_ticks: Number.isFinite(shortest) ? shortest : 1,
    ledger_lines: 8,
    lh_textures: [],
    simultaneous_notes: 5,
    chromatic_notes: 999,
    tempo: [30, 200],
    meters: [score.ts.name],
    hand_span: 12,
  };
}

/**
 * Compose several deterministic candidates, run the same musicality rubric on
 * each, and retain the strongest one. The public seed remains stable, so exact
 * links still regenerate the same accepted exercise.
 */
export function generateExercise(userParams = {}) {
  if (userParams.sourceMode === 'repertoire') return repertoireExercise({ ...DEFAULT_PARAMS, ...userParams });
  let best = null;
  let bestReview = null;
  let bestValidation = null;
  let selectedAttempt = 0;
  const hardFailures = new Map();

  for (let attempt = 0; attempt < COMPOSITION_CANDIDATES; attempt++) {
    const candidate = composeCandidate(userParams, attempt);
    const relaxation = attempt < 10 ? 0 : Math.min(4, 1 + Math.floor((attempt - 10) / 3));
    const validation = validateExercise(candidate, constraintsFor(candidate), { relaxation });
    for (const error of validation.hardErrors) hardFailures.set(error, (hardFailures.get(error) || 0) + 1);
    if (!validation.passed) continue;
    const review = reviewMusicality(candidate);
    const stronger = !best
      || (review.passed && !bestReview.passed)
      || (review.passed === bestReview.passed && review.score > bestReview.score);
    if (stronger) {
      best = candidate;
      bestReview = review;
      bestValidation = validation;
      selectedAttempt = attempt;
    }
  }

  if (!best) {
    const detail = [...hardFailures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || 'soft constraints could not be relaxed safely';
    throw new Error(`Generator configuration bug: ${detail}`);
  }

  best.compositionReview = {
    ...bestReview,
    candidates: COMPOSITION_CANDIDATES,
    selectedAttempt,
    validation: bestValidation,
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
