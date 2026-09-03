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
  const intervals = notes.slice(1).map((note, index) => Math.sign(note.pitches[0].dia - notes[index].pitches[0].dia));
  return { rhythm, intervals };
}

function similarity(a, b) {
  const rhythmDistance = levenshtein(a.rhythm, b.rhythm) / Math.max(1, a.rhythm.length, b.rhythm.length);
  const contourDistance = levenshtein(a.intervals, b.intervals) / Math.max(1, a.intervals.length, b.intervals.length);
  return Math.max(0, 1 - rhythmDistance * 0.55 - contourDistance * 0.45);
}

export function coherenceScore(score) {
  const signatures = (score.form.units || []).map((unit) => unitSignature(score, unit));
  const values = [];
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) values.push(similarity(signatures[i], signatures[j]));
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
}

function accidentalCount(score) {
  const signature = keyAlterations(score.key.fifths);
  return new Set([...score.staves.rh, ...score.staves.lh]
    .filter((note) => !note.rest)
    .flatMap((note) => note.pitches)
    .filter((pitch) => pitch.alter !== signature[pitch.letter])
    .map((pitch) => `${pitch.letter}:${pitch.alter}`)).size;
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
  return { errors, steps, apexCount, unrecovered };
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
    }
  }
  return errors;
}

/** Validate hard pedagogical constraints and separately report relaxable musical preferences. */
export function validateExercise(score, constraints, { relaxation = 0 } = {}) {
  const hardErrors = [];
  const pack = stylePack(score.style.id);
  const totalTicks = score.measures * score.ts.ticks;

  for (const [hand, staff] of Object.entries(score.staves)) {
    for (let bar = 0; bar < score.measures; bar++) {
      const from = bar * score.ts.ticks;
      const to = from + score.ts.ticks;
      const events = staff.filter((event) => event.onset >= from && event.onset < to);
      const furthest = events.reduce((end, event) => Math.max(end, event.onset + event.duration), from);
      if (events.length && furthest !== to) hardErrors.push(`${hand} bar ${bar + 1} has an invalid duration`);
    }
    for (const note of staff) {
      if (note.onset < 0 || note.onset + note.duration > totalTicks) hardErrors.push(`${hand} event crosses the exercise boundary`);
      if (note.duration < constraints.smallest_ticks) hardErrors.push(`${hand} contains a note shorter than the level permits`);
      if (note.rest) continue;
      const [low, high] = hand === 'rh' ? [score.params.rhLow, score.params.rhHigh] : [score.params.lhLow, score.params.lhHigh];
      if (note.pitches.some((pitch) => pitch.dia < low || pitch.dia > high)) hardErrors.push(`${hand} exceeds its pitch range`);
      const dias = note.pitches.map((pitch) => pitch.dia);
      if (dias.length > constraints.simultaneous_notes) hardErrors.push(`${hand} exceeds the simultaneous-note cap`);
      if (dias.length > 1 && Math.max(...dias) - Math.min(...dias) + 1 > constraints.hand_span) hardErrors.push(`${hand} exceeds the hand-span cap`);
    }
  }

  if (Math.abs(score.key.fifths) > constraints.key_signature_accidentals) hardErrors.push('key signature exceeds the level cap');
  if (accidentalCount(score) > constraints.chromatic_notes) hardErrors.push('chromatic-note count exceeds the level cap');
  hardErrors.push(...cadenceErrors(score));

  if (score.params.hands === 'both') {
    const rhLow = Math.min(...score.staves.rh.filter((n) => !n.rest).flatMap((n) => n.pitches.map((p) => p.midi)));
    const lhHigh = Math.max(...score.staves.lh.filter((n) => !n.rest).flatMap((n) => n.pitches.map((p) => p.midi)));
    if (Number.isFinite(rhLow) && Number.isFinite(lhHigh) && lhHigh >= rhLow) hardErrors.push('left and right hands collide');
  }

  const recognizable = (score.form.units || [])
    .filter((unit) => ['motif', 'exact', 'transpose_diatonic', 'reharmonize'].includes(unit.transform)).length;
  const required = Math.ceil((score.form.units || []).length * 0.5);
  if (score.measures > 4 && recognizable < required) hardErrors.push('development plan lacks a recognizable motivic restatement');

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
