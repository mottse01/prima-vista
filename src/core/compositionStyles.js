// Composition-style grammars.
//
// Each style supplies both a surface vocabulary and a formal grammar. The
// generator consumes the phrase functions below before it chooses harmony or
// pitches, so labels such as "period" and "chorus" describe audible behavior
// rather than metadata applied after the fact.

const profile = (id, label, description, options) => Object.freeze({
  id,
  label,
  description,
  ...options,
});

export const COMPOSITION_STYLES = Object.freeze({
  auto: profile('auto', 'Auto', 'Chooses a style that fits the metre and setup.', {
    title: 'Motivic Study', motifStrength: 16, stepwiseAdjustment: 0,
    nonChordMultiplier: 1, blueNoteRate: 0, climaxPosition: 0.62,
  }),
  classical: profile('classical', 'Classical', 'Periods, sentences, sequences, and functional cadences.', {
    title: 'Motivic Study', motifStrength: 15, stepwiseAdjustment: 0.06,
    nonChordMultiplier: 0.82, blueNoteRate: 0, climaxPosition: 0.66,
  }),
  folk: profile('folk', 'Folk / hymn', 'Plainspoken phrases, primary chords, and singable returns.', {
    title: 'Folk Tune', motifStrength: 21, stepwiseAdjustment: 0.1,
    nonChordMultiplier: 0.68, blueNoteRate: 0, climaxPosition: 0.58,
  }),
  pop: profile('pop', 'Pop / song', 'Loop harmony, hook-like repetition, and section contrast.', {
    title: 'Song Study', motifStrength: 24, stepwiseAdjustment: 0.02,
    nonChordMultiplier: 0.9, blueNoteRate: 0, climaxPosition: 0.74,
  }),
  blues: profile('blues', 'Blues', 'Twelve-bar harmony, call-and-response riffs, blue notes, and turnarounds.', {
    title: 'Blues Study', motifStrength: 25, stepwiseAdjustment: -0.04,
    nonChordMultiplier: 1.05, blueNoteRate: 0.28, climaxPosition: 0.72,
  }),
  waltz: profile('waltz', 'Waltz', 'Three-beat dance phrases with a singing line and rounded returns.', {
    title: 'Waltz', motifStrength: 18, stepwiseAdjustment: 0.04,
    nonChordMultiplier: 0.82, blueNoteRate: 0, climaxPosition: 0.64,
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

  const choices = [COMPOSITION_STYLES.classical, COMPOSITION_STYLES.folk, COMPOSITION_STYLES.pop];
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

/** Apply the conventions that define a selected style while preserving editable controls. */
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

const phrase = (
  section,
  functionName,
  cadenceStrength,
  transform,
  energy,
  harmonicRole,
  options = {},
) => ({
  section,
  function: functionName,
  cadenceStrength,
  cadence: cadenceStrength !== 'none',
  transform,
  energy,
  harmonicRole,
  registerShift: options.registerShift ?? Math.max(0, energy - 1),
  density: options.density ?? energy,
});

const form = (name, phrases) => ({ name, phrases });

const LIBRARY = {
  classical: {
    1: [form('Four-bar phrase', [phrase('A', 'statement', 'strong', 'statement', 1, 'closure')])],
    2: [
      form('Parallel period', [
        phrase('A', 'antecedent', 'weak', 'statement', 1, 'tonic'),
        phrase('A′', 'consequent', 'strong', 'return', 2, 'cadence'),
      ]),
      form('Eight-bar sentence', [
        phrase('A', 'presentation', 'none', 'repetition', 1, 'tonic'),
        phrase('B', 'continuation', 'strong', 'fragment', 2, 'cadence', { registerShift: 1, density: 3 }),
      ]),
    ],
    3: [form('Small ternary', [
      phrase('A', 'statement', 'weak', 'statement', 1, 'tonic'),
      phrase('B', 'departure', 'open', 'sequence', 3, 'departure', { registerShift: 2 }),
      phrase('A′', 'return', 'strong', 'return', 2, 'cadence'),
    ])],
    4: [form('Rounded binary', [
      phrase('A', 'statement', 'none', 'statement', 1, 'tonic'),
      phrase('A′', 'first close', 'open', 'variation', 2, 'dominant'),
      phrase('B', 'departure', 'weak', 'sequence', 3, 'departure', { registerShift: 2 }),
      phrase('A″', 'recapitulation', 'strong', 'return', 2, 'cadence'),
    ])],
  },
  folk: {
    1: [form('Four-bar folk strain', [phrase('A', 'strain', 'strong', 'statement', 1, 'closure')])],
    2: [form('Strophic period', [
      phrase('A', 'call', 'weak', 'statement', 1, 'tonic'),
      phrase('A′', 'answer', 'strong', 'return', 2, 'cadence'),
    ])],
    3: [form('Folk refrain', [
      phrase('A', 'verse', 'weak', 'statement', 1, 'tonic'),
      phrase('B', 'response', 'open', 'sequence', 2, 'subdominant'),
      phrase('A′', 'refrain', 'strong', 'return', 2, 'cadence'),
    ])],
    4: [form('Strophic refrain', [
      phrase('A', 'verse', 'none', 'statement', 1, 'tonic'),
      phrase('A′', 'verse answer', 'weak', 'variation', 2, 'subdominant'),
      phrase('B', 'refrain lift', 'open', 'sequence', 3, 'dominant'),
      phrase('A″', 'refrain close', 'strong', 'return', 2, 'cadence'),
    ])],
  },
  pop: {
    1: [form('Hook phrase', [phrase('A', 'hook', 'strong', 'statement', 2, 'closure')])],
    2: [form('Verse–refrain', [
      phrase('A', 'verse', 'open', 'statement', 1, 'tonic'),
      phrase('B', 'refrain', 'strong', 'return', 3, 'cadence', { registerShift: 2, density: 3 }),
    ])],
    3: [form('Verse–pre-chorus–chorus', [
      phrase('A', 'verse', 'weak', 'statement', 1, 'tonic'),
      phrase('B', 'pre-chorus', 'open', 'fragment', 2, 'dominant', { registerShift: 1, density: 3 }),
      phrase('C', 'chorus', 'strong', 'return', 3, 'cadence', { registerShift: 2, density: 3 }),
    ])],
    4: [form('Verse–pre-chorus–chorus', [
      phrase('A', 'verse', 'none', 'statement', 1, 'tonic'),
      phrase('A′', 'verse development', 'weak', 'variation', 1, 'subdominant'),
      phrase('B', 'pre-chorus', 'open', 'fragment', 2, 'dominant', { registerShift: 1, density: 3 }),
      phrase('C', 'chorus', 'strong', 'return', 3, 'cadence', { registerShift: 2, density: 3 }),
    ])],
  },
  blues: {
    1: [form('Four-bar blues riff', [phrase('A', 'riff', 'turn', 'statement', 2, 'turn')])],
    2: [form('Eight-bar blues', [
      phrase('A', 'call', 'turn', 'statement', 2, 'tonic'),
      phrase('A′', 'response', 'turn', 'variation', 2, 'turn'),
    ])],
    3: [form('Twelve-bar blues', [
      phrase('A', 'call', 'turn', 'statement', 2, 'tonic'),
      phrase('A′', 'response', 'open', 'variation', 2, 'subdominant'),
      phrase('B', 'turnaround', 'turn', 'fragment', 3, 'turn', { registerShift: 1, density: 3 }),
    ])],
  },
  waltz: {
    1: [form('Waltz strain', [phrase('A', 'strain', 'strong', 'statement', 1, 'closure')])],
    2: [form('Waltz period', [
      phrase('A', 'antecedent', 'weak', 'statement', 1, 'tonic'),
      phrase('A′', 'consequent', 'strong', 'return', 2, 'cadence'),
    ])],
    3: [form('Minuet form', [
      phrase('A', 'dance strain', 'weak', 'statement', 1, 'tonic'),
      phrase('B', 'trio contrast', 'open', 'sequence', 2, 'departure', { registerShift: 1 }),
      phrase('A′', 'da capo return', 'strong', 'return', 2, 'cadence'),
    ])],
    4: [form('Rounded waltz binary', [
      phrase('A', 'opening strain', 'none', 'statement', 1, 'tonic'),
      phrase('A′', 'first close', 'open', 'variation', 2, 'dominant'),
      phrase('B', 'contrasting strain', 'weak', 'sequence', 3, 'departure', { registerShift: 1 }),
      phrase('A″', 'rounded return', 'strong', 'return', 2, 'cadence'),
    ])],
  },
};

function extendedForm(styleId, count) {
  const base = LIBRARY[styleId]?.[4]?.[0] || LIBRARY.classical[4][0];
  const phrases = base.phrases.map((item) => ({ ...item }));
  while (phrases.length < count) {
    const beforeFinal = phrases.length - 1;
    const source = phrases[Math.max(0, beforeFinal - 1)] || phrases[0];
    phrases.splice(beforeFinal, 0, {
      ...source,
      section: `${source.section.charAt(0)}′`,
      function: source.function === 'departure' ? 'development' : 'continuation',
      transform: 'fragment',
      energy: Math.min(3, source.energy + 1),
      density: 3,
      cadenceStrength: 'weak',
      cadence: true,
    });
  }
  return form(styleId === 'pop' ? 'Extended song form' : 'Extended sectional form', phrases.slice(0, count));
}

/** Return a functional phrase plan for the selected style and length. */
export function formForStyle(styleId, phraseCount, rng = null) {
  const count = Math.max(1, phraseCount);
  const library = LIBRARY[styleId] || LIBRARY.classical;
  const variants = library[count] || [extendedForm(styleId, count)];
  const selected = rng?.pick ? rng.pick(variants) : variants[0];
  const phrases = selected.phrases.map((item, index) => ({ ...item, index }));
  return {
    name: selected.name,
    sections: phrases.map((item) => item.section),
    phrases,
  };
}
