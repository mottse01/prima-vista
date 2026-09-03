// Music theory primitives.
//
// Pitches are carried as spelled objects so the engraver can draw the right
// accidental and the right staff position: MIDI 61 is D-flat in A-flat major
// and C-sharp in D major, and those sit on different lines.

export const TPQ = 48; // ticks per quarter note; divisible by 3 and 16

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** Build a spelled pitch from letter index (0=C..6=B), alteration and octave. */
export function pitch(letter, alter, octave) {
  const l = ((letter % 7) + 7) % 7;
  return {
    letter: l,
    alter,
    octave,
    midi: (octave + 1) * 12 + LETTER_SEMITONES[l] + alter,
    // Absolute diatonic index: one step per staff position. C4 -> 28.
    dia: octave * 7 + l,
  };
}

/** Rebuild a pitch from an absolute diatonic index plus an alteration. */
export function fromDia(dia, alter = 0) {
  const octave = Math.floor(dia / 7);
  return pitch(dia - octave * 7, alter, octave);
}

export function pitchName(p) {
  const acc = p.alter === 0 ? '' : p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return LETTERS[p.letter] + acc + p.octave;
}

/** Letter name without octave — used for the note-accuracy heatmap. */
export function pitchClassName(p) {
  const acc = p.alter === 0 ? '' : p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return LETTERS[p.letter] + acc;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

// Order sharps and flats appear in a key signature.
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; //  B E A D G C F

// fifths -> tonic letter/alter for major and its relative minor.
const MAJOR_TONICS = {
  '-7': [0, -1], '-6': [4, -1], '-5': [1, -1], '-4': [5, -1],
  '-3': [2, -1], '-2': [6, -1], '-1': [3, 0], 0: [0, 0],
  1: [4, 0], 2: [1, 0], 3: [5, 0], 4: [2, 0], 5: [6, 0], 6: [3, 1], 7: [0, 1],
};

export const KEY_NAMES = {
  major: {
    '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb',
    '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
  },
  minor: {
    '-7': 'ab', '-6': 'eb', '-5': 'bb', '-4': 'f', '-3': 'c', '-2': 'g',
    '-1': 'd', 0: 'a', 1: 'e', 2: 'b', 3: 'f#', 4: 'c#', 5: 'g#', 6: 'd#', 7: 'a#',
  },
};

export function keyLabel(key) {
  return `${KEY_NAMES[key.mode][String(key.fifths)]} ${key.mode}`;
}

/** Alteration each letter carries in a key signature with `fifths` accidentals. */
export function keyAlterations(fifths) {
  const alt = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) for (let i = 0; i < fifths; i++) alt[SHARP_ORDER[i]] = 1;
  else for (let i = 0; i < -fifths; i++) alt[FLAT_ORDER[i]] = -1;
  return alt;
}

/** Tonic letter index for a key (minor tonic sits a third below the relative major). */
export function tonicLetter(key) {
  const [letter] = MAJOR_TONICS[String(key.fifths)];
  return key.mode === 'minor' ? (letter + 5) % 7 : letter;
}

/**
 * Absolute diatonic index for scale degree `degree` (0-based) of `key`,
 * in the octave whose tonic is nearest to (and not above) `nearDia`.
 */
export function degreeDia(key, degree, nearDia) {
  const tl = tonicLetter(key);
  const base = Math.round((nearDia - tl) / 7) * 7 + tl;
  return base + degree;
}

/**
 * Spell a diatonic index inside a key, applying the key signature plus any
 * mode-specific alteration (raised 7th / raised 6th in minor).
 */
export function spellInKey(key, dia, { raisedSeventh = false, raisedSixth = false } = {}) {
  const alts = keyAlterations(key.fifths);
  const letter = ((dia % 7) + 7) % 7;
  let alter = alts[letter];
  if (key.mode === 'minor') {
    const tl = tonicLetter(key);
    const degree = ((letter - tl) % 7 + 7) % 7;
    if (raisedSeventh && degree === 6) alter += 1;
    if (raisedSixth && degree === 5) alter += 1;
  }
  return fromDia(dia, alter);
}

// ---------------------------------------------------------------------------
// Chords — described by scale degree so the harmony engine stays key-agnostic.
// ---------------------------------------------------------------------------

/**
 * Realise a roman-numeral chord as a set of diatonic indices (root position)
 * near a reference diatonic index.
 */
export function chordTones(key, chord, nearDia) {
  const rootDia = degreeDia(key, chord.degree, nearDia);
  const tones = [0, 2, 4];
  if (chord.seventh) tones.push(6);
  return tones.map((t) => rootDia + t);
}

/** Spell a chord tone, honouring harmonic-minor leading tones on V and vii. */
export function spellChordTone(key, chord, dia) {
  const needsLeadingTone =
    key.mode === 'minor' && (chord.degree === 4 || chord.degree === 6);
  const spelled = spellInKey(key, dia, { raisedSeventh: needsLeadingTone });
  const tl = tonicLetter(key);
  const degree = (((dia - tl) % 7) + 7) % 7;
  const chordMember = ((degree - chord.degree) % 7 + 7) % 7;
  if (chord.bluesDominant && chordMember === 6) {
    return fromDia(dia, clamp(spelled.alter - 1, -2, 2));
  }
  return spelled;
}

/** True when `dia` is a member of `chord` (octave-agnostic). */
export function isChordTone(key, chord, dia) {
  const tl = tonicLetter(key);
  const rel = (((dia - tl) % 7) + 7) % 7;
  const members = [chord.degree, (chord.degree + 2) % 7, (chord.degree + 4) % 7];
  if (chord.seventh) members.push((chord.degree + 6) % 7);
  return members.includes(rel);
}

export const ROMAN = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor: ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°'],
};

export function chordLabel(key, chord) {
  return ROMAN[key.mode][chord.degree] + (chord.seventh ? '7' : '') + (chord.inversion === 1 ? '6' : chord.inversion === 2 ? '64' : '');
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export const CLEF_MIDDLE_DIA = { treble: 34, bass: 22 }; // B4 and D3 sit on the middle line

/**
 * Vertical staff position, in staff spaces from the top line, for a diatonic
 * index. 0 is the top line and 4 the bottom, so anything outside that range
 * needs ledger lines.
 */
export function diaToY(clef, dia) {
  return 2 - (dia - CLEF_MIDDLE_DIA[clef]) / 2;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Interval size in diatonic steps (1 = unison, 2 = second, ...). */
export function intervalSteps(a, b) {
  return Math.abs(a - b) + 1;
}
