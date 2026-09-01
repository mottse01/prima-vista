// Progression-based harmony engine.
//
// Every exercise starts from a recognised tonal progression, repeats that
// harmonic pattern, and closes with an authentic cadence. Chord voicings still
// use nearest-motion voice leading rather than parallel blocks.

import { chordTones, ROMAN, spellChordTone } from './theory.js';

// Degree indices: 0 = I, 1 = ii, 2 = iii, 3 = IV, 4 = V, 5 = vi, 6 = vii.
const FUNCTION_OF = ['T', 'PD', 'T', 'PD', 'D', 'T', 'D'];

const progression = (id, name, degrees) => Object.freeze({
  id,
  name,
  degrees: Object.freeze(degrees),
});

/** Familiar loops used as the harmonic spine of every generated study. */
export const COMMON_PROGRESSIONS = Object.freeze({
  major: Object.freeze([
    progression('pop-loop', 'Pop loop', [0, 4, 5, 3]),               // I–V–vi–IV
    progression('fifties', '’50s progression', [0, 5, 3, 4]),       // I–vi–IV–V
    progression('turnaround', 'Tonal turnaround', [0, 5, 1, 4]),    // I–vi–ii–V
    progression('canon', 'Canon sequence', [0, 4, 5, 2, 3, 0, 3, 4]),
  ]),
  minor: Object.freeze([
    progression('andalusian', 'Andalusian cadence', [0, 6, 5, 4]),  // i–VII–VI–V
    progression('minor-pop', 'Minor pop loop', [0, 5, 2, 6]),       // i–VI–III–VII
    progression('minor-turnaround', 'Minor turnaround', [0, 5, 1, 4]),
    progression('minor-circle', 'Minor circle sequence', [0, 3, 6, 2]),
  ]),
});

/**
 * Choose and repeat one common progression across `measures` bars, then add a
 * V–I close. The chosen pattern is returned as metadata so the score can name
 * its harmonic plan for the player.
 */
export function planProgression(rng, {
  measures,
  chordsPerMeasure = 1,
  allowSevenths = false,
  allowInversions = false,
  mode = 'major',
}) {
  const slots = measures * chordsPerMeasure;
  const resolvedMode = COMMON_PROGRESSIONS[mode] ? mode : 'major';
  const template = rng.pick(COMMON_PROGRESSIONS[resolvedMode]);
  const degrees = Array.from({ length: slots }, (_, i) => template.degrees[i % template.degrees.length]);

  if (slots === 1) degrees[0] = 0;
  if (slots > 1) {
    degrees[slots - 2] = 4;
    degrees[slots - 1] = 0;
  }

  const chords = degrees.map((degree, i) => {
    const isCadential = i >= slots - 2;
    // Sevenths belong on the dominant above all, and on ii as a pre-dominant.
    const seventhChance = degree === 4 ? 0.5 : degree === 1 ? 0.3 : 0;
    const seventh = allowSevenths && rng.chance(seventhChance);
    let inversion = 0;
    if (allowInversions && !isCadential && rng.chance(0.3)) inversion = rng.chance(0.7) ? 1 : 2;
    return {
      degree,
      seventh: Boolean(seventh),
      inversion,
      fn: FUNCTION_OF[degree],
      index: i,
    };
  });

  return {
    chords,
    progression: {
      id: template.id,
      name: template.name,
      degrees: [...template.degrees],
      roman: template.degrees.map((degree) => ROMAN[resolvedMode][degree]).join('–'),
      cadence: `${ROMAN[resolvedMode][4]}–${ROMAN[resolvedMode][0]}`,
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
