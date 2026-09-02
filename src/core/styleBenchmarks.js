// Style reference profiles.
//
// These are intentionally feature ranges rather than source melodies. They
// encode common-practice and songwriting expectations the critic can measure
// without copying repertoire: phrase motion, recurrence, cadence behavior,
// sectional lift, and texture.

export const STYLE_BENCHMARKS = Object.freeze({
  classical: Object.freeze({
    smallMotion: [0.62, 0.92],
    repeatedNotes: [0.01, 0.22],
    strongBeatChordTones: 0.72,
    motifRecognition: 0.58,
    sectionContrast: 0.08,
    finalCadences: ['authentic', 'imperfect', 'plagal'],
  }),
  folk: Object.freeze({
    smallMotion: [0.68, 0.96],
    repeatedNotes: [0.02, 0.3],
    strongBeatChordTones: 0.75,
    motifRecognition: 0.64,
    sectionContrast: 0.04,
    finalCadences: ['authentic', 'imperfect', 'plagal', 'modal'],
  }),
  pop: Object.freeze({
    smallMotion: [0.55, 0.9],
    repeatedNotes: [0.04, 0.38],
    strongBeatChordTones: 0.66,
    motifRecognition: 0.68,
    sectionContrast: 0.12,
    finalCadences: ['authentic', 'imperfect', 'plagal', 'deceptive'],
  }),
  blues: Object.freeze({
    smallMotion: [0.42, 0.88],
    repeatedNotes: [0.05, 0.48],
    strongBeatChordTones: 0.55,
    motifRecognition: 0.66,
    sectionContrast: 0.04,
    finalCadences: ['authentic', 'plagal', 'bluesTurnaround'],
  }),
  waltz: Object.freeze({
    smallMotion: [0.62, 0.94],
    repeatedNotes: [0.01, 0.24],
    strongBeatChordTones: 0.72,
    motifRecognition: 0.58,
    sectionContrast: 0.06,
    finalCadences: ['authentic', 'imperfect', 'plagal'],
  }),
});

export function styleBenchmark(styleId) {
  return STYLE_BENCHMARKS[styleId] || STYLE_BENCHMARKS.classical;
}
