import { isChordTone, keyAlterations, tonicLetter } from './theory.js';
import { stylePack } from './stylePacks.js';

const round = (value) => Math.round(value * 1000) / 1000;

function leadNotes(score) {
  const staff = score.staves.rh.some((note) => !note.rest) ? score.staves.rh : score.staves.lh;
  return staff.filter((note) => !note.rest && note.pitches.length).sort((a, b) => a.onset - b.onset);
}

function unitNotes(score, unit) {
  const from = unit.bars[0] * score.ts.ticks;
  const to = (unit.bars[1] + 1) * score.ts.ticks;
  return leadNotes(score).filter((note) => note.onset >= from && note.onset < to);
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function unitSignature(score, unit) {
  const notes = unitNotes(score, unit);
  const firstOnset = unit.bars[0] * score.ts.ticks;
  const rhythm = notes.map((note) => `${note.onset - firstOnset}:${note.duration}`);
  // Preserve interval size as well as direction. A rising second and a rising
  // octave are not the same contour simply because both point upward.
  const intervals = notes.slice(1).map((note, index) => {
    const value = note.pitches[0].dia - notes[index].pitches[0].dia;
    return Math.max(-7, Math.min(7, value));
  });
  return { rhythm, intervals };
}

function similarity(a, b) {
  const rhythmDistance = levenshtein(a.rhythm, b.rhythm) / Math.max(1, a.rhythm.length, b.rhythm.length);
  const contourDistance = levenshtein(a.intervals, b.intervals) / Math.max(1, a.intervals.length, b.intervals.length);
  return Math.max(0, 1 - rhythmDistance * 0.55 - contourDistance * 0.45);
}

export function coherenceScore(score) {
  const units = score.form.units || [];
  const signatures = units.map((unit) => unitSignature(score, unit));
  const values = [];
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) values.push(similarity(signatures[i], signatures[j]));
  }
  const related = units.slice(1)
    .map((unit, index) => ({ unit, value: similarity(signatures[0], signatures[index + 1]) }))
    .filter(({ unit }) => ['exact', 'transpose_diatonic', 'reharmonize'].includes(unit.transform))
    .map(({ value }) => value);
  const selected = related.length ? related : values;
  return selected.length ? selected.reduce((sum, value) => sum + value, 0) / selected.length : 1;
}

function accidentalCount(score) {
  const signature = keyAlterations(score.key.fifths);
  return [...score.staves.rh, ...score.staves.lh]
    .filter((note) => !note.rest)
    .flatMap((note) => note.pitches)
    .filter((pitch) => pitch.alter !== signature[pitch.letter]).length;
}

const STAFF_LIMITS = {
  rh: [30, 38], // E4–F5, the five treble-clef staff lines
  lh: [18, 26], // G2–A3, the five bass-clef staff lines
};

/** Number of ledger lines needed for an absolute diatonic staff position. */
export function ledgerLines(hand, dia) {
  const [low, high] = STAFF_LIMITS[hand];
  if (dia < low) return Math.floor((low - dia) / 2);
  if (dia > high) return Math.floor((dia - high) / 2);
  return 0;
}

function melodicStaffs(score) {
  if (score.params.hands === 'lh') return ['lh'];
  if (score.params.hands === 'both' && score.params.lhStyle === 'melodic') return ['rh', 'lh'];
  return ['rh'];
}

function melodicIntervalErrors(score, constraints) {
  const errors = [];
  for (const hand of melodicStaffs(score)) {
    const notes = (score.staves[hand] || [])
      .filter((note) => !note.rest && note.pitches.length)
      .sort((a, b) => a.onset - b.onset);
    for (let index = 1; index < notes.length; index++) {
      const size = Math.abs(notes[index].pitches[0].dia - notes[index - 1].pitches[0].dia) + 1;
      if (size > constraints.max_melodic_interval) {
        errors.push(`${hand} exceeds the melodic-interval cap`);
        break;
      }
    }
  }
  return errors;
}

/** Count five-finger-window changes rather than treating every leap as a shift. */
function handShifts(score, hand) {
  const notes = (score.staves[hand] || [])
    .filter((note) => !note.rest && note.pitches.length)
    .sort((a, b) => a.onset - b.onset)
    .map((note) => note.pitches[0].dia);
  if (!notes.length) return 0;
  const span = Math.max(...notes) - Math.min(...notes) + 1;
  return Math.max(0, Math.ceil(span / 5) - 1);
}

