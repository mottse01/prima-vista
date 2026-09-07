import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { emptyProfile, paramsForLevel } from '../src/core/adaptive.js';
import { generateExercise } from '../src/core/generator.js';
import { levelById } from '../src/core/levels.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/core/storage.js';
import { curtainMode } from '../src/core/curtain.js';

let server, Path, Onboarding, Practice, Result, Progress, Expedition, Debrief;
const noop = () => {};
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Expedition = (await server.ssrLoadModule('/src/components/ExpeditionView.jsx')).default;
  Debrief = (await server.ssrLoadModule('/src/components/ExpeditionDebrief.jsx')).default;
  Path = (await server.ssrLoadModule('/src/components/PathView.jsx')).default;
  Onboarding = (await server.ssrLoadModule('/src/components/OnboardingModal.jsx')).default;
  const practice = await server.ssrLoadModule('/src/components/PracticeView.jsx');
  Practice = practice.default;
  Result = practice.ResultPanel;
  Progress = (await server.ssrLoadModule('/src/components/ProgressView.jsx')).default;
});
after(async () => { await server?.close(); });
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const score = generateExercise(paramsForLevel(3, emptyProfile(), { seed: 54321 }));
const result = {
  score: 94, pitchAccuracy: 0.97, rhythmAccuracy: 0.96, continuity: 1,
  correct: 40, total: 41, attacksKept: 35, attackCount: 35, timedNotes: 40,
  timeline: [], meanSignedTiming: 0, recovery: null,
};
const resultProps = (overrides = {}) => ({
  result, score, focusIds: [], tempo: 76, curtain: curtainMode('off'),
  onAgain: noop, onNext: noop, onRepair: noop, onReflect: noop, onRepairHand: noop,
  ...overrides,
});

test('a scored take draws a star chart of the reading and offers the exact link', () => {
  const timeline = [
    { onset: 0, hand: 'rh', midi: 60, delta: 0.01, verdict: 'correct' },
    { onset: 48, hand: 'lh', midi: 43, delta: 0.2, verdict: 'timing' },
    { onset: 96, hand: 'rh', midi: 64, delta: null, verdict: 'missed' },
    { onset: 144, hand: 'rh', midi: 62, delta: null, verdict: 'wrong' },
  ];
  const html = render(Result, resultProps({
    result: { ...result, timeline, totalTicks: 192, window: 0.3, goodTiming: 0.1 },
  }));
  assert.match(html, /class="sr-trace"/);
  assert.match(html, /Time runs left to right, pitch bottom to top/);
  // Four attacks: one on time, one late, one never sounded, one wrong.
  assert.match(html, /sr-trace-missed/);
  assert.match(html, /sr-trace-wrong/);
  assert.match(html, /Challenge a friend/);
});

test('an unplayed take draws no star chart', () => {
  const html = render(Result, resultProps({ result: { ...result, timeline: [] } }));
  assert.doesNotMatch(html, /class="sr-trace"/);
});

