import { stylePack } from './stylePacks.js';

/** Critic targets are projected from the same versioned pack used to compose. */
export function styleBenchmark(styleId) {
  const pack = stylePack(styleId);
  const target = pack.melody.step_ratio_target;
  const tolerance = pack.melody.step_ratio_tolerance;
  const finalCadences = Object.keys(pack.harmony.cadence_weights.final)
    .filter((id) => pack.harmony.cadences[id]);
  return {
    smallMotion: [Math.max(0, target - tolerance), Math.min(1, target + tolerance)],
    repeatedNotes: [0, pack.validator.coherence_max > 0.95 ? 0.42 : 0.3],
    strongBeatChordTones: 0.72,
    motifRecognition: pack.validator.coherence_min,
    sectionContrast: Math.max(0.04, 1 - pack.validator.coherence_max),
    finalCadences,
  };
}
