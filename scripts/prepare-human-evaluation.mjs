import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { toMusicXml } from '../src/core/musicxml.js';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle(values, random) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [out[index], out[target]] = [out[target], out[index]];
  }
  return out;
}

const manifestPath = option('--references');
const out = resolve(option('--out', 'human-evaluation'));
const style = option('--style', 'classical_early');
const seed = Number(option('--seed', '20260903')) >>> 0;
const teacherSamples = Number(option('--teacher-samples', '20'));
assert.ok(manifestPath, 'usage: npm run prepare:evaluation -- --references references.jsonl [--out directory]');
assert.ok(Number.isInteger(teacherSamples) && teacherSamples >= 1, '--teacher-samples must be a positive integer');

const references = (await readFile(resolve(manifestPath), 'utf8')).split(/\r?\n/)
  .filter(Boolean).map((line) => JSON.parse(line))
  .filter((item) => item.style === style && item.level >= 1 && item.level <= 10);
for (const item of references) {
  assert.ok(item.path && item.source_id && item.license, 'each reference needs path, source_id, license, style and level');
  assert.doesNotMatch(item.license, /NC|NonCommercial|SA|ShareAlike/i, `${item.source_id} has a blocked license`);
}
assert.ok(references.length >= 10, `need at least 10 cleared, level-labelled ${style} references`);

const random = seeded(seed);
const selected = shuffle(references, random).slice(0, 10);
const abDir = resolve(out, 'blind-ab');
const teacherDir = resolve(out, 'teacher-review');
await mkdir(abDir, { recursive: true });
await mkdir(teacherDir, { recursive: true });

const stimuli = [];
for (let index = 0; index < selected.length; index++) {
  const reference = selected[index];
  const referenceId = `stimulus-${String(index * 2 + 1).padStart(2, '0')}`;
  const generatedId = `stimulus-${String(index * 2 + 2).padStart(2, '0')}`;
  await copyFile(resolve(reference.path), resolve(abDir, `${referenceId}.musicxml`));
  const generated = generateExercise({
    ...paramsForLevel(reference.level, emptyProfile(), { seed: (seed + index * 104729) >>> 0, targeting: false }),
    compositionStyle: style,
    ...(reference.meter ? { timeSignature: reference.meter } : {}),
    ...(reference.measures ? { measures: reference.measures } : {}),
  });
  await writeFile(resolve(abDir, `${generatedId}.musicxml`), toMusicXml(generated));
  stimuli.push(
    { id: referenceId, truth: 'human', level: reference.level, source_id: reference.source_id },
    { id: generatedId, truth: 'generated', level: reference.level, seed: generated.seed },
  );
}

await writeFile(resolve(abDir, 'answer-key.json'), `${JSON.stringify({ seed, style, stimuli }, null, 2)}\n`);
for (let rater = 1; rater <= 5; rater++) {
  const order = shuffle(stimuli.map((item) => item.id), seeded(seed + rater * 8191));
  const rows = ['order,stimulus,guess_human_or_generated,confidence_1_to_5,comment'];
  order.forEach((id, index) => rows.push(`${index + 1},${id},,,`));
  await writeFile(resolve(abDir, `rater-${rater}.csv`), `${rows.join('\n')}\n`);
}

const teacherRows = ['level,stimulus,awkward_yes_no,idiomatic_1_to_5,difficulty_fit_1_to_5,comment'];
for (let level = 1; level <= 10; level++) {
  for (let sample = 0; sample < teacherSamples; sample++) {
    const exerciseSeed = (seed + level * 1000003 + sample * 7919) >>> 0;
    const score = generateExercise({
      ...paramsForLevel(level, emptyProfile(), { seed: exerciseSeed, targeting: false }),
      compositionStyle: style,
    });
    const id = `level-${String(level).padStart(2, '0')}-${String(sample + 1).padStart(2, '0')}`;
    await writeFile(resolve(teacherDir, `${id}.musicxml`), toMusicXml(score));
    teacherRows.push(`${level},${id},,,,`);
  }
}
await writeFile(resolve(teacherDir, 'review.csv'), `${teacherRows.join('\n')}\n`);
await writeFile(resolve(out, 'README.txt'), [
  `Prima Vista human evaluation package (${style})`,
  '',
  'blind-ab/answer-key.json is confidential until all five rater sheets are complete.',
  'Compute identification accuracy from the five rater CSV files; release target: <65%.',
  `teacher-review/ contains ${teacherSamples} exercises per level; any awkward=yes blocks release.`,
  `Reference manifest: ${basename(manifestPath)}`,
  `Deterministic package seed: ${seed}`,
  '',
].join('\n'));

console.log(`prepared 20 blind A/B stimuli and ${teacherSamples * 10} teacher-review exercises in ${out}`);
