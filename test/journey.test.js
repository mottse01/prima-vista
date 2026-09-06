import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyProfile } from '../src/core/adaptive.js';
import { LEVELS } from '../src/core/levels.js';
import {
  SCENE_RADIUS, WAYPOINTS, bodyRadius, journeyProgress, journeyState, orbitAngle, orbitPosition,
  orbitRadius, waypointFor,
} from '../src/core/journey.js';

test('one waypoint per level, ordered outward from the Sun', () => {
  assert.equal(WAYPOINTS.length, LEVELS.length);
  WAYPOINTS.forEach((waypoint, index) => {
    assert.equal(waypoint.level, index + 1);
    assert.ok(waypoint.name && waypoint.note && waypoint.fact);
    if (index > 0) {
      assert.ok(
        waypoint.au > WAYPOINTS[index - 1].au,
        `${waypoint.name} is not further out than ${WAYPOINTS[index - 1].name}`,
      );
    }
  });
  assert.equal(waypointFor(1).name, 'Luna');
  assert.equal(waypointFor(99).level, LEVELS.length);
});

test('the scene compresses distance and size without ever reordering them', () => {
  // A true-scale system is unusable — the heliopause is 120 times Luna's
  // orbit — but compression must never put a nearer body further out.
  for (let index = 1; index < WAYPOINTS.length; index++) {
    assert.ok(orbitRadius(WAYPOINTS[index].au) > orbitRadius(WAYPOINTS[index - 1].au));
  }
  assert.ok(orbitRadius(WAYPOINTS[0].au) > 1, 'the innermost waypoint must clear the Sun');
  assert.equal(Math.round(orbitRadius(WAYPOINTS.at(-1).au)), SCENE_RADIUS);

  const sizes = [...WAYPOINTS]
    .filter((waypoint) => waypoint.radius)
    .sort((a, b) => a.radius - b.radius)
    .map((waypoint) => bodyRadius(waypoint.radius));
  for (let index = 1; index < sizes.length; index++) {
    assert.ok(sizes[index] > sizes[index - 1], 'a bigger body must be drawn bigger');
  }
  // Jupiter is 148 times Ceres in reality and must not be on screen.
  assert.ok(bodyRadius(69911) / bodyRadius(473) < 3);
});

test('bodies keep a fixed arrangement and move at their own real rate', () => {
  const mars = waypointFor(2);
  const neptune = waypointFor(7);
  assert.equal(orbitAngle(mars, 0), orbitAngle(mars, 0), 'the opening arrangement is fixed');
  assert.notEqual(orbitAngle(mars, 0), orbitAngle(neptune, 0), 'bodies do not stack on one ray');

  const marsMoved = Math.abs(orbitAngle(mars, 10) - orbitAngle(mars, 0));
  const neptuneMoved = Math.abs(orbitAngle(neptune, 10) - orbitAngle(neptune, 0));
  assert.ok(marsMoved > neptuneMoved * 50, 'Mars must visibly outrun Neptune');

  const [x, y, z] = orbitPosition(mars, 3);
  assert.equal(y, 0, 'bodies sit in the ecliptic plane');
  assert.ok(Math.abs(Math.hypot(x, z) - orbitRadius(mars.au)) < 1e-9);
});

test('a region has no orbit of its own to travel along', () => {
  for (const waypoint of WAYPOINTS.filter((item) => !item.period)) {
    assert.equal(orbitAngle(waypoint, 0), orbitAngle(waypoint, 500), `${waypoint.name} should not orbit`);
  }
});

test('the journey reports where a reader has been, and locks nothing', () => {
  const fresh = journeyState(emptyProfile());
  assert.ok(fresh.every((waypoint) => !waypoint.reached && !waypoint.visited));
  assert.equal(fresh.filter((waypoint) => waypoint.current).length, 1);
  assert.equal(journeyProgress(emptyProfile()).furthest.level, 1);

  const travelled = {
    ...emptyProfile(),
    level: 4,
    demonstratedLevels: [1, 2],
    history: [{ level: 1 }, { level: 2 }, { level: 3 }],
  };
  const state = journeyState(travelled);
  assert.deepEqual(state.filter((item) => item.reached).map((item) => item.name), ['Luna', 'Mars']);
  assert.equal(state.find((item) => item.current).name, 'Jupiter');
  const progress = journeyProgress(travelled);
  assert.equal(progress.reached, 2);
  assert.equal(progress.furthest.name, 'Ceres', 'furthest reached counts a read, not a pass');
  assert.equal(progress.current.name, 'Jupiter');
});
