// Exercise generator.
//
// Produces a fully spelled, phrase-shaped piano exercise from a parameter set
// and a seed. Deterministic: the same seed *and parameters* always yield the
// same music, which is what makes exact exercise links shareable and assignable.

import {
  TPQ, clamp, fromDia, isChordTone, isStructuralAlteration, keyAlterations, spellInKey, spellChordTone, tonicLetter, KEY_NAMES,
} from './theory.js';
import { getCell, metricWeight, resolveCells, timeSig } from './rhythm.js';
import { planProgression } from './harmony.js';
import {
  buildAccompaniment, normaliseTexture, playableTextures, resolveTexture,
} from './accompaniment.js';
import { reviewMusicality } from './musicality.js';
import { validateExercise } from './validator.js';
import { makeRng } from './rng.js';
import { formForStyle, resolveCompositionStyle } from './compositionStyles.js';
import { levelById } from './levels.js';
import { repertoireExercise } from './repertoire.js';
import { chooseFragment } from './fragments.js';
import { performanceTicks, playbackEvents } from './playback.js';

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

/** Fill one measure with rhythm cells drawn from the allowed vocabulary. */
function fillMeasure(rng, ts, cellIds, {
  offsetTicks, requiredTag = null, pack = null, primaryCellId = null,
}) {
  const meter = ts.compound ? 'compound' : 'simple';
  // Silence is shaped after the motif and phrase plan are known. Keeping rest
  // cells out of this blind draw prevents arbitrary holes on structural beats.
  const cells = cellIds.map(getCell).filter((c) => c && c.meter === meter && !c.tags.includes('rest'));
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
      let w = pack?.rhythm_cells.find((item) => item.id === c.id)?.weight || 0.08;
      if (c.id === primaryCellId) w *= 3.5;
      // Longer values open a bar naturally but clutter it mid-measure.
      if (c.ticks > ts.beat) w *= pos === 0 ? 1.1 : 0.45;
      // Keep plain beats common enough that lines stay readable.
      if (c.tags.includes('quarter')) w *= 1.4;
      // Don't start a multi-beat figure off the beat.
      if (!onBeat && c.ticks > ts.beat) w = 0.001;
      return Math.max(w, 0.001);
    });

    // Adaptive drills promise to put the diagnosed rhythm into the music, not
    // merely make it one of many possibilities. Put one legal sounding focus
    // cell at the opening of an assigned bar; rests are guaranteed later once
    // their musical location is known.
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

const REST_POLICIES = {
  classical_early: { boundary: 0.72, frequency: 1 },
  romantic: { boundary: 0.72, frequency: 0.9 },
  baroque: { boundary: 0.5, frequency: 0.78 },
  hymn_chorale: { boundary: 0.82, frequency: 0.68 },
  folk: { boundary: 0.58, frequency: 1.05 },
  pop_contemporary: { boundary: 0.34, frequency: 1.12 },
  blues: { boundary: 0.28, frequency: 1.08 },
  jazz_lead: { boundary: 0.28, frequency: 1.12 },
  ragtime: { boundary: 0.22, frequency: 0.92 },
  minimalist: { boundary: 0.38, frequency: 0.72 },
};

const rhythmMotifSlot = (event) => event.motifIndex == null
  ? null
  : String(event.motifIndex).split(':').slice(0, 2).join(':');

/**
 * Turn existing note values into measured silences only after formal function
 * is known. Tonal/lyrical styles prefer a breath after a cadence; groove-led
 * styles prefer a repeated weak-beat gap inside the motif. Cadence arrivals,
 * opening attacks, and lone notes in a bar are protected.
 */
function shapeMusicalRests(rng, events, {
  ts, form, restRate, styleId, enabled, forced = false, minDuration = 1,
}) {
  if (!enabled || !events.length) return events;
  const policy = REST_POLICIES[styleId] || { boundary: 0.5, frequency: 1 };
  const appearance = clamp(restRate * 3.4 * policy.frequency, 0.24, 0.68);
  if (!forced && !rng.chance(appearance)) return events;

  const soundedPerMeasure = new Map();
  for (const event of events) {
    if (event.rest) continue;
    const measure = Math.floor(event.onset / ts.ticks);
    soundedPerMeasure.set(measure, (soundedPerMeasure.get(measure) || 0) + 1);
  }
  const eligible = (event) => {
    const measure = Math.floor(event.onset / ts.ticks);
    return !event.rest
      && event.duration <= ts.beat
      && !event.cadenceArrival
      && !event.tags?.includes('phrase-end')
      && (soundedPerMeasure.get(measure) || 0) > 1;
  };

  // A breath belongs just after an actual cadence, at the opening of the next
  // phrase—not before the cadence has completed.
  const boundaryCandidates = [];
  for (const unit of form.units || []) {
    const nextMeasure = unit.bars[1] + 1;
    if (!unit.cadence || nextMeasure >= form.plan.length) continue;
    const onset = nextMeasure * ts.ticks;
    const candidate = events.find((event) => event.onset === onset && eligible(event));
    if (candidate) boundaryCandidates.push(candidate);
  }

  // A motivic rest is selected from a weak position in the stated idea, then
  // echoed once per formal unit. That makes silence part of the rhythm rather
  // than random damage to otherwise repeated material.
  const motifBars = form.units?.[0]?.bars || [0, Math.min(1, form.plan.length - 1)];
  const motifCandidates = events.filter((event) => {
    const measure = Math.floor(event.onset / ts.ticks);
    const within = event.onset - measure * ts.ticks;
    return eligible(event)
      && rhythmMotifSlot(event)
      && event.onset > 0
      && measure >= motifBars[0]
      && measure <= motifBars[1]
      && metricWeight(ts, within) < 2;
  });

  const chooseMotivic = () => {
    if (!motifCandidates.length) return [];
    const chosen = rng.weighted(motifCandidates, motifCandidates.map((event) => {
      const within = event.onset % ts.ticks;
      const offbeat = within % ts.beat !== 0;
      return (offbeat ? 3 : 1) * (event.duration <= ts.beat / 2 ? 1.8 : 1);
    }));
    const slot = rhythmMotifSlot(chosen);
    const onePerUnit = new Map();
    for (const event of events) {
      if (!eligible(event) || rhythmMotifSlot(event) !== slot) continue;
      const measure = Math.floor(event.onset / ts.ticks);
      const unit = form.plan[measure]?.unitIndex ?? 0;
      if (!onePerUnit.has(unit)) onePerUnit.set(unit, event);
    }
    return [...onePerUnit.values()];
  };

  let selected = [];
  let kind = 'motivic-rest';
  if (boundaryCandidates.length && rng.chance(policy.boundary)) {
    selected = [rng.pick(boundaryCandidates)];
    kind = 'phrase-breath';
  } else {
    selected = chooseMotivic();
    if (!selected.length && boundaryCandidates.length) {
      selected = [rng.pick(boundaryCandidates)];
      kind = 'phrase-breath';
    }
  }
  // Sustained textures may have no short event that can become a rest without
  // erasing an entire bar. In that case, release a long note early and use its
  // tail as the breath—a common written articulation that preserves the attack.
  if (!selected.length) {
    const longCandidates = events.filter((event) => (
      !event.rest
      && event.onset > 0
      && event.duration >= minDuration * 2
      && !event.cadenceArrival
      && !event.tags?.includes('phrase-end')
      && rhythmMotifSlot(event)
    ));
    if (!longCandidates.length) return events;
    const chosenLong = rng.pick(longCandidates);
    const slot = rhythmMotifSlot(chosenLong);
    const onePerUnit = new Map();
    for (const event of events) {
      if (rhythmMotifSlot(event) !== slot
        || event.duration < minDuration * 2
        || event.cadenceArrival
        || event.tags?.includes('phrase-end')) continue;
      const measure = Math.floor(event.onset / ts.ticks);
      const unit = form.plan[measure]?.unitIndex ?? 0;
      if (!onePerUnit.has(unit)) onePerUnit.set(unit, event);
    }
    const split = new Set(onePerUnit.values());
    return events.flatMap((event) => {
      if (!split.has(event)) return [event];
      const restDuration = Math.min(ts.beat, event.duration - minDuration);
      const noteDuration = event.duration - restDuration;
      return [
        { ...event, duration: noteDuration },
        {
          ...event,
          onset: event.onset + noteDuration,
          duration: restDuration,
          rest: true,
          cadenceArrival: false,
          motifIndex: `${event.motifIndex}:breath`,
          tags: [...new Set([...(event.tags || []), 'rest', 'motivic-rest'])],
        },
      ];
    });
  }
  const chosen = new Set(selected);
  return events.map((event) => chosen.has(event) ? {
    ...event,
    rest: true,
    tags: [...new Set([...(event.tags || []), 'rest', kind])],
  } : event);
}

