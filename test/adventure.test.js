import test from 'node:test';
import assert from 'node:assert/strict';
import { completePuzzle, emptyAdventure, LOCATIONS, pianoRelaySolved, receiveTone, roomComplete, roomState, toggleCircuit, travel } from '../src/core/adventure.js';

test('every room circuit can be solved from its starting state', () => {
  for (const location of LOCATIONS) {
    let found = false;
    for (let mask = 0; mask < 8; mask++) {
      let circuit = [false, false, false];
      for (let bit = 0; bit < 3; bit++) if (mask & (1 << bit)) circuit = toggleCircuit(circuit, bit);
      if (circuit.every((lamp, i) => lamp === location.power[i])) found = true;
    }
    assert.equal(found, true, `${location.name} must be solvable`);
  }
});

test('receivers reset on a wrong tone and accept the full signature in order', () => {
  for (const location of LOCATIONS) {
    let received = [];
    for (let i = 0; i < location.clue.length; i++) {
      const response = receiveTone(location.clue, received, location.clue[i]);
      assert.equal(response.matched, i === location.clue.length - 1);
      received = response.notes;
    }
    assert.deepEqual(receiveTone(location.clue, [], 99), { notes: [], matched: false });
  }
});

test('airlock requires all three systems and preserves rooms already solved', () => {
  let state = emptyAdventure();
  assert.equal(travel(state), state);
  assert.equal(completePuzzle(state, 'music'), state);
  assert.equal(completePuzzle(state, 'signal'), state);
  state = completePuzzle(state, 'power');
  assert.equal(roomComplete(state), false);
  assert.equal(travel(state), state);
  state = completePuzzle(state, 'signal');
  assert.equal(travel(state), state);
  state = completePuzzle(state, 'music');
  assert.equal(roomComplete(state), true);
  const next = travel(state);
  assert.equal(next.current, 1);
  assert.equal(roomComplete(next, 0), true);
  assert.deepEqual(roomState(next), { power: false, signal: false, music: false });
});

test('all ten locations are traversable with no destination beyond the ending', () => {
  let state = emptyAdventure();
  for (let i = 0; i < LOCATIONS.length; i++) {
    assert.equal(state.current, i);
    for (const puzzle of ['power','signal','music']) state = completePuzzle(state, puzzle);
    state = travel(state);
  }
  assert.equal(state.current, 9);
  assert.equal(travel(state), state);
});

test('story piano threshold allows rehearsal but rejects invalid or unscored assessment', () => {
  assert.equal(pianoRelaySolved({ score: 70, valid: true, assisted: true }), true);
  assert.equal(pianoRelaySolved({ score: 69 }), false);
  assert.equal(pianoRelaySolved({ score: 100, valid: false }), false);
  assert.equal(pianoRelaySolved({ score: 100, unscored: true }), false);
  assert.equal(pianoRelaySolved({ score: 100, assessmentEligible: false }), false);
  assert.equal(pianoRelaySolved({}), false);
});
