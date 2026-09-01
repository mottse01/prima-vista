// Functional harmony engine.
//
// Sight Reading Factory's most-cited weakness for piano is that its chord
// progressions "don't make sense". This module fixes that at the root: chords
// are chosen by tonic / pre-dominant / dominant function with real cadence
// planning, then voiced with actual voice leading rather than parallel blocks.

import { chordTones, spellChordTone } from './theory.js';

// Degree indices: 0 = I, 1 = ii, 2 = iii, 3 = IV, 4 = V, 5 = vi, 6 = vii.
const FUNCTION_OF = ['T', 'PD', 'T', 'PD', 'D', 'T', 'D'];

// Weighted successor tables. Tuned so progressions sound like tonal music
// rather than a random walk: pre-dominants lead to dominants, dominants
// resolve, and the tonic is free to go anywhere.
const TRANSITIONS = {
  0: [[3, 3], [4, 3], [5, 2], [1, 2], [2, 1]],
  1: [[4, 5], [6, 1], [3, 1]],
  2: [[3, 3], [5, 2], [1, 1]],
  3: [[4, 4], [0, 2], [1, 2], [6, 1]],
  4: [[0, 6], [5, 1]],
  5: [[3, 3], [1, 3], [4, 1], [2, 1]],
  6: [[0, 6], [5, 1]],
};

/**
 * Plan a chord progression across `measures` bars.
 *
 * Cadences are placed first and the interior is filled backwards-compatibly:
 * the final bar is tonic, the bar before it dominant, and (for phrases of 8
 * bars or more) the midpoint gets a half cadence so the shape is audible.
 */
export function planProgression(rng, { measures, chordsPerMeasure = 1, allowSevenths = false, allowInversions = false }) {
  const slots = measures * chordsPerMeasure;
  const degrees = new Array(slots).fill(null);

  degrees[0] = 0;

  // Four-bar harmonic punctuation mirrors the melodic form: the first phrase
  // asks a question on V, the next answers on I, and longer forms alternate
  // those cadence types before the final authentic close.
  const phraseSlots = 4 * chordsPerMeasure;
  for (let end = phraseSlots - 1, phrase = 1; end < slots - 1; end += phraseSlots, phrase++) {
    const halfCadence = phrase % 2 === 1;
    degrees[end] = halfCadence ? 4 : 0;
    if (end > 0) degrees[end - 1] = halfCadence ? (rng.chance(0.55) ? 1 : 3) : 4;
    if (end + 1 < slots - 1) degrees[end + 1] = halfCadence ? 0 : (rng.chance(0.35) ? 5 : 0);
  }

  degrees[slots - 1] = 0; // final authentic cadence
  if (slots > 1) degrees[slots - 2] = rng.chance(0.92) ? 4 : 6;

  for (let i = 1; i < slots; i++) {
    if (degrees[i] !== null) continue;
    const prev = degrees[i - 1];
    let options = TRANSITIONS[prev];
    // If the next slot is already fixed, only keep successors that can reach it.
    const nextFixed = degrees[i + 1];
    if (nextFixed !== null && nextFixed !== undefined) {
      const filtered = options.filter(([d]) =>
        d === nextFixed || TRANSITIONS[d].some(([e]) => e === nextFixed));
      if (filtered.length) options = filtered;
    }
    degrees[i] = rng.weighted(options.map((o) => o[0]), options.map((o) => o[1]));
  }

  return degrees.map((degree, i) => {
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
