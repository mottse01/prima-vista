import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyProfile } from '../src/core/adaptive.js';
import { LEVELS } from '../src/core/levels.js';
import { MISSIONS, STRONG_READ, missionProgress, missionState, nextObjective } from '../src/core/missions.js';
import { SCORING_VERSION } from '../src/core/grader.js';

/** A clean first read, shaped the way applyResult records one. */
const read = (level, overrides = {}) => ({
  scoringVersion: SCORING_VERSION,
  at: Date.now(),
  level,
  seed: Math.random(),
  repeat: false,
  assisted: false,
  curtain: null,
  score: STRONG_READ + 2,
  continuity: 0.9,
  timing: 0.2,
  hands: null,
  notes: 40,
  meta: { recipe: { params: { keyFifths: 0, timeSignature: '4/4', lhStyle: 'block_chord' } } },
  ...overrides,
});

const withHistory = (level, takes, extra = {}) => ({
  ...emptyProfile(), level, history: takes, ...extra,
});

test('every level has objectives, and they are all checkable', () => {
  for (const level of LEVELS) {
    const mission = missionState(emptyProfile(), level.id);
    assert.ok(MISSIONS[level.id]?.length >= 3, `level ${level.id} has too few objectives`);
    assert.equal(mission.total, MISSIONS[level.id].length);
    for (const objective of mission.objectives) {
      assert.ok(objective.id && objective.title, 'an objective needs an id and a title');
      assert.equal(typeof objective.done, 'boolean');
      assert.ok(objective.need >= 1 && objective.have >= 0 && objective.have <= objective.need);
    }
  }
});

test('a new reader has cleared nothing and is told what to do first', () => {
  const fresh = emptyProfile();
  for (const level of LEVELS) {
    const mission = missionState(fresh, level.id);
    assert.equal(mission.done, 0, `level ${level.id} starts partly done`);
    assert.equal(mission.cleared, false);
  }
  assert.equal(nextObjective(fresh, 1).id, 'first-reads');
  assert.equal(missionProgress(fresh).length, LEVELS.length);
});

test('clean first reads count, and repeats and assisted takes do not', () => {
  const strong = [read(1), read(1), read(1)];
  assert.equal(missionState(withHistory(1, strong), 1).objectives[0].done, true);

  const weak = [read(1, { score: STRONG_READ - 1 }), read(1), read(1)];
  const partial = missionState(withHistory(1, weak), 1).objectives[0];
  assert.equal(partial.done, false);
  assert.equal(partial.have, 2);

  const contaminated = [read(1, { repeat: true }), read(1, { assisted: true }), read(1, { curtain: 'beat' })];
  assert.equal(missionState(withHistory(1, contaminated), 1).objectives[0].have, 0);
});

test('Luna asks for a steady pulse and one unbroken read', () => {
  const rushed = missionState(withHistory(1, [read(1, { timing: 0.2, continuity: 0.8 })]), 1);
  assert.equal(rushed.objectives[1].done, false, 'a 200 ms drift is not steady');
  assert.equal(rushed.objectives[2].done, false);

  const steady = missionState(withHistory(1, [read(1, { timing: -0.03, continuity: 1 })]), 1);
  assert.equal(steady.objectives[1].done, true, 'a 30 ms drift either way is steady');
  assert.equal(steady.objectives[2].done, true);
});

test('a strand objective needs both a good rating and enough evidence', () => {
  const level = 2;
  const lucky = withHistory(level, [], {
    skills: { ...emptyProfile().skills, 'notes.bass': { rating: 1, attempts: 3 } },
  });
  assert.equal(missionState(lucky, level).objectives[1].done, false);

  const proven = withHistory(level, [], {
    skills: { ...emptyProfile().skills, 'notes.bass': { rating: 0.8, attempts: 30 } },
  });
  assert.equal(missionState(proven, level).objectives[1].done, true);
});

test('objectives about the music read what was actually on the page', () => {
  const plain = missionState(withHistory(7, [read(7)]), 7);
  assert.equal(plain.objectives[2].done, false);

  const tied = missionState(withHistory(7, [read(7, { meta: { tiedOverBarline: true, recipe: { params: {} } } })]), 7);
  assert.equal(tied.objectives[2].done, true, 'a tie across the barline clears Neptune');

  const chords = missionState(withHistory(8, [read(8)]), 8);
  assert.equal(chords.objectives[2].done, false);
  const walking = missionState(
    withHistory(8, [read(8, { meta: { recipe: { params: { lhStyle: 'walking' } } } })]),
    8,
  );
  assert.equal(walking.objectives[2].done, true, 'a walking bass clears Pluto');
});

test('Jupiter wants the same skills in more than one key', () => {
  const oneKey = withHistory(4, [read(4), read(4)]);
  assert.equal(missionState(oneKey, 4).objectives[2].have, 1);

  const twoKeys = withHistory(4, [
    read(4),
    read(4, { meta: { recipe: { params: { keyFifths: -2, timeSignature: '4/4' } } } }),
  ]);
  assert.equal(missionState(twoKeys, 4).objectives[2].done, true);
});

test('an Eclipse objective is cleared by any look-ahead take', () => {
  const none = missionState(emptyProfile(), 3);
  assert.equal(none.objectives[2].done, false);

  const drilled = { ...emptyProfile(), lookAhead: { adaptive: { takes: 2, best: 88, last: 80 } } };
  assert.equal(missionState(drilled, 3).objectives[2].done, true);
});

test('clearing every objective clears the destination', () => {
  const profile = withHistory(1, [
    read(1, { timing: 0.01, continuity: 1 }),
    read(1),
    read(1),
  ]);
  const mission = missionState(profile, 1);
  assert.equal(mission.done, mission.total);
  assert.equal(mission.cleared, true);
  assert.equal(nextObjective(profile, 1), null);
});
