import assert from 'node:assert/strict';
import test from 'node:test';
import { applyResult, comparableReads, eligibleFirstRead, emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { createGrader, SCORING_VERSION } from '../src/core/grader.js';
import { detectPitch, frequencyToMidi } from '../src/core/microphone.js';
import { toMusicXml } from '../src/core/musicxml.js';
import { timeSig } from '../src/core/rhythm.js';
import { loadProfile } from '../src/core/storage.js';
import { spellInKey } from '../src/core/theory.js';
import { balancedSystemBreaks } from '../src/core/verovio.js';

const key = { fifths: 0, mode: 'major' };
const pitch = (midi) => Array.from({ length: 70 }, (_, dia) => spellInKey(key, dia)).find((p) => p.midi === midi);
const note = (onset, midis, duration = 48) => ({ onset, duration, rest: !midis.length, tags: [midis.length ? 'quarter' : 'rest'], pitches: midis.map(pitch) });
const fixture = (rh, lh = [], tempo = 60) => ({ title: 'Fixture', seed: 1, measures: 1, tempo, ts: timeSig('4/4'), key, totalTicks: 192, performanceTicks: 192, staves: { rh, lh } });
const permutations = (items) => items.length ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest])) : [[]];

test('all 24 simultaneous chord arrival orders produce identical scoring', () => {
  const score = fixture([0, 48, 96, 144].map((at) => note(at, [60, 64, 67])));
  const summaries = permutations([60, 62, 64, 67]).map((order) => {
    const grader = createGrader(score, { startTime: 0 });
    for (const at of [0, 1, 2, 3]) for (const midi of order) grader.noteOn(midi, at);
    const { score: points, correct, wrong, extras, pitchAccuracy, rhythmAccuracy } = grader.finish();
    return { score: points, correct, wrong, extras, pitchAccuracy, rhythmAccuracy };
  });
  assert.ok(summaries.every((summary) => JSON.stringify(summary) === JSON.stringify(summaries[0])));
  assert.equal(summaries[0].correct, 12);
  assert.equal(summaries[0].extras, 4);
});

test('late correct pitches do not become pitch-reading failures', () => {
  const midis = [84, 86, 88, 89];
  const grader = createGrader(fixture(midis.map((midi, i) => note(i * 48, [midi])), [], 120), { startTime: 0 });
  midis.forEach((midi, i) => grader.noteOn(midi, i * 0.5 + 0.2));
  const result = grader.finish();
  assert.equal(result.pitchAccuracy, 1);
  assert.equal(result.rhythmAccuracy, 0);
  assert.deepEqual(result.skills['notes.treble'], { correct: 4, total: 4 });
  assert.deepEqual(result.skills['intervals.step'], { correct: 3, total: 3 });
});

test('rest re-entry and new attacks during full-score silence are separate', () => {
  const rh = [note(0, [60]), note(48, []), note(96, [64]), note(144, [67])];
  const run = (lh) => {
    const grader = createGrader(fixture(rh, lh), { startTime: 0 });
    [[60, 0], [61, 1], [64, 2], [67, 3]].forEach(([midi, at]) => grader.noteOn(midi, at));
    return grader.finish();
  };
  assert.deepEqual(run([]).skills['rhythm.rest'], { correct: 1, total: 1 });
  assert.deepEqual(run([]).skills['rhythm.silence'], { correct: 0, total: 1 });
  assert.equal(run([note(0, [48], 192)]).skills['rhythm.silence'], undefined);
});

test('microphone detects synthetic C2–C6 fundamentals at both common sample rates', () => {
  for (const sampleRate of [44100, 48000]) {
    for (let midi = 36; midi <= 84; midi++) {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      for (const harmonic of [0, 0.35]) {
        const samples = Float32Array.from({ length: 2048 }, (_, i) => {
          const phase = 2 * Math.PI * frequency * i / sampleRate;
          return 0.3 * (Math.sin(phase) + harmonic * Math.sin(phase * 2));
        });
        const detected = detectPitch(samples, sampleRate);
        assert.ok(detected, `${sampleRate} / ${midi}`);
        assert.equal(Math.round(frequencyToMidi(detected.frequency)), midi, `${sampleRate} / ${midi} / ${harmonic}`);
      }
    }
    assert.equal(detectPitch(new Float32Array(2048), sampleRate), null);
  }
});

