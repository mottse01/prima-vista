// What each destination asks of you.
//
// A waypoint is not cleared by turning up. Every objective here is checked
// against evidence the grader already collects — first reads, skill strands,
// timing, hand balance, what was actually on the page — so a mission is a
// reading task with a name, never a separate currency to farm.
//
// The objectives differ from place to place on purpose. Luna asks for a steady
// pulse in a five-finger position; Neptune asks you to hold a note through a
// barline; the Kuiper Belt asks for two independent voices. That is the level
// curriculum, made legible and given somewhere to happen.

import { comparableReads } from './adaptive.js';
import { skyProgress } from './constellation.js';
import { LIT_RATING, OBSERVATIONS_FOR_CONFIDENCE } from './constellation.js';
import { waypointFor } from './journey.js';

/** A read counts toward a mission at the same score the level gate wants. */
export const STRONG_READ = 88;

const takesAt = (profile, level) => (profile?.history || []).filter((take) => take.level === level);
const recipeOf = (take) => take?.meta?.recipe?.params || null;

// ---------------------------------------------------------------------------
// Objective builders
// ---------------------------------------------------------------------------

/** Progress is always reported as have/need so a panel can draw it. */
const counted = (id, title, detail, need, have) => ({
  id, title, detail, need, have: Math.min(have, need), done: have >= need,
});

const firstReads = (count) => (context) => counted(
  'first-reads',
  `${count} clean first reads`,
  `Score ${STRONG_READ} or better on music you have not seen before.`,
  count,
  context.reads.filter((take) => take.score >= STRONG_READ).length,
);

const strand = (id, title, detail) => (context) => {
  const skill = context.profile?.skills?.[id] || { rating: 0, attempts: 0 };
  const proven = skill.attempts >= OBSERVATIONS_FOR_CONFIDENCE && skill.rating >= LIT_RATING;
  return counted(`strand:${id}`, title, detail, 1, proven ? 1 : 0);
};

const steadyBeat = (milliseconds) => (context) => counted(
  'steady',
  `Hold the beat within ${milliseconds} ms`,
  'One read whose average timing sits close to the pulse, early or late.',
  1,
  context.takes.some((take) => take.timing != null && Math.abs(take.timing) * 1000 <= milliseconds) ? 1 : 0,
);

const unbroken = () => (context) => counted(
  'unbroken',
  'One read without stopping',
  'Keep going through every attack, even past a wrong note.',
  1,
  context.takes.some((take) => (take.continuity ?? 0) >= 0.99) ? 1 : 0,
);

const evenHands = (points) => (context) => counted(
  'hands',
  `Hands within ${points} points`,
  'One read where the bass staff is as accurate as the treble.',
  1,
  context.takes.some((take) => {
    const rh = take.hands?.rh?.pitchAccuracy;
    const lh = take.hands?.lh?.pitchAccuracy;
    return rh != null && lh != null && Math.abs(rh - lh) * 100 <= points;
  }) ? 1 : 0,
);

const eclipse = (title, detail, modes) => (context) => counted(
  'eclipse',
  title,
  detail,
  1,
  modes.some((mode) => (context.profile?.lookAhead?.[mode]?.takes || 0) > 0) ? 1 : 0,
);

const transitHere = () => (context) => counted(
  'transit',
  'Read a transit from here',
  'One of Tonight’s Transits, read cold at this level.',
  1,
  (context.profile?.transits || []).some((entry) => entry.level === context.level) ? 1 : 0,
);

const played = (id, title, detail, matches) => (context) => counted(
  id,
  title,
  detail,
  1,
  context.takes.some((take) => matches(take, recipeOf(take))) ? 1 : 0,
);

const distinctKeys = (count) => (context) => counted(
  'keys',
  `Read in ${count} different keys`,
  'The same skills, with a different set of sharps or flats in front of you.',
  count,
  new Set(context.takes.map((take) => recipeOf(take)?.keyFifths).filter((value) => value != null)).size,
);

