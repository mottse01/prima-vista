// Rhythm vocabulary.
//
// A "cell" is one metric unit's worth of rhythm — the building block levels are
// defined in terms of. Durations are in ticks (TPQ = 48 per quarter).

import { TPQ } from './theory.js';

const Q = TPQ;            // 48
const E = TPQ / 2;        // 24
const S = TPQ / 4;        // 12
const T8 = TPQ / 3;       // 16 — triplet eighth

const n = (d) => ({ d, rest: false });
const r = (d) => ({ d, rest: true });

/**
 * Simple-metre cells. `beats` counts quarter-note beats consumed.
 * `tags` drive both level gating and the weakness diagnostics.
 */
export const SIMPLE_CELLS = [
  { id: 'q', label: 'quarter', beats: 1, events: [n(Q)], tags: ['quarter'] },
  { id: 'h', label: 'half', beats: 2, events: [n(2 * Q)], tags: ['half'] },
  { id: 'w', label: 'whole', beats: 4, events: [n(4 * Q)], tags: ['whole'] },
  { id: 'qr', label: 'quarter rest', beats: 1, events: [r(Q)], tags: ['rest'] },
  { id: 'ee', label: 'two eighths', beats: 1, events: [n(E), n(E)], tags: ['eighth'] },
  { id: 'er', label: 'eighth + rest', beats: 1, events: [n(E), r(E)], tags: ['eighth', 'rest'] },
  { id: 're', label: 'rest + eighth', beats: 1, events: [r(E), n(E)], tags: ['eighth', 'rest', 'offbeat'] },
  { id: 'dqe', label: 'dotted quarter + eighth', beats: 2, events: [n(Q + E), n(E)], tags: ['dotted', 'offbeat'] },
  { id: 'edq', label: 'eighth + dotted quarter', beats: 2, events: [n(E), n(Q + E)], tags: ['dotted', 'syncopation'] },
  { id: 'eqe', label: 'syncopated eighth-quarter-eighth', beats: 2, events: [n(E), n(Q), n(E)], tags: ['syncopation'] },
  { id: 'ssss', label: 'four sixteenths', beats: 1, events: [n(S), n(S), n(S), n(S)], tags: ['sixteenth'] },
  { id: 'ess', label: 'eighth + two sixteenths', beats: 1, events: [n(E), n(S), n(S)], tags: ['sixteenth'] },
  { id: 'sse', label: 'two sixteenths + eighth', beats: 1, events: [n(S), n(S), n(E)], tags: ['sixteenth'] },
  { id: 'des', label: 'dotted eighth + sixteenth', beats: 1, events: [n(E + S), n(S)], tags: ['sixteenth', 'dotted'] },
  { id: 'sde', label: 'sixteenth + dotted eighth', beats: 1, events: [n(S), n(E + S)], tags: ['sixteenth', 'dotted', 'syncopation'] },
  { id: 'trip', label: 'eighth triplet', beats: 1, events: [n(T8), n(T8), n(T8)], tags: ['triplet'] },
  { id: 'hr', label: 'half rest', beats: 2, events: [r(2 * Q)], tags: ['rest'] },
];

/** Compound-metre cells. One "beat" here is a dotted quarter. */
export const COMPOUND_CELLS = [
  { id: 'cdq', label: 'dotted quarter', beats: 1, events: [n(3 * E)], tags: ['quarter'] },
  { id: 'ceee', label: 'three eighths', beats: 1, events: [n(E), n(E), n(E)], tags: ['eighth'] },
  { id: 'cqe', label: 'quarter + eighth', beats: 1, events: [n(2 * E), n(E)], tags: ['eighth'] },
  { id: 'ceq', label: 'eighth + quarter', beats: 1, events: [n(E), n(2 * E)], tags: ['eighth', 'syncopation'] },
  { id: 'cer', label: 'eighth rest + two eighths', beats: 1, events: [r(E), n(E), n(E)], tags: ['rest', 'offbeat'] },
  { id: 'cdh', label: 'dotted half', beats: 2, events: [n(6 * E)], tags: ['half'] },
  { id: 'cssee', label: 'two sixteenths + two eighths', beats: 1, events: [n(S), n(S), n(E), n(E)], tags: ['sixteenth'] },
];

