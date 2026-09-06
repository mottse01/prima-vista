import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import {
  TEXTURES, normaliseTexture, playableTextures, resolveTexture,
} from '../src/core/accompaniment.js';
import { generateExercise } from '../src/core/generator.js';
import { LEVELS, levelById } from '../src/core/levels.js';
import { reviewMusicality } from '../src/core/musicality.js';
import { toMusicXml } from '../src/core/musicxml.js';
import { timeSig } from '../src/core/rhythm.js';
import { validateExercise } from '../src/core/validator.js';

const TEXTURE_IDS = new Set(TEXTURES.map((texture) => texture.id));

const sample = (level, count = 10) => Array.from({ length: count }, (_, index) => (
  generateExercise(paramsForLevel(level, emptyProfile(), { seed: level * 3011 + index * 601 }))
));

test('every texture a level promises is one the engine can realise', () => {
  for (const level of LEVELS) {
    for (const id of level.constraints.lh_textures) {
      assert.ok(TEXTURE_IDS.has(id), `level ${level.id} names an unrealised texture: ${id}`);
    }
    assert.ok(
      TEXTURE_IDS.has(normaliseTexture(level.params.lhStyle)),
      `level ${level.id} defaults to an unrealised texture`,
    );
  }
});

test('a texture that cannot be played in this meter is replaced, not renamed', () => {
  // Stride is a simple-metre figure. In 6/8 it must resolve to something the
  // hand can actually play rather than emerging as a block chord still called
  // stride.
  const compound = timeSig('6/8');
  const permitted = playableTextures(
    ['root_fifth', 'block_chord', 'stride', 'broken_chord'],
    { ts: compound, minDuration: 12, handSpan: 10, slotTicks: compound.ticks },
  );
  assert.ok(!permitted.includes('stride'), 'stride is not playable in compound metre');
  assert.notEqual(resolveTexture('stride', permitted), 'stride');

  const simple = timeSig('4/4');
  const inFour = playableTextures(
    ['root_fifth', 'block_chord', 'stride'],
    { ts: simple, minDuration: 12, handSpan: 10, slotTicks: simple.ticks },
  );
  assert.ok(inFour.includes('stride'));
  assert.equal(resolveTexture('stride', inFour), 'stride');
});

test('an exercise only plays figures its level permits', () => {
  for (const level of [2, 4, 6, 8, 10]) {
    for (const score of sample(level, 6)) {
      const permitted = new Set([...levelById(level).constraints.lh_textures, 'block_chord']);
      for (const note of score.staves.lh) {
        if (!note.texture) continue;
        assert.ok(permitted.has(note.texture), `level ${level} played ${note.texture}`);
      }
      assert.deepEqual(
        validateExercise(score, levelById(level).constraints, { relaxation: 4 }).hardErrors,
        [],
      );
    }
  }
});

test('the accompaniment has a pulse of its own, not one chord per bar', () => {
  for (const level of [2, 3, 4, 5, 6, 7, 8]) {
    const attacks = sample(level, 8).map((score) => {
      const sounded = score.staves.lh.filter((note) => !note.rest);
      return sounded.length / score.measures;
    });
    const mean = attacks.reduce((sum, value) => sum + value, 0) / attacks.length;
    assert.ok(mean > 1.2, `level ${level} averages only ${mean.toFixed(2)} left-hand attacks per bar`);
  }
});

test('a walking bass walks: quarter notes, mostly by step or small approach', () => {
  const level = levelById(7);
  const params = {
    ...paramsForLevel(7, emptyProfile(), { seed: 515151 }),
    compositionStyle: 'jazz_lead',
    timeSignature: '4/4',
    hands: 'both',
    lhStyle: 'walking',
    measures: 12,
  };
  const score = generateExercise(params);
  const walking = score.staves.lh.filter((note) => note.texture === 'walking' && !note.rest);
  assert.ok(walking.length >= 8, 'the walking figure was not realised');
  assert.ok(walking.every((note) => note.duration === score.ts.beat), 'a walking bass moves in beats');

  const steps = walking.slice(1).filter((note, index) => (
    Math.abs(note.pitches[0].dia - walking[index].pitches[0].dia) <= 2
  ));
  assert.ok(steps.length / (walking.length - 1) > 0.55, 'a walking bass connects, it does not leap about');
  assert.deepEqual(validateExercise(score, level.constraints, { relaxation: 4 }).hardErrors, []);
});

test('expression reaches the bass staff, and an accompaniment sits under its melody', () => {
  const LADDER = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
  let checked = 0;
  for (const level of [4, 6, 8]) {
    for (const score of sample(level, 6)) {
      if (!score.staves.lh.length || !score.staves.rh.length) continue;
      const lead = score.staves.rh.find((note) => note.dynamic);
      const bass = score.staves.lh.find((note) => note.dynamic);
      assert.ok(bass, `level ${level} left hand carries no dynamic`);
      if (score.params.lhStyle !== 'contrapuntal' && lead) {
        assert.ok(
          LADDER.indexOf(bass.dynamic) <= LADDER.indexOf(lead.dynamic),
          'the accompaniment is not marked louder than the melody',
        );
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 10);
});

test('a phrase can be held across a barline, and the engraver ties it', () => {
  let tied = 0;
  let engraved = 0;
  for (const level of [7, 8, 9, 10]) {
    for (const score of sample(level, 10)) {
      const crossing = [...score.staves.rh, ...score.staves.lh].filter((note) => (
        !note.rest
        && Math.floor(note.onset / score.ts.ticks)
          !== Math.floor((note.onset + note.duration - 1) / score.ts.ticks)
      ));
      if (!crossing.length) continue;
      tied += crossing.length;
      assert.deepEqual(
        validateExercise(score, levelById(level).constraints, { relaxation: 4 }).hardErrors,
        [],
        'a note crossing a barline must still fill the bar exactly',
      );
      if (toMusicXml(score).includes('<tie type="start"/>')) engraved += 1;
    }
  }
  assert.ok(tied > 0, 'nothing was ever held across a barline');
  assert.ok(engraved > 0, 'a note held across a barline was not engraved as a tie');
});

test('the critic judges the left hand, including on contrapuntal levels', () => {
  for (const level of [6, 9]) {
    for (const score of sample(level, 4)) {
      const review = reviewMusicality(score);
      assert.ok(Number.isFinite(review.metrics.leftHand));
      assert.ok(review.metrics.leftHand > 0, `level ${level} scored the left hand at zero`);
      assert.ok(review.metrics.leftHand <= 1);
    }
  }
});

test('beginner melodies move by step more often than they repeat a note', () => {
  for (const level of [1, 2, 3, 4]) {
    let steps = 0;
    let repeats = 0;
    for (const score of sample(level, 12)) {
      const lead = (score.staves.rh.length ? score.staves.rh : score.staves.lh)
        .filter((note) => !note.rest);
      for (let index = 1; index < lead.length; index++) {
        const distance = Math.abs(lead[index].pitches[0].dia - lead[index - 1].pitches[0].dia);
        if (distance === 1) steps += 1;
        if (distance === 0) repeats += 1;
      }
    }
    assert.ok(steps > repeats, `level ${level}: ${steps} steps against ${repeats} repeated notes`);
  }
});
