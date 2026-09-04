import assert from 'node:assert/strict';
import test from 'node:test';

import { applyResult, emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import {
  renderReferenceWav, startPracticePlayback, startReferencePlayback,
} from '../src/core/audio.js';
import { generateExercise, planMusicalForm } from '../src/core/generator.js';
import { analyseEvents, createGrader } from '../src/core/grader.js';
import { COMMON_CADENCES } from '../src/core/harmony.js';
import { LEVELS, levelById } from '../src/core/levels.js';
import { reviewMusicality } from '../src/core/musicality.js';
import { STYLE_OPTIONS, styleSetupPatch } from '../src/core/compositionStyles.js';
import { STYLE_PACK_LIST, stylePack } from '../src/core/stylePacks.js';
import { ledgerLines, validateExercise } from '../src/core/validator.js';
import { toMusicXml } from '../src/core/musicxml.js';
import { codeToSeed, randomSeed, seedToCode } from '../src/core/rng.js';
import { timeSig } from '../src/core/rhythm.js';
import { scoreLayoutOptions } from '../src/core/verovio.js';
import { fromDia, keyAlterations, tonicLetter } from '../src/core/theory.js';
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

test('all circle-of-fifths tonics map to the correct staff letter', () => {
  const majorLetters = [0, 4, 1, 5, 2, 6, 3, 0, 4, 1, 5, 2, 6, 3, 0];
  for (let fifths = -7; fifths <= 7; fifths++) {
    const expected = majorLetters[fifths + 7];
    assert.equal(tonicLetter({ fifths, mode: 'major' }), expected, `major fifths ${fifths}`);
    assert.equal(tonicLetter({ fifths, mode: 'minor' }), (expected + 5) % 7, `minor fifths ${fifths}`);
  }
});

test('the same seed and parameters generate identical music', () => {
  const params = paramsForLevel(8, emptyProfile(), { seed: 741852 });
  const first = generateExercise(params);
  const second = generateExercise({ ...params });
  assert.deepEqual(first.staves, second.staves);
  assert.deepEqual(first.chords, second.chords);
  assert.equal(toMusicXml(first), toMusicXml(second));
});

test('all ten level envelopes pass hard validation across deterministic samples', () => {
  for (let level = 1; level <= 10; level++) {
    for (let sample = 1; sample <= 12; sample++) {
      const score = generateExercise(paramsForLevel(level, emptyProfile(), { seed: level * 10000 + sample }));
      const review = validateExercise(score, levelById(level).constraints, { relaxation: 4 });
      assert.deepEqual(review.hardErrors, [], `level ${level}, sample ${sample}: ${review.hardErrors.join('; ')}`);
      assert.ok(review.metrics.coherence >= stylePack(score.style.id).validator.coherence_min);
      assert.ok(review.metrics.coherence <= stylePack(score.style.id).validator.coherence_max);
    }
  }
});

test('guided studies begin at eight bars and never shorten as levels rise', () => {
  const lengths = LEVELS.map((level) => level.params.measures);
  assert.ok(lengths.every((bars) => bars >= 8));
  assert.ok(lengths.every((bars, index) => index === 0 || bars >= lengths[index - 1]));
});

test('style-pack schemas are complete and inheritance has been resolved', () => {
  for (const pack of STYLE_PACK_LIST) {
    assert.equal(pack.schema_version, 1);
    assert.equal('extends' in pack, false);
    assert.ok(pack.forms.length > 0);
    assert.ok(pack.harmony.vocabulary.every((roman) => pack.harmony.transitions[roman]));
    assert.ok(pack.provenance.model);
  }
});

test('public-domain repertoire mode renders a provenance-bearing fixed score', () => {
  const score = generateExercise({
    sourceMode: 'repertoire', repertoireId: 'beethoven-ode-to-joy-theme', seed: 42, tempo: 80,
  });
  assert.equal(score.repertoire.license, 'Public domain');
  assert.equal(score.measures, 8);
  assert.equal(score.harmony.cadences.at(-1).roman, 'V–I');
  assert.ok(toMusicXml(score).includes('Ode to Joy'));
  assert.deepEqual(score.staves, generateExercise(score.params).staves);
});

test('recombination mode transforms a provenance-bearing human motif deterministically', () => {
  const params = {
    ...paramsForLevel(5, emptyProfile(), { seed: 246810 }),
    sourceMode: 'recombined',
    compositionStyle: 'classical_early',
    timeSignature: '4/4',
    measures: 8,
  };
  const score = generateExercise(params);
  assert.ok(score.fragment?.provenance);
  assert.notEqual(score.fragment.shift, 0);
  assert.equal(score.compositionReview.validation.hardPassed, true);
  assert.equal(toMusicXml(score), toMusicXml(generateExercise(params)));
  assert.equal(decodeExerciseParams(encodeExerciseParams(params)).sourceMode, 'recombined');
});

test('generated studies use a clear phrase form and repeat their rhythmic idea', () => {
  const score = generateExercise({
    ...paramsForLevel(2, emptyProfile(), { seed: 314159 }),
    compositionStyle: 'classical_early', measures: 8,
  });
  const signature = (measure) => score.staves.rh
    .filter((note) => Math.floor(note.onset / score.ts.ticks) === measure)
    .map((note) => [note.onset % score.ts.ticks, note.duration, note.rest, note.cellId]);

  assert.equal(score.form.units.length, 4);
  assert.ok(score.form.units.every((unit) => unit.function));
  assert.ok(score.development.transforms.length === 3);
  assert.ok(score.form.units.filter((unit) => ['motif', 'exact', 'transpose_diatonic', 'reharmonize'].includes(unit.transform)).length >= 2);
  assert.deepEqual(signature(0), signature(4));
  const classical = planMusicalForm(8, 'classical_early', null, 3);
  assert.equal(classical.name, 'Parallel period');
  assert.equal(classical.units.length, 4);
  assert.equal(classical.plan[3].cadenceType, 'half');
  assert.equal(classical.plan[7].cadenceType, 'authentic');
  assert.equal(score.development.motif.source, 'generated');
  assert.ok(score.development.motif.rhythmCellId);
  assert.ok(score.development.motif.rhythm.length >= 1);
  assert.ok(score.development.motif.seedPitches.length >= 1);
  assert.ok(['arch', 'ascending', 'descending', 'wave'].includes(score.development.motif.contour));
});

test('articulations express repeated gestures and phrase structure', () => {
  let staccatoCount = 0;
  let tenutoCount = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const score = generateExercise({
      ...paramsForLevel(5, emptyProfile(), { seed: seed * 104729 }),
      compositionStyle: 'classical_early', timeSignature: '4/4', measures: 12,
      articulations: true,
    });
    const sounded = score.staves.rh.filter((note) => !note.rest);
    const staccatos = sounded.filter((note) => note.articulation === 'staccato');
    const tenutos = sounded.filter((note) => note.articulation === 'tenuto');
    staccatoCount += staccatos.length;
    tenutoCount += tenutos.length;

    assert.ok(staccatos.every((note) => !note.cadence && !note.tags.includes('phrase-end')));
    assert.ok(tenutos.every((note) => note.duration >= score.ts.beat));

    const slotCounts = new Map();
    for (const note of staccatos) {
      const slot = String(note.motifIndex).split(':').slice(0, 2).join(':');
      slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
    }
    assert.ok([...slotCounts.values()].every((count) => count >= 2));
  }
  assert.ok(staccatoCount > 0);
  assert.ok(tenutoCount > 0);
});

