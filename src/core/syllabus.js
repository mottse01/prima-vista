// What a destination can actually put in front of you.
//
// A level is an envelope, not a list of topics. Level one writes a five-finger
// melody in C with no left hand, so it cannot show a leap, a sharp, a bass
// clef, or two hands arriving together — no matter how much a reader needs
// those things. Asking it to diagnose one of them has no good outcome: either
// the request is silently ignored, or the composer is handed a brief it cannot
// satisfy and writes nothing at all. Both used to happen, and both also
// dropped the level's own focus to make room for the request, so a reader who
// asked for the wrong thing quietly lost the right thing as well.
//
// So the ladder answers the question directly, and everything that chooses
// what to practise next asks it first.

import { LEVELS, levelById } from './levels.js';
import { SKILLS } from './grader.js';

/**
 * The widest melodic interval a level will actually write, in staff steps.
 *
 * The level's own `maxLeap` is a request; the constraint is the law, and the
 * generator takes the smaller of the two. A level whose reach is two can write
 * a third and nothing wider, which is a skip and never a leap.
 */
export function melodicReach(level) {
  const def = levelById(level);
  return Math.min(def.params.maxLeap, def.constraints.max_melodic_interval - 1);
}

/**
 * How far a level may push its tessitura outward when ledger lines are the
 * thing being practised.
 *
 * Every level already puts a note or two beyond the staff — even the opening
 * five-finger position sits below the treble stave — but only a level with
 * ledger lines in its budget can be asked for more of them. Pushing a level
 * with no budget produced music that failed its own validation every time.
 */
export function ledgerHeadroom(level) {
  return Math.min(4, levelById(level).constraints.ledger_lines * 2);
}

/**
 * Whether each strand can appear at all, given a level's envelope.
 *
 * These read the level definition rather than naming levels, so adding or
 * re-tuning a rung cannot leave this table quietly out of date.
 */
const PRESENTS = {
  'notes.treble': (def) => def.params.hands !== 'lh',
  'notes.bass': (def) => def.params.hands !== 'rh',
  // Middle C sits below the treble staff, so the very first five-finger
  // position already has a ledger line in it.
  'notes.ledger': () => true,
  'notes.accidental': (def) => def.params.fifths.some((fifths) => fifths !== 0)
    || def.params.modes.includes('minor')
    || def.params.chromaticRate > 0,
  'intervals.step': () => true,
  'intervals.skip': (def, reach) => reach >= 2,
  // An accompaniment figure is not bound by the melody's leap cap, so a level
  // with a left hand can show a leap even when its melody may not.
  'intervals.leap': (def, reach) => reach >= 3 || def.params.hands !== 'rh',
  'rhythm.quarter': () => true,
  'rhythm.eighth': (def) => def.params.rhythmTags.includes('eighth'),
  'rhythm.sixteenth': (def) => def.params.rhythmTags.includes('sixteenth'),
  'rhythm.dotted': (def) => def.params.rhythmTags.includes('dotted'),
  'rhythm.syncopation': (def) => def.params.rhythmTags.includes('syncopation'),
  'rhythm.triplet': (def) => def.params.rhythmTags.includes('triplet'),
  'rhythm.rest': (def) => def.params.rhythmTags.includes('rest'),
  // A general rest is a silence in both hands at once, so it needs both a
  // left hand to fall silent and rests in the vocabulary to do it with.
  'rhythm.silence': (def) => def.params.rhythmTags.includes('rest') && def.params.hands === 'both',
  'coordination.together': (def) => def.params.hands === 'both',
};

/** Whether this level can put this strand on the page. */
export function presents(level, skillId) {
  const test = PRESENTS[skillId];
  if (!test) return false;
  const def = levelById(level);
  return Boolean(test(def, melodicReach(level)));
}

/** Everything this level can be asked to diagnose. */
export function presentableSkills(level) {
  return SKILLS.map((skill) => skill.id).filter((id) => presents(level, id));
}

/**
 * Where to go to practise something.
 *
 * Staying put is preferred: a reader asking to work on skips should read skips
 * in the music they are already reading. Only when the level cannot show the
 * thing at all does this move, and then to the nearest rung that can — outward
 * first, because the ladder gains material as it rises and a reader wanting a
 * skill they have not met yet is looking forward, not back.
 */
export function levelForSkill(skillId, preferred = 1) {
  const ids = LEVELS.map((level) => level.id);
  if (!PRESENTS[skillId]) return null;
  const start = Math.max(1, Math.min(ids.length, Number(preferred) || 1));
  if (presents(start, skillId)) return start;
  return ids.find((id) => id > start && presents(id, skillId))
    ?? ids.find((id) => presents(id, skillId))
    ?? null;
}