/**
 * Enter after the downbeat.
 *
 * Beginning on beat one every time is the one thing no real melody does
 * reliably, and finding a beat that has already gone past is a distinct
 * reading skill: the eye has to locate the entry rather than start with the
 * bar. The opening of a phrase gives up its first attack, so the line enters
 * on a later beat of the bar it belongs to.
 *
 * This is a delayed entry inside a full bar, not a partial-measure anacrusis:
 * every bar keeps its full length, so the engraver, the repeat plan and the
 * playhead all continue to see uniform measures.
 */
function openOnUpbeat(rng, events, { ts, form, measures, chance = 0 }) {
  if (!chance || measures < 4 || !rng.chance(chance)) return events;
  const sorted = [...events].sort((a, b) => a.onset - b.onset);

  const opening = (form?.units || []).filter((unit) => unit.bars[0] < measures - 1).slice(0, 1);
  const chosen = new Set();
  for (const unit of opening) {
    const from = unit.bars[0] * ts.ticks;
    const to = from + ts.ticks;
    const inBar = sorted.filter((event) => event.onset >= from && event.onset < to);
    const sounded = inBar.filter((event) => !event.rest);
    const first = inBar[0];
    if (sounded.length < 3 || !first || first.rest) continue;
    if (first.onset !== from || first.duration > ts.beat) continue;
    if (first.cadenceArrival) continue;
    chosen.add(first);
  }
  if (!chosen.size) return events;

  return sorted.map((event) => (chosen.has(event) ? {
    ...event,
    rest: true,
    tags: [...new Set([...(event.tags || []), 'rest', 'upbeat-entry'])],
  } : event));
}

/**
 * Let one idea carry over a barline.
 *
 * A note attacked before the barline and held through it is the commonest
 * rhythmic tension in tonal music and the one device this generator could not
 * write: rhythm cells fill a measure exactly, so every attack landed inside
 * its own bar. Merging a bar's last event with the next bar's downbeat makes
 * the anticipation real; the engraver already splits the result into tied
 * notes at the barline.
 *
 * Cadence arrivals, phrase openings and the final bar are left alone — the
 * point is tension inside a phrase, not a blurred phrase boundary.
 */
function tieAcrossBarlines(rng, events, {
  ts, form, measures, minDuration = 1, chance = 0, maximum = 2,
}) {
  if (!chance || measures < 4 || !rng.chance(chance)) return events;
  const sorted = [...events].sort((a, b) => a.onset - b.onset);
  const soundedInBar = new Map();
  for (const event of sorted) {
    if (event.rest) continue;
    const bar = Math.floor(event.onset / ts.ticks);
    soundedInBar.set(bar, (soundedInBar.get(bar) || 0) + 1);
  }

  const candidates = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const event = sorted[index];
    const next = sorted[index + 1];
    if (event.rest || next.rest) continue;
    const bar = Math.floor(event.onset / ts.ticks);
    if (bar >= measures - 2) continue;
    const barline = (bar + 1) * ts.ticks;
    if (event.onset + event.duration !== barline || next.onset !== barline) continue;
    // Anticipating a downbeat is a within-phrase gesture. Across a formal
    // seam it reads as a mistake rather than as syncopation.
    if ((form?.plan?.[bar]?.unitIndex ?? 0) !== (form?.plan?.[bar + 1]?.unitIndex ?? 0)) continue;
    if (event.cadenceArrival || next.cadenceArrival) continue;
    if (event.tags?.includes('phrase-end') || next.tags?.includes('phrase-end')) continue;
    if ((soundedInBar.get(bar + 1) || 0) < 2) continue;
    if (event.duration >= ts.beat && event.onset % ts.beat === 0) continue;
    if (event.duration + next.duration < minDuration) continue;
    candidates.push(index);
  }
  if (!candidates.length) return events;

  const chosen = new Set();
  const barsUsed = new Set();
  for (const index of rng.shuffle(candidates)) {
    if (chosen.size >= maximum) break;
    const bar = Math.floor(sorted[index].onset / ts.ticks);
    if (barsUsed.has(bar) || barsUsed.has(bar - 1) || barsUsed.has(bar + 1)) continue;
    barsUsed.add(bar);
    chosen.add(index);
  }
  if (!chosen.size) return events;

  const removed = new Set();
  const out = [];
  for (let index = 0; index < sorted.length; index++) {
    if (removed.has(index)) continue;
    if (!chosen.has(index)) { out.push(sorted[index]); continue; }
    const event = sorted[index];
    const next = sorted[index + 1];
    removed.add(index + 1);
    out.push({
      ...event,
      duration: event.duration + next.duration,
      tags: [...new Set([...(event.tags || []), 'tied-over-barline', 'syncopation'])],
    });
  }
  return out;
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

/**
 * Realise a cadence bar.
 *
 * The final event of the bar always sounds — that is the arrival. When the
 * arrival is shorter than a beat it also absorbs the note before it, so the
 * phrase ending is heard as a broadening rather than as one more note of the
 * prevailing rhythm. Cadential broadening is how a phrase end is written.
 */
function realiseCadenceAttack(events, ts, minDuration = 1, broaden = true) {
  if (!events.length) return events;
  const mark = (event) => ({
    ...event,
    rest: false,
    tags: [...new Set([...event.tags, 'cadence-arrival'])],
    cadenceArrival: true,
  });
  const last = events.length - 1;
  const previous = events[last - 1];
  const arrival = events[last];
  const contiguous = previous && previous.onset + previous.duration === arrival.onset;
  const canBroaden = broaden && contiguous && !previous.rest
    && events.filter((event) => !event.rest).length >= 3
    && arrival.duration < ts.beat
    && previous.duration + arrival.duration >= minDuration;
  if (!canBroaden) return events.map((event, index) => index === last ? mark(event) : event);
  return [
    ...events.slice(0, last - 1),
    mark({
      ...arrival,
      onset: previous.onset,
      duration: previous.duration + arrival.duration,
      tags: [...new Set([...arrival.tags, 'cadential-broadening'])],
    }),
  ];
}

