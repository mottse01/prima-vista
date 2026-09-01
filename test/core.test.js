import assert from 'node:assert/strict';
import test from 'node:test';

import { applyResult, emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import {
  renderReferenceWav, startPracticePlayback, startReferencePlayback,
} from '../src/core/audio.js';
import { generateExercise, planMusicalForm } from '../src/core/generator.js';
import { analyseEvents, createGrader } from '../src/core/grader.js';
import { COMMON_CADENCES, COMMON_PROGRESSIONS } from '../src/core/harmony.js';
import { reviewMusicality } from '../src/core/musicality.js';
import { toMusicXml } from '../src/core/musicxml.js';
import { codeToSeed, randomSeed, seedToCode } from '../src/core/rng.js';
import { timeSig } from '../src/core/rhythm.js';
import { fromDia, tonicLetter } from '../src/core/theory.js';
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

test('generated studies use a clear phrase form and repeat their rhythmic idea', () => {
  const score = generateExercise(paramsForLevel(8, emptyProfile(), { seed: 314159 }));
  const signature = (measure) => score.staves.rh
    .filter((note) => Math.floor(note.onset / score.ts.ticks) === measure)
    .map((note) => [note.onset % score.ts.ticks, note.duration, note.rest, note.cellId]);

  assert.equal(score.form.label, 'A–A′');
  assert.equal(score.form.name, 'Parallel period');
  assert.deepEqual(signature(0), signature(2));
  assert.deepEqual(signature(0), signature(4));
  assert.equal(planMusicalForm(16).label, 'A–A′–B–A″');
  assert.equal(planMusicalForm(16).name, 'Rounded binary');
  assert.equal(planMusicalForm(24).name, 'Extended ternary');
});

test('every study follows a named progression with a varied common cadence plan', () => {
  const finalCadences = new Set();
  const finalPairs = new Set();
  for (const mode of ['major', 'minor']) {
    for (let seed = 1; seed <= 24; seed++) {
      const score = generateExercise({
        ...paramsForLevel(8, emptyProfile(), { seed: seed * 7919 }),
        keyMode: mode,
        measures: 8,
        chordsPerMeasure: 1,
      });
      const template = COMMON_PROGRESSIONS[mode].find((item) => item.id === score.harmony.id);

      assert.ok(template);
      assert.equal(score.harmony.name, template.name);
      assert.deepEqual(score.harmony.degrees, [...template.degrees]);
      for (const chord of score.chords.filter((item) => item.source === 'progression')) {
        assert.equal(chord.degree, template.degrees[chord.index % template.degrees.length]);
      }
      for (const cadence of score.harmony.cadences) {
        assert.equal(COMMON_CADENCES[cadence.id].name, cadence.name);
        assert.deepEqual(cadence.slots.map((slot) => score.chords[slot].degree), cadence.degrees);
        const arrival = score.staves.rh.find((note) => note.cadence === cadence.id
          && Math.floor(note.onset / score.ts.ticks) === cadence.measure);
        const degree = (((arrival.pitches[0].dia - tonicLetter(score.key)) % 7) + 7) % 7;
        assert.equal(degree, cadence.melodyDegree);
      }
      const final = score.harmony.cadences.at(-1);
      finalCadences.add(final.id);
      finalPairs.add(final.degrees.join(','));
      assert.equal(score.compositionReview.passed, true);
      assert.equal(score.compositionReview.candidates, 4);
    }
  }

  assert.ok(finalCadences.size >= 3);
  assert.ok([...finalPairs].some((pair) => pair !== '4,0'));
});

test('the composition critic rejects a broken harmonic plan', () => {
  const score = generateExercise(paramsForLevel(8, emptyProfile(), { seed: 867530 }));
  const broken = structuredClone(score);
  const bodyChord = broken.chords.find((chord) => chord.source === 'progression');
  bodyChord.degree = (bodyChord.degree + 1) % 7;
  const review = reviewMusicality(broken);

  assert.equal(score.compositionReview.passed, true);
  assert.equal(review.passed, false);
  assert.ok(review.issues.includes('the harmonic pattern loses its stated progression'));
});

function xmlForDurations(durations) {
  let onset = 0;
  const notes = durations.map((duration) => {
    const note = {
      onset,
      duration,
      rest: false,
      pitches: [fromDia(28)],
      tags: [],
    };
    onset += duration;
    return note;
  });
  return toMusicXml({
    title: 'Beam test',
    key: { fifths: 0, mode: 'major' },
    ts: timeSig('4/4'),
    tempo: 72,
    measures: 1,
    staves: { rh: notes, lh: [] },
    slurs: [],
  });
}

const occurrences = (text, fragment) => text.split(fragment).length - 1;

test('sixteenths engrave as beamed couplets inside a beat', () => {
  const xml = xmlForDurations([12, 12, 12, 12]);

  assert.equal(occurrences(xml, '<beam number="1">begin</beam>'), 1);
  assert.equal(occurrences(xml, '<beam number="1">end</beam>'), 1);
  assert.equal(occurrences(xml, '<beam number="2">begin</beam>'), 2);
  assert.equal(occurrences(xml, '<beam number="2">end</beam>'), 2);
});

test('dotted-eighth/sixteenth figures use conventional secondary-beam hooks', () => {
  const dottedFirst = xmlForDurations([36, 12]);
  const dottedLast = xmlForDurations([12, 36]);

  assert.ok(dottedFirst.includes('<beam number="2">backward hook</beam>'));
  assert.ok(dottedLast.includes('<beam number="2">forward hook</beam>'));
});

test('primary beams stop at quarter-note beats in common time', () => {
  const xml = xmlForDurations([12, 12, 12, 12, 12, 12, 12, 12]);

  assert.equal(occurrences(xml, '<beam number="1">begin</beam>'), 2);
  assert.equal(occurrences(xml, '<beam number="1">end</beam>'), 2);
});

test('reference playback renders a non-empty browser-safe WAV', () => {
  const score = generateExercise(paramsForLevel(1, emptyProfile(), { seed: 161803 }));
  const wav = renderReferenceWav(score, { sampleRate: 8000 });
  const ascii = (from, to) => String.fromCharCode(...wav.slice(from, to));

  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 12), 'WAVE');
  assert.ok(wav.length > 44);
  assert.ok(wav.slice(44).some((byte) => byte !== 0));

  const countIn = renderReferenceWav(score, {
    sampleRate: 8000, playScore: false, metronome: false, countInBeats: 2,
  });
  assert.ok(countIn.slice(44).some((byte) => byte !== 0));
});

