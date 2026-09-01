// Adaptive engine.
//
// Two things happen after every take: skill ratings move, and the *next*
// exercise is bent toward whatever is weakest. This is the part neither
// competitor does — SRF has no idea how you played, and fixed-library apps can
// only pick a different piece, not a different weakness.

import { SKILLS } from './grader.js';
import { levelById, LEVELS } from './levels.js';
import { makeRng, randomSeed } from './rng.js';

const ALPHA_MIN = 0.18;
const ALPHA_MAX = 0.45;

// A second reading of music you have already seen is practice, not
// sight-reading: it still says something about your notes and rhythm, but
// familiarity inflates it, so it moves the skill map at half weight and can
// never advance your level.
const REPEAT_WEIGHT = 0.5;

// How many recently-scored exercise seeds to remember, so a reload or a shared
// link cannot launder a repeat into a fresh first read.
const SEEN_SEEDS_KEPT = 300;

export function emptyProfile() {
  const skills = {};
  for (const s of SKILLS) skills[s.id] = { rating: 0.5, attempts: 0 };
  return {
    version: 1,
    level: 1,
    skills,
    history: [],       // { at, level, score, seed, repeat, curtain, ... }
    streak: { count: 0, lastDay: null },
    totals: { takes: 0, notes: 0, minutes: 0 },
    // Look-ahead curtain progress, keyed by curtain mode.
    lookAhead: {},     // { [mode]: { takes, best, last } }
    seenSeeds: [],
  };
}

/**
 * Fold one take's results into the profile.
 *
 * Three kinds of take are treated differently, because they measure different
 * things: a first read of new music is the real sight-reading measurement, a
 * replay is contaminated by familiarity, and a curtain take is measuring
 * look-ahead rather than note knowledge.
 *
 * Returns { profile, promoted, demoted, repeat }.
 */
export function applyResult(profile, { level, summary, seed, elapsedSec, meta, takeIndex = 1, curtain = 'off' }) {
  const next = {
    ...profile,
    skills: { ...profile.skills },
    history: [...profile.history],
    totals: { ...profile.totals },
    streak: { ...profile.streak },
    lookAhead: { ...(profile.lookAhead || {}) },
    seenSeeds: [...(profile.seenSeeds || [])],
  };

  const seenBefore = next.seenSeeds.includes(seed);
  const repeat = takeIndex > 1 || seenBefore;
  const curtained = Boolean(curtain) && curtain !== 'off';

  if (!seenBefore) {
    next.seenSeeds.push(seed);
    if (next.seenSeeds.length > SEEN_SEEDS_KEPT) {
      next.seenSeeds = next.seenSeeds.slice(-SEEN_SEEDS_KEPT);
    }
  }

  // A curtain take is a reading-fluency drill. Scoring it against the skill map
  // would read the curtain's difficulty as "you forgot where F sharp is".
  if (!curtained) {
    const weight = repeat ? REPEAT_WEIGHT : 1;
    for (const [id, tally] of Object.entries(summary.skills)) {
      if (!next.skills[id]) next.skills[id] = { rating: 0.5, attempts: 0 };
      const prev = next.skills[id];
      const observed = tally.total ? tally.correct / tally.total : 0;
      // Weight the update by how much evidence this take gave us.
      const alpha = Math.min(ALPHA_MAX, ALPHA_MIN + tally.total * 0.03) * weight;
      next.skills[id] = {
        rating: prev.rating * (1 - alpha) + observed * alpha,
        attempts: prev.attempts + tally.total,
      };
    }
  } else {
    const prev = next.lookAhead[curtain] || { takes: 0, best: 0, last: 0 };
    next.lookAhead[curtain] = {
      takes: prev.takes + 1,
      best: Math.max(prev.best, summary.score),
      last: summary.score,
    };
  }

  next.history.push({
    at: Date.now(),
    level: level || null,
    seed,
    repeat,
    curtain: curtained ? curtain : null,
    score: summary.score,
    pitchAccuracy: summary.pitchAccuracy,
    rhythmAccuracy: summary.rhythmAccuracy,
    continuity: summary.continuity,
    notes: summary.total,
    meta: meta || null,
  });
  if (next.history.length > 400) next.history = next.history.slice(-400);

  next.totals.takes += 1;
  next.totals.notes += summary.total;
  next.totals.minutes += (elapsedSec || 0) / 60;

  const today = new Date().toDateString();
  if (next.streak.lastDay !== today) {
    const yesterday = new Date(Date.now() - 864e5).toDateString();
    next.streak = { count: next.streak.lastDay === yesterday ? next.streak.count + 1 : 1, lastDay: today };
  }

  // Only a first read of a level's own material can move you along the path.
  // A custom exercise is whatever difficulty you chose, a replay is not a sight
  // read, and a curtain take is measuring a different skill entirely.
  if (!level || repeat || curtained) {
    return { profile: next, promoted: false, demoted: false, repeat };
  }

  const { promoted, demoted } = evaluateLevel(next, level);
  if (promoted) next.level = Math.min(LEVELS.length, level + 1);
  if (demoted) next.level = Math.max(1, level - 1);

  return { profile: next, promoted, demoted, repeat };
}

