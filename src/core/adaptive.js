// Adaptive engine.
//
// Two things happen after every take: skill ratings move, and the *next*
// exercise emphasizes an observed need within the chosen level's envelope.

import { SKILLS, SCORING_VERSION } from './grader.js';
import { levelById, LEVELS } from './levels.js';
import { makeRng, randomSeed } from './rng.js';

const ALPHA_MIN = 0.18;
const ALPHA_MAX = 0.45;

// A second reading of music you have already seen is practice, not
// sight-reading: it still says something about your notes and rhythm, but
// familiarity inflates it, so its evidence is kept in a separate practice map
// and can never advance your level.
const MIN_FOCUS_OBSERVATIONS = 3;

// How many recently-seen exercise fingerprints to remember, so a reload or a
// shared link cannot launder a repeat into a fresh first read.
const SEEN_SEEDS_KEPT = 300;

/** A short placement check moves at most one rung from the conservative start. */
export function placementRecommendation(startLevel, scores) {
  if (!scores?.length) return Math.max(1, Math.min(LEVELS.length, Number(startLevel) || 1));
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const adjustment = mean >= 90 ? 1 : mean < 60 ? -1 : 0;
  return Math.max(1, Math.min(LEVELS.length, Number(startLevel) + adjustment));
}

/** Shared first-read rule for placement, promotion and comparable evidence. */
export function eligibleFirstRead({ summary, fresh = true, takeIndex = 1, assisted = false, curtain = 'off' }) {
  return summary?.valid !== false && summary?.assessmentEligible !== false
    && fresh && takeIndex === 1 && !assisted && (!curtain || curtain === 'off');
}

export function comparableReads(profile, level = profile.level) {
  return profile.history.filter((take) => take.level === level
    && take.scoringVersion === SCORING_VERSION && !take.repeat && !take.assisted && !take.curtain);
}