// Attach the meter each cell belongs to and its total length in ticks, so the
// generator can fill measures by duration rather than by an assumed beat.
for (const c of SIMPLE_CELLS) { c.meter = 'simple'; c.ticks = c.events.reduce((a, e) => a + e.d, 0); }
for (const c of COMPOUND_CELLS) { c.meter = 'compound'; c.ticks = c.events.reduce((a, e) => a + e.d, 0); }

const byId = new Map([...SIMPLE_CELLS, ...COMPOUND_CELLS].map((c) => [c.id, c]));
export const getCell = (id) => byId.get(id);

/** Tags a user can switch on or off. Others are descriptive only. */
export const GATEABLE_TAGS = new Set(['eighth', 'rest', 'dotted', 'syncopation', 'sixteenth', 'triplet']);

/** Cells that are always available, so a measure can always be filled. */
const BASE_CELLS = { simple: ['q', 'h', 'w'], compound: ['cdq', 'cdh'] };

/**
 * Resolve a set of enabled rhythm tags into the concrete cells legal for this
 * meter. Levels and the custom panel both speak in tags; only the generator
 * needs cell ids.
 */
export function resolveCells(allowedTags, ts) {
  const meter = ts.compound ? 'compound' : 'simple';
  const pool = ts.compound ? COMPOUND_CELLS : SIMPLE_CELLS;
  const allowed = new Set(allowedTags || []);
  const base = BASE_CELLS[meter];
  const ids = pool
    .filter((c) => base.includes(c.id)
      || c.tags.filter((t) => GATEABLE_TAGS.has(t)).every((t) => allowed.has(t)))
    .filter((c) => c.ticks <= ts.ticks)
    .map((c) => c.id);
  return ids.length ? ids : base.filter((id) => byId.get(id).ticks <= ts.ticks);
}

/** Every tag that appears in the vocabulary, for the diagnostics grid. */
export const ALL_RHYTHM_TAGS = [
  'quarter', 'half', 'whole', 'eighth', 'rest', 'dotted',
  'syncopation', 'sixteenth', 'triplet', 'offbeat',
];

// ---------------------------------------------------------------------------
// Time signatures
// ---------------------------------------------------------------------------

export const TIME_SIGNATURES = {
  // In common time, short values beam by quarter-note beat. This keeps the
  // pulse legible and prevents long, ambiguous runs across beats two and three.
  '4/4': { num: 4, den: 4, compound: false, beat: Q, beats: 4, beamGroup: Q, strong: [0, 2 * Q] },
  '3/4': { num: 3, den: 4, compound: false, beat: Q, beats: 3, beamGroup: Q, strong: [0] },
  '2/4': { num: 2, den: 4, compound: false, beat: Q, beats: 2, beamGroup: Q, strong: [0] },
  '5/4': { num: 5, den: 4, compound: false, beat: Q, beats: 5, beamGroup: Q, strong: [0, 3 * Q] },
  '2/2': { num: 2, den: 2, compound: false, beat: 2 * Q, beats: 2, beamGroup: 2 * Q, strong: [0] },
  '3/8': { num: 3, den: 8, compound: true, beat: 3 * E, beats: 1, beamGroup: 3 * E, strong: [0] },
  '6/8': { num: 6, den: 8, compound: true, beat: 3 * E, beats: 2, beamGroup: 3 * E, strong: [0] },
  '9/8': { num: 9, den: 8, compound: true, beat: 3 * E, beats: 3, beamGroup: 3 * E, strong: [0] },
  '12/8': { num: 12, den: 8, compound: true, beat: 3 * E, beats: 4, beamGroup: 3 * E, strong: [0, 6 * E] },
};

export function timeSig(name) {
  const t = TIME_SIGNATURES[name] || TIME_SIGNATURES['4/4'];
  return { name, ...t, ticks: t.beat * t.beats };
}

/** Metric weight of an offset inside a measure: 2 downbeat, 1 beat, 0 off-beat. */
export function metricWeight(ts, offset) {
  if (offset === 0) return 2;
  if (ts.strong.includes(offset)) return 2;
  if (offset % ts.beat === 0) return 1;
  return 0;
}
