// Composition-style grammars.
//
// A style is more than a label: it constrains form, harmonic vocabulary,
// cadence weighting, motivic memory, and melodic ornament. The setup panel
// exposes these profiles while the generator keeps the same deterministic
// seed contract.

const profile = (id, label, description, options) => Object.freeze({
  id,
  label,
  description,
  ...options,
});

export const COMPOSITION_STYLES = Object.freeze({
  auto: profile('auto', 'Auto', 'Chooses a style that fits the metre and setup.', {
    title: 'Motivic Study',
    motifStrength: 16,
    stepwiseAdjustment: 0,
    nonChordMultiplier: 1,
    blueNoteRate: 0,
  }),
  classical: profile('classical', 'Classical', 'Balanced periods, sequences, and functional cadences.', {
    title: 'Motivic Study',
    motifStrength: 15,
    stepwiseAdjustment: 0.06,
    nonChordMultiplier: 0.82,
    blueNoteRate: 0,
  }),
  folk: profile('folk', 'Folk / hymn', 'Plainspoken phrases, primary chords, and singable returns.', {
    title: 'Folk Tune',
    motifStrength: 21,
    stepwiseAdjustment: 0.1,
    nonChordMultiplier: 0.68,
    blueNoteRate: 0,
  }),
  pop: profile('pop', 'Pop / song', 'Loop harmony, hook-like repetition, and verse–refrain form.', {
    title: 'Song Study',
    motifStrength: 24,
    stepwiseAdjustment: 0.02,
    nonChordMultiplier: 0.9,
    blueNoteRate: 0,
  }),
  blues: profile('blues', 'Blues', 'Twelve-bar harmony, repeating riffs, blue notes, and turnarounds.', {
    title: 'Blues Study',
    motifStrength: 25,
    stepwiseAdjustment: -0.04,
    nonChordMultiplier: 1.05,
    blueNoteRate: 0.28,
  }),
  waltz: profile('waltz', 'Waltz', 'Three-beat phrases with dance bass and rounded returns.', {
    title: 'Waltz',
    motifStrength: 18,
    stepwiseAdjustment: 0.04,
    nonChordMultiplier: 0.82,
    blueNoteRate: 0,
  }),
});

export const STYLE_OPTIONS = Object.freeze([
  COMPOSITION_STYLES.auto,
  COMPOSITION_STYLES.classical,
  COMPOSITION_STYLES.folk,
  COMPOSITION_STYLES.pop,
  COMPOSITION_STYLES.blues,
  COMPOSITION_STYLES.waltz,
]);

export const STYLE_IDS = Object.freeze(STYLE_OPTIONS.map((item) => item.id));

export function compositionStyle(id) {
  return COMPOSITION_STYLES[id] || COMPOSITION_STYLES.classical;
}

/** Deterministically resolve Auto without choosing a style that fights the setup. */
export function resolveCompositionStyle(rng, requested, context = {}) {
  if (requested && requested !== 'auto' && COMPOSITION_STYLES[requested]) {
    return COMPOSITION_STYLES[requested];
  }

  const choices = [
    COMPOSITION_STYLES.classical,
    COMPOSITION_STYLES.folk,
    COMPOSITION_STYLES.pop,
  ];
  const weights = [
    context.lhStyle === 'alberti' ? 5 : 2.4,
    context.lhStyle === 'roots' || context.lhStyle === 'sustained' ? 4 : 2.2,
    context.lhStyle === 'broken' || context.lhStyle === 'blocked' ? 3.5 : 2.2,
  ];

  if (context.timeSignature === '3/4') {
    choices.push(COMPOSITION_STYLES.waltz);
    weights.push(context.lhStyle === 'waltz' ? 8 : 5);
  }
  if (context.timeSignature === '4/4' && Number(context.measures) % 12 === 0) {
    choices.push(COMPOSITION_STYLES.blues);
    weights.push(4.5);
  }
  return rng.weighted(choices, weights);
}

/**
 * Selecting a named style applies only the conventions that define it. All
 * other controls remain editable, so a teacher can still make a slow folk
 * study or a right-hand-only waltz.
 */
