// Exact exercise sharing.
//
// A seed only reproduces music when every generator parameter is also the
// same. The short seed remains useful inside one setup, while shared links carry
// a compact, versioned parameter payload so they truly open identical music.

import { DEFAULT_PARAMS } from './generator.js';
import { seedToCode } from './rng.js';

const EXTRA_KEYS = new Set(['level', 'targeted', 'focusRhythmTags', 'focusIntervals']);
const ALLOWED_KEYS = new Set([...Object.keys(DEFAULT_PARAMS), ...EXTRA_KEYS]);
const ARRAY_KEYS = new Set(['rhythmTags', 'cells', 'lhCells', 'targeted', 'focusRhythmTags', 'focusIntervals']);
const ENUMS = {
  keyMode: new Set(['major', 'minor']),
  hands: new Set(['both', 'rh', 'lh']),
  timeSignature: new Set(['4/4', '3/4', '2/4', '5/4', '2/2', '3/8', '6/8', '9/8', '12/8']),
  lhStyle: new Set(['roots', 'blocked', 'alberti', 'broken', 'waltz', 'sustained', 'melodic']),
  compositionStyle: new Set(['auto', 'classical', 'folk', 'pop', 'blues', 'waltz']),
};
const BOUNDS = {
  keyFifths: [-7, 7], measures: [1, 32], tempo: [30, 200],
  rhLow: [0, 70], rhHigh: [0, 70], lhLow: [0, 70], lhHigh: [0, 70],
  maxLeap: [1, 12], stepwiseBias: [0, 1], nonChordRate: [0, 1],
  chromaticRate: [0, 1], chordsPerMeasure: [1, 2], restRate: [0, 1],
  level: [1, 20],
};
const INTEGER_KEYS = new Set([
  'keyFifths', 'measures', 'rhLow', 'rhHigh', 'lhLow', 'lhHigh', 'maxLeap', 'chordsPerMeasure', 'level',
]);

function primitiveArray(value) {
  if (!Array.isArray(value) || value.length > 32) return null;
  const clean = value.filter((v) =>
    (typeof v === 'string' && v.length <= 48) || (typeof v === 'number' && Number.isFinite(v)));
  return clean.length === value.length ? clean : null;
}

/** Keep only bounded generator values before placing parameters in a URL. */
export function cleanExerciseParams(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const key of [...ALLOWED_KEYS].sort()) {
    if (!(key in input)) continue;
    const value = input[key];
    if (ARRAY_KEYS.has(key)) {
      const clean = value == null && (key === 'cells' || key === 'lhCells') ? null : primitiveArray(value);
      if (clean !== null || value === null) out[key] = clean;
      continue;
    }
    if (ENUMS[key]) {
      if (ENUMS[key].has(value)) out[key] = value;
      continue;
    }
    if (BOUNDS[key]) {
      if (!Number.isFinite(value)) continue;
      const [min, max] = BOUNDS[key];
      const bounded = Math.max(min, Math.min(max, value));
      out[key] = INTEGER_KEYS.has(key) ? Math.round(bounded) : bounded;
      continue;
    }
    if (typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 6000) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeExerciseParams(params) {
  const clean = cleanExerciseParams(params);
  if (!clean) return null;
  return toBase64Url(JSON.stringify({ v: 1, p: clean }));
}

export function decodeExerciseParams(payload) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(payload));
    if (parsed?.v !== 1) return null;
    return cleanExerciseParams(parsed.p);
  } catch {
    return null;
  }
}

/** Stable identity for repeat detection across custom setups and shared links. */
export function exerciseFingerprint(params, seed) {
  const clean = cleanExerciseParams(params) || {};
  // These values change the presentation or explain how the exercise was
  // chosen, but they do not change its pitches or rhythms. Slowing a familiar
  // excerpt down must never launder it into a new first read.
  const {
    level: _level,
    targeted: _targeted,
    tempo: _tempo,
    dynamics: _dynamics,
    articulations: _articulations,
    slurs: _slurs,
    fingerings: _fingerings,
    ...musicalParams
  } = clean;
  const text = JSON.stringify(musicalParams);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${seedToCode(seed)}:${(hash >>> 0).toString(36)}`;
}

export function exactExerciseUrl(score, href) {
  const url = new URL(href);
  url.search = '';
  url.searchParams.set('x', seedToCode(score.seed));
  const payload = encodeExerciseParams(score.params);
  if (payload) url.searchParams.set('p', payload);
  return url;
}
