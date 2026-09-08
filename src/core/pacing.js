// Reading tempo, calibrated to the reader.
//
// Sight-reading is a time-constrained task. The same eight bars at 60 and at
// 108 are not the same exercise, and reading them at a tempo that leaves time
// to work each note out is not sight-reading at all — it is very slow
// deciphering. Every level in the ladder already declares a tempo band, and
// until now nothing used it: every study at a level was written at that
// level's single default number, and the band existed only so the validator
// could reject a tempo nobody was setting.
//
// This walks the tempo inside the level's own band. A reader who is
// comfortable is asked to read a little faster; a reader coming apart is given
// room to keep going. Difficulty is a dial the app already owns, and leaving
// it fixed meant every reader at a level got the same one.
//
// The target is deliberately not perfection. Reading that is always clean is
// not asking anything, and reading that collapses stops being reading; so the
// tempo moves up only from readings that were both accurate and unbroken, and
// comes down when the reader stopped keeping up. The step is small, and three
// readings stand behind every move, so no single bad take changes the ground.

import { levelById } from './levels.js';
import { comparableReads } from './reads.js';

/** Above this, the page was not asking enough of the reader. */
export const COMFORTABLE = 92;
/** Below this, the tempo is in the way of the reading. */
export const STRUGGLING = 72;
/** A reading only counts toward speeding up if the pulse survived it. */
export const FLUENT_CONTINUITY = 0.95;
/** How many readings stand behind one move. */
export const READS_BEFORE_MOVING = 3;
/** One move, in beats per minute. Small enough to be felt and not feared. */
export const STEP = 4;

/** The tempo range a level permits, from its own definition. */
export const tempoBand = (level) => levelById(level).constraints.tempo;

const clampToBand = (level, bpm) => {
  const [low, high] = tempoBand(level);
  return Math.max(low, Math.min(high, Math.round(bpm)));
};

/**
 * The tempo this reader currently reads at, at this level.
 *
 * Falls back to the level's published default, which is where everybody
 * starts and where a reader with no history here stays.
 */
export function readingTempo(profile, level) {
  const stored = profile?.pacing?.[level];
  const base = Number.isFinite(stored) ? stored : levelById(level).params.tempo;
  return clampToBand(level, base);
}

/**
 * Where the tempo should sit after the readings recorded so far.
 *
 * Returns the same number when there is not enough evidence to move, which is
 * the common case: this is meant to drift over a session, not react to a take.
 */
export function nextTempo(profile, level) {
  const current = readingTempo(profile, level);
  const recent = comparableReads(profile, level).slice(-READS_BEFORE_MOVING);
  if (recent.length < READS_BEFORE_MOVING) return current;

  const mean = recent.reduce((sum, take) => sum + take.score, 0) / recent.length;
  const heldTogether = recent.every((take) => (take.continuity ?? 0) >= FLUENT_CONTINUITY);
  // Reading this well while keeping the pulse means the notes are no longer
  // the constraint. Speed is the next thing to ask for.
  if (mean >= COMFORTABLE && heldTogether) return clampToBand(level, current + STEP);
  // Coming apart is not always about speed, but slowing down is the one
  // response that never makes it worse.
  const brokenUp = recent.reduce((sum, take) => sum + (take.continuity ?? 1), 0) / recent.length < 0.8;
  if (mean < STRUGGLING || brokenUp) return clampToBand(level, current - STEP);
  return current;
}

/**
 * The pacing map after this level's latest reading.
 *
 * Kept on the profile rather than recomputed from history, because history is
 * capped and a reader who has read a great deal should not silently drop back
 * to a beginner's tempo when their early takes scroll off the end.
 */
export function calibrate(profile, level) {
  if (!level) return profile?.pacing || {};
  const pacing = { ...(profile?.pacing || {}) };
  const wanted = nextTempo(profile, level);
  if (wanted === readingTempo(profile, level) && pacing[level] === wanted) return pacing;
  pacing[level] = wanted;
  return pacing;
}

/** How the current tempo sits inside the level's band, for a progress panel. */
export function pacingStanding(profile, level) {
  const [low, high] = tempoBand(level);
  const bpm = readingTempo(profile, level);
  return {
    bpm,
    low,
    high,
    // 0 at the bottom of the band, 1 at the top; a band of one number is
    // already at its own ceiling.
    position: high > low ? (bpm - low) / (high - low) : 1,
    atCeiling: bpm >= high,
    atFloor: bpm <= low,
    fromDefault: bpm - levelById(level).params.tempo,
  };
}