export function styleSetupPatch(id, params = {}) {
  const patch = { compositionStyle: id };
  if (id === 'blues') {
    patch.timeSignature = '4/4';
    patch.measures = 12;
    patch.allowSevenths = true;
    if (params.hands === 'both') patch.lhStyle = 'broken';
  } else if (id === 'waltz') {
    patch.timeSignature = '3/4';
    patch.chordsPerMeasure = 1;
    if (params.hands === 'both') patch.lhStyle = 'waltz';
  }
  return patch;
}

const repeatTo = (sections, count, beforeLast = 'B′') => {
  const out = [...sections];
  while (out.length < count) out.splice(Math.max(0, out.length - 1), 0, beforeLast);
  return out.slice(0, count);
};

/** Return a conventional phrase map for the selected style and length. */
export function formForStyle(styleId, phraseCount) {
  const count = Math.max(1, phraseCount);

  if (styleId === 'folk') {
    const forms = {
      1: ['Four-bar folk strain', ['A']],
      2: ['Strophic pair', ['A', 'A′']],
      3: ['Refrain form', ['A', 'B', 'A′']],
      4: ['Strophic refrain', ['A', 'A′', 'B', 'A″']],
      5: ['Folk arch', ['A', 'B', 'A′', 'B′', 'A″']],
      6: ['Extended refrain', ['A', 'A′', 'B', 'A″', 'B′', 'A‴']],
    };
    const [name, sections] = forms[Math.min(count, 6)] || forms[6];
    return { name, sections: repeatTo(sections, count, 'B′') };
  }

  if (styleId === 'pop') {
    const forms = {
      1: ['Hook phrase', ['A']],
      2: ['Verse period', ['A', 'A′']],
      3: ['Verse–pre-chorus', ['A', 'A′', 'B']],
      4: ['Verse–chorus', ['A', 'A′', 'B', 'B′']],
      5: ['Verse–chorus return', ['A', 'A′', 'B', 'B′', 'A″']],
      6: ['Song form', ['A', 'A′', 'B', 'B′', 'A″', 'B″']],
    };
    const [name, sections] = forms[Math.min(count, 6)] || forms[6];
    return { name, sections: repeatTo(sections, count, 'B′') };
  }

  if (styleId === 'blues') {
    const forms = {
      1: ['Four-bar blues riff', ['A']],
      2: ['Eight-bar blues', ['A', 'A′']],
      3: ['Twelve-bar blues', ['A', 'A′', 'B']],
      4: ['Extended blues', ['A', 'A′', 'B', 'A″']],
      5: ['Blues chorus and tag', ['A', 'A′', 'B', 'A″', 'B′']],
      6: ['Two-chorus blues', ['A', 'A′', 'B', 'A″', 'A‴', 'B′']],
    };
    const [name, sections] = forms[Math.min(count, 6)] || forms[6];
    return { name, sections: repeatTo(sections, count, 'A″') };
  }

  if (styleId === 'waltz') {
    const forms = {
      1: ['Waltz strain', ['A']],
      2: ['Waltz period', ['A', 'A′']],
      3: ['Minuet form', ['A', 'B', 'A′']],
      4: ['Rounded waltz binary', ['A', 'A′', 'B', 'A″']],
      5: ['Waltz arch', ['A', 'B', 'C', 'B′', 'A′']],
      6: ['Extended waltz', ['A', 'A′', 'B', 'B′', 'A', 'A″']],
    };
    const [name, sections] = forms[Math.min(count, 6)] || forms[6];
    return { name, sections: repeatTo(sections, count, 'B′') };
  }

  // Classical is the neutral grammar and preserves the original form names.
  const forms = {
    1: ['Four-bar phrase', ['A']],
    2: ['Parallel period', ['A', 'A′']],
    3: ['Ternary miniature', ['A', 'B', 'A′']],
    4: ['Rounded binary', ['A', 'A′', 'B', 'A″']],
    5: ['Arch form', ['A', 'B', 'C', 'B′', 'A′']],
    6: ['Extended ternary', ['A', 'A′', 'B', 'B′', 'A', 'A″']],
  };
  if (count <= 6) {
    const [name, sections] = forms[count];
    return { name, sections };
  }
  return {
    name: 'AABA song form',
    sections: repeatTo(['A', 'A′', 'A', 'A″', 'B', 'B′', 'A', 'A‴'], count, 'B′'),
  };
}
