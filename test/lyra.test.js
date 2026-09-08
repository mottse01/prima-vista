import test from 'node:test';
import assert from 'node:assert/strict';

import { lyraOnHolding, lyraOnOpening, lyraOnReading, lyraSpeaks } from '../src/core/lyra.js';
import { BEATS, beatFor, LOCATIONS, READING_LESSONS } from '../src/core/adventure.js';
import { LEVELS } from '../src/core/levels.js';
import { createGrader } from '../src/core/grader.js';
import { generateExercise } from '../src/core/generator.js';
import { emptyProfile, paramsForLevel } from '../src/core/adaptive.js';

const reading = (extra = {}) => ({
  valid: true, score: 80, total: 24, correct: 20, wrong: 2, missed: 2, extras: 0,
  misreadInKey: 0, pitchAccuracy: 0.83, rhythmAccuracy: 0.9, continuity: 1,
  fluency: { spread: 0.08, hesitation: 1.1, steady: true, unbroken: true },
  hands: null, ...extra,
});

test('every destination has something waiting and something to find out', () => {
  assert.equal(BEATS.length, LOCATIONS.length);
  assert.equal(BEATS.length, LEVELS.length);
  for (const [index, beat] of BEATS.entries()) {
    assert.ok(beat.found.length > 20, `beat ${index + 1} needs something waiting there`);
    assert.ok(beat.discovery.length > 40, `beat ${index + 1} needs something to find out`);
    // What is waiting is said before it is read, so it must not give away
    // what it turns out to be.
    assert.notEqual(beat.found, beat.discovery);
    assert.equal(beatFor(index + 1), beat);
  }
  // Out-of-range levels still answer rather than leaving a reader nowhere.
  assert.equal(beatFor(0), BEATS[0]);
  assert.equal(beatFor(99), BEATS.at(-1));
  assert.equal(READING_LESSONS.length, LEVELS.length);
});

test('she names the stop before anything else', () => {
  // Stopping is the characteristic sight-reading failure and the one that does
  // not improve on its own, so it outranks a page of wrong notes.
  const stopped = lyraOnReading(reading({
    pitchAccuracy: 0.4, wrong: 9, misreadInKey: 9,
    fluency: { spread: 0.4, hesitation: 3.1, steady: false, unbroken: false },
  }));
  assert.match(stopped, /stopped/i);
});

test('she reads a wandering pulse as a pulse problem, not a note problem', () => {
  const drifting = lyraOnReading(reading({
    fluency: { spread: 0.31, hesitation: 1.2, steady: false, unbroken: true },
  }));
  assert.match(drifting, /metre|pulse/i);
});

test('an error inside the key is reported as evidence of reading, not as damage', () => {
  // Assimilating an error toward the key means the harmony was being used to
  // predict. It never looks like progress and is worth telling somebody.
  const assimilated = lyraOnReading(reading({ wrong: 6, misreadInKey: 5, missed: 0, pitchAccuracy: 0.7 }));
  assert.match(assimilated, /same key|harmony/i);
  // Random wrong notes get no such credit.
  const scattered = lyraOnReading(reading({ wrong: 6, misreadInKey: 1, missed: 0, pitchAccuracy: 0.7 }));
  assert.ok(scattered == null || !/same key/i.test(scattered));
});

test('a gap is worth more comment than a wrong note', () => {
  const gaps = lyraOnReading(reading({ missed: 8, wrong: 1, pitchAccuracy: 0.6 }));
  assert.match(gaps, /nothing came|gap/i);
});

test('she never congratulates a reading that did not happen', () => {
  // An invalid or ineligible take is a device event, not a performance.
  assert.equal(lyraOnReading({ valid: false, score: 0 }), null);
  assert.equal(lyraOnReading({ assessmentEligible: false }), null);
  assert.equal(lyraOnReading(null), null);
  assert.match(lyraOnReading({ unscored: true }), /could not hear/i);

  // A poor reading with nothing distinctive about it gets silence, not praise.
  const unremarkable = lyraOnReading(reading({
    pitchAccuracy: 0.5, wrong: 1, missed: 1, correct: 12,
    fluency: { spread: 0.15, hesitation: 1.6, steady: false, unbroken: false },
  }));
  assert.ok(unremarkable == null || !/that is what it sounds like/i.test(unremarkable));

  // And nothing anywhere claims a first hearing for a reading that did not
  // open one. She may still say something true about it — "you read it
  // straight through and some of it was wrong" is not praise.
  const held = lyraSpeaks(reading({ score: 40, pitchAccuracy: 0.4 }), { opened: false });
  assert.ok(!/first time anyone/i.test(held));
  assert.ok(!/what it sounds like when someone can read/i.test(held));
  // With nothing measured worth remarking on, she falls back rather than
  // inventing an observation.
  assert.equal(lyraSpeaks({ valid: true }, { opened: false }), lyraOnHolding());
});

test('the discovery arrives only once the passage has been sounded', () => {
  const summary = reading({ score: 96, pitchAccuracy: 0.97 });
  const before = lyraSpeaks(summary, { opened: false, discovery: BEATS[2].discovery });
  const after = lyraSpeaks(summary, { opened: true, discovery: BEATS[2].discovery });
  assert.ok(!before.includes(BEATS[2].discovery), 'nothing is given away by a reading that did not open it');
  assert.ok(after.includes(BEATS[2].discovery));
  assert.match(after, /first time anyone has heard it/i);
  assert.ok(lyraOnOpening(null).length > 10, 'she still says something without a beat to report');
});

test('an uneven hand is named, and the usual way round is not treated as remarkable', () => {
  const weakLeft = lyraOnReading(reading({
    pitchAccuracy: 0.8, wrong: 1, missed: 1,
    hands: { rh: { pitchAccuracy: 0.95 }, lh: { pitchAccuracy: 0.6 } },
  }));
  assert.match(weakLeft, /lower staff/i);
  const weakRight = lyraOnReading(reading({
    pitchAccuracy: 0.8, wrong: 1, missed: 1,
    hands: { rh: { pitchAccuracy: 0.6 }, lh: { pitchAccuracy: 0.95 } },
  }));
  assert.match(weakRight, /upper staff/i);
  const even = lyraOnReading(reading({
    pitchAccuracy: 0.92, wrong: 1, missed: 1,
    hands: { rh: { pitchAccuracy: 0.92 }, lh: { pitchAccuracy: 0.9 } },
  }));
  assert.ok(!/staff is costing/i.test(even || ''));
});

test('the grader can tell a misreading inside the key from one outside it', () => {
  // The measurement Lyra's best line depends on, taken from a real score
  // rather than from a hand-built summary.
  const score = generateExercise(paramsForLevel(3, emptyProfile(), { seed: 606060, targeting: false }));
  const play = (offsets) => {
    const grader = createGrader(score, { startTime: 0 });
    const secPerTick = 60 / score.tempo / 48;
    grader.events.forEach((event, index) => {
      grader.noteOn(event.midi + (offsets[index % offsets.length] || 0), event.onset * secPerTick);
    });
    return grader.summary();
  };
  // A whole tone up from every written note stays inside the scale about as
  // often as the scale allows; a semitone up leaves it far more often.
  const diatonic = play([2]);
  const chromatic = play([1]);
  assert.ok(diatonic.wrong > 5 && chromatic.wrong > 5, 'both readings must be wrong enough to compare');
  assert.ok(
    diatonic.misreadInKey / diatonic.wrong > chromatic.misreadInKey / chromatic.wrong,
    'reading a step off the key should score as more in-key than reading a semitone off',
  );
  assert.ok(diatonic.misreadInKey <= diatonic.wrong);
});
