// The journey outward.
//
// Ten reading levels are ten places, ordered by how far they are from the Sun,
// so the ladder has a direction you can point at. Everything here is real: the
// distances are in astronomical units, the radii in kilometres, and the orbital
// periods in years. The scene compresses all three — a true-scale solar system
// is mostly empty space and Jupiter is a hundred and fifty times Ceres — but it
// compresses them monotonically, so what is further away is drawn further away
// and what is bigger is drawn bigger.

import { LEVELS } from './levels.js';

/**
 * `au`      mean distance from the Sun, in astronomical units
 * `radius`  equatorial radius in kilometres, or null for a region
 * `period`  orbital period in years, or null for a region
 */
export const WAYPOINTS = [
  {
    level: 1,
    name: 'Luna',
    kind: 'moon',
    au: 1,
    radius: 1737,
    period: 1,
    colour: '#cfd3dc',
    note: 'The nearest light there is',
    fact: 'Close enough that its light takes 1.3 seconds to reach you.',
  },
  {
    level: 2,
    name: 'Mars',
    kind: 'planet',
    au: 1.52,
    radius: 3390,
    period: 1.88,
    colour: '#c15a3c',
    note: 'Dust storms that cover a planet',
    fact: 'A day there is 24 hours and 37 minutes long.',
  },
  {
    level: 3,
    name: 'Ceres',
    kind: 'dwarf',
    au: 2.77,
    radius: 473,
    period: 4.6,
    colour: '#9c968c',
    note: 'Largest body in the asteroid belt',
    fact: 'It holds about a quarter of the belt’s entire mass.',
  },
  {
    level: 4,
    name: 'Jupiter',
    kind: 'planet',
    au: 5.2,
    radius: 69911,
    period: 11.86,
    colour: '#d8a970',
    note: 'A storm wider than Earth',
    fact: 'It turns once in under ten hours, faster than any other planet.',
  },
  {
    level: 5,
    name: 'Saturn',
    kind: 'planet',
    au: 9.58,
    radius: 58232,
    period: 29.45,
    colour: '#e3d2a4',
    note: 'Rings a garden telescope can find',
    ring: [1.32, 1.92],
    fact: 'The rings are only tens of metres thick.',
  },
  {
    level: 6,
    name: 'Uranus',
    kind: 'planet',
    au: 19.19,
    radius: 25362,
    period: 84.02,
    colour: '#93d8e4',
    note: 'Rolling on its side',
    tilt: 1.71,
    ring: [1.7, 2.0],
    fact: 'Its axis is tipped 98 degrees, so it orbits lying down.',
  },
  {
    level: 7,
    name: 'Neptune',
    kind: 'planet',
    au: 30.07,
    radius: 24622,
    period: 164.8,
    colour: '#4a6fd4',
    note: 'Found with mathematics before a lens',
    fact: 'Predicted from Uranus’s wobble, then found the first night anyone looked.',
  },
  {
    level: 8,
    name: 'Pluto',
    kind: 'dwarf',
    au: 39.48,
    radius: 1188,
    period: 248,
    colour: '#d6c3aa',
    note: 'A heart of nitrogen ice',
    fact: 'Sputnik Planitia is a frozen plain the size of Texas.',
  },
  {
    level: 9,
    name: 'The Kuiper Belt',
    kind: 'field',
    au: 45,
    radius: null,
    period: null,
    colour: '#8fa3c4',
    note: 'Where the map stops being crowded',
    fact: 'A ring of icy bodies running roughly from 30 to 50 astronomical units.',
  },
  {
    level: 10,
    name: 'The Heliopause',
    kind: 'boundary',
    au: 120,
    radius: null,
    period: null,
    colour: '#6ee0d0',
    note: 'The edge of the Sun’s reach',
    fact: 'Voyager 1 crossed it in 2012, about 121 astronomical units out.',
  },
];

export const waypointFor = (level) => (
  WAYPOINTS[Math.max(0, Math.min(WAYPOINTS.length - 1, level - 1))]
);

// ---------------------------------------------------------------------------
// Scene geometry
// ---------------------------------------------------------------------------

/** Where the outermost waypoint sits in scene units. */
export const SCENE_RADIUS = 62;
const FURTHEST = WAYPOINTS[WAYPOINTS.length - 1].au;
const LARGEST = 69911;

/**
 * Distance from the Sun in scene units.
 *
 * A power curve rather than a logarithm: it keeps the inner planets from
 * piling onto the Sun while still fitting a hundred and twenty astronomical
 * units on one screen, and it never reorders two waypoints.
 */
export function orbitRadius(au) {
  return (au ** 0.55 / FURTHEST ** 0.55) * SCENE_RADIUS;
}

/** Drawn radius. Compressed hard, because Jupiter is 148 times Ceres. */
export function bodyRadius(km) {
  if (!km) return 0.5;
  return 0.34 + 1.06 * (km / LARGEST) ** 0.35;
}

/**
 * Where a body sits on its orbit at a given moment.
 *
 * Phase is seeded from the level so the system has a fixed, recognisable
 * arrangement rather than a different one on every visit, and each body moves
 * at its own real rate: Mars laps Neptune's crawl about ninety times over.
 */
export function orbitAngle(waypoint, seconds = 0) {
  const phase = (waypoint.level * 2.39996) % (Math.PI * 2);
  if (!waypoint.period) return phase;
  // One Earth year every twelve seconds keeps the inner system visibly alive
  // without making the outer planets look stationary.
  return phase + (seconds / 12) * (Math.PI * 2) / waypoint.period;
}

export function orbitPosition(waypoint, seconds = 0) {
  const angle = orbitAngle(waypoint, seconds);
  const distance = orbitRadius(waypoint.au);
  return [Math.cos(angle) * distance, 0, Math.sin(angle) * distance];
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * Journey state for each waypoint.
 *
 * Nothing here locks anything: a reader can travel to any level at any time,
 * which is the app's own rule. `reached` means the level has been demonstrated
 * with real first reads, and `visited` means it has been read at all.
 */
export function journeyState(profile) {
  const demonstrated = new Set(profile?.demonstratedLevels || []);
  const visited = new Set((profile?.history || []).map((take) => take.level).filter(Boolean));
  return WAYPOINTS.map((waypoint) => ({
    ...waypoint,
    definition: LEVELS.find((item) => item.id === waypoint.level) || null,
    current: waypoint.level === (profile?.level || 1),
    reached: demonstrated.has(waypoint.level),
    visited: visited.has(waypoint.level),
  }));
}

/** How far out the reader has actually been, as a fraction of the journey. */
export function journeyProgress(profile) {
  const state = journeyState(profile);
  const reached = state.filter((waypoint) => waypoint.reached).length;
  const furthest = state.filter((waypoint) => waypoint.visited || waypoint.reached).at(-1);
  return {
    reached,
    total: state.length,
    furthest: furthest || state[0],
    current: state.find((waypoint) => waypoint.current) || state[0],
  };
}
