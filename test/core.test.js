import assert from 'node:assert/strict';
import test from 'node:test';

import { applyResult, emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { codeToSeed, randomSeed, seedToCode } from '../src/core/rng.js';
import {
  decodeExerciseParams, encodeExerciseParams, exerciseFingerprint, exactExerciseUrl,
} from '../src/core/share.js';

test('new variation seeds are six characters and validation is strict', () => {
  for (let i = 0; i < 100; i++) {
    const seed = randomSeed();
    const code = seedToCode(seed);
    assert.match(code, /^[0-9A-Z]{6}$/);
    assert.equal(codeToSeed(code), seed);
  }
  assert.equal(codeToSeed('ABC123!'), null);
  assert.equal(codeToSeed(''), null);
});

test('the same seed and parameters generate identical music', () => {
  const params = paramsForLevel(8, emptyProfile(), { seed: 741852 });
  const first = generateExercise(params);
  const second = generateExercise({ ...params });
  assert.deepEqual(first.staves, second.staves);
  assert.deepEqual(first.chords, second.chords);
});

test('adaptive rhythm focus is actually present in the exercise', () => {
  const profile = emptyProfile();
  profile.skills['rhythm.dotted'] = { rating: 0.12, attempts: 60 };
  const params = paramsForLevel(10, profile, { seed: 123456 });
  const score = generateExercise(params);

  assert.deepEqual(params.targeted, ['rhythm.dotted']);
  assert.deepEqual(params.focusRhythmTags, ['dotted']);
  assert.ok(score.staves.rh.some((note) => note.tags?.includes('dotted')));
});

test('an interval drill guarantees the requested interval family', () => {
  const params = paramsForLevel(4, emptyProfile(), { seed: 246810, targetSkill: 'intervals.skip' });
  const score = generateExercise(params);
  const pitches = score.staves.rh.filter((note) => !note.rest).map((note) => note.pitches[0].dia);
  const intervals = pitches.slice(1).map((pitch, i) => Math.abs(pitch - pitches[i]));

  assert.ok(params.focusIntervals.includes('skip'));
  assert.ok(intervals.includes(2));
});

test('an exact share link round-trips the full musical recipe', () => {
  const profile = emptyProfile();
  profile.skills['notes.ledger'] = { rating: 0.2, attempts: 50 };
  const original = generateExercise(paramsForLevel(12, profile, { seed: 987654 }));
  const payload = encodeExerciseParams(original.params);
  const params = decodeExerciseParams(payload);
  const reopened = generateExercise({ ...params, seed: original.seed });
  const url = exactExerciseUrl(original, 'https://example.com/practice?old=1');

  assert.deepEqual(reopened.staves, original.staves);
  assert.deepEqual(reopened.chords, original.chords);
  assert.equal(url.searchParams.get('x'), seedToCode(original.seed));
  assert.equal(url.searchParams.get('p'), payload);
});

test('exercise identity changes with music, not explanatory metadata', () => {
  const base = paramsForLevel(4, emptyProfile(), { seed: 456789 });
  const id = exerciseFingerprint(base, base.seed);
  assert.equal(exerciseFingerprint({ ...base, level: 17, targeted: ['notes.bass'] }, base.seed), id);
  assert.notEqual(exerciseFingerprint({ ...base, tempo: base.tempo + 2 }, base.seed), id);
});

test('assisted work cannot satisfy the two-first-read promotion rule', () => {
  let profile = emptyProfile();
  for (const id of ['notes.treble', 'intervals.step', 'rhythm.quarter']) {
    profile.skills[id] = { rating: 0.95, attempts: 100 };
  }
  const summary = {
    score: 96,
    pitchAccuracy: 0.98,
    rhythmAccuracy: 0.94,
    continuity: 1,
    total: 20,
    skills: {},
  };

  profile = applyResult(profile, {
    level: 1, summary, seed: 1, exerciseId: 'a', elapsedSec: 20, assisted: true,
  }).profile;
  profile = applyResult(profile, {
    level: 1, summary, seed: 2, exerciseId: 'b', elapsedSec: 20,
  }).profile;
  assert.equal(profile.level, 1);

  profile = applyResult(profile, {
    level: 1, summary, seed: 3, exerciseId: 'c', elapsedSec: 20,
  }).profile;
  assert.equal(profile.level, 2);
});