const TEXTURE_IDS = {
  roots: 'root_fifth', blocked: 'block_chord', sustained: 'block_chord',
  alberti: 'alberti', broken: 'broken_octave', waltz: 'stride', melodic: 'contrapuntal',
};

function coverageErrors(score, hand, staff) {
  const errors = [];
  for (let bar = 0; bar < score.measures; bar++) {
    const from = bar * score.ts.ticks;
    const to = from + score.ts.ticks;
    const events = staff
      .filter((event) => event.onset >= from && event.onset < to)
      .sort((a, b) => a.onset - b.onset);
    if (!events.length) {
      errors.push(`${hand} bar ${bar + 1} is empty`);
      continue;
    }
    let cursor = from;
    for (const event of events) {
      if (event.onset !== cursor) {
        errors.push(`${hand} bar ${bar + 1} has a ${event.onset < cursor ? 'overlap' : 'gap'}`);
        break;
      }
      if (!Number.isFinite(event.duration) || event.duration <= 0) {
        errors.push(`${hand} bar ${bar + 1} has a non-positive duration`);
        break;
      }
      cursor = event.onset + event.duration;
    }
    if (cursor !== to) errors.push(`${hand} bar ${bar + 1} has an invalid duration`);
  }
  return errors;
}

function simultaneousCollision(score) {
  const rh = score.staves.rh.filter((event) => !event.rest && event.pitches.length);
  const lh = score.staves.lh.filter((event) => !event.rest && event.pitches.length);
  for (const right of rh) {
    const rightLow = Math.min(...right.pitches.map((pitch) => pitch.midi));
    for (const left of lh) {
      const overlaps = right.onset < left.onset + left.duration && left.onset < right.onset + right.duration;
      if (!overlaps) continue;
      const leftHigh = Math.max(...left.pitches.map((pitch) => pitch.midi));
      if (leftHigh >= rightLow) return true;
    }
  }
  return false;
}

function outerParallelCount(score) {
  if (score.params.hands !== 'both') return 0;
  const points = [...new Set([...score.staves.rh, ...score.staves.lh]
    .filter((event) => !event.rest).map((event) => event.onset))].sort((a, b) => a - b);
  const sonorities = points.map((onset) => {
    const sounding = (staff) => score.staves[staff].filter((event) => (
      !event.rest && event.onset <= onset && event.onset + event.duration > onset
    )).flatMap((event) => event.pitches);
    const right = sounding('rh');
    const left = sounding('lh');
    if (!right.length || !left.length) return null;
    return { top: Math.max(...right.map((pitch) => pitch.midi)), bottom: Math.min(...left.map((pitch) => pitch.midi)) };
  }).filter(Boolean);
  let count = 0;
  for (let index = 1; index < sonorities.length; index++) {
    const previous = sonorities[index - 1];
    const current = sonorities[index];
    const topMove = Math.sign(current.top - previous.top);
    const bottomMove = Math.sign(current.bottom - previous.bottom);
    const previousInterval = (previous.top - previous.bottom) % 12;
    const currentInterval = (current.top - current.bottom) % 12;
    if (topMove && topMove === bottomMove && [0, 7].includes(previousInterval) && previousInterval === currentInterval) count += 1;
  }
  return count;
}

function repeatedRun(notes) {
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const note of notes) {
    const dia = note.pitches[0].dia;
    run = dia === previous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = dia;
  }
  return longest;
}

function softMelodyChecks(score, pack) {
  const notes = leadNotes(score);
  const intervals = notes.slice(1).map((note, index) => note.pitches[0].dia - notes[index].pitches[0].dia);
  const steps = intervals.filter((value) => Math.abs(value) <= 1).length / Math.max(1, intervals.length);
  let unrecovered = 0;
  for (let index = 0; index < intervals.length - 1; index++) {
    if (Math.abs(intervals[index]) <= 2) continue;
    const from = notes[index];
    const to = notes[index + 1];
    const fromChord = chordAt(score, from.onset);
    const toChord = chordAt(score, to.onset);
    const triadic = (isChordTone(score.key, fromChord, from.pitches[0].dia)
      && isChordTone(score.key, fromChord, to.pitches[0].dia))
      || (isChordTone(score.key, toChord, from.pitches[0].dia)
        && isChordTone(score.key, toChord, to.pitches[0].dia));
    if (triadic) continue;
    const next = intervals[index + 1];
    if (Math.abs(next) !== 1 || Math.sign(next) === Math.sign(intervals[index])) unrecovered += 1;
  }
  const highest = Math.max(...notes.map((note) => note.pitches[0].dia));
  const apexCount = notes.filter((note) => note.pitches[0].dia === highest).length;
  const errors = [];
  const target = pack.melody.step_ratio_target;
  const tolerance = pack.melody.step_ratio_tolerance;
  if (steps < target - tolerance || steps > target + tolerance) errors.push('step ratio is outside the style band');
  if (notes.length > 4 && apexCount !== 1) errors.push('the melody does not have exactly one global maximum');
  if (unrecovered) errors.push('a non-triadic leap is not recovered by contrary step');
  if ((score.params.level || 1) < 6 && repeatedRun(notes) > 3) errors.push('too many consecutive repeated pitches');
  if (pack.validator.forbid_outer_parallels && outerParallelCount(score)) {
    errors.push('outer voices contain parallel fifths or octaves');
  }
  return { errors, steps, apexCount, unrecovered };
}

