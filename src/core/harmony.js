// Progression-based harmony engine.
//
// Every exercise starts from a recognised tonal progression, repeats that
// harmonic pattern, and receives phrase-aware cadences. Chord voicings still
// use nearest-motion voice leading rather than parallel blocks.

import { chordTones, ROMAN, spellChordTone } from './theory.js';

// Degree indices: 0 = I, 1 = ii, 2 = iii, 3 = IV, 4 = V, 5 = vi, 6 = vii.
const FUNCTION_OF = ['T', 'PD', 'T', 'PD', 'D', 'T', 'D'];

const progression = (id, name, style, degrees) => Object.freeze({
  id,
  name,
  style,
  degrees: Object.freeze(degrees),
});

const cadence = (id, name, short, options) => Object.freeze({ id, name, short, ...options });

/** Cadential grammar shared by the harmonic and melodic planners. */
export const COMMON_CADENCES = Object.freeze({
  authentic: cadence('authentic', 'Perfect authentic cadence', 'PAC', {
    approaches: [4], arrival: 0, melodyDegree: 0,
  }),
  imperfect: cadence('imperfect', 'Imperfect authentic cadence', 'IAC', {
    approaches: [4], arrival: 0, melodyDegree: 2,
  }),
  plagal: cadence('plagal', 'Plagal cadence', 'PC', {
    approaches: [3], arrival: 0, melodyDegree: 0,
  }),
  half: cadence('half', 'Half cadence', 'HC', {
    approaches: [1, 3], arrival: 4, melodyDegree: 4,
  }),
  deceptive: cadence('deceptive', 'Deceptive cadence', 'DC', {
    approaches: [4], arrival: 5, melodyDegree: 5,
  }),
  phrygian: cadence('phrygian', 'Phrygian half cadence', 'PHC', {
    approaches: [3], approachInversion: 1, arrival: 4, melodyDegree: 4, modes: ['minor'],
  }),
  modal: cadence('modal', 'Modal close', 'MC', {
    approaches: [6], arrival: 0, melodyDegree: 0, modes: ['minor'],
  }),
});

/** Familiar loops used as the harmonic spine of every generated study. */
export const COMMON_PROGRESSIONS = Object.freeze({
  major: Object.freeze([
    progression('pop-loop', 'Pop loop', 'Song', [0, 4, 5, 3]),               // I–V–vi–IV
    progression('fifties', '’50s progression', 'Song', [0, 5, 3, 4]),       // I–vi–IV–V
    progression('turnaround', 'Tonal turnaround', 'Classical', [0, 5, 1, 4]),
    progression('canon', 'Canon sequence', 'Classical', [0, 4, 5, 2, 3, 0, 3, 4]),
  ]),
  minor: Object.freeze([
    progression('andalusian', 'Andalusian sequence', 'Folk', [0, 6, 5, 4]),
    progression('minor-pop', 'Minor pop loop', 'Song', [0, 5, 2, 6]),
    progression('minor-turnaround', 'Minor turnaround', 'Classical', [0, 5, 1, 4]),
    progression('minor-circle', 'Minor circle sequence', 'Classical', [0, 3, 6, 2]),
  ]),
});

const CADENCE_POOLS = {
  internal: [
    ['half', 5], ['deceptive', 2.5], ['imperfect', 2.5], ['plagal', 1], ['phrygian', 2],
  ],
  final: [
    ['authentic', 4], ['imperfect', 2], ['plagal', 3], ['modal', 2],
  ],
  short: [
    ['authentic', 3], ['imperfect', 2], ['plagal', 2.5], ['half', 2],
    ['deceptive', 1], ['phrygian', 1.5], ['modal', 1],
  ],
};

function chooseCadence(rng, { final, onlyPhrase, mode, previous, melodyDegrees }) {
  const pool = CADENCE_POOLS[onlyPhrase ? 'short' : final ? 'final' : 'internal'];
  const modeChoices = pool
    .map(([id, weight]) => [COMMON_CADENCES[id], weight])
    .filter(([item]) => !item.modes || item.modes.includes(mode));
  const ranged = melodyDegrees?.length
    ? modeChoices.filter(([item]) => melodyDegrees.includes(item.melodyDegree))
    : modeChoices;
  const choices = ranged.length ? ranged : modeChoices;
  const weights = choices.map(([item, weight]) => item.id === previous?.id ? weight * 0.12 : weight);
  return rng.weighted(choices.map(([item]) => item), weights);
}

function romanWithInversion(mode, degree, inversion = 0) {
  return ROMAN[mode][degree] + (inversion === 1 ? '6' : inversion === 2 ? '64' : '');
}

/**
 * Choose and repeat one common progression across `measures` bars, then shape
 * each phrase with a common cadence. The chosen pattern and cadence plan are
 * returned so the melodic planner and the player can see the same structure.
 */
