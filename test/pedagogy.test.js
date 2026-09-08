import test from 'node:test';
import assert from 'node:assert/strict';

import { applyResult, emptyProfile, paramsForLevel, staleness, weakestSkills } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { analyseEvents, SKILLS } from '../src/core/grader.js';
import { LEVELS, levelById } from '../src/core/levels.js';
import { playbackEvents } from '../src/core/playback.js';
import { missionState } from '../src/core/missions.js';
import {
  COMFORTABLE, STEP, STRUGGLING, calibrate, pacingStanding, readingTempo, tempoBand,
} from '../src/core/pacing.js';
import {
  STEADY_SPREAD, UNBROKEN_HESITATION, pulseSpread, readingFluency, worstHesitation,
} from '../src/core/fluency.js';
import {
  ledgerHeadroom, levelForSkill, melodicReach, presentableSkills, presents,
} from '../src/core/syllabus.js';

const LEVEL_IDS = LEVELS.map((level) => level.id);

// ---------------------------------------------------------------------------
// What a level can actually teach
// ---------------------------------------------------------------------------

test('the syllabus matches what the levels really put on the page', () => {
  // Generated, not asserted: the claim is about the music this ladder writes,
  // so the music is what decides. A strand the syllabus says a level presents
  // must turn up in that level's studies, and one it says is absent must not.
  const observed = {};
  for (const level of LEVEL_IDS) {
    const seen = new Set();
    for (let sample = 0; sample < 40; sample += 1) {
      const seed = (level * 1000003 + sample * 7919) >>> 0;
      const score = generateExercise(paramsForLevel(level, emptyProfile(), { seed, targeting: false }));
      for (const event of analyseEvents(score)) for (const id of event.skills) seen.add(id);
    }
    observed[level] = seen;
  }
  for (const level of LEVEL_IDS) {
    for (const id of observed[level]) {
      assert.ok(presents(level, id), `level ${level} wrote ${id} but the syllabus says it cannot`);
    }
  }
  // The reverse only holds for strands the generator reaches every time. Rests
  // and general rests are occasional by design, so a forty-study sample is not
  // evidence of their absence.
  const occasional = new Set(['rhythm.rest', 'rhythm.silence']);
  for (const level of LEVEL_IDS) {
    for (const id of presentableSkills(level)) {
      if (occasional.has(id)) continue;
      assert.ok(observed[level].has(id), `the syllabus promises ${id} at level ${level} and none appeared`);
    }
  }
});

test('the ladder only ever gains material', () => {
  // Nothing a reader has met should become unavailable by moving forward, and
  // the drill router relies on that to search outward.
  for (let i = 1; i < LEVEL_IDS.length; i += 1) {
    for (const id of presentableSkills(LEVEL_IDS[i - 1])) {
      assert.ok(
        presents(LEVEL_IDS[i], id),
        `level ${LEVEL_IDS[i]} lost ${id}, which level ${LEVEL_IDS[i - 1]} had`,
      );
    }
  }
});

test('every strand on the reading map has somewhere it can be practised', () => {
  for (const skill of SKILLS) {
    const level = levelForSkill(skill.id, 1);
    assert.ok(level, `${skill.id} is on the map with nowhere to read it`);
    assert.ok(presents(level, skill.id));
  }
  // Staying put is preferred; moving is outward and minimal.
  assert.equal(levelForSkill('intervals.step', 5), 5);
  assert.equal(levelForSkill('intervals.leap', 1), 2, 'a five-finger study cannot leap');
  assert.equal(levelForSkill('rhythm.triplet', 1), 8);
  assert.equal(levelForSkill('rhythm.triplet', 9), 9, 'already somewhere it lives');
  assert.equal(levelForSkill('not.a.skill', 3), null);
});

test('every strand can be drilled at every level, and none of them lies', () => {
  // Three separate ways this used to fail. Asking level two for ledger lines
  // produced no study at all; asking a lone left hand for the bass staff at
  // the top two levels produced one seed in three; and asking level one for a
  // leap produced a study that ignored the request *and* dropped the level's
  // own focus to make room for it.
  for (const level of LEVEL_IDS) {
    for (const skill of SKILLS) {
      for (let seed = 0; seed < 5; seed += 1) {
        const params = paramsForLevel(level, emptyProfile(), {
          seed: (level * 1000003 + seed * 7919) >>> 0, targetSkill: skill.id,
        });
        assert.doesNotThrow(
          () => generateExercise(params),
          `level ${level} could not write a study while targeting ${skill.id}`,
        );
        if (!presents(level, skill.id)) {
          assert.deepEqual(params.targeted, [], `${skill.id} is not at level ${level} and must not claim to be`);
        }
      }
    }
  }
});