function chordAt(score, onset) {
  const measure = Math.floor(onset / score.ts.ticks);
  const within = onset - measure * score.ts.ticks;
  const slotTicks = score.ts.ticks / score.chordsPerMeasure;
  const slot = Math.min(score.chordsPerMeasure - 1, Math.floor(within / slotTicks));
  return score.chords[Math.min(score.chords.length - 1, measure * score.chordsPerMeasure + slot)];
}

function cadenceErrors(score) {
  const errors = [];
  const notes = leadNotes(score);
  for (const cadence of score.harmony.cadences || []) {
    if (!cadence.slots.every((slot, index) => score.chords[slot]?.degree === cadence.degrees[index])) {
      errors.push(`cadence ${cadence.id} does not match its harmonic formula`);
      continue;
    }
    const arrivals = notes.filter((note) => note.cadence === cadence.id
      && Math.floor(note.onset / score.ts.ticks) === cadence.measure);
    const arrival = arrivals.at(-1) || notes.filter((note) => Math.floor(note.onset / score.ts.ticks) === cadence.measure).at(-1);
    const chord = score.chords[cadence.slots.at(-1)];
    if (!arrival || !isChordTone(score.key, chord, arrival.pitches[0].dia)) {
      errors.push(`cadence ${cadence.id} does not end on a chord tone`);
    } else if (scaleDegree(score.key, arrival.pitches[0].dia) !== cadence.melodyDegree) {
      errors.push(`cadence ${cadence.id} misses its planned melody degree`);
    }
  }
  return errors;
}

function developmentErrors(score, pack) {
  const units = score.form.units || [];
  if (score.measures <= 4 || units.length < 2) return [];
  const recognizable = units.filter((unit) => (
    ['motif', 'exact', 'transpose_diatonic', 'reharmonize'].includes(unit.transform)
  ));
  const required = Math.ceil(units.length * pack.development.recognizable_min_ratio);
  const errors = [];
  if (recognizable.length < required) errors.push('development plan lacks a recognizable motivic restatement');
  const base = unitSignature(score, units[0]);
  const audible = recognizable.slice(1).filter((unit) => similarity(base, unitSignature(score, unit)) >= 0.38);
  if (!audible.length) errors.push('the planned motivic restatement is not audible in the realised notes');
  return errors;
}

function harmonySeamErrors(score, pack) {
  const variants = (roman) => {
    const withoutInversion = roman.replace(/64|65|43|42|6|2$/g, '');
    return [...new Set([roman, withoutInversion, withoutInversion.replace(/7$/g, '')])];
  };
  const licensedJoin = (left, right) => variants(left).some((from) => variants(right).some((to) => (
    Boolean(pack.harmony.transitions[from]?.[to])
    || (pack.harmony.licensed_retrogressions || []).includes(`${from}>${to}`)
  )));
  const errors = [];
  for (let index = 1; index < score.chords.length; index++) {
    const left = score.chords[index - 1];
    const right = score.chords[index];
    if (left.cadence && right.cadence && left.cadence.id === right.cadence.id) continue;
    const from = left.modelRoman || left.plannedRoman;
    const to = right.modelRoman || right.plannedRoman;
    const licensed = licensedJoin(from, to);
    if (!licensed) errors.push(`unlicensed harmonic join ${from}–${to}`);
  }
  return errors;
}

function nonChordToneErrors(score, pack) {
  const allowed = new Set(pack.melody.non_chord_tones || []);
  const invalid = leadNotes(score).filter((note) => !note.chordTone
    && (!note.nonChordKind || !allowed.has(note.nonChordKind)));
  if (!invalid.length) return [];
  const first = invalid[0];
  const bar = Math.floor(first.onset / score.ts.ticks) + 1;
  const kind = first.nonChordKind && first.nonChordKind !== 'unlicensed'
    ? `${first.nonChordKind} ` : '';
  return [`melody contains an unlicensed ${kind}non-chord tone at bar ${bar}`];
}

