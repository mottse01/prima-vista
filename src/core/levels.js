// The graded path.
//
// Each level is a *parameter envelope*, not a fixed piece, so the path is
// infinite: you can never memorise your way up it, which is the failure mode of
// fixed-library apps.

/** Diatonic index helpers: C4 = 28, each unit is one staff step. */
const D = { C2: 14, E2: 16, F2: 17, G2: 18, B2: 20, C3: 21, D3: 22, F3: 24, G3: 25, B3: 27, C4: 28, E4: 30, G4: 32, A4: 33, C5: 35, E5: 37, G5: 39, C6: 42 };

const base = {
  measures: 8,
  tempo: 72,
  hands: 'both',
  rhythmTags: [],
  maxLeap: 2,
  stepwiseBias: 0.8,
  nonChordRate: 0.25,
  chromaticRate: 0,
  restRate: 0.1,
  lhStyle: 'roots',
  chordsPerMeasure: 1,
  allowSevenths: false,
  allowInversions: false,
  dynamics: false,
  articulations: false,
  slurs: false,
  fingerings: false,
  meters: ['4/4'],
  fifths: [0],
  modes: ['major'],
};

export const LEVELS = [
  {
    id: 1, name: 'Five-finger position', stage: 'Foundations',
    blurb: 'Right hand alone, C position, quarter and half notes.',
    params: { ...base, hands: 'rh', measures: 4, tempo: 60, maxLeap: 1, rhLow: D.C4, rhHigh: D.G4, restRate: 0.05, fingerings: true },
    focus: ['notes.treble', 'intervals.step', 'rhythm.quarter'],
  },
  {
    id: 2, name: 'Bass clef position', stage: 'Foundations',
    blurb: 'Left hand alone in the bass staff, same rhythms.',
    params: { ...base, hands: 'lh', measures: 4, tempo: 60, maxLeap: 1, lhLow: D.G2, lhHigh: D.D3, restRate: 0.05, fingerings: true },
    focus: ['notes.bass', 'intervals.step'],
  },
  {
    id: 3, name: 'Both hands, one note each', stage: 'Foundations',
    blurb: 'Grand staff. The left hand holds a root while the right hand moves.',
    params: { ...base, measures: 4, tempo: 60, maxLeap: 1, rhLow: D.C4, rhHigh: D.G4, lhLow: D.G2, lhHigh: D.D3, lhStyle: 'roots', fingerings: true },
    focus: ['coordination.together', 'notes.treble', 'notes.bass'],
  },
  {
    id: 4, name: 'Skips of a third', stage: 'Reading intervals',
    blurb: 'Thirds enter the melody; still one chord per bar.',
    params: { ...base, tempo: 66, maxLeap: 2, rhLow: D.C4, rhHigh: D.C5, lhLow: D.G2, lhHigh: D.D3 },
    focus: ['intervals.skip', 'notes.treble'],
  },
  {
    id: 5, name: 'Eighth notes', stage: 'Reading intervals',
    blurb: 'Pairs of eighths against a steady left hand.',
    params: { ...base, tempo: 66, rhythmTags: ['eighth'], maxLeap: 2, rhLow: D.C4, rhHigh: D.C5, lhLow: D.G2, lhHigh: D.D3, dynamics: true },
    focus: ['rhythm.eighth'],
  },
  {
    id: 6, name: 'One sharp, one flat', stage: 'Reading intervals',
    blurb: 'G major and F major join C. Watch the key signature.',
    params: { ...base, tempo: 68, rhythmTags: ['eighth'], fifths: [-1, 0, 1], maxLeap: 2, rhLow: D.C4, rhHigh: D.C5, lhLow: D.G2, lhHigh: D.D3, dynamics: true },
    focus: ['notes.treble', 'notes.bass'],
  },
  {
    id: 7, name: 'Rests and 3/4', stage: 'Metre',
    blurb: 'Silence counts too. Waltz time arrives.',
    params: { ...base, tempo: 70, rhythmTags: ['eighth', 'rest'], meters: ['4/4', '3/4'], restRate: 0.2, fifths: [-1, 0, 1], rhLow: D.C4, rhHigh: D.C5, lhLow: D.G2, lhHigh: D.F3, lhStyle: 'waltz', dynamics: true },
    focus: ['rhythm.rest'],
  },
  {
    id: 8, name: 'Blocked chords', stage: 'Metre',
    blurb: 'The left hand plays full triads — two notes to read at once.',
    params: { ...base, tempo: 70, rhythmTags: ['eighth', 'rest'], meters: ['4/4', '3/4', '2/4'], fifths: [-2, -1, 0, 1, 2], lhStyle: 'blocked', rhLow: D.C4, rhHigh: D.E5, lhLow: D.E2, lhHigh: D.F3, dynamics: true },
    focus: ['coordination.together', 'notes.bass'],
  },
  {
    id: 9, name: 'Minor keys', stage: 'Metre',
    blurb: 'Relative minors, with their raised leading tones.',
    params: { ...base, tempo: 70, rhythmTags: ['eighth', 'rest'], meters: ['4/4', '3/4'], fifths: [-2, -1, 0, 1, 2], modes: ['major', 'minor'], lhStyle: 'blocked', rhLow: D.C4, rhHigh: D.E5, lhLow: D.E2, lhHigh: D.F3, dynamics: true },
    focus: ['notes.accidental'],
  },
  {
    id: 10, name: 'Dotted rhythms', stage: 'Rhythm',
    blurb: 'Dotted quarters and their answering eighths.',
    params: { ...base, tempo: 72, rhythmTags: ['eighth', 'rest', 'dotted'], meters: ['4/4', '3/4'], fifths: [-2, -1, 0, 1, 2], modes: ['major', 'minor'], lhStyle: 'blocked', maxLeap: 3, rhLow: D.C4, rhHigh: D.E5, lhLow: D.E2, lhHigh: D.F3, dynamics: true, slurs: true },
    focus: ['rhythm.dotted'],
  },
  {
    id: 11, name: 'Alberti bass', stage: 'Rhythm',
    blurb: 'A broken-chord left hand that keeps moving underneath the tune.',
    params: { ...base, tempo: 72, rhythmTags: ['eighth', 'rest', 'dotted'], meters: ['4/4', '3/4'], fifths: [-3, -2, -1, 0, 1, 2, 3], modes: ['major', 'minor'], lhStyle: 'alberti', maxLeap: 3, rhLow: D.C4, rhHigh: D.G5, lhLow: D.G2, lhHigh: D.F3, dynamics: true, slurs: true },
    focus: ['coordination.together', 'rhythm.eighth'],
  },
  {
    id: 12, name: 'Above and below the staff', stage: 'Rhythm',
    blurb: 'Ledger lines in both hands — the gap most readers never close.',
    params: { ...base, tempo: 72, rhythmTags: ['eighth', 'rest', 'dotted'], meters: ['4/4', '3/4'], fifths: [-3, -2, -1, 0, 1, 2, 3], modes: ['major', 'minor'], lhStyle: 'broken', maxLeap: 4, rhLow: D.A4, rhHigh: D.C6, lhLow: D.C2, lhHigh: D.C3, dynamics: true },
    focus: ['notes.ledger'],
  },
  {
    id: 13, name: 'Compound time', stage: 'Advanced metre',
    blurb: '6/8 and 9/8: count in dotted beats, not quarters.',
    params: { ...base, tempo: 66, rhythmTags: ['eighth', 'rest'], meters: ['6/8', '9/8'], fifths: [-3, -2, -1, 0, 1, 2, 3], modes: ['major', 'minor'], lhStyle: 'broken', maxLeap: 3, rhLow: D.C4, rhHigh: D.G5, lhLow: D.G2, lhHigh: D.F3, dynamics: true, slurs: true },
    focus: ['rhythm.eighth', 'coordination.together'],
  },
  {
    id: 14, name: 'Sixteenth notes', stage: 'Advanced metre',
    blurb: 'Four to a beat, and dotted-eighth pairs.',
    params: { ...base, tempo: 66, rhythmTags: ['eighth', 'rest', 'dotted', 'sixteenth'], meters: ['4/4', '2/4', '2/2'], fifths: [-4, -3, -2, -1, 0, 1, 2, 3, 4], modes: ['major', 'minor'], lhStyle: 'blocked', maxLeap: 4, rhLow: D.C4, rhHigh: D.G5, lhLow: D.E2, lhHigh: D.F3, dynamics: true, articulations: true },
    focus: ['rhythm.sixteenth'],
  },
  {
    id: 15, name: 'Syncopation', stage: 'Advanced metre',
    blurb: 'Notes that start where the beat is not.',
    params: { ...base, tempo: 72, rhythmTags: ['eighth', 'rest', 'dotted', 'syncopation'], meters: ['4/4', '2/2'], fifths: [-4, -3, -2, -1, 0, 1, 2, 3, 4], modes: ['major', 'minor'], lhStyle: 'alberti', maxLeap: 4, rhLow: D.C4, rhHigh: D.G5, lhLow: D.G2, lhHigh: D.F3, dynamics: true, articulations: true },
    focus: ['rhythm.syncopation'],
  },
  {
    id: 16, name: 'Chromatic colour', stage: 'Harmony',
    blurb: 'Accidentals that are not in the key signature.',
    params: { ...base, tempo: 72, rhythmTags: ['eighth', 'rest', 'dotted', 'sixteenth'], meters: ['4/4', '3/4', '6/8'], fifths: [-4, -3, -2, -1, 0, 1, 2, 3, 4], modes: ['major', 'minor'], lhStyle: 'broken', chromaticRate: 0.3, maxLeap: 4, rhLow: D.C4, rhHigh: D.G5, lhLow: D.E2, lhHigh: D.F3, dynamics: true, articulations: true, slurs: true },
    focus: ['notes.accidental'],
  },
  {
    id: 17, name: 'Sevenths and inversions', stage: 'Harmony',
    blurb: 'Richer harmony, with the bass line moving through inversions.',
    params: { ...base, tempo: 74, rhythmTags: ['eighth', 'rest', 'dotted', 'sixteenth'], meters: ['4/4', '3/4'], fifths: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], modes: ['major', 'minor'], lhStyle: 'blocked', allowSevenths: true, allowInversions: true, chordsPerMeasure: 2, chromaticRate: 0.2, maxLeap: 5, rhLow: D.C4, rhHigh: D.C6, lhLow: D.C2, lhHigh: D.F3, dynamics: true, articulations: true },
    focus: ['coordination.together', 'notes.accidental'],
  },
  {
    id: 18, name: 'Two voices', stage: 'Harmony',
    blurb: 'The left hand gets a melody of its own. Contrapuntal reading.',
    params: { ...base, tempo: 70, rhythmTags: ['eighth', 'rest', 'dotted'], meters: ['4/4', '3/4', '6/8'], fifths: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], modes: ['major', 'minor'], lhStyle: 'melodic', allowSevenths: true, maxLeap: 5, rhLow: D.C4, rhHigh: D.C6, lhLow: D.G2, lhHigh: D.C4, dynamics: true, articulations: true, slurs: true },
    focus: ['coordination.together', 'notes.bass'],
  },
  {
    id: 19, name: 'Triplets and mixed metre', stage: 'Mastery',
    blurb: 'Three against two, and bars of five.',
    params: { ...base, tempo: 76, rhythmTags: ['eighth', 'rest', 'dotted', 'sixteenth', 'triplet', 'syncopation'], meters: ['4/4', '3/4', '5/4', '12/8'], fifths: [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6], modes: ['major', 'minor'], lhStyle: 'alberti', allowSevenths: true, allowInversions: true, chromaticRate: 0.25, maxLeap: 5, rhLow: D.C4, rhHigh: D.C6, lhLow: D.E2, lhHigh: D.F3, dynamics: true, articulations: true, slurs: true, measures: 12 },
    focus: ['rhythm.triplet', 'rhythm.syncopation'],
  },
  {
    id: 20, name: 'Every key', stage: 'Mastery',
    blurb: 'All fifteen key signatures, everything you have learned, at sight.',
    params: { ...base, tempo: 80, rhythmTags: ['eighth', 'rest', 'dotted', 'sixteenth', 'triplet', 'syncopation'], meters: ['4/4', '3/4', '2/2', '6/8', '9/8', '5/4'], fifths: [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7], modes: ['major', 'minor'], lhStyle: 'melodic', allowSevenths: true, allowInversions: true, chordsPerMeasure: 2, chromaticRate: 0.3, maxLeap: 6, stepwiseBias: 0.62, rhLow: D.C4, rhHigh: D.C6, lhLow: D.F2, lhHigh: D.C4, dynamics: true, articulations: true, slurs: true, measures: 16 },
    focus: ['notes.accidental', 'notes.ledger', 'coordination.together'],
  },
];

export const STAGES = [...new Set(LEVELS.map((l) => l.stage))];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}
