import assert from 'node:assert/strict';
import test from 'node:test';

import { applyResult, emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { analyseEvents, createGrader } from '../src/core/grader.js';
import { codeToSeed, randomSeed, seedToCode } from '../src/core/rng.js';
import { fromDia } from '../src/core/theory.js';
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

test('adaptive practice isolates one measured weakness at a time', () => {
  const profile = emptyProfile();
  profile.skills['rhythm.dotted'] = { rating: 0.1, attempts: 60 };
  profile.skills['notes.ledger'] = { rating: 0.15, attempts: 60 };
  profile.skills['intervals.skip'] = { rating: 0.2, attempts: 60 };
  const params = paramsForLevel(12, profile, { seed: 112233 });

  assert.equal(params.targeted.length, 1);
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

test('exercise identity changes with notes, not metadata or practice tempo', () => {
  const base = paramsForLevel(4, emptyProfile(), { seed: 456789 });
  const id = exerciseFingerprint(base, base.seed);
  assert.equal(exerciseFingerprint({ ...base, level: 17, targeted: ['notes.bass'] }, base.seed), id);
  assert.equal(exerciseFingerprint({ ...base, tempo: base.tempo + 2 }, base.seed), id);
  assert.notEqual(exerciseFingerprint({ ...base, maxLeap: base.maxLeap + 1 }, base.seed), id);
});

test('blocked chords do not masquerade as hand coordination or melodic intervals', () => {
  const chord = (onset, dias) => ({
    onset, duration: 48, rest: false, tags: ['quarter'], pitches: dias.map((dia) => fromDia(dia)),
  });
  const score = {
    staves: { rh: [chord(0, [28, 30, 32]), chord(48, [29, 31, 33])], lh: [] },
  };
  const events = analyseEvents(score);

  assert.equal(events.filter((event) => event.skills.includes('coordination.together')).length, 0);
  assert.equal(events.filter((event) => event.skills.some((skill) => skill.startsWith('intervals.'))).length, 1);
});

test('continuity measures attacks kept moving and extra notes reduce pitch accuracy', () => {
  const note = (onset, dia) => ({
    onset, duration: 48, rest: false, tags: ['quarter'], pitches: [fromDia(dia)],
  });
  const score = {
    tempo: 60,
    ts: { beat: 48 },
    staves: { rh: [note(0, 28), note(48, 29)], lh: [] },
  };
  const grader = createGrader(score, { startTime: 0 });
  grader.noteOn(fromDia(30).midi, 0); // wrong note, but the first attack kept moving
  grader.noteOn(fromDia(29).midi, 1);
  grader.noteOn(96, 4); // unrelated extra
  const result = grader.finish();

  assert.equal(result.continuity, 1);
  assert.equal(result.attackCount, 2);
  assert.equal(result.attacksKept, 2);
  assert.ok(result.pitchAccuracy < result.correct / result.total);
});

test('audio is unlocked before notes are scheduled', async () => {
  const starts = [];
  class Param {
    constructor(value = 0) { this.value = value; }
    setValueAtTime(value) { this.value = value; }
    exponentialRampToValueAtTime(value) { this.value = value; }
    cancelScheduledValues() {}
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    constructor(context) {
      this.context = context;
      this.gain = new Param(1);
      this.frequency = new Param(440);
    }
    connect() { return this; }
    start(at) { starts.push(at); }
    stop() {}
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 1;
      this.sampleRate = 48000;
      this.destination = {};
    }
    createBuffer() { return {}; }
    createBufferSource() { return new Node(this); }
    createGain() { return new Node(this); }
    createOscillator() { return new Node(this); }
    createDynamicsCompressor() {
      const node = new Node(this);
      node.threshold = new Param();
      node.knee = new Param();
      node.ratio = new Param();
      node.attack = new Param();
      node.release = new Param();
      return node;
    }
    async resume() {
      this.currentTime = 2;
      this.state = 'running';
      this.onstatechange?.();
    }
  }

  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const audio = await import('../src/core/audio.js?test=unlock');
    assert.equal(await audio.unlockAudio(), true);
    audio.playPianoNote(audio.now(), 60, 0.5);
    assert.ok(starts.slice(1).every((at) => at >= 2.008));
  } finally {
    delete globalThis.window;
  }
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

test('assisted practice contributes half-strength diagnostic evidence', () => {
  const profile = emptyProfile();
  const summary = {
    score: 90,
    pitchAccuracy: 1,
    rhythmAccuracy: 1,
    continuity: 1,
    total: 10,
    skills: { 'notes.treble': { correct: 10, total: 10 } },
  };
  const next = applyResult(profile, {
    level: 1, summary, seed: 1, exerciseId: 'assisted', elapsedSec: 10, assisted: true,
  }).profile;

  assert.equal(next.skills['notes.treble'].attempts, 5);
});