test('practising leaps asks for more of them, never for narrower ones', () => {
  for (const level of LEVEL_IDS) {
    const plain = paramsForLevel(level, emptyProfile(), { seed: 4242, targeting: false });
    const drill = paramsForLevel(level, emptyProfile(), { seed: 4242, targetSkill: 'intervals.leap' });
    // Every rung already writes as wide as its own constraint allows, so the
    // only honest lever is frequency. What must never happen is the drill
    // narrowing the music, which is what a flat cap of seven did at the top of
    // the ladder: it pulled level ten's reach down from eleven.
    assert.ok(
      Math.min(drill.maxLeap, melodicReach(level)) >= melodicReach(level),
      `level ${level} narrowed to ${drill.maxLeap} when asked for leaps`,
    );
    if (presents(level, 'intervals.leap')) {
      assert.ok(drill.stepwiseBias < plain.stepwiseBias, `level ${level} did not ask for more leaps`);
      assert.ok(drill.targeted.includes('intervals.leap'));
    }
  }
  assert.equal(paramsForLevel(10, emptyProfile(), { seed: 1, targetSkill: 'intervals.leap' }).maxLeap, 11);
});

test('practising ledger lines stays inside the level ledger budget', () => {
  for (const level of LEVEL_IDS) {
    const plain = paramsForLevel(level, emptyProfile(), { seed: 77, targeting: false });
    const drill = paramsForLevel(level, emptyProfile(), { seed: 77, targetSkill: 'notes.ledger' });
    const room = ledgerHeadroom(level);
    // Within the budget, and within the outermost pitches the app will write.
    assert.ok(drill.rhHigh - plain.rhHigh <= room);
    assert.ok(plain.lhLow - drill.lhLow <= room);
    assert.equal(room === 0, levelById(level).constraints.ledger_lines === 0);
    if (room > 0 && plain.rhHigh < 44) assert.ok(drill.rhHigh > plain.rhHigh);
  }
  assert.equal(melodicReach(1), 2, 'a level whose reach is two writes skips and never leaps');
});

// ---------------------------------------------------------------------------
// A silence both hands have to count
// ---------------------------------------------------------------------------

/** Windows where nothing at all is sounding, by the grader's own definition. */
function generalRests(score) {
  const events = ['rh', 'lh'].flatMap((hand) => playbackEvents(score, hand));
  const edges = [...new Set(events.flatMap((event) => [event.onset, event.onset + event.duration]))]
    .sort((a, b) => a - b);
  let windows = 0;
  let open = false;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const silent = !events.some((event) => !event.rest
      && event.onset < edges[i + 1] && event.onset + event.duration > edges[i]);
    if (silent && !open) windows += 1;
    open = silent;
  }
  return windows;
}

test('asking to read a silence produces one', () => {
  // `rhythm.silence` has always been a star on the reading map, a skill in the
  // grader and a requirement of the last destination — and no generated study
  // reached it, because the accompaniment played through every rest the melody
  // took. Twelve silences in a thousand studies is not a practisable skill.
  for (const level of LEVEL_IDS.filter((id) => presents(id, 'rhythm.silence'))) {
    let found = 0;
    for (let sample = 0; sample < 30; sample += 1) {
      const seed = (level * 1000003 + sample * 7919) >>> 0;
      const params = paramsForLevel(level, emptyProfile(), { seed, targetSkill: 'rhythm.silence' });
      assert.equal(params.generalRest, true);
      found += generalRests(generateExercise(params));
    }
    assert.ok(found >= 8, `level ${level} produced only ${found} silences in thirty studies`);
  }
});

