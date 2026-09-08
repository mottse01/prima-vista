// Whether the reading held together, as distinct from whether it was right.
//
// Accuracy is the easy half of sight-reading to measure and the less
// diagnostic half. What separates a reader who can be put in front of an
// unfamiliar page from one who cannot is not the note count — it is whether
// the pulse survived the page. The characteristic failure is stopping: the
// eyes fall behind, the hands wait for them, and the music resumes a beat
// later. Every measure this app had was blind to that. Notes played late but
// eventually correct are counted correct; an attack that arrives at all counts
// toward continuity; and the one timing number kept — the mean signed error —
// is a bias, not a steadiness. A reader alternating sixty milliseconds early
// and sixty late averages zero and looks flawless.
//
// So two numbers, both expressed as fractions of a beat so that takes at
// different tempi and in different metres can be compared with each other.

/** Fewer than this many timed notes cannot describe a pulse. */
const MINIMUM_SAMPLE = 4;

/**
 * How tightly the attacks clustered around their own average error.
 *
 * This is spread, not bias, and that distinction is the whole point: sitting
 * consistently forty milliseconds behind the reference click is a steady
 * reading at a marginally slow tempo, while landing alternately on the beat
 * and half a beat late is not steady at all, however well the two cancel.
 *
 * Returned as a fraction of one beat, so 0.1 means the attacks scattered by a
 * tenth of a beat whatever the tempo was.
 */
export function pulseSpread(deltas, beatSeconds) {
  const usable = (deltas || []).filter((delta) => Number.isFinite(delta));
  if (usable.length < MINIMUM_SAMPLE || !(beatSeconds > 0)) return null;
  const mean = usable.reduce((sum, delta) => sum + delta, 0) / usable.length;
  const variance = usable.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / usable.length;
  return Math.sqrt(variance) / beatSeconds;
}

/**
 * The longest hesitation in the reading, as a multiple of the reader's own pace.
 *
 * Each gap between consecutive attacks is compared with the gap the music
 * asked for, which gives a local tempo for that moment. Dividing the worst of
 * those by the median makes the measure indifferent to how fast the reading
 * was overall — a reader who takes the whole study at three quarters speed is
 * not hesitating — and sensitive to the thing that matters, which is one
 * moment much slower than the rest.
 *
 * 1 is perfectly even. 2 means one gap took twice as long as this reader's own
 * pace, which is a stop long enough to hear.
 */
export function worstHesitation(attacks) {
  const ordered = (attacks || [])
    .filter((attack) => Number.isFinite(attack?.at) && Number.isFinite(attack?.onset))
    .sort((a, b) => a.onset - b.onset);
  const ratios = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const written = ordered[i].onset - ordered[i - 1].onset;
    const taken = ordered[i].at - ordered[i - 1].at;
    if (written <= 0 || !(taken > 0)) continue;
    ratios.push(taken / written);
  }
  if (ratios.length < MINIMUM_SAMPLE - 1) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  if (!(median > 0)) return null;
  return Math.max(...ratios) / median;
}

// A reading is steady when its attacks sit within this much of a beat of each
// other, and unbroken when no single gap runs this far past the reader's own
// pace. Both are product judgements rather than measured norms: an eighth of a
// beat is roughly the point at which unevenness becomes audible as unevenness,
// and half again as long as your own pace is roughly the point at which a
// listener hears a stop rather than a rubato.
export const STEADY_SPREAD = 0.125;
export const UNBROKEN_HESITATION = 1.5;

/**
 * One reading's fluency, in the two terms the rest of the app stores and asks
 * about. Either can be null when the take was too short to say anything.
 */
export function readingFluency({ deltas, attacks, beatSeconds }) {
  const spread = pulseSpread(deltas, beatSeconds);
  const hesitation = worstHesitation(attacks);
  return {
    spread,
    hesitation,
    steady: spread == null ? null : spread <= STEADY_SPREAD,
    unbroken: hesitation == null ? null : hesitation <= UNBROKEN_HESITATION,
  };
}

/** Plain words for a fluency reading, or null when there is nothing to say. */
export function fluencyNote({ spread, hesitation }) {
  if (hesitation != null && hesitation > 2.4) {
    return 'The reading stopped somewhere. Choose a tempo you can hold through the hardest bar, and keep going past mistakes.';
  }
  if (spread != null && spread > 0.22) {
    return 'The pulse moved around a good deal. Counting one bar in before you start gives the beat somewhere to live.';
  }
  if (spread != null && spread <= STEADY_SPREAD && (hesitation == null || hesitation <= UNBROKEN_HESITATION)) {
    return 'You held one pulse the whole way through, which is the thing that transfers to new music.';
  }
  return null;
}