test('Path shows all ten levels and opens only as far as the course has been earned', () => {
  for (const level of [1, 4, 10]) {
    // unlockedLevel is what the course opens to; a reader is placed there or
    // walks there by clearing destinations.
    const profile = { ...emptyProfile(), level, unlockedLevel: level };
    const html = render(Path, { profile, onPick: noop });
    assert.match(html, new RegExp(`Where you are · Level ${level}`));
    assert.equal((html.match(/class="sr-level is-/g) || []).length, 10, 'every level stays visible');
    assert.match(html, /<details class="sr-path-all"><summary>Explore all 10 levels/);
    assert.doesNotMatch(html, /Level 11|>Mastery</);
    assert.match(html, level === 10 ? /Keep exploring/ : new RegExp(`Explore next · Level ${level + 1}`));

    // Everything beyond the frontier is present, marked closed, and unusable.
    const closed = (html.match(/class="sr-level is-locked"/g) || []).length;
    assert.equal(closed, 10 - level, `level ${level} should close ${10 - level} destinations`);
    assert.equal((html.match(/disabled=""/g) || []).length, closed + (level === 10 ? 0 : 1));
  }
});

test('Path names what is standing in the way of the next destination', () => {
  const profile = { ...emptyProfile(), level: 1, unlockedLevel: 1 };
  const html = render(Path, { profile, onPick: noop });
  assert.match(html, /Three strong first reads to open/);
  assert.match(html, /The course is open through <strong>Luna<\/strong>/);
  // The way in for someone who already reads music.
  assert.match(html, /Recheck my level/);
});

test('selected Path level is not presented as demonstrated without evidence', () => {
  const profile = { ...emptyProfile(), level: 4 };
  assert.doesNotMatch(render(Path, { profile, onPick: noop }), /Shown in your first reads/);
  profile.demonstratedLevels = [4];
  assert.match(render(Path, { profile, onPick: noop }), /Shown in your first reads/);
});

test('onboarding keeps age-neutral choices, dismiss control and optional real music examples', () => {
  const html = render(Onboarding, { onChoose: noop, onDismiss: noop });
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.equal((html.match(/name="starting-level"/g) || []).length, 5);
  assert.match(html, /Close welcome and explore practice/);
  assert.match(html, /See music at level 1/);
  assert.match(html, /Your starting level · 1/);
  assert.doesNotMatch(html, /Provisional|Confident|date of birth|children.s mode/i);
});

test('practice exposes one difficulty slider, named actions and independent display preferences', () => {
  const props = { score, settings: DEFAULT_SETTINGS, level: levelById(3), midi: {}, freshRead: true };
  const html = render(Practice, props);
  assert.equal((html.match(/aria-label="Difficulty level"/g) || []).length, 1);
  assert.ok(html.indexOf('aria-label="Difficulty level"') < html.indexOf('<summary>Settings</summary>'));
  for (const label of ['Launch flight', 'New music', 'Listen', 'Preparation tips', 'Comfort view', 'Eclipse', '2-minute practice']) assert.ok(html.includes(label), label);
  assert.match(html, /30-second preparation/);
  assert.doesNotMatch(render(Practice, { ...props, settings: { ...DEFAULT_SETTINGS, preparationTips: false } }), /class="sr-btn sr-btn--ghost sr-prep-toggle"/);
  assert.match(render(Practice, { ...props, level: null }), /Custom exercise/);
});

test('coaching and next actions precede optional numerical detail', () => {
  const html = render(Result, resultProps());
  assert.ok(html.indexOf('sr-result-coach') < html.indexOf('sr-result-details'));
  assert.ok(html.indexOf('sr-result-actions') < html.indexOf('sr-result-details'));
  assert.match(html, /<details class="sr-result-details"><summary>/);
  assert.match(html, /You kept going through the music/);
  assert.match(html, /What would you like to practice next/);
  assert.doesNotMatch(html, /What broke first|Repair at/);
});

test('daily practice never labels a reading-ahead drill or assisted take as an independent first read', () => {
  const props = { score, level: levelById(3), midi: {}, freshRead: true, session: { minutes: 5, takes: 1 } };
  const drill = render(Practice, { ...props, settings: { ...DEFAULT_SETTINGS, curtain: 'played' } });
  assert.match(drill, /sr-statuspill[^>]*>Reading-ahead drill</);
  const assisted = render(Practice, { ...props, settings: { ...DEFAULT_SETTINGS, guideKeys: true } });
  assert.match(assisted, /sr-statuspill[^>]*>Practice only</);
});

test('invalid and acoustic reads never show a numerical assessment', () => {
  for (const special of [{ invalid: true }, { unscored: true }]) {
    const html = render(Result, resultProps({ result: special }));
    assert.doesNotMatch(html, /sr-bigscore|out of 100|sr-result-details/);
    assert.match(html, /<button/);
  }
});

test('placement, assisted and one-hand feedback retain their distinct actions and notices', () => {
  assert.match(render(Result, resultProps({ placement: { active: true } })), /Next level-check read/);
  assert.match(render(Result, resultProps({ placement: { complete: true, recommended: 2 } })), /Start at level 2/);
  assert.match(render(Result, resultProps({ assisted: true })), /cannot advance your level/);
  assert.match(render(Result, resultProps({ curtain: curtainMode('played') })), /does not move your constellation or level/);
  assert.doesNotMatch(render(Result, resultProps({ repairHand: 'rh' })), /Right hand only/);
  assert.match(render(Result, resultProps({ result: { ...result, score: 50, continuity: 0.5 } })), /Try again at 60 bpm/);
});

test('cumulative practice reads remain visible without an active streak', () => {
  const profile = emptyProfile();
  profile.totals.takes = 12;
  profile.totals.minutes = 30;
  const html = render(Progress, { profile });
  assert.match(html, /Completed practice reads/);
  assert.match(html, /30 minutes of playing/);
  assert.doesNotMatch(html, /0-day streak/);
});

test('preparation preferences persist independently of comfort and answer assistance', () => {
  const original = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  try {
    saveSettings({ preparationTips: false, comfortView: true, guideKeys: false });
    const settings = loadSettings();
    assert.equal(settings.preparationTips, false);
    assert.equal(settings.comfortView, true);
    assert.equal(settings.guideKeys, false);
    assert.equal(settings.curtain, 'off');
    assert.equal(settings.sessionMinutes, 0);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});


test('expedition opens on a real launch with ten accessible destination previews', () => {
  const html = render(Expedition, { profile: emptyProfile() });
  assert.match(html, /Launch mission/);
  assert.equal((html.match(/aria-pressed=/g) || []).length, 10);
  assert.match(html, /0 \/ 3 first reads/);
  assert.match(html, /three strong first reads open the route/);
  assert.match(html, /MIDI|Flight log|flight log/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('debrief celebrates a real unlock and does not invent one for rehearsal', async () => {
  const { missionState } = await import('../src/core/missions.js');
  const base = emptyProfile();
  const receipt = { level: 1, frontier: 1, eligible: false, before: missionState(base, 1) };
  const practice = render(Debrief, { profile: base, receipt });
  assert.doesNotMatch(practice, /NEW DESTINATION OPEN|Travel onward/);
  assert.match(practice, /fresh, unassisted reading/);
  const unlocked = render(Debrief, { profile: { ...base, unlockedLevel: 2 }, receipt: { ...receipt, eligible: true } });
  assert.match(unlocked, /Next stop: Mars/);
  assert.match(unlocked, /Travel onward/);
});