test('MusicXML preserves every pitch, rest and tick across all ten levels', () => {
  const letterPc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (let level = 1; level <= 10; level++) {
    for (let sample = 1; sample <= 8; sample++) {
      const score = generateExercise(paramsForLevel(level, emptyProfile(), { seed: level * 10000 + sample }));
      const xml = toMusicXml(score);
      const occupancy = new Map();
      const bars = [...xml.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)];
      assert.equal(bars.length, score.measures);
      for (const [bar, match] of bars.entries()) {
        const cursors = {};
        const starts = {};
        for (const item of match[1].matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>/g)) {
          const body = item[1];
          const voice = Number(body.match(/<voice>(\d+)<\/voice>/)[1]);
          const hand = voice === 1 ? 'rh' : 'lh';
          const duration = Number(body.match(/<duration>(\d+)<\/duration>/)[1]);
          const chord = body.includes('<chord/>');
          const onset = chord ? starts[voice] : (cursors[voice] || 0);
          if (!chord) { starts[voice] = onset; cursors[voice] = onset + duration; }
          const midi = body.includes('<rest/>') ? 'rest' : (() => {
            const step = body.match(/<step>([A-G])<\/step>/)[1];
            const octave = Number(body.match(/<octave>(\d+)<\/octave>/)[1]);
            const alter = Number(body.match(/<alter>(-?\d+)<\/alter>/)?.[1] || 0);
            return 12 * (octave + 1) + letterPc[step] + alter;
          })();
          for (let tick = bar * score.ts.ticks + onset; tick < bar * score.ts.ticks + onset + duration; tick++) {
            occupancy.set(`${hand}:${tick}:${midi}`, (occupancy.get(`${hand}:${tick}:${midi}`) || 0) + 1);
          }
        }
        for (const total of Object.values(cursors)) assert.equal(total, score.ts.ticks, `level ${level}, bar ${bar}`);
      }
      const expected = new Map();
      for (const hand of ['rh', 'lh']) for (const event of score.staves[hand] || []) {
        for (const midi of event.rest ? ['rest'] : event.pitches.map((p) => p.midi)) {
          for (let tick = event.onset; tick < event.onset + event.duration; tick++) expected.set(`${hand}:${tick}:${midi}`, 1);
        }
      }
      assert.deepEqual(occupancy, expected, `level ${level}, sample ${sample}`);
    }
  }
});

test('triplet durations have an explicit ratio and metric syncopations have ties', () => {
  const triplet = fixture([note(0, [60], 16), note(16, [62], 16), note(32, [64], 16), note(48, [65], 144)]);
  const xml = toMusicXml(triplet);
  assert.equal((xml.match(/<time-modification>/g) || []).length, 3);
  assert.match(xml, /<tuplet type="start"/);
  assert.match(xml, /<tuplet type="stop"/);
  const sync = fixture([note(0, [60], 24), note(24, [62], 48), note(72, [64], 24), note(96, [65], 96)]);
  assert.match(toMusicXml(sync), /<tie type="start"/);
  assert.match(toMusicXml(sync), /<tie type="stop"/);
});

test('minor dominant leading tones survive a zero optional-chromatic budget', () => {
  const score = generateExercise({ ...paramsForLevel(4, emptyProfile(), { seed: 40001 }), compositionStyle: 'classical_early', keyMode: 'minor', keyFifths: 0, timeSignature: '4/4', chromaticRate: 0 });
  const dominants = score.chords.map((chord, index) => ({ chord, index })).filter(({ chord }) => chord.degree === 4);
  assert.ok(dominants.length);
  let leading = 0;
  for (const { index } of dominants) {
    for (const event of Object.values(score.staves).flat().filter((event) => Math.floor(event.onset / score.ts.ticks) === index)) {
      for (const p of event.pitches.filter((p) => p.letter === 4)) {
        assert.equal(p.alter, 1);
        leading++;
      }
    }
  }
  assert.ok(leading > 0);
});

