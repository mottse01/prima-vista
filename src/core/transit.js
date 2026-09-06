// Tonight's Transit — one shared piece a day.
//
// A transit happens at a fixed time and does not happen again. So does a first
// read: once you have seen the music, you can never sight-read it. The two
// facts fit, so the daily challenge is built out of the thing this generator
// already guarantees — a seed that produces identical music everywhere.
//
// Nothing is sent anywhere. The date is the seed, so every reader opens the
// same eight bars without a server knowing that they did.

import { levelById, LEVELS } from './levels.js';
import { paramsForLevel } from './adaptive.js';

/** The transit runs on the reader's own calendar day, in their own timezone. */
export function transitDay(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A stable 32-bit seed from the day string, so the piece is the same for all. */
export function transitSeed(day = transitDay()) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < day.length; index++) {
    hash ^= day.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The transit is read at the level you have reached, so a beginner and an
 * advanced reader get the same seed realised at their own difficulty. The
 * music differs; the challenge — one cold read, today — does not.
 */
export function transitParams(profile, now = new Date()) {
  const day = transitDay(now);
  const level = Math.max(1, Math.min(LEVELS.length, profile?.level || 1));
  return {
    day,
    level,
    params: paramsForLevel(level, profile, {
      seed: transitSeed(day),
      targeting: false,
    }),
  };
}

/** Has today's transit already been read? A transit only happens once. */
export function transitTaken(profile, now = new Date()) {
  const day = transitDay(now);
  return (profile?.transits || []).some((entry) => entry.day === day);
}

export function transitResult(profile, day = transitDay()) {
  return (profile?.transits || []).find((entry) => entry.day === day) || null;
}

/** Record a transit read. Only the first read of a day counts. */
export function recordTransit(profile, { day = transitDay(), score, level }) {
  if (transitTaken(profile, new Date(`${day}T12:00:00`))) return profile;
  const transits = [...(profile.transits || []), { day, score, level }].slice(-120);
  return { ...profile, transits };
}

/**
 * Consecutive days with a transit read, counting back from today.
 *
 * Deliberately counted in first reads rather than minutes: minutes reward
 * sitting at the instrument, and this is a reading habit.
 */
export function transitStreak(profile, now = new Date()) {
  const days = new Set((profile?.transits || []).map((entry) => entry.day));
  if (!days.size) return 0;
  const cursor = new Date(now);
  // A streak survives until today's transit is actually missed, so it does not
  // read as broken at one minute past midnight.
  if (!days.has(transitDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(transitDay(cursor)) && count < 3650) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** A short, spoiler-free description of what today's transit is. */
export function transitBlurb(level) {
  const definition = levelById(level);
  return `${definition.name} · ${definition.blurb}`;
}