test('Auto never escapes to a meter-incompatible style pack', () => {
  const params = {
    ...paramsForLevel(8, emptyProfile(), { seed: 808080 }),
    compositionStyle: 'auto', timeSignature: '5/4', measures: 8,
  };
  const score = generateExercise(params);
  assert.ok(stylePack(score.style.id).meters.some((meter) => meter.value === '5/4'));
  assert.throws(() => generateExercise({ ...params, compositionStyle: 'classical_early' }), /does not support 5\/4/);
});

test('validator mutations trip each independent hard pedagogical gate', () => {
  const source = generateExercise({
    ...paramsForLevel(2, emptyProfile(), { seed: 220022 }),
    compositionStyle: 'classical_early', timeSignature: '4/4', measures: 8,
  });
  const constraints = levelById(2).constraints;
  const errorsFor = (mutate) => {
    const score = structuredClone(source);
    mutate(score);
    return validateExercise(score, constraints, { relaxation: 4 }).hardErrors;
  };

  assert.ok(errorsFor((score) => {
    score.staves.rh.find((note) => !note.rest).pitches = [fromDia(score.params.rhHigh + 8)];
  }).some((error) => error.includes('pitch range')));

  assert.ok(errorsFor((score) => {
    const note = score.staves.rh.find((event) => !event.rest);
    note.pitches = [fromDia(score.params.rhHigh + 4)];
  }).some((error) => error.includes('ledger-line budget')));

  assert.ok(errorsFor((score) => {
    const signature = keyAlterations(score.key.fifths);
    for (const note of score.staves.rh.filter((event) => !event.rest).slice(0, constraints.chromatic_notes + 1)) {
      note.pitches[0].alter = signature[note.pitches[0].letter] + 1;
    }
  }).some((error) => error.includes('chromatic-note count')));

  assert.ok(errorsFor((score) => {
    const note = score.staves.rh[0];
    note.duration = Math.max(1, constraints.smallest_ticks - 1);
  }).some((error) => error.includes('shorter than the level permits')));

  assert.ok(errorsFor((score) => {
    const attacks = score.staves.rh.filter((event) => !event.rest).slice(0, 2);
    attacks[0].pitches = [fromDia(score.params.rhLow)];
    attacks[1].pitches = [fromDia(score.params.rhHigh)];
  }).some((error) => error.includes('melodic-interval cap')));

  assert.ok(errorsFor((score) => {
    const cadence = score.harmony.cadences.at(-1);
    const arrival = score.staves.rh.find((note) => note.cadence === cadence.id
      && Math.floor(note.onset / score.ts.ticks) === cadence.measure);
    arrival.pitches = [fromDia(arrival.pitches[0].dia + 1)];
  }).some((error) => error.includes('cadence')));

  assert.ok(errorsFor((score) => {
    const right = score.staves.rh.find((note) => !note.rest);
    const left = score.staves.lh.find((note) => !note.rest && note.onset === right.onset);
    left.pitches = [fromDia(right.pitches[0].dia)];
  }).some((error) => error.includes('collide')));

  assert.ok(errorsFor((score) => {
    score.form.units.forEach((unit, index) => { if (index) unit.transform = 'invert'; });
  }).some((error) => error.includes('recognizable motivic restatement')));
  assert.equal(ledgerLines('rh', 35), 0);
});