/** Give continuation/chorus phrases perceptibly greater rhythmic momentum. */
function transformRhythm(events, ts, spec, canSubdivide, minDuration = 1) {
  if (!spec) return events;
  const transform = spec.transform;
  let source = events.map((event) => ({ ...event }));
  let scale = 1;
  if (transform === 'augment') scale = 2;
  if (transform === 'diminish' && canSubdivide
    && source.every((event) => event.duration / 2 >= minDuration)) scale = 0.5;
  if (transform === 'fragment') {
    const sounded = source.filter((event) => !event.rest);
    const keep = new Set(sounded.slice(0, Math.max(1, Math.ceil(sounded.length / 2))));
    const last = [...source].findLastIndex((event) => keep.has(event));
    // Keep complete metric units: cutting after two notes of a triplet and
    // cycling that fragment creates an unnotatable tail at the barline.
    const desiredEnd = source[Math.max(0, last)].onset + source[Math.max(0, last)].duration;
    const cut = source.findIndex((event) => event.onset + event.duration >= desiredEnd
      && (event.onset + event.duration) % ts.beat === 0);
    if (cut >= 0) source = source.slice(0, cut + 1);
  }

  const motifLength = Math.max(1, source.reduce((end, event) => Math.max(end, event.onset + event.duration), 0) * scale);
  const transformed = [];
  for (let cycle = 0, cursor = 0; cursor < ts.ticks && cycle < 32; cycle++, cursor += motifLength) {
    for (const event of source) {
      const onset = cursor + event.onset * scale;
      if (onset >= ts.ticks) break;
      const duration = Math.min(event.duration * scale, ts.ticks - onset);
      if (!Number.isInteger(onset) || !Number.isInteger(duration) || duration <= 0) continue;
      if (duration < minDuration) {
        const previous = transformed.at(-1);
        if (previous && previous.onset + previous.duration === onset) previous.duration += duration;
        continue;
      }
      transformed.push({
        ...event, onset, duration,
        motifIndex: `${event.motifIndex}:${cycle}`,
        tags: [...event.tags, `formal-${transform}`],
      });
    }
  }
  const supported = new Set([6, 8, 12, 16, 18, 24, 32, 36, 48, 72, 96, 144, 192, 240, 288]);
  return transformed.length && transformed.every((event) => supported.has(event.duration)) ? transformed : events;
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
  style = null,
  minDuration = 1,
  sequenceChance = 0,
  tieChance = 0,
  upbeatChance = 0,
) {
  if (!Number.isInteger(chordsPerMeasure) || chordsPerMeasure < 1) {
    throw new Error('Harmonic slots per measure must be a positive integer');
  }
  const out = [];
  const required = [...new Set(focusTags)].slice(0, Math.max(0, measures - 1));
  const firstUnit = form.units?.[0] || { bars: [0, Math.min(1, measures - 1)] };
  const motifBars = Math.max(1, firstUnit.bars[1] - firstUnit.bars[0] + 1);
  const canSubdivide = cellIds.some((id) => {
    const cell = getCell(id);
    return cell?.tags?.some((tag) => ['eighth', 'sixteenth', 'triplet'].includes(tag));
  });
  const primaryPool = cellIds.filter((id) => {
    const cell = getCell(id);
    return cell?.meter === (ts.compound ? 'compound' : 'simple') && !cell.tags.includes('rest');
  });
  const primaryCellId = primaryPool.length
    ? rng.weighted(primaryPool, primaryPool.map((id) => (
      style?.pack.rhythm_cells.find((cell) => cell.id === id)?.weight || 0.08
    )))
    : null;
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
        offsetTicks: 0, requiredTag: required[index] || null,
        pack: style?.pack, primaryCellId,
      });
      if (!canSubdivide || events.filter((event) => !event.rest).length >= 3) break;
    }
    return events.map((event, motifIndex) => ({ ...event, motifIndex: `${index}:${motifIndex}` }));
  });

  // A sequence — the same figure restated one diatonic step higher or lower —
  // is the strongest memorability device in tonal melody and one of the
  // easiest things to read, because the eye recognises a shape it has already
  // seen. Restating bar one as bar two keeps the motif memory intact and
  // carries a shift with it.
  if (prototypes.length >= 2 && !fragment && rng.chance(sequenceChance)) {
    const step = rng.chance(0.55) ? 1 : -1;
    prototypes[1] = prototypes[0].map((event) => ({ ...event, sequenceShift: step }));
  }

  for (let m = 0; m < measures; m++) {
    const offsetTicks = m * ts.ticks;
    const spec = form.plan[m];
    const unit = form.units?.[spec.unitIndex] || firstUnit;
    const barInUnit = m - unit.bars[0];
    const relative = prototypes[barInUnit % motifBars];

    const shaped = transformRhythm(relative, ts, spec, canSubdivide, minDuration);
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
      measureEvents = realiseCadenceAttack(measureEvents, ts, minDuration, m > 0);
    }
    out.push(...measureEvents);
  }
  const withRests = tieAcrossBarlines(rng, shapeMusicalRests(rng, out, {
    ts,
    form,
    restRate,
    styleId: style?.id,
    enabled: cellIds.some((id) => getCell(id)?.tags.includes('rest')),
    forced: focusTags.includes('rest'),
    minDuration,
  }), { ts, form, measures, minDuration, chance: tieChance });
  const opened = openOnUpbeat(rng, withRests, { ts, form, measures, chance: upbeatChance });
  Object.defineProperty(opened, 'motifPlan', {
    enumerable: false,
    value: Object.freeze({
      id: fragment?.id || `motif:${primaryCellId || 'derived'}`,
      source: fragment ? 'fragment-library' : 'generated',
      bars: [firstUnit.bars[0], firstUnit.bars[1]],
      rhythmCellId: primaryCellId,
      rhythm: prototypes.map((bar) => bar.map((event) => ({
        onset: event.onset, duration: event.duration, rest: event.rest,
      }))),
    }),
  });
  return opened;
}

// ---------------------------------------------------------------------------
// Melody
// ---------------------------------------------------------------------------