test('reference playback starts through an HTML media element', async () => {
  const originalAudio = globalThis.Audio;
  const originalCreate = globalThis.URL.createObjectURL;
  const originalRevoke = globalThis.URL.revokeObjectURL;
  let plays = 0;
  let revoked = 0;

  class FakeAudio {
    constructor() {
      this.currentTime = 0;
      this.volume = 1;
    }
    play() { plays += 1; return Promise.resolve(); }
    pause() {}
  }

  globalThis.Audio = FakeAudio;
  globalThis.URL.createObjectURL = () => 'blob:prima-vista-test';
  globalThis.URL.revokeObjectURL = () => { revoked += 1; };
  try {
    const score = generateExercise(paramsForLevel(1, emptyProfile(), { seed: 141421 }));
    const playback = startReferencePlayback({ score });
    assert.ok(playback);
    assert.equal(await playback.started, true);
    assert.equal(plays, 1);
    playback.stop();
    assert.equal(revoked, 1);

    const practice = startPracticePlayback({ score, metronome: true, countInBeats: 4 });
    assert.equal(await practice.started, true);
    assert.ok(practice.exerciseStart > practice.leadIn);
    assert.equal(plays, 2);
    practice.stop();
    assert.equal(revoked, 2);
  } finally {
    globalThis.Audio = originalAudio;
    globalThis.URL.createObjectURL = originalCreate;
    globalThis.URL.revokeObjectURL = originalRevoke;
  }
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
    assert.ok(starts.filter((at) => at > 0).every((at) => at >= 2.025));
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
