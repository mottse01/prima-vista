import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyProfile } from '../src/core/adaptive.js';
import {
  CONSTELLATIONS, LIT_RATING, OBSERVATIONS_FOR_CONFIDENCE, nextObservation, skyProgress, skyState,
  waypointFor,
} from '../src/core/constellation.js';
import { SKILLS } from '../src/core/grader.js';
import { LEVELS } from '../src/core/levels.js';
import {
  recordTransit, transitDay, transitParams, transitSeed, transitStreak, transitTaken,
} from '../src/core/transit.js';

const profileWith = (ratings, attempts = OBSERVATIONS_FOR_CONFIDENCE) => {
  const profile = emptyProfile();
  for (const [id, rating] of Object.entries(ratings)) {
    profile.skills[id] = { rating, attempts };
  }
  return profile;
};

test('every measured skill appears exactly once in the sky', () => {
  const placed = CONSTELLATIONS.flatMap((constellation) => constellation.stars.map((star) => star.id));
  assert.equal(placed.length, new Set(placed).size, 'a skill is drawn twice');
  assert.deepEqual([...placed].sort(), SKILLS.map((skill) => skill.id).sort());
});

test('constellation lines only join stars that exist', () => {
  for (const constellation of CONSTELLATIONS) {
    for (const [from, to] of constellation.lines) {
      assert.ok(constellation.stars[from], `${constellation.id} line starts nowhere`);
      assert.ok(constellation.stars[to], `${constellation.id} line ends nowhere`);
    }
  }
});

test('a star needs both a good rating and enough evidence before it lights', () => {
  const lucky = profileWith({ 'notes.treble': 1 }, OBSERVATIONS_FOR_CONFIDENCE - 1);
  const [lyra] = skyState(lucky);
  assert.equal(lyra.stars.find((star) => star.id === 'notes.treble').lit, false);

  const proven = profileWith({ 'notes.treble': LIT_RATING }, OBSERVATIONS_FOR_CONFIDENCE);
  assert.equal(skyState(proven)[0].stars.find((star) => star.id === 'notes.treble').lit, true);

  const weak = profileWith({ 'notes.treble': LIT_RATING - 0.01 }, 200);
  assert.equal(skyState(weak)[0].stars.find((star) => star.id === 'notes.treble').lit, false);
});

test('an unobserved constellation is dark, not failing', () => {
  const sky = skyState(emptyProfile());
  assert.ok(sky.every((constellation) => constellation.untouched));
  assert.ok(sky.every((constellation) => constellation.stars.every((star) => star.brightness === 0)));
  assert.equal(skyProgress(emptyProfile()).lit, 0);
  assert.equal(nextObservation(emptyProfile()), null);
});

test('the next observation is the dimmest star with evidence behind it', () => {
  const profile = profileWith({
    'notes.treble': 0.95,
    'notes.bass': 0.4,
    'rhythm.triplet': 0.1,
  });
  // The triplet rating is worse, but only the two with full evidence compete
  // until nothing measured is left.
  profile.skills['rhythm.triplet'] = { rating: 0.1, attempts: 2 };
  assert.equal(nextObservation(profile).id, 'notes.bass');
});

test('every level has a waypoint and the ladder never runs out of sky', () => {
  for (const level of LEVELS) {
    const waypoint = waypointFor(level.id);
    assert.equal(waypoint.level, level.id);
    assert.ok(waypoint.name && waypoint.note);
  }
  assert.equal(waypointFor(99).level, LEVELS.length);
});

test('one transit a day, identical for every reader, at their own level', () => {
  const day = '2026-09-06';
  assert.equal(transitSeed(day), transitSeed(day));
  assert.notEqual(transitSeed(day), transitSeed('2026-09-07'));

  const beginner = { ...emptyProfile(), level: 1 };
  const advanced = { ...emptyProfile(), level: 8 };
  const a = transitParams(beginner);
  const b = transitParams(advanced);
  assert.equal(a.params.seed, b.params.seed, 'the same day is the same seed');
  assert.equal(a.level, 1);
  assert.equal(b.level, 8);
  assert.equal(a.day, transitDay());
});

test('a transit is recorded once, and the streak counts consecutive days', () => {
  const day = transitDay();
  let profile = emptyProfile();
  assert.equal(transitTaken(profile), false);

  profile = recordTransit(profile, { day, score: 88, level: 3 });
  assert.equal(transitTaken(profile), true);
  assert.equal(profile.transits.length, 1);

  profile = recordTransit(profile, { day, score: 99, level: 3 });
  assert.equal(profile.transits.length, 1, 'a second read of the same day is not a new transit');
  assert.equal(profile.transits[0].score, 88);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const older = new Date();
  older.setDate(older.getDate() - 2);
  profile = recordTransit(profile, { day: transitDay(yesterday), score: 80, level: 3 });
  profile = recordTransit(profile, { day: transitDay(older), score: 80, level: 3 });
  assert.equal(transitStreak(profile), 3);
});

test('a missed day ends the streak, and today being unread does not', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const gap = new Date();
  gap.setDate(gap.getDate() - 3);

  let profile = emptyProfile();
  profile = recordTransit(profile, { day: transitDay(yesterday), score: 80, level: 2 });
  profile = recordTransit(profile, { day: transitDay(gap), score: 80, level: 2 });
  // Yesterday counts because today is not over; the two-day hole does not.
  assert.equal(transitStreak(profile), 1);
});