const chartTheSky = () => (context) => {
  const sky = skyProgress(context.profile);
  return counted(
    'sky',
    'Chart every constellation',
    'All four reading constellations complete.',
    sky.constellations,
    sky.charted,
  );
};

// ---------------------------------------------------------------------------
// The missions
// ---------------------------------------------------------------------------

/**
 * Three objectives per destination: prove you can read the level, prove the
 * skill the level exists to teach, and do one thing only this place asks for.
 */
export const MISSIONS = {
  1: [
    firstReads(3),
    steadyBeat(45),
    unbroken(),
  ],
  2: [
    firstReads(3),
    strand('notes.bass', 'Read the bass staff', 'Bass-clef notes, proven over enough of them to trust.'),
    strand('coordination.together', 'Bring the hands together', 'Both hands arriving on the same beat.'),
  ],
  3: [
    firstReads(3),
    strand('rhythm.rest', 'Count through a silence', 'Re-enter in time after a rest.'),
    eclipse(
      'Read one bar ahead',
      'One Eclipse take: the notes go dark before you reach them.',
      ['played', 'beat', 'adaptive', 'twobeats', 'bar'],
    ),
  ],
  4: [
    firstReads(3),
    strand('intervals.skip', 'Read skips at sight', 'Thirds recognised without counting up from the line below.'),
    distinctKeys(2),
  ],
  5: [
    firstReads(3),
    strand('rhythm.dotted', 'Feel the dotted beat', 'Dotted values read as one gesture.'),
    played(
      'meter',
      'Read a compound metre',
      'One study in 6/8, where the beat divides in three.',
      (take, recipe) => recipe?.timeSignature?.endsWith('/8'),
    ),
  ],
  6: [
    firstReads(3),
    strand('rhythm.sixteenth', 'Hold sixteenths steady', 'The fastest values at this level, kept even.'),
    evenHands(12),
  ],
  7: [
    firstReads(3),
    strand('rhythm.syncopation', 'Play against the beat', 'Syncopation read as displacement, not as a mistake.'),
    played(
      'tie',
      'Hold a note through a barline',
      'One study containing a tie across the bar, played through it.',
      (take) => Boolean(take?.meta?.tiedOverBarline),
    ),
  ],
  8: [
    firstReads(3),
    strand('rhythm.triplet', 'Read three against two', 'Triplets against a duple pulse.'),
    played(
      'stride',
      'Read a walking or stride bass',
      'A left hand that moves as a line rather than as a chord.',
      (take, recipe) => ['walking', 'stride', 'boogie'].includes(recipe?.lhStyle),
    ),
  ],
  9: [
    firstReads(3),
    played(
      'contrapuntal',
      'Read two independent voices',
      'A study where the left hand has a melody of its own.',
      (take, recipe) => recipe?.lhStyle === 'contrapuntal' || recipe?.lhStyle === 'melodic',
    ),
    transitHere(),
  ],
  10: [
    firstReads(3),
    chartTheSky(),
    eclipse(
      'Read a full bar ahead',
      'One Eclipse take at the longest look-ahead.',
      ['bar', 'twobeats'],
    ),
  ],
};

/**
 * Where a reader stands at one destination.
 *
 * Missions describe the recommended course; they never lock a level. Anyone
 * can fly anywhere at any time, which is the app's own rule — an adult
 * returning to the piano should not have to re-earn Luna.
 */
export function missionState(profile, level) {
  const builders = MISSIONS[level] || [];
  const context = {
    profile,
    level,
    reads: comparableReads(profile, level),
    takes: takesAt(profile, level),
  };
  const objectives = builders.map((build) => build(context));
  return {
    level,
    waypoint: waypointFor(level),
    objectives,
    done: objectives.filter((item) => item.done).length,
    total: objectives.length,
    cleared: objectives.length > 0 && objectives.every((item) => item.done),
  };
}

/** The next thing to actually do here, or null when the place is cleared. */
export function nextObjective(profile, level) {
  return missionState(profile, level).objectives.find((item) => !item.done) || null;
}

/** Every destination's standing, for the map. */
export function missionProgress(profile) {
  return Object.keys(MISSIONS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((level) => missionState(profile, level));
}
