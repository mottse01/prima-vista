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

// How many recently-seen exercise fingerprints to remember, so a reload or a
// shared link cannot launder a repeat into a fresh first read.
const SEEN_SEEDS_KEPT = 300;

export function emptyProfile() {
  const skills = {};
  for (const s of SKILLS) skills[s.id] = { rating: 0.5, attempts: 0 };
  return {
    version: 2,
    level: 1,
    skills,
    history: [],       // { at, level, score, seed, repeat, curtain, ... }
    streak: { count: 0, lastDay: null },
    totals: { takes: 0, notes: 0, minutes: 0 },
    // Look-ahead curtain progress, keyed by curtain mode.
    lookAhead: {},     // { [mode]: { takes, best, last } }
    seenExercises: [],
  };
}

/** Mark reference playback as familiarity without inventing a scored take. */
export function markExerciseSeen(profile, exerciseId) {
  if (!exerciseId || (profile.seenExercises || []).includes(exerciseId)) return profile;
  const seenExercises = [...(profile.seenExercises || []), exerciseId].slice(-SEEN_SEEDS_KEPT);
  return { ...profile, seenExercises };
}

/**
 * Fold one take's results into the profile.
 *
 * Four kinds of take are treated differently, because they measure different
 * things: a first read is the real sight-reading measurement; a replay or an
 * assisted take is useful but contaminated by familiarity/help; and a curtain
 * take measures look-ahead rather than note knowledge.
 *
 * Returns { profile, promoted, demoted, repeat }.
 */
export function applyResult(profile, {
  level, summary, seed, exerciseId, elapsedSec, meta, takeIndex = 1, curtain = 'off', assisted = false,
}) {
  const next = {
    ...profile,
    skills: { ...profile.skills },
    history: [...profile.history],
    totals: { ...profile.totals },
    streak: { ...profile.streak },
    lookAhead: { ...(profile.lookAhead || {}) },
    seenExercises: [...(profile.seenExercises || [])],
  };

  const identity = exerciseId || `seed:${seed}`;
  const seenBefore = next.seenExercises.includes(identity)
    || (profile.seenSeeds || []).includes(seed); // v1 compatibility
  const repeat = takeIndex > 1 || seenBefore;
  const curtained = Boolean(curtain) && curtain !== 'off';

  if (!seenBefore) {
    next.seenExercises.push(identity);
    if (next.seenExercises.length > SEEN_SEEDS_KEPT) {
      next.seenExercises = next.seenExercises.slice(-SEEN_SEEDS_KEPT);
    }
  }

  // A curtain take is a reading-fluency drill. Scoring it against the skill map
  // would read the curtain's difficulty as "you forgot where F sharp is".
  if (!curtained) {
    const weight = repeat || assisted ? REPEAT_WEIGHT : 1;
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
    assisted: Boolean(assisted),
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

  // Only a first read of a level's own material can move you along the path. A
  // custom exercise has user-chosen difficulty, a replay is no longer at sight,
  // an assisted take had help, and a curtain take measures a different skill.
  if (!level || repeat || assisted || curtained) {
    return { profile: next, promoted: false, demoted: false, repeat };
  }

  const { promoted, demoted } = evaluateLevel(next, level);
  if (promoted) next.level = Math.min(LEVELS.length, level + 1);
  if (demoted) next.level = Math.max(1, level - 1);

  return { profile: next, promoted, demoted, repeat };
}

/**
 * Promotion needs two strong first reads in a row *and* no weak focus skill.
 * Replays, assisted takes, and curtain takes are excluded: none is clean
 * evidence that you can read this level's material at sight.
 */
function evaluateLevel(profile, level) {
  const recent = profile.history
    .filter((h) => h.level === level && !h.repeat && !h.assisted && !h.curtain)
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
  'rhythm.quarter': 'quarter',
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
export function paramsForLevel(level, profile, {
  seed = randomSeed(), targeting = true, overrides = {}, targetSkill = null,
} = {}) {
  const def = levelById(level);
  const rng = makeRng(seed);
  const p = { ...def.params };
  const weak = targeting && profile ? weakestSkills(profile, 4) : [];
  const weakIds = new Set(weak.filter((w) => w.rating < 0.78).map((w) => w.id));
  if (targetSkill) weakIds.add(targetSkill);
  const targeted = new Set();
  const focusRhythmTags = [];
  const focusIntervals = [];

  // Meter and key are drawn from the level's allowed sets.
  p.timeSignature = rng.pick(p.meters);
  p.keyMode = rng.pick(p.modes);
  let fifthsPool = p.fifths;
  if (weakIds.has('notes.accidental') && fifthsPool.length > 2) {
    // Bias toward keys with more accidentals when accidentals are the problem.
    const sorted = [...fifthsPool].sort((a, b) => Math.abs(b) - Math.abs(a));
    fifthsPool = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));
    targeted.add('notes.accidental');
  }
  p.keyFifths = rng.pick(fifthsPool);

  // Rhythm: guarantee the weak rhythm tag shows up.
  const tags = new Set(p.rhythmTags);
  for (const id of weakIds) {
    const tag = SKILL_TO_TAG[id];
    if (tag && (tag === 'quarter' || p.rhythmTags.includes(tag) || targetSkill === id)) {
      tags.add(tag);
      focusRhythmTags.push(tag);
      targeted.add(id);
    }
  }
  p.rhythmTags = [...tags];
  p.focusRhythmTags = focusRhythmTags;

  if (weakIds.has('notes.ledger')) {
    // Push the tessitura outward so ledger lines are unavoidable.
    p.rhHigh = Math.min(p.rhHigh + 4, 44);
    p.lhLow = Math.max(p.lhLow - 4, 12);
    targeted.add('notes.ledger');
  }
  if (weakIds.has('intervals.leap')) {
    p.maxLeap = Math.min(7, p.maxLeap + 2);
    p.stepwiseBias = Math.max(0.45, p.stepwiseBias - 0.15);
    targeted.add('intervals.leap');
    focusIntervals.push('leap');
  }
  if (weakIds.has('intervals.step')) {
    p.stepwiseBias = Math.min(0.92, p.stepwiseBias + 0.1);
    targeted.add('intervals.step');
    focusIntervals.push('step');
  }
  if (weakIds.has('intervals.skip')) {
    p.maxLeap = Math.max(2, p.maxLeap);
    p.stepwiseBias = Math.min(0.68, p.stepwiseBias);
    targeted.add('intervals.skip');
    focusIntervals.push('skip');
  }
  if (weakIds.has('coordination.together') && p.hands === 'both') {
    if (p.lhStyle === 'roots') p.lhStyle = 'blocked';
    targeted.add('coordination.together');
  }

  // An explicit dashboard drill can isolate a staff. Routine adaptive practice
  // keeps the level's intended hand texture intact.
  if (targetSkill === 'notes.treble') {
    p.hands = 'rh';
    targeted.add('notes.treble');
  }
  if (targetSkill === 'notes.bass') {
    p.hands = 'lh';
    targeted.add('notes.bass');
  }

  p.seed = seed;
  p.focusIntervals = focusIntervals;
  return { ...p, ...overrides, seed: overrides.seed ?? seed, level, targeted: [...targeted] };
}

/** Rolling score over the last `n` takes, for the dashboard. */
export function recentAverage(profile, n = 10) {
  const recent = profile.history.slice(-n);
  if (!recent.length) return null;
  return Math.round(recent.reduce((a, h) => a + h.score, 0) / recent.length);
}