export function emptyProfile() {
  const skills = {};
  for (const s of SKILLS) skills[s.id] = { rating: 0.5, attempts: 0 };
  return {
    version: 5,
    scoringVersion: SCORING_VERSION,
    demonstratedLevels: [],
    level: 1,
    skills,
    practiceSkills: {},
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
  // A disconnected keyboard, blocked on-screen input, or abandoned take is a
  // device event rather than evidence about the learner. Keep it out of every
  // progress measure.
  if (summary?.valid === false || summary?.assessmentEligible === false) {
    return { profile, promoted: false, demoted: false, repeat: false, invalid: true };
  }
  const next = {
    ...profile,
    skills: { ...profile.skills },
    practiceSkills: { ...(profile.practiceSkills || {}) },
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
    const bank = repeat || assisted ? next.practiceSkills : next.skills;
    for (const [id, tally] of Object.entries(summary.skills)) {
      if (!tally.total) continue;
      if (!bank[id]) bank[id] = { rating: 0.5, attempts: 0 };
      const prev = bank[id];
      const observed = tally.total ? tally.correct / tally.total : 0;
      // Weight the update by how much evidence this take gave us.
      const alpha = Math.min(ALPHA_MAX, ALPHA_MIN + tally.total * 0.03);
      bank[id] = {
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
    scoringVersion: summary.scoringVersion || SCORING_VERSION,
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
    // Kept per take because a mission asks about one reading, not an average:
    // "hold the beat within 45 ms" is a thing you did once, not a trend.
    timing: summary.meanSignedTiming ?? null,
    hands: summary.hands
      ? {
        rh: { pitchAccuracy: summary.hands.rh?.pitchAccuracy ?? null },
        lh: { pitchAccuracy: summary.hands.lh?.pitchAccuracy ?? null },
      }
      : null,
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
  if (promoted) {
    next.level = Math.min(LEVELS.length, level + 1);
    next.demonstratedLevels = [...new Set([...(next.demonstratedLevels || []), level])];
  }
  if (demoted) next.level = Math.max(1, level - 1);

  return { profile: next, promoted, demoted, repeat };
}

/**
 * Promotion needs three strong first reads in a row *and* no weak focus skill.
 * Replays, assisted takes, and curtain takes are excluded: none is clean
 * evidence that you can read this level's material at sight.
 */
function evaluateLevel(profile, level) {
  const recent = comparableReads(profile, level).slice(-3);
  const def = levelById(level);
  const focusOk = def.focus.every((id) => {
    const skill = profile.skills[id] || { rating: 0.5, attempts: 0 };
    return skill.rating >= 0.72 && skill.attempts >= MIN_FOCUS_OBSERVATIONS;
  });
  const lastThree = recent.slice(-3);
  const promoted =
    level < LEVELS.length &&
    lastThree.length === 3 &&
    lastThree.every((h) => h.score >= 88) &&
    focusOk;
  const demoted =
    !promoted && level > 1 && recent.length === 3 && recent.every((h) => h.score < 55);
  return { promoted, demoted };
}

/** Skills sorted weakest first, with enough evidence to be worth trusting. */
export function weakestSkills(profile, limit = 3) {
  return Object.entries(profile.skills)
    .filter(([, v]) => v.attempts >= 8 && v.rating < 0.78)
    .sort((a, b) => a[1].rating - b[1].rating)
    .slice(0, limit)
    .map(([id, v]) => ({ id, ...v, label: SKILLS.find((s) => s.id === id)?.label || id }));
}

const SKILL_TO_TAG = {
  'rhythm.silence': 'rest',
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
  const weakPool = weak.filter((w) => w.rating < 0.78);
  // Isolate one diagnostic variable per generated study. Mixing every weak
  // skill into one excerpt makes the music harder, but makes the practice less
  // specific. Weighted selection keeps the weakest item most likely while
  // still interleaving other needs across a session.
  const selectedWeakness = targetSkill || (weakPool.length
    ? rng.weighted(weakPool, weakPool.map((w) => Math.pow(1 - w.rating, 2))).id
    : null);
  const weakIds = new Set(selectedWeakness ? [selectedWeakness] : []);
  const targeted = new Set();
  // Every level must actually present its named rhythm and interval goals.
  // This makes the public path auditable and prevents promotion gates from
  // waiting for evidence that random generation happened not to include.
  const levelRhythmTags = def.focus
    .map((id) => SKILL_TO_TAG[id])
    .filter((tag) => tag && (tag === 'quarter' || p.rhythmTags.includes(tag)));
  const levelIntervals = def.focus
    .filter((id) => id.startsWith('intervals.'))
    .map((id) => id.split('.')[1]);
  const focusRhythmTags = selectedWeakness || !levelRhythmTags.length
    ? []
    : [levelRhythmTags[Math.abs(seed) % levelRhythmTags.length]];
  const focusIntervals = selectedWeakness || !levelIntervals.length
    ? []
    : [levelIntervals[Math.abs(seed) % levelIntervals.length]];

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
      if (!focusRhythmTags.includes(tag)) focusRhythmTags.push(tag);
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
    if (!focusIntervals.includes('leap')) focusIntervals.push('leap');
  }
  if (weakIds.has('intervals.step')) {
    p.stepwiseBias = Math.min(0.92, p.stepwiseBias + 0.1);
    targeted.add('intervals.step');
    if (!focusIntervals.includes('step')) focusIntervals.push('step');
  }
  if (weakIds.has('intervals.skip')) {
    p.maxLeap = Math.max(2, p.maxLeap);
    p.stepwiseBias = Math.min(0.68, p.stepwiseBias);
    targeted.add('intervals.skip');
    if (!focusIntervals.includes('skip')) focusIntervals.push('skip');
  }
  if (weakIds.has('coordination.together') && p.hands === 'both') {
    if (p.lhStyle === 'root_fifth') p.lhStyle = 'block_chord';
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
  if (!p.compositionStyle) p.compositionStyle = 'auto';
  p.focusIntervals = focusIntervals;
  return { ...p, ...overrides, seed: overrides.seed ?? seed, level, targeted: [...targeted] };
}

/** Rolling score over clean first reads, so rehearsal does not inflate it. */
export function recentAverage(profile, n = 10) {
  const reads = comparableReads(profile);
  const latest = reads.at(-1);
  const recent = reads.filter((take) => {
    const recipe = take.meta?.recipe?.params;
    const anchor = latest?.meta?.recipe?.params;
    return recipe?.tempo === anchor?.tempo && recipe?.timeSignature === anchor?.timeSignature
      && recipe?.hands === anchor?.hands && recipe?.measures === anchor?.measures;
  }).slice(-n);
  if (!recent.length) return null;
  return Math.round(recent.reduce((a, h) => a + h.score, 0) / recent.length);
}