test('a silence never opens or closes a study', () => {
  for (const level of [3, 6, 9]) {
    for (let sample = 0; sample < 20; sample += 1) {
      const seed = (level * 31337 + sample * 7919) >>> 0;
      const score = generateExercise(paramsForLevel(level, emptyProfile(), { seed, targetSkill: 'rhythm.silence' }));
      const sounding = ['rh', 'lh'].flatMap((hand) => playbackEvents(score, hand)).filter((e) => !e.rest);
      const lastBar = Math.floor((score.performanceTicks || score.totalTicks) / score.ts.ticks) - 1;
      assert.ok(sounding.some((event) => event.onset < score.ts.ticks), 'the first bar must sound');
      assert.ok(
        sounding.some((event) => Math.floor(event.onset / score.ts.ticks) >= lastBar),
        'the last bar must sound',
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Fluency: steadiness, and stopping
// ---------------------------------------------------------------------------

test('steadiness is spread, not bias', () => {
  const beat = 0.5;
  // Alternating early and late averages to nothing and is not steady at all.
  const alternating = Array.from({ length: 12 }, (_, i) => (i % 2 ? 0.12 : -0.12));
  assert.ok(Math.abs(alternating.reduce((a, b) => a + b, 0)) < 1e-9, 'the bias cancels');
  assert.ok(pulseSpread(alternating, beat) > STEADY_SPREAD, 'and the old measure called that perfect');
  // Consistently behind the click is a steady reading at a shade under tempo.
  assert.ok(pulseSpread(Array.from({ length: 12 }, () => 0.12), beat) <= STEADY_SPREAD);
  assert.equal(pulseSpread([0.01, 0.02], beat), null, 'two notes do not describe a pulse');
  assert.equal(pulseSpread([0.01, 0.02, 0.01, 0.02], 0), null);
});

test('hesitation is measured against the reader own pace, not the written tempo', () => {
  const even = Array.from({ length: 9 }, (_, i) => ({ onset: i * 480, at: i * 0.5 }));
  assert.ok(Math.abs(worstHesitation(even) - 1) < 1e-9);
  // A whole reading taken at three quarters speed is slow, not hesitant.
  const slow = Array.from({ length: 9 }, (_, i) => ({ onset: i * 480, at: i * 0.667 }));
  assert.ok(worstHesitation(slow) <= UNBROKEN_HESITATION);
  // One gap at triple the rest is a stop, however tidy everything else was.
  const stalled = even.map((attack, i) => ({ ...attack, at: attack.at + (i >= 5 ? 1 : 0) }));
  assert.ok(worstHesitation(stalled) > 2.4);
  assert.equal(worstHesitation([{ onset: 0, at: 0 }, { onset: 480, at: 0.5 }]), null);
});

test('a reading that held together says so; one that stopped says that instead', () => {
  const beat = 0.5;
  const attacks = Array.from({ length: 9 }, (_, i) => ({ onset: i * 480, at: i * 0.5 }));
  const held = readingFluency({ deltas: Array(9).fill(0.03), attacks, beatSeconds: beat });
  assert.equal(held.steady, true);
  assert.equal(held.unbroken, true);
  const stopped = readingFluency({
    deltas: Array(9).fill(0.03),
    attacks: attacks.map((a, i) => ({ ...a, at: a.at + (i >= 5 ? 1.2 : 0) })),
    beatSeconds: beat,
  });
  assert.equal(stopped.unbroken, false);
  const nothing = readingFluency({ deltas: [], attacks: [], beatSeconds: beat });
  assert.deepEqual(nothing, { spread: null, hesitation: null, steady: null, unbroken: null });
});

test('the steady-pulse objective reads steadiness, and old takes still count', () => {
  const base = emptyProfile();
  const take = (extra) => ({
    scoringVersion: base.scoringVersion, at: Date.now(), level: 1, seed: 1,
    repeat: false, assisted: false, curtain: null, score: 90, continuity: 1,
    pitchAccuracy: 1, rhythmAccuracy: 1, notes: 20, meta: null, ...extra,
  });
  const uneven = { ...base, history: [take({ spread: 0.3, timing: 0 })] };
  const even = { ...base, history: [take({ spread: 0.05, timing: 0.2 })] };
  // A take recorded before any of this was measured keeps its old terms.
  const legacy = { ...base, history: [take({ timing: 0.01 })] };
  const steadyOf = (profile) => missionState(profile, 1).objectives.find((o) => o.id === 'steady').done;
  assert.equal(steadyOf(uneven), false, 'a cancelling bias must not read as steady');
  assert.equal(steadyOf(even), true);
  assert.equal(steadyOf(legacy), true, 'a cleared objective must not un-clear itself');
});

// ---------------------------------------------------------------------------
// Reading tempo
// ---------------------------------------------------------------------------

test('every level starts at its published tempo, inside its own band', () => {
  for (const level of LEVEL_IDS) {
    const [low, high] = tempoBand(level);
    const start = readingTempo(emptyProfile(), level);
    assert.equal(start, levelById(level).params.tempo);
    assert.ok(start >= low && start <= high, `level ${level} starts outside its own band`);
    assert.equal(paramsForLevel(level, emptyProfile(), { seed: 5, targeting: false }).tempo, start);
  }
});

test('reading well and unbroken asks for more speed; coming apart gives it back', () => {
  const at = (level, score, continuity) => ({
    scoringVersion: emptyProfile().scoringVersion, at: Date.now(), level, seed: 1,
    repeat: false, assisted: false, curtain: null, score, continuity, notes: 20, meta: null,
  });
  const withHistory = (takes) => ({ ...emptyProfile(), history: takes });
  const start = levelById(3).params.tempo;

  const cruising = withHistory(Array(3).fill(at(3, COMFORTABLE + 2, 1)));
  assert.equal(calibrate(cruising, 3)[3], start + STEP);

  // Accurate but stopping is not a reason to go faster.
  const stopStart = withHistory(Array(3).fill(at(3, COMFORTABLE + 2, 0.7)));
  assert.ok(calibrate(stopStart, 3)[3] < start);

  const struggling = withHistory(Array(3).fill(at(3, STRUGGLING - 10, 1)));
  assert.equal(calibrate(struggling, 3)[3], start - STEP);

  // One good reading is not evidence, and neither are two.
  const early = withHistory([at(3, 100, 1), at(3, 100, 1)]);
  assert.equal(readingTempo({ ...early, pacing: calibrate(early, 3) }, 3), start);

  // A level's band is a wall, not a suggestion.
  const [low, high] = tempoBand(3);
  const fast = { ...cruising, pacing: { 3: high } };
  assert.equal(calibrate(fast, 3)[3], high);
  const slow = { ...struggling, pacing: { 3: low } };
  assert.equal(calibrate(slow, 3)[3], low);
  assert.equal(pacingStanding(fast, 3).atCeiling, true);
});

test('only a clean first read is allowed to move the tempo', () => {
  const summary = {
    score: 100, total: 20, skills: {}, pitchAccuracy: 1, rhythmAccuracy: 1, continuity: 1,
    meanSignedTiming: 0, fluency: { spread: 0.02, hesitation: 1 },
  };
  const read = (profile, extra) => applyResult(profile, {
    level: 4, summary, seed: Math.random(), exerciseId: `x${Math.random()}`, elapsedSec: 30, ...extra,
  }).profile;

  let assisted = emptyProfile();
  for (let i = 0; i < 4; i += 1) assisted = read(assisted, { assisted: true });
  assert.equal(readingTempo(assisted, 4), levelById(4).params.tempo, 'help is not evidence of speed');

  let fresh = emptyProfile();
  for (let i = 0; i < 4; i += 1) fresh = read(fresh);
  assert.ok(readingTempo(fresh, 4) > levelById(4).params.tempo);
  assert.equal(fresh.history.at(-1).spread, 0.02, 'fluency is kept with the take');
  assert.equal(fresh.history.at(-1).hesitation, 1);
});

// ---------------------------------------------------------------------------
// Bringing a strand back round
// ---------------------------------------------------------------------------

test('a strand nothing has asked about in a long time weighs more', () => {
  const fresh = { rating: 0.6, attempts: 20, seenAtTake: 100 };
  const neglected = { rating: 0.6, attempts: 20, seenAtTake: 20 };
  assert.equal(staleness(fresh, 100), 1);
  assert.ok(staleness(neglected, 100) > staleness(fresh, 100));
  // Doubling is the ceiling, so weakness always outranks mere neglect.
  assert.equal(staleness({ seenAtTake: 0 }, 1000), 2);
  assert.ok(Math.pow(1 - 0.4, 2) * staleness(fresh, 100) > Math.pow(1 - 0.7, 2) * staleness(neglected, 100));
});

test('a level only ever targets something it can present', () => {
  const profile = { ...emptyProfile(), level: 2, totals: { takes: 60, notes: 0, minutes: 0 } };
  for (const skill of SKILLS) profile.skills[skill.id] = { rating: 0.4, attempts: 30, seenAtTake: 1 };
  for (const level of LEVEL_IDS) {
    const allowed = new Set(presentableSkills(level));
    for (const id of weakestSkills(profile, 4, { level }).map((skill) => skill.id)) {
      assert.ok(allowed.has(id), `${id} cannot appear at level ${level}`);
    }
    for (let seed = 1; seed <= 30; seed += 1) {
      const params = paramsForLevel(level, profile, { seed: seed * 7919 });
      for (const id of params.targeted) assert.ok(allowed.has(id), `level ${level} targeted ${id}`);
      assert.doesNotThrow(() => generateExercise(params));
    }
  }
  // Unfiltered, the same call still describes the whole reading picture.
  assert.ok(weakestSkills(profile, 20).length > weakestSkills(profile, 20, { level: 1 }).length);
});

test('a level always presents its own named focus when nothing is being targeted', () => {
  for (const level of LEVEL_IDS) {
    const params = paramsForLevel(level, emptyProfile(), { seed: level * 13, targeting: false });
    const named = levelById(level).focus.filter((id) => id.startsWith('rhythm.'));
    if (!named.length) continue;
    assert.ok(
      params.focusRhythmTags.length > 0,
      `level ${level} dropped its own focus with nothing else asked for`,
    );
  }
});