/** Phrase arch: rise toward the middle of the line, fall back at the cadence. */
function contourTarget(contour, m, measures, lowDia, highDia) {
  if (measures <= 1) return (lowDia + highDia) / 2;
  const x = m / (measures - 1);
  let shape;
  if (contour === 'ascending') shape = 0.15 + x * 0.7;
  else if (contour === 'descending') shape = 0.85 - x * 0.7;
  else if (contour === 'wave') shape = 0.5 + Math.sin(2 * Math.PI * x) * 0.32;
  else shape = 0.3 + 0.5 * Math.sin(Math.PI * x);
  return lowDia + (highDia - lowDia) * shape;
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
    chromaticBudget = null, stepFirst = false,
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
  let repeatRun = 0;
  let focusIndex = 0;
  let prevChord = null;
  const motifPitches = new Map();
  let motifAnchor = null;

  const sounded = rhythm.filter((e) => !e.rest);
  const cadenceByMeasure = new Map(cadences.map((item) => [item.measure, item]));
  const lastSoundedByMeasure = new Map();
  sounded.forEach((event, i) => lastSoundedByMeasure.set(Math.floor(event.onset / ts.ticks), i));
  const cadenceArrivals = cadences.map((cadence) => ({
    cadence,
    index: lastSoundedByMeasure.get(cadence.measure),
    targets: Array.from({ length: highDia - lowDia + 1 }, (_, offset) => lowDia + offset)
      .filter((dia) => scaleDegree(key, dia) === cadence.melodyDegree),
  }));
  if (cadenceArrivals.some((arrival) => !arrival.targets.length)) {
    throw new Error('A planned cadence degree lies outside the melodic range');
  }
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
  const chordForIndex = (index) => {
    const event = sounded[index];
    const arrival = cadenceArrivals.find((item) => item.index === index);
    return arrival
      ? chords[arrival.cadence.slots.at(-1)]
      : chordAt(chords, ts, chordsPerMeasure, event.onset);
  };
  const structuralChordTone = (index) => {
    const event = sounded[index];
    const eventMeasure = Math.floor(event.onset / ts.ticks);
    const eventWithin = event.onset - eventMeasure * ts.ticks;
    return index === sounded.length - 1
      || cadenceArrivals.some((item) => item.index === index)
      || metricWeight(ts, eventWithin) === 2
      || phraseStartIndices.has(index)
      || index === climaxIndex;
  };
  const reachabilityMemo = new Map();
  const canReachCadence = (index, dia, arrival) => {
    const keyForMemo = `${index}:${dia}:${arrival.index}`;
    if (reachabilityMemo.has(keyForMemo)) return reachabilityMemo.get(keyForMemo);
    if (index === arrival.index) {
      const result = arrival.targets.includes(dia) && isChordTone(key, chordForIndex(index), dia);
      reachabilityMemo.set(keyForMemo, result);
      return result;
    }
    if (index > arrival.index) return true;
    const currentChordTone = isChordTone(key, chordForIndex(index), dia);
    const nextIndex = index + 1;
    const nextChord = chordForIndex(nextIndex);
    let result = false;
    for (let nextDia = lowDia; nextDia <= highDia; nextDia++) {
      const distance = Math.abs(nextDia - dia);
      if (distance > maxLeap) continue;
      const nextChordTone = isChordTone(key, nextChord, nextDia);
      if (structuralChordTone(nextIndex) && !nextChordTone) continue;
      if (!currentChordTone && (!nextChordTone || distance !== 1)) continue;
      if (!nextChordTone && distance !== 1) continue;
      if (canReachCadence(nextIndex, nextDia, arrival)) {
        result = true;
        break;
      }
    }
    reachabilityMemo.set(keyForMemo, result);
    return result;
  };
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
    const target = contourTarget(compositionStyle?.melodyContour || 'arch', measure, measures, lowDia, highDia)
      + (phraseSpec?.registerShift || 0);
    const motifId = ev.motifKey ? `${ev.motifKey}:${ev.motifIndex}` : null;
    const remembered = motifId ? motifPitches.get(motifId) : null;
    let motifTarget = remembered == null ? null : remembered + (ev.motifShift || 0) + (ev.sequenceShift || 0);
    if (motifTarget != null && motifAnchor != null && ev.formalTransform === 'invert') {
      motifTarget = motifAnchor - (remembered - motifAnchor);
    } else if (motifTarget != null && motifAnchor != null && ev.formalTransform === 'expand_intervals') {
      motifTarget = motifAnchor + Math.round((remembered - motifAnchor) * 1.35);
    }

    // Decide whether this slot must be a chord tone.
    let requireChordTone;
    if (isLast || isCadenceArrival || weight === 2 || phraseStartIndices.has(i) || i === climaxIndex) requireChordTone = true;
    // Reading levels built on scale motion need beats that are free to hold a
    // passing or neighbour tone. Requiring a chord tone on every beat inside a
    // five-finger position leaves only unisons and thirds to choose from.
    else if (weight === 1) requireChordTone = rng.chance(stepFirst ? 0.45 : 1 - styledNonChordRate * 0.5);
    else requireChordTone = rng.chance(1 - styledNonChordRate);
    if (lastLeap >= 3 && !isCadenceArrival && !isLast) {
      requireChordTone = false; // a leap wants a stepwise answer
    }
    const resolvingNonChord = notes.at(-1)?.chordTone === false;
    if (resolvingNonChord) requireChordTone = true;
    if (cadenceArrivals.some((arrival) => arrival.index === i + 1)) requireChordTone = true;

    let candidates = [];
    for (let d = lowDia; d <= highDia; d++) {
      if (requireChordTone && !isChordTone(key, chord, d)) continue;
      if (prev && Math.abs(d - prev.dia) > maxLeap) continue;
      if (resolvingNonChord && prev && Math.abs(d - prev.dia) !== 1) continue;
      // Decorative tones are approached by step. Repeating a pitch over a
      // changed chord creates an unplanned suspension/retardation, so it must
      // be generated by a dedicated transform rather than slipping through
      // this generic weak-beat path.
      if (!requireChordTone && prev) {
        const decorativeDistance = Math.abs(d - prev.dia);
        if (decorativeDistance > 1) continue;
        if (decorativeDistance === 0 && !isChordTone(key, chord, d)) continue;
      }
      if (!requireChordTone && sounded[i + 1]) {
        const nextEvent = sounded[i + 1];
        const nextMeasure = Math.floor(nextEvent.onset / ts.ticks);
        const nextCadence = cadenceByMeasure.get(nextMeasure);
        const nextIsArrival = Boolean(nextEvent.cadenceArrival);
        const nextChord = nextIsArrival && nextCadence
          ? chords[nextCadence.slots.at(-1)]
          : chordAt(chords, ts, chordsPerMeasure, nextEvent.onset);
        const hasResolution = Array.from({ length: highDia - lowDia + 1 }, (_, offset) => lowDia + offset)
          .some((nextDia) => Math.abs(nextDia - d) === 1 && isChordTone(key, nextChord, nextDia)
            && (!nextIsArrival || scaleDegree(key, nextDia) === nextCadence.melodyDegree));
        if (!hasResolution) continue;
      }
      const nextCadence = cadenceArrivals.find((arrival) => arrival.index >= i);
      if (nextCadence && i < nextCadence.index) {
        if (!canReachCadence(i, d, nextCadence)) continue;
      }
      candidates.push(d);
    }
    // Leap recovery and decoration are preferences around the structural
    // skeleton. If their local choice set is empty, fall back to a legal chord
    // tone instead of letting an optional surface rule make the whole phrase
    // unsatisfiable. A pending non-chord resolution is never bypassed.
    if (!candidates.length && !resolvingNonChord && !isCadenceArrival) {
      const nextCadence = cadenceArrivals.find((arrival) => arrival.index >= i);
      for (let d = lowDia; d <= highDia; d++) {
        if (!isChordTone(key, chord, d)) continue;
        if (prev && Math.abs(d - prev.dia) > maxLeap) continue;
        if (nextCadence && i < nextCadence.index) {
          if (!canReachCadence(i, d, nextCadence)) continue;
        }
        candidates.push(d);
      }
      requireChordTone = true;
    }
    if (!candidates.length) {
      throw new Error(`No legal melody pitch at measure ${measure + 1} (onset ${within}, previous ${prev?.dia ?? 'none'}, cadence ${isCadenceArrival ? cadence?.id : 'no'}, resolving ${resolvingNonChord})`);
    }

    let chosen;
    const fragmentTarget = ev.fragmentDegree
      ? (ev.fragmentDegree - 1 + (ev.fragmentShift || 0) + 70) % 7
      : null;
    if (i === climaxIndex) {
      chosen = candidates.at(-1);
    } else if (isCadenceArrival) {
      // The melodic arrival defines the cadence: tonic for PAC/plagal, the
      // third for IAC, dominant for half cadences, and vi/VI for deceptive ones.
      const targets = candidates.filter((d) => scaleDegree(key, d) === cadence.melodyDegree);
      if (!targets.length) throw new Error(`Cadence ${cadence.id} has no reachable melody degree`);
      chosen = nearest(targets, prev ? prev.dia : target);
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
        const focused = candidates.filter(matches);
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
        // A repeated note is a deliberate device, not a resting place. Two in
        // a row is a figure; three is a dead bar.
        if (dist === 0) w = repeatRun >= 1 ? 0.012 : 0.15;
        else if (dist === 1) w = styledStepwiseBias * (stepFirst ? 9 : 6);
        else if (dist === 2) w = (1 - styledStepwiseBias) * (stepFirst ? 2.6 : 5);
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
    repeatRun = prev && chosen === prev.dia ? repeatRun + 1 : 0;

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

    const signature = keyAlterations(key.fifths);
    let chromatic = p.alter !== signature[p.letter];
    if (chromaticBudget && chromatic && !isStructuralAlteration(key, chord, p)) {
      const reserve = chromaticBudget.reservedForAccompaniment || 0;
      if (chromaticBudget.remaining > reserve) chromaticBudget.remaining -= 1;
      else {
        p = spellInKey(key, chosen);
        chromatic = false;
      }
    }

    notes.push({
      onset: ev.onset,
      duration: ev.duration,
      rest: false,
      pitches: [p],
      tags: blueInflection && chromatic ? [...ev.tags, 'blue-note'] : ev.tags,
      cellId: ev.cellId,
      chordTone: isChordTone(key, chord, chosen),
      motifKey: ev.motifKey || null,
      motifIndex: ev.motifIndex || null,
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
    motifKey: e.motifKey || null, motifIndex: e.motifIndex || null,
    motifRole: e.motifRole || null, section: e.section || null,
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
        else if (prev.pitches[0].dia === next.pitches[0].dia) note.nonChordKind = 'neighbor';
        else note.nonChordKind = 'escape';
      } else if (prev && next && prev.pitches[0].dia === note.pitches[0].dia
        && next.pitches[0].dia === note.pitches[0].dia - 1) {
        note.nonChordKind = 'suspension';
      } else if (into != null && out === -1 && Math.abs(into) > 1) {
        note.nonChordKind = 'appoggiatura';
      } else if (into != null && out != null && Math.abs(into) === 1
        && Math.abs(out) > 1 && Math.sign(into) !== Math.sign(out)) {
        note.nonChordKind = 'escape';
      } else {
        note.nonChordKind = 'unlicensed';
      }
    } else {
      note.nonChordKind = null;
    }

    const degree = scaleDegree(key, note.pitches[0].dia);
    // A blues dominant seventh is a colour, not a tendency: every chord in the
    // idiom carries one and none of them are obliged to resolve downward.
    const chordalSeventh = chord.seventh && !chord.bluesDominant
      && degree === (chord.degree + 6) % 7;
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

/** An independent left-hand melodic line, for two-voice contrapuntal levels. */
function buildLeftHandMelody(rng, opts) {
  const rhythm = buildRhythm(
    rng, opts.ts, opts.cellIds, opts.measures, opts.restRate, [], opts.form, opts.chordsPerMeasure,
    null, 0, opts.compositionStyle, opts.minDuration, opts.sequenceChance, opts.tieChance,
  );
  // The cadence plan specifies the soprano arrival. An independent bass line
  // is governed by the cadence harmony instead of being forced onto the same
  // scale degree as the soprano (which can be unreachable in a bass range).
  const neutralRhythm = rhythm.map((event) => {
    const copy = { ...event };
    delete copy.cadenceArrival;
    return copy;
  });
  return assignPitches(rng, { ...opts, rhythm: neutralRhythm, cadences: [] });
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

const DYNAMIC_LADDER = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];

/** One step quieter, for an accompaniment under a melody. */
function softer(dynamic) {
  const index = DYNAMIC_LADDER.indexOf(dynamic);
  return index > 0 ? DYNAMIC_LADDER[index - 1] : dynamic;
}

/**
 * Mark the second staff. An accompaniment sits under the melody it supports;
 * an independent line carries the same dynamic as its partner.
 */
function addStaffDynamic(staff, lead, accompanying) {
  const first = staff.find((note) => !note.rest);
  if (!first) return;
  const leadDynamic = lead.find((note) => note.dynamic)?.dynamic || 'mf';
  first.dynamic = accompanying ? softer(leadDynamic) : leadDynamic;
}

/**
 * Write the shape the melody already has.
 *
 * The generator chooses one structural climax. A crescendo into it and a
 * diminuendo out of it turn that plan into an instruction the reader can see,
 * which is what makes a phrase get shaped rather than merely played.
 */
function addHairpins(notes, ts, form) {
  const sounded = notes.filter((note) => !note.rest);
  const climaxIndex = sounded.findIndex((note) => note.structural === 'climax');
  if (climaxIndex < 2) return 0;
  const climax = sounded[climaxIndex];
  const measure = Math.floor(climax.onset / ts.ticks);
  const unit = (form.units || []).find((item) => measure >= item.bars[0] && measure <= item.bars[1]);
  if (!unit) return 0;

  const unitStart = unit.bars[0] * ts.ticks;
  const unitEnd = (unit.bars[1] + 1) * ts.ticks;
  const rise = sounded.find((note) => note.onset >= unitStart && note.onset < climax.onset);
  const fall = [...sounded].reverse().find((note) => note.onset > climax.onset && note.onset < unitEnd);
  let count = 0;
  if (rise && rise.onset < climax.onset) {
    rise.wedge = 'crescendo';
    climax.wedgeStop = true;
    count += 1;
  }
  if (fall && fall.onset > climax.onset) {
    climax.wedge = climax.wedge === 'crescendo' ? climax.wedge : 'diminuendo';
    if (count) {
      // The crescendo closes on the climax and the diminuendo opens there.
      climax.wedgeStop = true;
      climax.wedge = 'diminuendo';
    }
    fall.wedgeStop = true;
    count += 1;
  }
  return count;
}

function motifSlot(note) {
  if (note.motifIndex == null) return null;
  return String(note.motifIndex).split(':').slice(0, 2).join(':');
}

function addArticulations(notes, ts, style, form) {
  const allowed = new Set(style.pack.expression.articulations);
  const sounded = notes.filter((note) => !note.rest);
  if (!sounded.length) return;

  // Staccato is a recognisable rhythmic gesture, not confetti. Find the first
  // useful run in the stated motif, then repeat that articulation pattern when
  // the motif returns. Cadential arrivals stay clear.
  if (allowed.has('staccato')) {
    const motifBars = form.units?.[0]?.bars || [0, 0];
    const motifNotes = sounded.filter((note) => {
      const measure = Math.floor(note.onset / ts.ticks);
      return measure >= motifBars[0] && measure <= motifBars[1]
        && note.duration <= ts.beat
        && !note.cadence
        && !note.tags?.includes('phrase-end');
    });
    const runs = [];
    let run = [];
    for (const note of motifNotes) {
      const previous = run.at(-1);
      const sameMeasure = previous && Math.floor(previous.onset / ts.ticks) === Math.floor(note.onset / ts.ticks);
      const continues = previous && sameMeasure
        && previous.onset + previous.duration === note.onset
        && previous.cellId === note.cellId;
      if (!continues) {
        if (run.length >= 2) runs.push(run);
        run = [];
      }
      run.push(note);
    }
    if (run.length >= 2) runs.push(run);

    const gesture = [...runs]
      .sort((a, b) => b.length - a.length || a[0].onset - b[0].onset)[0]
      ?.slice(0, 2);
    const slots = new Set((gesture || []).map(motifSlot).filter(Boolean));
    for (const note of sounded) {
      if (slots.has(motifSlot(note))
        && note.duration <= ts.beat
        && !note.cadence
        && !note.tags?.includes('phrase-end')) {
        note.articulation = 'staccato';
      }
    }
  }

  // Tenuto clarifies a strong phrase goal. Open-ended phrases remain unmarked,
  // and stronger structural marks take precedence below.
  if (allowed.has('tenuto')) {
    for (const unit of form.units || []) {
      if (unit.cadenceStrength !== 'strong') continue;
      const start = unit.bars[0] * ts.ticks;
      const end = (unit.bars[1] + 1) * ts.ticks;
      const within = sounded.filter((note) => note.onset >= start && note.onset < end);
      const arrival = [...within].reverse().find((note) => note.duration >= ts.beat);
      if (arrival) arrival.articulation = 'tenuto';
    }
  }

  // Accents and marcato marks belong to formal emphasis: the melodic climax,
  // or the opening downbeat of a higher-energy section when there is no marked
  // climax. This keeps them sparse and explainable.
  const emphasis = allowed.has('marcato') ? 'marcato' : allowed.has('accent') ? 'accent' : null;
  if (emphasis) {
    const climax = sounded.find((note) => note.structural === 'climax');
    if (climax && !climax.cadence) {
      climax.articulation = emphasis;
    } else {
      const sectionStarts = sounded.filter((note) => (
        note.structural === 'phrase-start'
        && note.onset % ts.ticks === 0
        && (note.energy || 1) > 1
      ));
      for (const note of sectionStarts) note.articulation = emphasis;
    }
  }
}

/**
 * Ornaments belong on notes that can carry one.
 *
 * A turn or a mordent needs room and a reason: it decorates a structurally
 * important note, not whichever note a coin flip landed on. Candidates are
 * long enough to hear the figure inside them, on a strong beat, and away from
 * a cadence arrival, which should sound plain. Two per study is plenty.
 */
function addOrnaments(rng, notes, level, style, ts) {
  const policy = style.pack.expression.ornaments;
  const supported = policy.allowed.filter((name) => ['turn', 'mordent'].includes(name));
  if (level < policy.min_level || !supported.length || !policy.density) return;

  const candidates = notes.filter((note) => (
    !note.rest
    && note.chordTone
    && note.pitches?.length
    && note.duration >= ts.beat
    && !note.cadence
    && note.articulation !== 'staccato'
    && metricWeight(ts, note.onset % ts.ticks) > 0
  ));
  if (!candidates.length) return;

  const wanted = Math.min(2, Math.max(1, Math.round(candidates.length * policy.density)));
  for (const note of rng.shuffle(candidates).slice(0, wanted)) note.ornament = rng.pick(supported);
}

// A fourth or wider asks for a new hand position, so a phrase mark stops
// there; eight notes or two bars is as far as one legato gesture reaches.
const SLUR_LEAP = 4;
const SLUR_MAX_NOTES = 8;
const SLUR_MAX_BARS = 2;

/**
 * Phrase marks that follow the music.
 *
 * A slur is a legato instruction for one gesture, not a bracket around
 * everything that happens between two rests. It breaks where a pianist's hand
 * and ear break it: at a rest, at a leap wide enough to need a hand move, at a
 * repeated pitch, which has to be re-struck and so cannot be slurred, at a
 * note already marked staccato, and at a cadence arrival, which ends a gesture
 * rather than continuing through it. A long line is divided at a barline
 * instead of being drawn as one arc across the system.
 */
function buildSlurs(notes, ts, form, hand = 'rh') {
  const slurs = [];
  const ordered = [...notes].sort((a, b) => a.onset - b.onset);

  for (const unit of form.units || []) {
    const start = unit.bars[0] * ts.ticks;
    const end = (unit.bars[1] + 1) * ts.ticks;
    const within = ordered.filter((note) => note.onset >= start && note.onset < end);

    let run = [];
    const finish = () => {
      if (run.length > 1) slurs.push({ hand, from: run[0].onset, to: run.at(-1).onset });
      run = [];
    };

    for (const note of within) {
      if (note.rest || note.articulation === 'staccato' || !note.pitches?.length) {
        finish();
        continue;
      }
      const previous = run.at(-1);
      if (previous) {
        const step = Math.abs(note.pitches[0].dia - previous.pitches[0].dia);
        const bars = Math.floor(note.onset / ts.ticks) - Math.floor(run[0].onset / ts.ticks);
        if (step === 0
          || step >= SLUR_LEAP
          || previous.cadence
          || run.length >= SLUR_MAX_NOTES
          || bars >= SLUR_MAX_BARS) finish();
      }
      run.push(note);
      if (note.cadence) finish();
    }
    finish();
  }
  return slurs;
}

/** Only offer fingerings we can explain with a stable five-finger position. */
function addFingerings(notes, low, high, hand = 'rh') {
  const sounded = notes.filter((n) => !n.rest && n.pitches.length === 1);
  if (!sounded.length) return;
  const lowest = Math.min(...sounded.map((n) => n.pitches[0].dia));
  const highest = Math.max(...sounded.map((n) => n.pitches[0].dia));
  const position = high - low <= 4 ? low : lowest;
  if (highest - position > 4 || lowest < position) return;
  for (const n of notes) {
    if (n.rest || !n.pitches.length) continue;
    const dia = n.pitches[0].dia;
    if (n.pitches.length !== 1) continue;
    n.fingering = hand === 'rh' ? dia - position + 1 : 5 - (dia - position);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const DEFAULT_PARAMS = {
  generatorVersion: 3,
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

/**
 * Introduce repeat literacy only after the reading foundations are stable.
 * A repeat encloses one complete, non-final formal unit: the learner gets a
 * clear musical idea to recognise, the final cadence keeps its closing force,
 * and no first/second ending is needed to explain the route.
 */
function planNotationRepeat(rng, form, level, measures) {
  if (level < 4) return null;
  const chance = Math.min(0.5, 0.28 + (level - 4) * 0.04);
  if (!rng.chance(chance)) return null;

  const eligible = (form.units || []).filter((unit) => {
    const length = unit.bars[1] - unit.bars[0] + 1;
    return unit.bars[1] < measures - 1 && length >= 2 && length <= 4;
  });
  if (!eligible.length) return null;

  // The opening phrase is the clearest first encounter with repeat barlines.
  // At higher levels, a later complete phrase can occasionally be repeated.
  const opening = eligible.find((unit) => unit.bars[0] === 0);
  const unit = opening && (level < 7 || rng.chance(0.72)) ? opening : rng.pick(eligible);
  return {
    startMeasure: unit.bars[0],
    endMeasure: unit.bars[1],
    times: 2,
    unit: unit.index,
    phraseFunction: unit.function,
  };
}

export function composeCandidate(userParams = {}, attempt = 0) {
  const merged = { ...DEFAULT_PARAMS, ...userParams };
  // Texture ids are the vocabulary the levels, the style packs and the critic
  // all speak. Older saved values are translated once, here, so nothing
  // downstream has to know two names for the same figure.
  const params = { ...merged, lhStyle: normaliseTexture(merged.lhStyle) };
  const seed = params.seed >>> 0;
  const candidateSeed = attempt === 0 ? seed : (seed + Math.imul(attempt, 0x9e3779b9)) >>> 0;
  const rng = makeRng(candidateSeed);
  const key = { fifths: params.keyFifths, mode: params.keyMode };
  const ts = timeSig(params.timeSignature);
  const measures = params.measures;
  const resolvedStyle = resolveCompositionStyle(rng, params.compositionStyle, {
    timeSignature: params.timeSignature,
    measures,
    lhStyle: params.lhStyle,
    keyMode: params.keyMode,
    level: params.level || 10,
  });
  const style = {
    ...resolvedStyle,
    melodyContour: rng.weighted(
      resolvedStyle.pack.melody.contours.map((item) => item.id),
      resolvedStyle.pack.melody.contours.map((item) => item.weight),
    ),
  };
  const level = params.level || 10;
  const constraints = params.level ? levelById(params.level).constraints : { simultaneous_notes: 5 };
  const form = planMusicalForm(measures, style.id, rng, level);
  const fragment = params.sourceMode === 'recombined'
    ? chooseFragment(rng, {
      meter: params.timeSignature, level, genre: style.id, lhStyle: params.lhStyle,
    })
    : null;
  if (params.sourceMode === 'recombined' && !fragment) {
    throw new Error(`No provenance-cleared ${style.id} fragment supports this level, meter, and texture`);
  }
  const fragmentShift = fragment ? rng.pick([-2, -1, 1, 2]) : 0;
  // A harmonic rhythm only works if each chord slot is a whole number of beats.
  const slotLevels = Object.entries(style.pack.harmony.harmonic_slots_by_level)
    .filter(([minimum]) => Number(minimum) <= level)
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  const styleSlots = slotLevels[0]?.[1] || 1;
  const requestedSlots = Math.min(params.chordsPerMeasure, styleSlots);
  const slot = ts.ticks / requestedSlots;
  const chordsPerMeasure = Number.isInteger(slot) && slot % ts.beat === 0
    ? requestedSlots : 1;
  // Levels and the custom panel speak in rhythm tags; resolve to legal cells.
  const levelCells = params.cells && params.cells.length
    ? resolveCells(null, ts).concat(params.cells).filter((id, i, a) => a.indexOf(id) === i)
    : resolveCells(params.rhythmTags, ts);
  const packCells = new Set(style.pack.rhythm_cells
    .filter((cell) => cell.min_level <= level && cell.meter === (ts.compound ? 'compound' : 'simple'))
    .map((cell) => cell.id));
  // Style packs govern sounding rhythm, while the level/custom vocabulary
  // governs whether rests are pedagogically available. Phrase-aware shaping
  // below decides where those rests belong.
  const cells = levelCells.filter((id) => packCells.has(id) || getCell(id)?.tags.includes('rest'));
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
  let motifPlan = null;
  const wantsRh = params.hands === 'both' || params.hands === 'rh';
  const wantsLh = params.hands === 'both' || params.hands === 'lh';
  const accompanimentReserve = wantsRh && wantsLh && params.lhStyle !== 'contrapuntal'
    ? Math.min(constraints.chromatic_notes, Math.max(1, Math.ceil(measures / 4)))
    : 0;
  const chromaticBudget = {
    remaining: constraints.chromatic_notes,
    reservedForAccompaniment: accompanimentReserve,
  };

  // Sequences need a stated idea long enough to restate, and a reader who has
  // met a second phrase before.
  const sequenceChance = level >= 3 && measures >= 8 ? 0.38 : 0;
  const stepFirst = level <= 4;
  // Holding a note through a barline is the level-7 skill the curriculum
  // already names — "ties and syncopation" — so it arrives with that
  // vocabulary rather than as a surprise.
  const tieChance = (params.rhythmTags || []).includes('syncopation') ? 0.55 : 0;
  // Entering after the downbeat is a level-3 reading skill: the eye has to
  // find a beat that has already passed.
  const upbeatChance = level >= 3 && (params.rhythmTags || []).includes('rest') ? 0.34 : 0;

  if (wantsRh) {
    const rhythm = buildRhythm(
      rng, ts, cells, measures, params.restRate, params.focusRhythmTags, form, chordsPerMeasure,
      fragment, fragmentShift, style, constraints.smallest_ticks, sequenceChance, tieChance,
      upbeatChance,
    );
    motifPlan = rhythm.motifPlan;
    staves.rh = assignPitches(rng, {
      key, ts, chords, chordsPerMeasure, rhythm, measures,
      lowDia: params.rhLow, highDia: params.rhHigh,
      maxLeap: Math.min(params.maxLeap, constraints.max_melodic_interval - 1), stepwiseBias: params.stepwiseBias,
      nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
      focusIntervals: params.focusIntervals,
      cadences: harmonyPlan.progression.cadences,
      compositionStyle: style,
      form,
      chromaticBudget,
      stepFirst,
    });
  }

  if (wantsLh) {
    if (params.lhStyle === 'contrapuntal') {
      staves.lh = buildLeftHandMelody(rng, {
        key, ts, chords, chordsPerMeasure, measures,
        cellIds: params.lhCells || cells,
        restRate: params.restRate,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: Math.min(params.maxLeap, 4, constraints.max_melodic_interval - 1),
        stepwiseBias: Math.min(0.85, params.stepwiseBias + 0.1),
        nonChordRate: params.nonChordRate * 0.7, chromaticRate: 0,
        cadences: harmonyPlan.progression.cadences,
        compositionStyle: style,
        form,
        minDuration: constraints.smallest_ticks,
        chromaticBudget,
        stepFirst,
        sequenceChance,
        tieChance,
      });
    } else if (params.hands === 'lh') {
      // Left hand alone gets the melody, not an accompaniment pattern.
      const rhythm = buildRhythm(
        rng, ts, cells, measures, params.restRate, params.focusRhythmTags, form, chordsPerMeasure,
        fragment, fragmentShift, style, constraints.smallest_ticks, sequenceChance, tieChance,
        upbeatChance,
      );
      motifPlan = rhythm.motifPlan;
      staves.lh = assignPitches(rng, {
        key, ts, chords, chordsPerMeasure, rhythm, measures,
        lowDia: params.lhLow, highDia: params.lhHigh,
        maxLeap: Math.min(params.maxLeap, constraints.max_melodic_interval - 1), stepwiseBias: params.stepwiseBias,
        nonChordRate: params.nonChordRate, chromaticRate: params.chromaticRate,
        focusIntervals: params.focusIntervals,
        cadences: harmonyPlan.progression.cadences,
        compositionStyle: style,
        form,
        chromaticBudget,
      });
    } else {
      const allowedTextures = playableTextures(
        constraints.lh_textures?.length
          ? constraints.lh_textures
          : style.pack.lh_textures.filter((item) => item.min_level <= level).map((item) => item.id),
        {
          ts,
          minDuration: constraints.smallest_ticks,
          handSpan: constraints.hand_span,
          slotTicks: ts.ticks / chordsPerMeasure,
        },
      );
      // Label the study with the figure it will actually play. A texture that
      // this meter or subdivision cannot carry is resolved here, and the
      // resolved id is what the exercise, the critic and a shared link carry.
      params.lhStyle = resolveTexture(params.lhStyle, allowedTextures);
      staves.lh = buildAccompaniment(rng, {
        key, ts, chords, chordsPerMeasure, measures,
        texture: params.lhStyle, lowDia: params.lhLow, highDia: params.lhHigh,
        form, compositionStyle: style, maxSimultaneous: constraints.simultaneous_notes,
        upperStaff: staves.rh,
        chromaticBudget,
        minDuration: constraints.smallest_ticks,
        handSpan: constraints.hand_span,
        allowInversions: params.allowInversions,
        allowChromatic: constraints.chromatic_notes > 0,
        allowedTextures,
        breathChance: (params.rhythmTags || []).includes('rest') ? 0.55 : 0,
        anticipationChance: (params.rhythmTags || []).includes('syncopation') ? 0.45 : 0,
      });
    }
  }

  for (const hand of ['rh', 'lh']) {
    for (const n of staves[hand]) n.hand = hand;
  }

  const lead = staves.rh.length ? staves.rh : staves.lh;
  const motifUnit = form.units[0];
  const motifStart = motifUnit.bars[0] * ts.ticks;
  const motifEnd = (motifUnit.bars[1] + 1) * ts.ticks;
  const motifLead = lead.filter((note) => !note.rest && note.onset >= motifStart && note.onset < motifEnd);
  const accompanying = staves.rh.length > 0 && staves.lh.length > 0
    && params.lhStyle !== 'contrapuntal';
  if (params.dynamics) {
    addDynamics(rng, lead, ts, measures, style);
    // The second staff is a part, and a part has a dynamic. An accompaniment
    // is marked one step under the melody it supports, which is the balance
    // instruction a pianist actually needs; an independent line is marked in
    // its own right.
    if (staves.lh.length && lead !== staves.lh) {
      addStaffDynamic(staves.lh, lead, accompanying);
    }
  }
  if (params.articulations) {
    addArticulations(lead, ts, style, form);
    if (staves.lh.length && lead !== staves.lh) addArticulations(staves.lh, ts, style, form);
  }
  addOrnaments(rng, lead, level, style, ts);
  if (params.dynamics) addHairpins(lead, ts, form);
  if (params.fingerings) {
    addFingerings(staves.rh, params.rhLow, params.rhHigh, 'rh');
    addFingerings(staves.lh, params.lhLow, params.lhHigh, 'lh');
  }
  const slurs = [
    ...(params.slurs && staves.rh.length ? buildSlurs(staves.rh, ts, form) : []),
    ...(params.slurs && params.lhStyle === 'contrapuntal' && staves.lh.length
      ? buildSlurs(staves.lh, ts, form, 'lh') : []),
  ];

  const keyName = KEY_NAMES[key.mode][String(key.fifths)];
  const title = `${style.title} in ${key.mode === 'minor' ? keyName.toUpperCase() : keyName} ${key.mode}, ${ORDINALS[seed % ORDINALS.length]}`;
  const notationRepeat = planNotationRepeat(rng, form, level, measures);

  const score = {
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
    generatorVersion: 3,
    stylePackVersion: style.version,
    development: {
      motif: {
        ...(motifPlan || { id: 'motif:derived', source: 'generated', bars: motifUnit.bars }),
        contour: style.melodyContour,
        seedPitches: motifLead.map((note) => ({
          onset: note.onset - motifStart,
          degree: scaleDegree(key, note.pitches[0].dia) + 1,
          octaveOffset: Math.floor((note.pitches[0].dia - tonicLetter(key)) / 7),
        })),
      },
      transforms: form.units.slice(1).map((unit) => ({
        unit: unit.index, transform: unit.transform, value: unit.transform_value || 0,
      })),
    },
    constraints: params.level ? levelById(params.level).constraints : null,
    fragment: fragment ? { id: fragment.id, shift: fragmentShift, provenance: fragment.provenance } : null,
    totalTicks: measures * ts.ticks,
    notationRepeat,
  };
  score.performanceTicks = performanceTicks(score);
  return score;
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
  if (userParams.level && Number.isFinite(userParams.tempo)) {
    const [minimum, maximum] = levelById(userParams.level).constraints.tempo;
    const safeTempo = Math.max(minimum, Math.min(maximum, userParams.tempo));
    if (safeTempo !== userParams.tempo) {
      // Tempo changes do not rewrite the music. Outside the level's assessment
      // range, preserve the chosen speed but label the take practice-only.
      const study = generateExercise({ ...userParams, tempo: safeTempo });
      return { ...study, tempo: userParams.tempo, params: { ...study.params, tempo: userParams.tempo }, tempoPracticeOnly: true };
    }
  }
  let best = null;
  let bestReview = null;
  let bestValidation = null;
  let selectedAttempt = 0;
  let attempted = 0;
  const hardFailures = new Map();

  function search(from, to, relaxed) {
    for (let attempt = from; attempt < to; attempt++) {
      attempted += 1;
      let candidate;
      try {
        candidate = composeCandidate(userParams, attempt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        hardFailures.set(message, (hardFailures.get(message) || 0) + 1);
        continue;
      }
      const relaxation = relaxed ? Math.min(4, attempt - 9) : 0;
      const validation = validateExercise(candidate, constraintsFor(candidate), { relaxation });
      for (const error of validation.hardErrors) hardFailures.set(error, (hardFailures.get(error) || 0) + 1);
      if (!validation.passed) continue;
      const review = reviewMusicality(candidate);
      if (!review.passed) {
        for (const error of review.errors.length ? review.errors : review.issues) {
          hardFailures.set(`critic: ${error}`, (hardFailures.get(`critic: ${error}`) || 0) + 1);
        }
        continue;
      }
      if (!best || review.score > bestReview.score
        || (review.score === bestReview.score && validation.softErrors.length < bestValidation.softErrors.length)) {
        best = candidate;
        bestReview = review;
        bestValidation = validation;
        selectedAttempt = attempt;
      }
    }
  }

  // Relaxation is a true fallback phase: a softer candidate can never displace
  // a fully compliant one merely because its critic score is a point higher.
  search(0, 10, false);
  if (!best) search(10, COMPOSITION_CANDIDATES, true);

  if (!best) {
    const detail = [...hardFailures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || 'soft constraints could not be relaxed safely';
    throw new Error(`Generator configuration bug: ${detail}`);
  }

  best.compositionReview = {
    ...bestReview,
    candidates: attempted,
    selectedAttempt,
    validation: bestValidation,
  };
  return best;
}

/** Flat, time-ordered list of expected note events — the grader's reference. */
export function expectedEvents(score) {
  const out = [];
  for (const hand of ['rh', 'lh']) {
    for (const note of playbackEvents(score, hand)) {
      if (note.rest) continue;
      for (const p of note.pitches) {
        out.push({
          midi: p.midi,
          pitch: p,
          onset: note.onset,
          notationOnset: note.notationOnset,
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