test('beginner fingering assigns one finger per fixed-position pitch', () => {
  for (let seed = 10001; seed <= 10008; seed++) {
    const score = generateExercise(paramsForLevel(1, emptyProfile(), { seed }));
    const fingers = new Map();
    for (const event of score.staves.rh.filter((event) => !event.rest)) {
      assert.ok(event.fingering >= 1 && event.fingering <= 5);
      const midi = event.pitches[0].midi;
      if (fingers.has(midi)) assert.equal(event.fingering, fingers.get(midi));
      fingers.set(midi, event.fingering);
    }
  }
});

test('placement rejects repeated, assisted, curtained and unscored takes', () => {
  const take = { summary: { valid: true }, fresh: true, takeIndex: 1, assisted: false, curtain: 'off' };
  assert.equal(eligibleFirstRead(take), true);
  for (const patch of [{ fresh: false }, { takeIndex: 2 }, { assisted: true }, { curtain: 'played' }, { summary: { assessmentEligible: false } }]) {
    assert.equal(eligibleFirstRead({ ...take, ...patch }), false);
  }
  const profile = emptyProfile();
  const summary = { score: 100, total: 10, skills: { 'notes.treble': { correct: 10, total: 10 } } };
  const first = applyResult(profile, { summary, level: 1, exerciseId: 'one' }).profile;
  const replay = applyResult(first, { summary, level: 1, exerciseId: 'one' }).profile;
  assert.deepEqual(first.skills, replay.skills);
  assert.equal(replay.practiceSkills['notes.treble'].attempts, 10);
  assert.equal(comparableReads(replay).length, 1);
  assert.deepEqual(emptyProfile().demonstratedLevels, []);
});

test('old biased skill ratings are archived, not merged into corrected evidence', () => {
  const oldStorage = globalThis.localStorage;
  const old = { ...emptyProfile(), version: 4, scoringVersion: 1, skills: { 'notes.treble': { rating: 0.1, attempts: 99 } }, history: [{ level: 1, score: 90 }], level: 5 };
  globalThis.localStorage = { getItem: () => JSON.stringify(old) };
  try {
    const loaded = loadProfile();
    assert.equal(loaded.level, 5);
    assert.deepEqual(loaded.history, old.history);
    assert.deepEqual(loaded.legacySkills, old.skills);
    assert.equal(loaded.skills['notes.treble'].attempts, 0);
    assert.equal(loaded.scoringVersion, SCORING_VERSION);
    assert.deepEqual(comparableReads(loaded), []);
  } finally { globalThis.localStorage = oldStorage; }
});

test('tempo changes outside a level remain usable and are practice-only', () => {
  const params = paramsForLevel(3, emptyProfile(), { seed: 30303 });
  const baseline = generateExercise(params);
  for (const tempo of [30, 180]) {
    const adjusted = generateExercise({ ...params, tempo });
    assert.equal(adjusted.tempo, tempo);
    assert.equal(adjusted.tempoPracticeOnly, true);
    assert.deepEqual(adjusted.staves, baseline.staves);
  }
});

test('balanced page breaks cover all bars without an avoidable final orphan', () => {
  const score = generateExercise(paramsForLevel(3, emptyProfile(), { seed: 30303 }));
  for (const width of [600, 860, 1200, 1850]) {
    const starts = [0, ...balancedSystemBreaks(score, width), score.measures];
    const lengths = starts.slice(1).map((end, index) => end - starts[index]);
    assert.ok(lengths.every((length) => length > 0));
    assert.equal(lengths.reduce((sum, length) => sum + length, 0), score.measures);
    if (score.measures >= lengths.length * 2) assert.ok(lengths.at(-1) >= 2);
  }
});
