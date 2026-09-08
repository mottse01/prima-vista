// Adaptive engine.
//
// Two things happen after every take: skill ratings move, and the *next*
// exercise emphasizes an observed need within the chosen level's envelope.

import { SKILLS, SCORING_VERSION } from './grader.js';
import { levelById, LEVELS } from './levels.js';
import { makeRng, randomSeed } from './rng.js';
import { comparableReads, eligibleFirstRead } from './reads.js';
import { missionState, openThrough, raiseFrontier } from './missions.js';
import { calibrate, readingTempo } from './pacing.js';
import { ledgerHeadroom, presents } from './syllabus.js';

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

// After this many readings without meeting a strand again, it is treated as
// fully due for revisiting. Spacing the return of something already learned is
// what keeps it learned; a rating that was measured forty readings ago is a
// record of what was true then, not a claim about now. Counted in readings
// rather than days so that the same profile always produces the same study.
const STALE_AFTER_READS = 40;

/** A short placement check moves at most one rung from the conservative start. */
export function placementRecommendation(startLevel, scores) {
  if (!scores?.length) return Math.max(1, Math.min(LEVELS.length, Number(startLevel) || 1));
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const adjustment = mean >= 90 ? 1 : mean < 60 ? -1 : 0;
  return Math.max(1, Math.min(LEVELS.length, Number(startLevel) + adjustment));
}


export { comparableReads, eligibleFirstRead };

/**
 * Fold a measured practice observation into the profile.
 *
 * Practice evidence lives in its own bank: it informs what to work on next and
 * lights the skill map, but it never counts toward a level, because a drill is
 * not a reading at sight.
 */
export function applyPracticeEvidence(profile, tallies) {
  if (!tallies || !Object.keys(tallies).length) return profile;
  const practiceSkills = { ...(profile.practiceSkills || {}) };
  for (const [id, tally] of Object.entries(tallies)) {
    if (!tally?.total) continue;
    const previous = practiceSkills[id] || { rating: 0.5, attempts: 0 };
    const observed = tally.correct / tally.total;
    const alpha = Math.min(ALPHA_MAX, ALPHA_MIN + tally.total * 0.03);
    practiceSkills[id] = {
      rating: previous.rating * (1 - alpha) + observed * alpha,
      attempts: previous.attempts + tally.total,
      seenAtTake: (profile.totals?.takes || 0) + 1,
    };
  }
  return { ...profile, practiceSkills };
}