test('property grid emits only critic-approved, hard-valid candidates', () => {
  for (let level = 1; level <= 10; level++) {
    const definition = levelById(level);
    for (let sample = 0; sample < 5; sample++) {
      const base = paramsForLevel(level, emptyProfile(), { seed: level * 700001 + sample * 97 });
      const score = generateExercise({
        ...base,
        keyFifths: definition.params.fifths[sample % definition.params.fifths.length],
        keyMode: definition.params.modes[sample % definition.params.modes.length],
        timeSignature: definition.constraints.meters[sample % definition.constraints.meters.length],
        compositionStyle: 'auto',
      });
      assert.equal(score.compositionReview.passed, true);
      assert.equal(score.compositionReview.validation.hardPassed, true);
      assert.ok(score.compositionReview.selectedAttempt < 20);
      if (score.compositionReview.selectedAttempt < 10) {
        assert.equal(score.compositionReview.validation.relaxation, 0);
      }
    }
  }
});

test('selectable styles use coherent, distinct composition grammars', () => {
  assert.equal(STYLE_PACK_LIST.length, 10);
  assert.equal(STYLE_OPTIONS.length, 11); // ten packs plus Auto
  const formNames = new Set();

  for (const pack of STYLE_PACK_LIST) {
    const level = Math.max(5, pack.forms[0].min_level);
    const setup = {
      compositionStyle: pack.id,
      measures: pack.forms[0].bars,
      timeSignature: pack.meters[0].value,
    };
    const score = generateExercise({
      ...paramsForLevel(level, emptyProfile(), { seed: 123456 }),
      ...setup,
    });
    assert.equal(score.style.id, pack.id);
    assert.equal(score.form.styleId, pack.id);
    assert.ok(score.harmony.styles.includes(pack.id));
    assert.equal(score.compositionReview.validation.hardPassed, true);
    formNames.add(score.form.name);
  }

  assert.equal(formNames.size, STYLE_PACK_LIST.length);
  assert.equal(styleSetupPatch('blues', { hands: 'both' }).measures, 12);
  assert.equal(styleSetupPatch('hymn_chorale', { hands: 'both' }).compositionStyle, 'hymn_chorale');
});