/** Validate hard pedagogical constraints and separately report relaxable musical preferences. */
export function validateExercise(score, constraints, { relaxation = 0 } = {}) {
  const hardErrors = [];
  const pack = stylePack(score.style.id);
  const totalTicks = score.measures * score.ts.ticks;
  const expectedHands = score.params.hands === 'both' ? ['rh', 'lh'] : [score.params.hands];

  for (const [hand, staff] of Object.entries(score.staves)) {
    if (expectedHands.includes(hand)) hardErrors.push(...coverageErrors(score, hand, staff));
    for (const note of staff) {
      if (note.onset < 0 || note.onset + note.duration > totalTicks) hardErrors.push(`${hand} event crosses the exercise boundary`);
      if (note.duration < constraints.smallest_ticks) hardErrors.push(`${hand} contains a note shorter than the level permits`);
      if (note.rest) continue;
      const [low, high] = hand === 'rh' ? [score.params.rhLow, score.params.rhHigh] : [score.params.lhLow, score.params.lhHigh];
      if (note.pitches.some((pitch) => pitch.dia < low || pitch.dia > high)) hardErrors.push(`${hand} exceeds its pitch range`);
      if (note.pitches.some((pitch) => ledgerLines(hand, pitch.dia) > constraints.ledger_lines)) {
        hardErrors.push(`${hand} exceeds the ledger-line budget`);
      }
      const dias = note.pitches.map((pitch) => pitch.dia);
      if (dias.length > constraints.simultaneous_notes) hardErrors.push(`${hand} exceeds the simultaneous-note cap`);
      if (dias.length > 1 && Math.max(...dias) - Math.min(...dias) + 1 > constraints.hand_span) hardErrors.push(`${hand} exceeds the hand-span cap`);
    }
  }

  if (Math.abs(score.key.fifths) > constraints.key_signature_accidentals) hardErrors.push('key signature exceeds the level cap');
  if (accidentalCount(score) > constraints.chromatic_notes) hardErrors.push('chromatic-note count exceeds the level cap');
  if (!constraints.meters.includes(score.ts.name)) hardErrors.push('meter is not permitted at this level');
  if (score.tempo < constraints.tempo[0] || score.tempo > constraints.tempo[1]) hardErrors.push('tempo is outside the level range');
  if (!pack.meters.some((meter) => meter.value === score.ts.name)) hardErrors.push('meter is not supported by the style pack');
  if (score.params.hands === 'both') {
    const texture = TEXTURE_IDS[score.params.lhStyle] || score.params.lhStyle;
    if (constraints.lh_textures.length && !constraints.lh_textures.includes(texture)) {
      hardErrors.push('left-hand texture is not permitted at this level');
    }
  }
  hardErrors.push(...melodicIntervalErrors(score, constraints));
  for (const hand of melodicStaffs(score)) {
    if (handShifts(score, hand) > constraints.hand_shifts) hardErrors.push(`${hand} exceeds the hand-position-shift cap`);
  }
  hardErrors.push(...cadenceErrors(score));
  hardErrors.push(...harmonySeamErrors(score, pack));
  hardErrors.push(...nonChordToneErrors(score, pack));

  if (score.params.hands === 'both' && simultaneousCollision(score)) hardErrors.push('left and right hands collide');
  hardErrors.push(...developmentErrors(score, pack));

  const coherence = coherenceScore(score);
  if (coherence < pack.validator.coherence_min) hardErrors.push('phrase similarity is below the coherence floor');
  if (coherence > pack.validator.coherence_max) hardErrors.push('phrase similarity is mechanically repetitive');

  const soft = softMelodyChecks(score, pack);
  const allowedSoftFailures = Math.max(0, relaxation);
  const passed = hardErrors.length === 0 && soft.errors.length <= allowedSoftFailures;
  return {
    passed, hardPassed: hardErrors.length === 0, hardErrors: [...new Set(hardErrors)],
    softErrors: soft.errors, relaxation,
    metrics: { coherence: round(coherence), stepRatio: round(soft.steps), apexCount: soft.apexCount, unrecoveredLeaps: soft.unrecovered },
  };
}

export function scaleDegree(key, dia) {
  return ((dia - tonicLetter(key)) % 7 + 7) % 7;
}
