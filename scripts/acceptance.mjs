import assert from 'node:assert/strict';

import { emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { levelById } from '../src/core/levels.js';
import { toMusicXml } from '../src/core/musicxml.js';
import { validateExercise } from '../src/core/validator.js';

const samples = Number(process.env.PV_ACCEPTANCE_SAMPLES || 1000);
const profile = emptyProfile();
const summary = {
  samplesPerLevel: samples,
  hardViolations: 0,
  criticFailuresEmitted: 0,
  strictSelections: 0,
  relaxedSelections: 0,
  levels: {},
  diversity: null,
  determinism: null,
};

for (let level = 1; level <= 10; level++) {
  let minimumCoherence = 1;
  let maximumCoherence = 0;
  for (let sample = 0; sample < samples; sample++) {
    const seed = (level * 1000003 + sample * 7919) >>> 0;
    let score;
    try {
      score = generateExercise(paramsForLevel(level, profile, { seed, targeting: false }));
    } catch (error) {
      throw new Error(`level ${level} seed ${seed}: ${error.message}`, { cause: error });
    }
    if (!score.compositionReview.passed) {
      summary.criticFailuresEmitted += 1;
      throw new Error(`level ${level} seed ${seed}: a critic-failed score escaped ranking`);
    }
    if (score.compositionReview.selectedAttempt < 10) summary.strictSelections += 1;
    else summary.relaxedSelections += 1;
    const review = validateExercise(score, levelById(level).constraints, { relaxation: 4 });
    if (review.hardErrors.length) {
      summary.hardViolations += 1;
      throw new Error(`level ${level} seed ${seed}: ${review.hardErrors.join('; ')}`);
    }
    minimumCoherence = Math.min(minimumCoherence, review.metrics.coherence);
    maximumCoherence = Math.max(maximumCoherence, review.metrics.coherence);
  }
  summary.levels[level] = { minimumCoherence, maximumCoherence };
  console.log(`level ${level}: ${samples} hard-valid generations`);
}

const deterministicParams = paramsForLevel(6, profile, { seed: 24681357, targeting: false });
const baseline = toMusicXml(generateExercise(deterministicParams));
for (let run = 0; run < 100; run++) assert.equal(toMusicXml(generateExercise(deterministicParams)), baseline);
summary.determinism = { runs: 100, byteIdentical: true };

function barSignatures(score) {
  const lead = score.staves.rh.length ? score.staves.rh : score.staves.lh;
  return Array.from({ length: score.measures }, (_, bar) => lead
    .filter((event) => Math.floor(event.onset / score.ts.ticks) === bar)
    .map((event) => [event.onset % score.ts.ticks, event.duration, event.rest,
      event.pitches.map((pitch) => [pitch.dia, pitch.alter])])
    .join('|'));
}

const diversityCount = Math.min(samples, 1000);
const index = new Map();
const diversityParams = {
  ...paramsForLevel(5, profile, { seed: 4000001, targeting: false }),
  compositionStyle: 'classical_early',
  timeSignature: '4/4',
  keyMode: 'major',
  keyFifths: 0,
  measures: 8,
};
for (let sample = 0; sample < diversityCount; sample++) {
  const score = generateExercise({
    ...diversityParams,
    seed: (4000001 + sample * 104729) >>> 0,
  });
  for (const signature of new Set(barSignatures(score))) {
    if (!index.has(signature)) index.set(signature, []);
    index.get(signature).push(sample);
  }
}
const pairCounts = new Map();
for (const ids of index.values()) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = `${ids[i]}:${ids[j]}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }
}
const maxSharedBars = [...pairCounts.values()].reduce((maximum, count) => Math.max(maximum, count), 0);
assert.ok(maxSharedBars <= 4, `a generated pair shares ${maxSharedBars} identical bars`);
summary.diversity = { generations: diversityCount, maxSharedBars };

console.log(JSON.stringify(summary, null, 2));
