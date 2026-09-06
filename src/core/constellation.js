// The reading map, drawn as a sky.
//
// Every diagnostic strand the grader measures is a star. Stars that have been
// observed often enough and read well enough are lit; the rest are still dark
// sky. A constellation completes when all of its stars are lit, which is the
// same promotion evidence the adaptive engine already uses — shown as a place
// rather than as a table of percentages.

import { SKILLS } from './grader.js';

/** Evidence needed before a star is drawn at its true brightness. */
export const OBSERVATIONS_FOR_CONFIDENCE = 8;

/** A star counts as lit at the same rating the level gate asks for. */
export const LIT_RATING = 0.72;

/**
 * Four constellations, one per reading strand.
 *
 * The names are real constellations chosen for what they mean: the lyre for
 * reading notation, the arrow for the distance between two notes, the
 * pendulum clock for pulse, and the twins for two hands at once.
 */
export const CONSTELLATIONS = [
  {
    id: 'lyra',
    name: 'Lyra',
    meaning: 'The lyre',
    strand: 'Staff and key reading',
    hue: 196,
    stars: [
      { id: 'notes.treble', x: 24, y: 20, magnitude: 1 },
      { id: 'notes.bass', x: 52, y: 12, magnitude: 1 },
      { id: 'notes.ledger', x: 68, y: 46, magnitude: 2 },
      { id: 'notes.accidental', x: 34, y: 58, magnitude: 2 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0]],
  },
  {
    id: 'sagitta',
    name: 'Sagitta',
    meaning: 'The arrow',
    strand: 'Distance between notes',
    hue: 44,
    stars: [
      { id: 'intervals.step', x: 16, y: 52, magnitude: 1 },
      { id: 'intervals.skip', x: 46, y: 38, magnitude: 1 },
      { id: 'intervals.leap', x: 78, y: 22, magnitude: 2 },
    ],
    lines: [[0, 1], [1, 2]],
  },
  {
    id: 'horologium',
    name: 'Horologium',
    meaning: 'The pendulum clock',
    strand: 'Pulse and subdivision',
    hue: 276,
    stars: [
      { id: 'rhythm.quarter', x: 50, y: 10, magnitude: 1 },
      { id: 'rhythm.eighth', x: 74, y: 26, magnitude: 1 },
      { id: 'rhythm.sixteenth', x: 82, y: 54, magnitude: 2 },
      { id: 'rhythm.triplet', x: 62, y: 76, magnitude: 3 },
      { id: 'rhythm.dotted', x: 32, y: 76, magnitude: 2 },
      { id: 'rhythm.syncopation', x: 16, y: 52, magnitude: 2 },
      { id: 'rhythm.rest', x: 24, y: 24, magnitude: 2 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    meaning: 'The twins',
    strand: 'Two hands at once',
    hue: 152,
    stars: [
      { id: 'coordination.together', x: 36, y: 30, magnitude: 1 },
      { id: 'rhythm.silence', x: 66, y: 62, magnitude: 2 },
    ],
    lines: [[0, 1]],
  },
];

const LABELS = new Map(SKILLS.map((skill) => [skill.id, skill.label]));

// The ten waypoints, and where each level sits in the sky, live in the journey
// model beside the astronomy they are drawn from.
export { WAYPOINTS, waypointFor } from './journey.js';

/**
 * One star's observed state.
 *
 * `brightness` is what the map draws: rating scaled by how much evidence
 * stands behind it, so a lucky single take does not light a star.
 */
export function starState(profile, id) {
  const skill = profile?.skills?.[id] || { rating: 0.5, attempts: 0 };
  const confidence = Math.min(1, skill.attempts / OBSERVATIONS_FOR_CONFIDENCE);
  const lit = skill.attempts >= OBSERVATIONS_FOR_CONFIDENCE && skill.rating >= LIT_RATING;
  return {
    id,
    label: LABELS.get(id) || id,
    rating: skill.rating,
    attempts: skill.attempts,
    confidence,
    brightness: confidence === 0 ? 0 : Math.max(0.12, skill.rating) * confidence,
    lit,
    unobserved: skill.attempts === 0,
  };
}

/** Every constellation with its stars resolved against the profile. */
export function skyState(profile) {
  return CONSTELLATIONS.map((constellation) => {
    const stars = constellation.stars.map((star) => ({ ...star, ...starState(profile, star.id) }));
    const observed = stars.filter((star) => !star.unobserved);
    return {
      ...constellation,
      stars,
      litCount: stars.filter((star) => star.lit).length,
      charted: stars.every((star) => star.lit),
      observedCount: observed.length,
      // A constellation you have never pointed a telescope at is not weak, it
      // is simply unobserved, and the map should say so.
      untouched: observed.length === 0,
    };
  });
}

/** How much of the whole sky is charted, for the one headline figure. */
export function skyProgress(profile) {
  const sky = skyState(profile);
  const stars = sky.flatMap((constellation) => constellation.stars);
  return {
    lit: stars.filter((star) => star.lit).length,
    total: stars.length,
    charted: sky.filter((constellation) => constellation.charted).length,
    constellations: sky.length,
  };
}

/**
 * The dimmest star with enough evidence to trust — the one worth observing
 * next. Stars nobody has looked at yet are offered before failing ones only
 * when nothing has been measured at all.
 */
export function nextObservation(profile) {
  const stars = skyState(profile).flatMap((constellation) => (
    constellation.stars.map((star) => ({ ...star, constellation }))
  ));
  const measured = stars.filter((star) => star.attempts >= OBSERVATIONS_FOR_CONFIDENCE && !star.lit);
  if (measured.length) return measured.sort((a, b) => a.rating - b.rating)[0];
  const partial = stars.filter((star) => star.attempts > 0 && !star.lit);
  if (partial.length) return partial.sort((a, b) => a.attempts - b.attempts)[0];
  return null;
}