/**
 * Promotion needs two strong first reads in a row *and* no weak focus skill.
 * Replays and curtain takes are excluded: neither is evidence that you can read
 * this level's material at sight.
 */
function evaluateLevel(profile, level) {
  const recent = profile.history
    .filter((h) => h.level === level && !h.repeat && !h.curtain)
    .slice(-3);
  const def = levelById(level);
  const focusOk = def.focus.every((id) => (profile.skills[id]?.rating ?? 0.5) >= 0.72);
  const lastTwo = recent.slice(-2);
  const promoted =
    level < LEVELS.length &&
    lastTwo.length === 2 &&
    lastTwo.every((h) => h.score >= 88) &&
    focusOk;
  const demoted =
    !promoted && level > 1 && recent.length === 3 && recent.every((h) => h.score < 55);
  return { promoted, demoted };
}

/** Skills sorted weakest first, with enough evidence to be worth trusting. */
export function weakestSkills(profile, limit = 3) {
  return Object.entries(profile.skills)
    .filter(([, v]) => v.attempts >= 8)
    .sort((a, b) => a[1].rating - b[1].rating)
    .slice(0, limit)
    .map(([id, v]) => ({ id, ...v, label: SKILLS.find((s) => s.id === id)?.label || id }));
}

const SKILL_TO_TAG = {
  'rhythm.eighth': 'eighth',
  'rhythm.sixteenth': 'sixteenth',
  'rhythm.dotted': 'dotted',
  'rhythm.syncopation': 'syncopation',
  'rhythm.triplet': 'triplet',
  'rhythm.rest': 'rest',
};

/**
 * Turn a level envelope plus a profile into concrete generator parameters.
 * `targeting` off gives a plain random draw from the level; on, the draw is
 * skewed toward the skills that are actually failing.
 */
export function paramsForLevel(level, profile, { seed = randomSeed(), targeting = true, overrides = {} } = {}) {
  const def = levelById(level);
  const rng = makeRng(seed);
  const p = { ...def.params };
  const weak = targeting && profile ? weakestSkills(profile, 4) : [];
  const weakIds = new Set(weak.filter((w) => w.rating < 0.78).map((w) => w.id));

  // Meter and key are drawn from the level's allowed sets.
  p.timeSignature = rng.pick(p.meters);
  p.keyMode = rng.pick(p.modes);
  let fifthsPool = p.fifths;
  if (weakIds.has('notes.accidental') && fifthsPool.length > 2) {
    // Bias toward keys with more accidentals when accidentals are the problem.
    const sorted = [...fifthsPool].sort((a, b) => Math.abs(b) - Math.abs(a));
    fifthsPool = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));
  }
  p.keyFifths = rng.pick(fifthsPool);

  // Rhythm: guarantee the weak rhythm tag shows up.
  const tags = new Set(p.rhythmTags);
  for (const id of weakIds) {
    const tag = SKILL_TO_TAG[id];
    if (tag && p.rhythmTags.includes(tag)) tags.add(tag);
  }
  p.rhythmTags = [...tags];

  if (weakIds.has('notes.ledger')) {
    // Push the tessitura outward so ledger lines are unavoidable.
    p.rhHigh = Math.min(p.rhHigh + 4, 44);
    p.lhLow = Math.max(p.lhLow - 4, 12);
  }
  if (weakIds.has('intervals.leap')) {
    p.maxLeap = Math.min(7, p.maxLeap + 2);
    p.stepwiseBias = Math.max(0.45, p.stepwiseBias - 0.15);
  }
  if (weakIds.has('intervals.step')) {
    p.stepwiseBias = Math.min(0.92, p.stepwiseBias + 0.1);
  }
  if (weakIds.has('coordination.together') && p.hands === 'both' && p.lhStyle === 'roots') {
    p.lhStyle = 'blocked';
  }

  p.seed = seed;
  return { ...p, ...overrides, seed: overrides.seed ?? seed, level, targeted: [...weakIds] };
}

/** Rolling score over the last `n` takes, for the dashboard. */
export function recentAverage(profile, n = 10) {
  const recent = profile.history.slice(-n);
  if (!recent.length) return null;
  return Math.round(recent.reduce((a, h) => a + h.score, 0) / recent.length);
}
