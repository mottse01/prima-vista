import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, homeTabFor, isMode, modeOf, otherMode, showsChrome, tabsFor } from '../src/core/modes.js';
import { DEFAULT_SETTINGS } from '../src/core/storage.js';

test('nobody has a mode until they choose one', () => {
  assert.equal(DEFAULT_SETTINGS.mode, null);
  assert.equal(modeOf(DEFAULT_SETTINGS), null);
  assert.equal(modeOf({}), null);
  assert.equal(modeOf(undefined), null);
  // A value from a future build, or a corrupted one, is the same as no answer:
  // ask again rather than land somewhere that does not exist.
  assert.equal(modeOf({ mode: 'orchestra' }), null);
  assert.equal(isMode('orchestra'), false);
});

test('both modes describe themselves and land somewhere real', () => {
  assert.equal(MODES.length, 2);
  for (const mode of MODES) {
    assert.ok(mode.id && mode.name && mode.tagline);
    assert.ok(mode.blurb.length > 40, `${mode.id} needs to say what it is`);
    assert.ok(mode.forWhom.length > 20, `${mode.id} needs to say who it is for`);
    assert.equal(homeTabFor(mode.id), mode.home);
    assert.equal(modeOf({ mode: mode.id }).id, mode.id);
  }
  assert.deepEqual(MODES.map((mode) => mode.id).sort(), ['expedition', 'practice']);
});

test('the expedition is the whole screen; practice has a tab bar', () => {
  // The station's own menu is its navigation. A tab bar beside it would be a
  // second one competing with the first.
  assert.deepEqual(tabsFor('expedition'), []);
  assert.equal(showsChrome('expedition', 'adventure'), false);

  const practice = tabsFor('practice').map((tab) => tab.id);
  assert.ok(practice.includes('practice'), 'the piano is the point of this room');
  assert.ok(practice.includes('custom'));
  assert.ok(practice.includes('progress'));
  assert.equal(practice.includes('adventure'), false, 'no station tab in the practice room');
  assert.equal(new Set(practice).size, practice.length, 'no tab appears twice');
  for (const tab of tabsFor('practice')) assert.ok(tab.label && tab.short);
});

test('a mode always lands on its own home, and the other mode is the other one', () => {
  assert.equal(homeTabFor('expedition'), 'adventure');
  assert.equal(homeTabFor('practice'), 'practice');
  assert.equal(otherMode('expedition').id, 'practice');
  assert.equal(otherMode('practice').id, 'expedition');
  // An unknown id still has to answer, rather than leaving a reader nowhere.
  assert.ok(homeTabFor('nonsense'));
  assert.ok(otherMode('nonsense').id);
});

test('the practice room lands on its own tab list', () => {
  const home = homeTabFor('practice');
  assert.ok(tabsFor('practice').some((tab) => tab.id === home), 'the home tab must be reachable');
});