test('blues style realises a twelve-bar I–IV–V vocabulary with dominant sevenths', () => {
  const score = generateExercise({
    ...paramsForLevel(8, emptyProfile(), { seed: 271828 }),
    compositionStyle: 'blues',
    keyMode: 'major',
    keyFifths: 0,
    measures: 12,
    timeSignature: '4/4',
    hands: 'both',
    lhStyle: 'blocked',
    lhLow: 14,
    lhHigh: 28,
  });

  assert.equal(score.form.name, 'Twelve-bar blues');
  assert.ok(score.harmony.degrees.every((degree) => [0, 3, 4].includes(degree)));
  assert.deepEqual(score.harmony.cadences.slice(0, 2).map((item) => item.id), ['subdominant_turn', 'half']);
  assert.ok(score.chords.filter((chord) => [0, 3, 4].includes(chord.degree)).every((chord) => chord.seventh));
  const openingPitches = score.staves.lh.filter((note) => note.onset === 0).flatMap((note) => note.pitches);
  assert.ok(openingPitches.some((pitch) => pitch.letter === 6 && pitch.alter === -1)); // B-flat in C7
});

test('every study follows its pack transition model with a varied cadence plan', () => {
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
      const pack = stylePack(score.style.id);
      assert.equal(score.harmony.sourceProgression, `${pack.display_name} transition model`);
      assert.equal(score.harmony.degrees.length, score.chords.length);
      assert.ok(score.harmony.sectionPlans.length >= 1);
      for (const chord of score.chords.filter((item) => item.source === 'progression')) {
        assert.equal(chord.degree, chord.plannedDegree);
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
      assert.equal(score.compositionReview.validation.hardPassed, true);
      assert.ok([10, 20].includes(score.compositionReview.candidates));
    }
  }

  assert.ok(finalCadences.size >= 2);
  assert.ok([...finalPairs].some((pair) => pair !== '4,0'));
});

test('perfect authentic cadences preserve root-position V–I in the realised bass', () => {
  let checked = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const score = generateExercise({
      ...paramsForLevel(7, emptyProfile(), { seed }),
      compositionStyle: 'classical_early',
      measures: 8,
      chordsPerMeasure: 2,
      hands: 'both',
      lhStyle: 'blocked',
      allowInversions: true,
      timeSignature: '4/4',
    });
    for (const cadence of score.harmony.cadences.filter((item) => item.id === 'authentic')) {
      checked += 1;
      assert.equal(score.compositionReview.metrics.strictPac, 1);
      assert.equal(score.compositionReview.metrics.cadenceBass, 1);
      assert.deepEqual(cadence.degrees.slice(-2), [4, 0]);
    }
  }
  assert.ok(checked > 10);
});

test('formal grammar assigns phrase functions, cadence hierarchy, and sectional contrast', () => {
  const pop = generateExercise({
    ...paramsForLevel(7, emptyProfile(), { seed: 97531 }),
    compositionStyle: 'pop_contemporary',
    measures: 16,
    timeSignature: '4/4',
    hands: 'both',
    lhStyle: 'broken',
  });
  assert.deepEqual(pop.form.phrases.map((phrase) => phrase.function), [
    'verse', 'verse_variation', 'pre_chorus', 'chorus',
  ]);
  assert.equal(pop.form.phrases[0].energy < pop.form.phrases.at(-1).energy, true);
  assert.equal(pop.compositionReview.metrics.phraseHierarchy, 1);
  assert.ok(pop.compositionReview.metrics.sectionContrast >= 0.12);
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

test('score layout offers a conventional page and one continuous scrolling system', () => {
  const page = scoreLayoutOptions('page', 1200);
  const scroll = scoreLayoutOptions('scroll', 1200);

  assert.equal(page.breaks, 'auto');
  assert.equal(page.adjustPageWidth, false);
  assert.equal(scroll.breaks, 'none');
  assert.equal(scroll.adjustPageWidth, true);
  assert.equal(scroll.adjustPageHeight, true);
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
  const params = paramsForLevel(7, profile, { seed: 112233 });

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
  const original = generateExercise(paramsForLevel(8, profile, { seed: 987654 }));
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

test('assisted work cannot satisfy the three-first-read promotion rule', () => {
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
  assert.equal(profile.level, 1);

  profile = applyResult(profile, {
    level: 1, summary, seed: 4, exerciseId: 'd', elapsedSec: 20,
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