export function planProgression(rng, {
  measures,
  chordsPerMeasure = 1,
  allowSevenths = false,
  allowInversions = false,
  mode = 'major',
  form = null,
  melodyDegrees = null,
}) {
  const slots = measures * chordsPerMeasure;
  const resolvedMode = COMMON_PROGRESSIONS[mode] ? mode : 'major';
  const template = rng.pick(COMMON_PROGRESSIONS[resolvedMode]);
  const degrees = Array.from({ length: slots }, (_, i) => template.degrees[i % template.degrees.length]);

  const phraseEndMeasures = form?.plan
    ? form.plan.filter((item) => item.cadence).map((item) => item.measure)
    : Array.from({ length: Math.ceil(measures / 4) }, (_, i) => Math.min(measures - 1, i * 4 + 3));
  const uniqueEnds = [...new Set(phraseEndMeasures)];
  const cadenceSlots = new Map();
  const cadences = [];
  let previousCadence = null;

  for (const measure of uniqueEnds) {
    const endSlot = Math.min(slots - 1, (measure + 1) * chordsPerMeasure - 1);
    const startSlot = Math.max(0, endSlot - 1);
    const final = endSlot === slots - 1;
    const chosen = chooseCadence(rng, {
      final,
      onlyPhrase: uniqueEnds.length === 1,
      mode: resolvedMode,
      previous: previousCadence,
      melodyDegrees,
    });
    const approach = rng.pick(chosen.approaches);
    const appliedSlots = startSlot === endSlot ? [endSlot] : [startSlot, endSlot];
    const appliedDegrees = startSlot === endSlot ? [chosen.arrival] : [approach, chosen.arrival];
    const inversions = startSlot === endSlot ? [0] : [chosen.approachInversion || 0, 0];

    appliedSlots.forEach((slot, i) => {
      degrees[slot] = appliedDegrees[i];
      cadenceSlots.set(slot, {
        id: chosen.id,
        position: i === appliedSlots.length - 1 ? 'arrival' : 'approach',
        inversion: inversions[i],
      });
    });

    cadences.push({
      id: chosen.id,
      name: chosen.name,
      short: chosen.short,
      measure,
      final,
      slots: appliedSlots,
      degrees: appliedDegrees,
      melodyDegree: chosen.melodyDegree,
      roman: appliedDegrees.map((degree, i) => romanWithInversion(resolvedMode, degree, inversions[i])).join('–'),
    });
    previousCadence = chosen;
  }

  const chords = degrees.map((degree, i) => {
    const cadenceMark = cadenceSlots.get(i);
    // Sevenths belong on the dominant above all, and on ii as a pre-dominant.
    const seventhChance = degree === 4 ? 0.5 : degree === 1 ? 0.3 : 0;
    const seventh = allowSevenths && rng.chance(seventhChance);
    let inversion = cadenceMark?.inversion || 0;
    if (allowInversions && !cadenceMark && rng.chance(0.3)) inversion = rng.chance(0.7) ? 1 : 2;
    return {
      degree,
      seventh: Boolean(seventh),
      inversion,
      fn: FUNCTION_OF[degree],
      index: i,
      source: cadenceMark ? 'cadence' : 'progression',
      cadence: cadenceMark ? { id: cadenceMark.id, position: cadenceMark.position } : null,
    };
  });

  const finalCadence = cadences[cadences.length - 1] || null;

  return {
    chords,
    progression: {
      id: template.id,
      name: template.name,
      style: template.style,
      degrees: [...template.degrees],
      roman: template.degrees.map((degree) => ROMAN[resolvedMode][degree]).join('–'),
      cadence: finalCadence?.name || null,
      cadencePlan: cadences.map((item) => item.short).join(' → '),
      cadences,
    },
  };
}

/**
 * Voice a chord in the left hand, choosing the rotation (inversion) that moves
 * least from the previous voicing. Returns ascending diatonic indices.
 */
export function voiceChord(key, chord, prevVoicing, { lowDia, highDia }) {
  const centre = Math.round((lowDia + highDia) / 2);
  const base = chordTones(key, chord, centre - 2);
  const candidates = [];

  for (let rot = 0; rot < base.length; rot++) {
    for (let oct = -1; oct <= 1; oct++) {
      const voicing = [];
      for (let i = 0; i < base.length; i++) {
        const idx = (rot + i) % base.length;
        const wraps = rot + i >= base.length ? 7 : 0;
        voicing.push(base[idx] + wraps + oct * 7);
      }
      voicing.sort((a, b) => a - b);
      if (voicing[0] < lowDia || voicing[voicing.length - 1] > highDia) continue;
      // Fixed inversions requested by the plan pin the bass note.
      if (chord.inversion && ((voicing[0] - base[0]) % 7 + 7) % 7 !== chord.inversion * 2) continue;
      candidates.push(voicing);
    }
  }
  if (!candidates.length) {
    // Range is too tight for a full triad — fall back to root and fifth.
    const root = Math.max(lowDia, Math.min(highDia, base[0]));
    return [root];
  }

  if (!prevVoicing) {
    // Open with something centred, root-position by preference.
    candidates.sort((a, b) => Math.abs(a[0] - lowDia - 2) - Math.abs(b[0] - lowDia - 2));
    return candidates[0];
  }

  let best = candidates[0];
  let bestCost = Infinity;
  for (const cand of candidates) {
    let cost = 0;
    for (let i = 0; i < cand.length; i++) {
      const prev = prevVoicing[Math.min(i, prevVoicing.length - 1)];
      cost += Math.abs(cand[i] - prev);
    }
    // Nudge away from a stagnant bass so the left hand still has a line.
    if (cand[0] === prevVoicing[0]) cost += 0.5;
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return best;
}

/** Spell a voicing inside the key, applying leading tones where the chord needs them. */
export function spellVoicing(key, chord, voicing) {
  return voicing.map((dia) => spellChordTone(key, chord, dia));
}