export function emptyProfile() {
  const skills = {};
  for (const s of SKILLS) skills[s.id] = { rating: 0.5, attempts: 0 };
  return {
    version: 5,
    scoringVersion: SCORING_VERSION,
    demonstratedLevels: [],
    level: 1,
    // How far along the course is open. Only placement, or clearing the
    // destination you are standing on, moves it — and it never moves back.
    unlockedLevel: 1,
    skills,
    practiceSkills: {},
    history: [],       // { at, level, score, seed, repeat, curtain, ... }
    streak: { count: 0, lastDay: null },
    totals: { takes: 0, notes: 0, minutes: 0 },
    // Look-ahead curtain progress, keyed by curtain mode.
    lookAhead: {},     // { [mode]: { takes, best, last } }
    // The tempo this reader currently reads at, per level, inside that
    // level's own band. Empty means everybody starts at the published default.
    pacing: {},        // { [level]: bpm }
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
  const takeNumber = (profile.totals?.takes || 0) + 1;
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
        // When this strand was last actually met, so that a skill nothing has
        // asked about in a long time can be brought back around.
        seenAtTake: takeNumber,
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
    // Steadiness and hesitation, both as fractions of a beat, so a mission can
    // ask whether one reading held its pulse without knowing its tempo.
    spread: summary.fluency?.spread ?? null,
    hesitation: summary.fluency?.hesitation ?? null,
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

  // Only a clean first read says anything about the tempo this reader can hold
  // at this level. A replay knows the music and an assisted take had help, so
  // neither is allowed to talk the tempo up.
  if (level && !repeat && !assisted && !curtained) next.pacing = calibrate(next, level);

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

  // Two different things, deliberately separated. "Demonstrated" is the old
  // reading evidence: three strong first reads in a row with the level's focus
  // skills behind them. Moving on additionally needs the first-read flight goal complete,
  // because that is what opens the next one.
  const { promoted: demonstrated, demoted } = evaluateLevel(next, level);
  if (demonstrated) {
    next.demonstratedLevels = [...new Set([...(next.demonstratedLevels || []), level])];
  }
  Object.assign(next, raiseFrontier(next, level));
  const promoted = demonstrated && missionState(next, level).routeReady;
  if (promoted) {
    next.level = Math.min(LEVELS.length, openThrough(next), level + 1);
  }
  if (demoted) next.level = Math.max(1, level - 1);

  return { profile: next, promoted, demonstrated, demoted, repeat };
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

/**
 * Skills sorted weakest first, with enough evidence to be worth trusting.
 *
 * Pass a level to get only the strands that level can actually put on the
 * page. Without one this is the whole reading picture, which is what a
 * progress panel wants to show.
 */
export function weakestSkills(profile, limit = 3, { level = null } = {}) {
  return Object.entries(profile.skills)
    .filter(([id, v]) => v.attempts >= 8 && v.rating < 0.78
      && (level == null || presents(level, id)))
    .sort((a, b) => a[1].rating - b[1].rating)
    .slice(0, limit)
    .map(([id, v]) => ({ id, ...v, label: SKILLS.find((s) => s.id === id)?.label || id }));
}

/**
 * How overdue a strand is, as a multiplier on how much it wants practising.
 *
 * A rating is a record of a moment. Something read well forty readings ago and
 * never met since is not evidence that it is still read well, and the only way
 * to find out is to put it in front of the reader again. This doubles the
 * weight of the most neglected strand without ever overriding weakness, so the
 * thing that is failing now still comes first.
 */
export function staleness(skill, takes) {
  const since = takes - (skill?.seenAtTake ?? 0);
  return 1 + Math.min(1, Math.max(0, since) / STALE_AFTER_READS);
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
  // Only strands this level can actually write. Asking a five-finger study in
  // C for a leap or a sharp used to produce a study that ignored the request
  // and dropped the level's own focus to make room for it; asking level three
  // for triplets produced no study at all.
  const weakPool = targeting && profile ? weakestSkills(profile, 4, { level }) : [];
  const takes = profile?.totals?.takes || 0;
  // Isolate one diagnostic variable per generated study. Mixing every weak
  // skill into one excerpt makes the music harder, but makes the practice less
  // specific. Weighted selection keeps the weakest item most likely while
  // still interleaving other needs across a session, and a strand nothing has
  // asked about in a long time is weighted back up so that it comes round
  // again rather than being quietly assumed.
  const requested = targetSkill && presents(level, targetSkill) ? targetSkill : null;
  const selectedWeakness = requested || (weakPool.length
    ? rng.weighted(
      weakPool,
      weakPool.map((w) => Math.pow(1 - w.rating, 2) * staleness(w, takes)),
    ).id
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

  // Tempo is the difficulty dial this app already owned and never turned. The
  // level's published number is where everybody starts; from there it walks
  // inside the level's own band according to how the reading is going.
  p.tempo = readingTempo(profile, level);

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

  const ledgerRoom = ledgerHeadroom(level);
  if (weakIds.has('notes.ledger') && ledgerRoom > 0) {
    // Push the tessitura outward so ledger lines are unavoidable — but only as
    // far as this level's ledger budget allows. A fixed four-step push asked
    // the early levels for music that then failed their own validation every
    // single time, so the drill returned nothing at all.
    p.rhHigh = Math.min(p.rhHigh + ledgerRoom, 44);
    p.lhLow = Math.max(p.lhLow - ledgerRoom, 12);
    targeted.add('notes.ledger');
  }
  if (weakIds.has('intervals.leap')) {
    // How wide a leap may be belongs to the level; how often one turns up is
    // ours to change, and lowering the stepwise bias is the lever for it.
    // This used to widen the reach to a flat seven as well, which did nothing
    // at the levels already narrower than that and, at the top of the ladder,
    // pulled the reach *down* from nine or eleven — the drill for leaps made
    // the music easier than the level's ordinary fare.
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
  if (weakIds.has('rhythm.silence')) {
    // Reading a silence means both hands stopping. The rest tag alone only
    // guarantees the melody rests, which is a different and easier thing.
    p.generalRest = true;
    // A second independent line has its own reasons to keep playing, so the
    // levels written contrapuntally take an accompaniment figure for this one
    // study — the figure is what can be asked to stop with the melody.
    if (p.lhStyle === 'contrapuntal') p.lhStyle = 'block_chord';
    targeted.add('rhythm.silence');
  }
  if (weakIds.has('coordination.together') && p.hands === 'both') {
    if (p.lhStyle === 'root_fifth') p.lhStyle = 'block_chord';
    targeted.add('coordination.together');
  }

  // An explicit drill can isolate a staff. Routine adaptive practice keeps the
  // level's intended hand texture intact, and a level written for one hand is
  // not made to grow another — a reader who wants the bass staff is sent to
  // the destination where it appears.
  if (requested === 'notes.treble') {
    p.hands = 'rh';
    targeted.add('notes.treble');
  }
  if (requested === 'notes.bass') {
    p.hands = 'lh';
    targeted.add('notes.bass');
  }

  p.seed = seed;
  if (!p.compositionStyle) p.compositionStyle = 'auto';
  p.focusIntervals = focusIntervals;
  return { ...p, ...overrides, seed: overrides.seed ?? seed, level, targeted: [...targeted] };
}

/**
 * Rolling score over clean first reads, so rehearsal does not inflate it.
 *
 * Tempo is deliberately not part of what makes two reads comparable. It used
 * to be, back when a level had one tempo and a different one meant a different
 * kind of study; now the tempo moves with the reader precisely to hold the
 * difficulty steady, so excluding readings at a neighbouring tempo would throw
 * away most of the evidence and reset this number every time it moved.
 */
export function recentAverage(profile, n = 10) {
  const reads = comparableReads(profile);
  const latest = reads.at(-1);
  const recent = reads.filter((take) => {
    const recipe = take.meta?.recipe?.params;
    const anchor = latest?.meta?.recipe?.params;
    return recipe?.timeSignature === anchor?.timeSignature
      && recipe?.hands === anchor?.hands && recipe?.measures === anchor?.measures;
  }).slice(-n);
  if (!recent.length) return null;
  return Math.round(recent.reduce((a, h) => a + h.score, 0) / recent.length);
}
