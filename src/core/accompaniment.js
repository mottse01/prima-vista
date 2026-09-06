// Left-hand accompaniment textures.
//
// Every texture named by a level or a style pack is realised here, by its own
// id. Nothing is aliased: if a texture cannot be played in the current meter,
// at the current subdivision, or inside the current hand span, the realiser
// declines and the caller falls back explicitly rather than silently emitting
// a block chord under a different name.

import {
  TPQ, fromDia, isStructuralAlteration, keyAlterations, spellChordTone, spellInKey, tonicLetter,
} from './theory.js';
import { spellVoicing, voiceChordSequence } from './harmony.js';

/**
 * Texture catalogue.
 *
 * `minUnit`  smallest note value the figure needs, in ticks.
 * `beats`    how many beats of the slot the figure needs to be recognisable.
 * `span`     widest reach the hand must hold at one moment, in diatonic steps.
 * `meters`   null for any meter, otherwise the meters the figure belongs to.
 */
export const TEXTURES = [
  { id: 'root_fifth', label: 'Roots and fifths', minUnit: TPQ, beats: 1, span: 5 },
  { id: 'block_chord', label: 'Block chords', minUnit: TPQ, beats: 1, span: 5 },
  { id: 'sustained', label: 'Sustained chords', minUnit: TPQ, beats: 1, span: 5 },
  { id: 'pad', label: 'Open fifth pad', minUnit: TPQ, beats: 1, span: 5 },
  { id: 'bass_pulse', label: 'Repeated bass notes', minUnit: TPQ, beats: 2, span: 1 },
  { id: 'chord_pulse', label: 'Repeated chords', minUnit: TPQ, beats: 2, span: 5 },
  { id: 'pedal', label: 'Pedal point', minUnit: TPQ, beats: 1, span: 1 },
  { id: 'alberti', label: 'Alberti bass', minUnit: TPQ / 2, beats: 2, span: 1 },
  { id: 'broken_chord', label: 'Broken chord', minUnit: TPQ / 2, beats: 2, span: 1 },
  { id: 'broken_octave', label: 'Broken octaves', minUnit: TPQ / 2, beats: 2, span: 1 },
  { id: 'octave_bass', label: 'Octave bass', minUnit: TPQ, beats: 1, span: 8 },
  { id: 'arpeggio_wide', label: 'Wide arpeggio', minUnit: TPQ / 2, beats: 2, span: 1 },
  { id: 'walking', label: 'Walking bass', minUnit: TPQ, beats: 2, span: 1 },
  { id: 'stride', label: 'Stride bass', minUnit: TPQ, beats: 2, span: 5, meters: ['simple'] },
  { id: 'waltz', label: 'Waltz (bass–chord–chord)', minUnit: TPQ, beats: 3, span: 5, meters: ['simple'] },
  { id: 'boogie', label: 'Boogie figure', minUnit: TPQ / 2, beats: 2, span: 1 },
  { id: 'habanera', label: 'Habanera', minUnit: TPQ / 4, beats: 2, span: 5, meters: ['simple'] },
  { id: 'contrapuntal', label: 'Independent line', minUnit: TPQ / 4, beats: 1, span: 1 },
];

const BY_ID = new Map(TEXTURES.map((item) => [item.id, item]));
export const textureById = (id) => BY_ID.get(id) || null;

/**
 * Values written into saved profiles and shared links before textures were
 * realised individually. Each maps to the figure that value actually produced,
 * so an old link still opens music of the same kind.
 */
const LEGACY_IDS = {
  roots: 'root_fifth',
  blocked: 'block_chord',
  broken: 'broken_chord',
  melodic: 'contrapuntal',
};

export const TEXTURE_IDS = Object.freeze(TEXTURES.map((item) => item.id));
export const normaliseTexture = (id) => (BY_ID.has(id) ? id : LEGACY_IDS[id] || id);

/**
 * The texture a study will actually be built on.
 *
 * A figure that this meter, subdivision or hand span cannot carry is replaced
 * here, once and visibly, so the exercise is labelled with the figure it plays
 * rather than with the one that was asked for.
 */
export function resolveTexture(requested, permitted) {
  const id = normaliseTexture(requested);
  if (id === 'contrapuntal' || permitted.includes(id)) return id;
  return permitted[permitted.length - 1] || 'block_chord';
}

/** Textures a hand can physically play at this level, in descending richness. */
export function playableTextures(ids, { ts, minDuration, handSpan, slotTicks }) {
  const meter = ts.compound ? 'compound' : 'simple';
  const slotBeats = slotTicks / ts.beat;
  return ids
    .map(normaliseTexture)
    .filter((id) => {
      const texture = BY_ID.get(id);
      if (!texture || id === 'contrapuntal') return false;
      if (texture.meters && !texture.meters.includes(meter)) return false;
      if (texture.minUnit < minDuration) return false;
      if (texture.span > handSpan) return false;
      return slotBeats >= texture.beats;
    });
}

// ---------------------------------------------------------------------------
// Figure helpers
// ---------------------------------------------------------------------------

/**
 * Smallest writable subdivision that divides the slot. A figure named for its
 * motion — broken, arpeggiated, boogie — should move at the fastest value the
 * level allows, not settle for the widest one that happens to fit.
 */
function movingUnit(slotTicks, candidates, minDuration) {
  const usable = candidates
    .filter((unit) => unit >= minDuration && slotTicks % unit === 0)
    .sort((a, b) => a - b);
  return usable[0] || null;
}

/** Chord-tone diatonic step nearest a reference, searching upward from a floor. */
function chordToneNear(chordDias, reference) {
  let best = chordDias[0];
  let bestDistance = Infinity;
  for (const dia of chordDias) {
    const distance = Math.abs(dia - reference);
    if (distance < bestDistance) { bestDistance = distance; best = dia; }
  }
  return best;
}

/** Every diatonic step in range that sounds a tone of this chord. */
function chordDiasInRange(key, chord, lowDia, highDia) {
  const wanted = new Set();
  const root = (chord.degree + tonicLetter(key)) % 7;
  wanted.add(((root % 7) + 7) % 7);
  wanted.add(((root + 2) % 7 + 7) % 7);
  wanted.add(((root + 4) % 7 + 7) % 7);
  if (chord.seventh) wanted.add(((root + 6) % 7 + 7) % 7);
  const out = [];
  for (let dia = lowDia; dia <= highDia; dia++) {
    if (wanted.has(((dia % 7) + 7) % 7)) out.push(dia);
  }
  return out;
}

/**
 * A bass line from one chord's bass note into the next.
 *
 * Interior beats take chord tones; the last beat approaches the next bass note
 * by step, chromatically from below when the style and the accidental budget
 * both allow it. This is what makes a walking bass a line rather than a list
 * of roots.
 */
function walkingPath(rng, {
  key, chord, startDia, targetDia, count, lowDia, highDia, allowChromatic,
}) {
  if (count <= 1) return [{ dia: startDia }];
  const tones = chordDiasInRange(key, chord, lowDia, highDia);
  const path = [{ dia: startDia }];
  const direction = targetDia === startDia
    ? (startDia - lowDia > highDia - startDia ? -1 : 1)
    : Math.sign(targetDia - startDia);

  for (let step = 1; step < count - 1; step++) {
    const previous = path[step - 1].dia;
    const wanted = previous + direction * 2;
    const options = tones.filter((dia) => dia !== previous && Math.abs(dia - previous) <= 4);
    const dia = options.length ? chordToneNear(options, wanted) : previous;
    path.push({ dia });
  }

  // The approach. A diatonic step into the target always works; a chromatic
  // half step from below is the idiomatic jazz and blues approach.
  const from = path[path.length - 1].dia;
  const above = targetDia + 1;
  const below = targetDia - 1;
  const preferred = Math.abs(from - below) <= Math.abs(from - above) ? below : above;
  const approach = preferred >= lowDia && preferred <= highDia ? preferred : (preferred === below ? above : below);
  if (approach < lowDia || approach > highDia) {
    path.push({ dia: chordToneNear(tones, targetDia) });
    return path;
  }
  const chromatic = allowChromatic && approach === below && rng.chance(0.45)
    ? { dia: approach, chromatic: true }
    : { dia: approach };
  path.push(chromatic);
  return path;
}

// ---------------------------------------------------------------------------
// Realisers
// ---------------------------------------------------------------------------

/**
 * Each realiser returns events for one harmonic slot, or null when the figure
 * cannot be played here. Returning null is a real answer: the caller falls back
 * to a simpler named texture instead of pretending the figure was played.
 */
const REALISERS = {
  root_fifth(ctx) {
    const { spelled, slotTicks, onset, lift } = ctx;
    const fifth = spelled.length > 2 ? spelled[2] : spelled.at(-1);
    const pitches = lift && fifth && fifth.midi !== spelled[0].midi ? [spelled[0], fifth] : [spelled[0]];
    return [ctx.mk(onset, slotTicks, pitches, ['root'])];
  },

  block_chord(ctx) {
    return [ctx.mk(ctx.onset, ctx.slotTicks, ctx.spelled, ['blocked'])];
  },

  sustained(ctx) {
    return [ctx.mk(ctx.onset, ctx.slotTicks, ctx.spelled, ['blocked', 'sustained'])];
  },

  pad(ctx) {
    const { spelled, key, chord, voicing, lowDia, highDia } = ctx;
    const fifthDia = voicing[0] + 4;
    if (fifthDia > highDia || fifthDia < lowDia) return null;
    const fifth = spellChordTone(key, chord, fifthDia);
    return [ctx.mk(ctx.onset, ctx.slotTicks, [spelled[0], fifth], ['pad'])];
  },

  pedal(ctx) {
    const { pedalDia, key } = ctx;
    if (pedalDia == null) return null;
    return [ctx.mk(ctx.onset, ctx.slotTicks, [spellInKey(key, pedalDia)], ['pedal'])];
  },

  bass_pulse(ctx) {
    const { spelled, slotTicks, onset, ts } = ctx;
    const unit = ts.beat;
    if (unit < ctx.minDuration || slotTicks % unit !== 0 || slotTicks / unit < 2) return null;
    return ctx.tile(onset, slotTicks, unit, () => [spelled[0]], 'bass-pulse');
  },

  chord_pulse(ctx) {
    const { spelled, slotTicks, onset, ts } = ctx;
    // Restate at the widest value that still gives the bar a pulse: every two
    // beats where the meter divides in two, every beat in a three-beat bar.
    const unit = [ts.beat * 2, ts.beat]
      .find((value) => value >= ctx.minDuration && slotTicks % value === 0 && slotTicks / value >= 2);
    if (!unit) return null;
    return ctx.tile(onset, slotTicks, unit, () => spelled, 'chord-pulse');
  },

  alberti(ctx) {
    const { spelled, slotTicks, onset } = ctx;
    if (spelled.length < 3) return null;
    const unit = movingUnit(slotTicks, [TPQ / 2, TPQ], ctx.minDuration);
    if (!unit) return null;
    // Low, high, middle, high — the classical figure.
    const order = [0, spelled.length - 1, 1, spelled.length - 1];
    return ctx.tile(onset, slotTicks, unit, (i) => [spelled[order[i % order.length]]], 'alberti');
  },

  broken_chord(ctx) {
    const { spelled, slotTicks, onset, ts } = ctx;
    const unit = movingUnit(slotTicks, ts.compound ? [TPQ / 2, TPQ * 1.5] : [TPQ / 2, TPQ], ctx.minDuration);
    if (!unit) return null;
    const top = spelled[Math.min(2, spelled.length - 1)];
    const middle = spelled[Math.min(1, spelled.length - 1)];
    const cycle = [spelled[0], middle, top, middle];
    return ctx.tile(onset, slotTicks, unit, (i) => [cycle[i % cycle.length]], 'broken');
  },

  broken_octave(ctx) {
    const { voicing, key, chord, slotTicks, onset, highDia } = ctx;
    const octaveDia = voicing[0] + 7;
    if (octaveDia > highDia) return null;
    const unit = movingUnit(slotTicks, [TPQ / 2, TPQ], ctx.minDuration);
    if (!unit) return null;
    const low = spellChordTone(key, chord, voicing[0]);
    const high = spellChordTone(key, chord, octaveDia);
    return ctx.tile(onset, slotTicks, unit, (i) => [i % 2 === 0 ? low : high], 'broken-octave');
  },

  octave_bass(ctx) {
    const { voicing, key, chord, highDia } = ctx;
    const octaveDia = voicing[0] + 7;
    if (octaveDia > highDia) return null;
    const pitches = [spellChordTone(key, chord, voicing[0]), spellChordTone(key, chord, octaveDia)];
    return [ctx.mk(ctx.onset, ctx.slotTicks, pitches, ['octave'])];
  },

  arpeggio_wide(ctx) {
    const { voicing, key, chord, slotTicks, onset, highDia } = ctx;
    const shape = [0, 4, 7, 9].map((offset) => voicing[0] + offset);
    if (shape.at(-1) > highDia) return null;
    const unit = movingUnit(slotTicks, [TPQ / 2, TPQ], ctx.minDuration);
    if (!unit) return null;
    const pitches = shape.map((dia) => spellChordTone(key, chord, dia));
    return ctx.tile(onset, slotTicks, unit, (i) => [pitches[i % pitches.length]], 'wide-arpeggio');
  },

  walking(ctx) {
    const {
      rng, key, chord, voicing, nextVoicing, slotTicks, onset, ts, lowDia, highDia, allowChromatic,
    } = ctx;
    const unit = ts.compound ? ts.beat : TPQ;
    if (unit < ctx.minDuration || slotTicks % unit !== 0) return null;
    const count = slotTicks / unit;
    if (count < 2) return null;
    const path = walkingPath(rng, {
      key, chord, startDia: voicing[0], targetDia: (nextVoicing || voicing)[0],
      count, lowDia, highDia, allowChromatic,
    });
    return path.map((step, index) => {
      const base = spellChordTone(key, chord, step.dia);
      const pitch = step.chromatic ? ctx.raise(step.dia, base) : base;
      return ctx.mk(onset + index * unit, unit, [pitch], index === 0 ? ['bass', 'walking'] : ['walking']);
    });
  },

  stride(ctx) {
    const {
      spelled, voicing, key, chord, slotTicks, onset, ts, highDia,
    } = ctx;
    const beat = ts.beat;
    if (beat < ctx.minDuration || slotTicks % beat !== 0) return null;
    const beats = slotTicks / beat;
    if (beats < 2) return null;
    const upper = spelled.length > 1 ? spelled.slice(1) : spelled;
    const fifthDia = voicing[0] + 4;
    const alternate = fifthDia <= highDia ? spellChordTone(key, chord, fifthDia) : spelled[0];
    const events = [];
    for (let index = 0; index < beats; index++) {
      const at = onset + index * beat;
      if (index % 2 === 0) {
        const bass = index === 0 ? spelled[0] : alternate;
        events.push(ctx.mk(at, beat, [bass], ['bass', 'stride']));
      } else {
        events.push(ctx.mk(at, beat, upper, ['chord', 'stride']));
      }
    }
    return events;
  },

  waltz(ctx) {
    const { spelled, slotTicks, onset, ts } = ctx;
    if (ts.compound || ts.beats !== 3 || slotTicks !== ts.ticks) return null;
    if (ts.beat < ctx.minDuration) return null;
    const upper = spelled.length > 1 ? spelled.slice(1) : spelled;
    return [
      ctx.mk(onset, ts.beat, [spelled[0]], ['bass', 'waltz']),
      ctx.mk(onset + ts.beat, ts.beat, upper, ['chord', 'waltz']),
      ctx.mk(onset + 2 * ts.beat, ts.beat, upper, ['chord', 'waltz']),
    ];
  },

  boogie(ctx) {
    const { voicing, key, chord, slotTicks, onset, highDia } = ctx;
    const unit = movingUnit(slotTicks, [TPQ / 2], ctx.minDuration);
    if (!unit) return null;
    const shape = [0, 2, 4, 5].map((offset) => voicing[0] + offset);
    if (shape.at(-1) > highDia) return null;
    const pitches = shape.map((dia, index) => (
      index === 3 ? spellInKey(key, dia) : spellChordTone(key, chord, dia)
    ));
    // Up and back down: 1–3–5–6–5–3, the shuffle figure, cycled to fill.
    const cycle = [pitches[0], pitches[1], pitches[2], pitches[3], pitches[2], pitches[1]];
    return ctx.tile(onset, slotTicks, unit, (i) => [cycle[i % cycle.length]], 'boogie');
  },

  habanera(ctx) {
    const { spelled, slotTicks, onset, ts } = ctx;
    const cell = ts.beat * 2;
    if (ts.compound || slotTicks % cell !== 0) return null;
    const sixteenth = ts.beat / 4;
    if (sixteenth < ctx.minDuration) return null;
    const upper = spelled.length > 1 ? spelled.slice(1) : spelled;
    const events = [];
    for (let at = onset; at < onset + slotTicks; at += cell) {
      events.push(ctx.mk(at, sixteenth * 3, [spelled[0]], ['bass', 'habanera']));
      events.push(ctx.mk(at + sixteenth * 3, sixteenth, [spelled[0]], ['bass', 'habanera']));
      events.push(ctx.mk(at + ts.beat, ts.beat / 2, upper, ['chord', 'habanera']));
      events.push(ctx.mk(at + ts.beat + ts.beat / 2, ts.beat / 2, upper, ['chord', 'habanera']));
    }
    return events;
  },
};

/** Simpler figure to try when a texture declines, ending at a plain block chord. */
const FALLBACK = {
  bass_pulse: 'root_fifth',
  chord_pulse: 'block_chord',
  walking: 'bass_pulse',
  stride: 'block_chord',
  waltz: 'block_chord',
  habanera: 'block_chord',
  boogie: 'broken_chord',
  arpeggio_wide: 'broken_chord',
  broken_octave: 'broken_chord',
  octave_bass: 'root_fifth',
  broken_chord: 'root_fifth',
  alberti: 'root_fifth',
  pad: 'root_fifth',
  pedal: 'root_fifth',
  root_fifth: 'block_chord',
  sustained: 'block_chord',
  block_chord: null,
};

// ---------------------------------------------------------------------------
// Texture plan
// ---------------------------------------------------------------------------

/**
 * Choose a texture for each formal unit rather than one for the whole study.
 *
 * The stated idea keeps the requested texture so the piece has an identity;
 * restatements and higher-energy sections may take a related figure from the
 * same permitted set. Cadence bars always settle onto held chords.
 */
export function planTextures(rng, {
  texture, form, measures, allowed, varyFrom = 5,
}) {
  const plan = Array.from({ length: measures }, () => texture);
  const pool = allowed.filter((id) => id !== texture);
  if (!pool.length || !form?.units || form.units.length < 2 || measures < varyFrom) return plan;

  for (const unit of form.units) {
    if (unit.index === 0) continue;
    const energetic = (unit.energy || 1) > 1;
    // Contrasting sections earn a different figure; restatements usually keep
    // the one the ear already knows.
    if (!rng.chance(energetic ? 0.7 : 0.25)) continue;
    const choice = rng.pick(pool);
    for (let bar = unit.bars[0]; bar <= unit.bars[1] && bar < measures; bar++) plan[bar] = choice;
  }
  return plan;
}

/**
 * Let the accompaniment breathe.
 *
 * A bass that never stops is easy to write and unlike any real keyboard part.
 * Dropping the last attack of a phrase leaves the melody exposed at the
 * cadence, which is both an ordinary piece of keyboard writing and a reading
 * skill: the left hand has to count a rest rather than ride the pulse.
 */
export function addAccompanimentBreath(rng, notes, {
  ts, form, measures, chance = 0.5,
}) {
  if (!chance || !rng.chance(chance)) return notes;
  const perBar = new Map();
  for (const note of notes) {
    if (note.rest) continue;
    const bar = Math.floor(note.onset / ts.ticks);
    perBar.set(bar, [...(perBar.get(bar) || []), note]);
  }
  const candidates = [];
  for (const unit of form?.units || []) {
    const bar = unit.bars[1];
    if (bar >= measures - 1) continue;
    const inBar = perBar.get(bar) || [];
    if (inBar.length < 3) continue;
    candidates.push(inBar[inBar.length - 1]);
  }
  if (!candidates.length) return notes;
  const chosen = rng.pick(candidates);
  return notes.map((note) => (note === chosen ? {
    ...note,
    rest: true,
    pitches: [],
    tags: [...new Set([...(note.tags || []), 'rest', 'accompaniment-breath'])],
  } : note));
}

/**
 * Push a chord in front of its own downbeat.
 *
 * The anticipation — the left hand arriving an eighth early and holding
 * through the barline — is the gesture that makes pop, gospel and Latin
 * accompaniments feel like they are pulling the music forward. It needs a
 * chord attacked before the barline it belongs to, which is only possible now
 * that an accompaniment event may outlive its own bar.
 */
export function anticipateDownbeat(rng, notes, {
  ts, form, measures, minDuration = 1, chance = 0,
}) {
  const push = ts.beat / 2;
  if (!chance || push < minDuration || !rng.chance(chance)) return notes;
  const sorted = [...notes].sort((a, b) => a.onset - b.onset);

  const candidates = [];
  for (let index = 1; index < sorted.length; index++) {
    const arrival = sorted[index];
    const previous = sorted[index - 1];
    if (arrival.rest || previous.rest) continue;
    const bar = arrival.onset / ts.ticks;
    if (!Number.isInteger(bar) || bar < 1 || bar >= measures - 1) continue;
    // Anticipating across a formal seam blurs the seam; inside a phrase it is
    // a groove. A cadence bar keeps its downbeat.
    if ((form?.plan?.[bar - 1]?.unitIndex ?? 0) !== (form?.plan?.[bar]?.unitIndex ?? 0)) continue;
    if (form?.plan?.[bar]?.cadence || form?.plan?.[bar - 1]?.cadence) continue;
    if (previous.onset + previous.duration !== arrival.onset) continue;
    if (previous.duration - push < minDuration) continue;
    candidates.push(index);
  }
  if (!candidates.length) return notes;

  const index = rng.pick(candidates);
  const previous = sorted[index - 1];
  const arrival = sorted[index];
  return sorted.map((note) => {
    if (note === previous) return { ...note, duration: note.duration - push };
    if (note === arrival) {
      return {
        ...note,
        onset: note.onset - push,
        duration: note.duration + push,
        tags: [...new Set([...(note.tags || []), 'anticipation', 'syncopation'])],
      };
    }
    return note;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Realise a complete left-hand accompaniment.
 *
 * Returns notes sorted by onset. Each note carries the texture that produced it
 * so the critic can check that the music matches the figure it claims.
 */
export function buildAccompaniment(rng, opts) {
  const {
    key, ts, chords, chordsPerMeasure, measures, texture, lowDia, highDia, form,
    compositionStyle, maxSimultaneous = 5, upperStaff = [], chromaticBudget = null,
    minDuration = 1, handSpan = 8, allowedTextures = null, allowChromatic = false,
    allowInversions = true, breathChance = 0, anticipationChance = 0,
  } = opts;

  const slotTicks = ts.ticks / chordsPerMeasure;
  const voicings = voiceChordSequence(key, chords, {
    lowDia, highDia, upperStaff, slotTicks,
    forbidOuterParallels: compositionStyle?.pack.validator.forbid_outer_parallels,
    preferStepwiseBass: true,
    rootPositionOnly: !allowInversions,
  });

  const permitted = playableTextures(
    allowedTextures && allowedTextures.length ? allowedTextures : [normaliseTexture(texture)],
    { ts, minDuration, handSpan, slotTicks },
  );
  const requested = resolveTexture(texture, permitted);
  const barTextures = planTextures(rng, {
    texture: requested, form, measures,
    allowed: permitted.filter((id) => id !== requested),
  });

  const signature = keyAlterations(key.fifths);
  const notes = [];
  const pedalDia = voicings[0] ? voicings[0][0] : null;

  for (let measure = 0; measure < measures; measure++) {
    for (let slot = 0; slot < chordsPerMeasure; slot++) {
      const index = Math.min(chords.length - 1, measure * chordsPerMeasure + slot);
      const chord = chords[index];
      const voicing = voicings[Math.min(voicings.length - 1, index)];
      const nextVoicing = voicings[Math.min(voicings.length - 1, index + 1)];
      const onset = measure * ts.ticks + slot * slotTicks;
      const spelled = spellVoicing(key, chord, voicing).slice(0, maxSimultaneous);
      const isFinal = measure === measures - 1;
      const phraseSpec = form?.plan?.[measure] || null;
      const lift = compositionStyle?.id === 'pop_contemporary' && (phraseSpec?.energy || 1) >= 3;

      const ctx = {
        rng, key, ts, chord, voicing, nextVoicing, spelled, onset, slotTicks,
        lowDia, highDia, minDuration, maxSimultaneous, lift, pedalDia, allowChromatic,
        mk, tile, raise,
      };

      // The last bar of a study is an arrival, not a figure.
      let id = isFinal ? 'block_chord' : barTextures[measure];
      // A pedal point holds one note under changing harmony, so it cannot also
      // state a cadence chord's own bass. Pedals resolve at the cadence, which
      // is what they do in the repertoire too.
      if (id === 'pedal' && phraseSpec?.cadence) id = FALLBACK.pedal;
      let events = null;
      let guard = 0;
      while (id && !events && guard++ < 6) {
        events = REALISERS[id] ? REALISERS[id](ctx) : null;
        if (!events) id = FALLBACK[id];
      }
      if (!events) events = REALISERS.block_chord(ctx);
      for (const event of events) event.texture = id || 'block_chord';
      notes.push(...events);
    }
  }

  const breathed = addAccompanimentBreath(rng, notes.sort((a, b) => a.onset - b.onset), {
    ts, form, measures, chance: breathChance,
  });
  return anticipateDownbeat(rng, breathed, {
    ts, form, measures, minDuration, chance: anticipationChance,
  });

  /** Raise a diatonic step by a half step for a chromatic approach note. */
  function raise(dia, base) {
    return fromDia(dia, Math.max(-2, Math.min(2, base.alter + 1)));
  }

  function mk(onset, duration, pitches, tags) {
    const chord = chords[Math.min(chords.length - 1, Math.floor(onset / slotTicks))];
    const list = pitches.length ? pitches : [spellChordTone(key, chord, voicings[0][0])];
    const constrained = list.slice(0, maxSimultaneous).map((pitch) => {
      if (!chromaticBudget || pitch.alter === signature[pitch.letter]
        || isStructuralAlteration(key, chord, pitch)) return pitch;
      if (chromaticBudget.remaining > 0) {
        chromaticBudget.remaining -= 1;
        return pitch;
      }
      return spellInKey(key, pitch.dia);
    });
    return {
      onset, duration, rest: false, tags, cellId: 'lh', pitches: constrained,
    };
  }

  /** Repeat a figure across a slot, never spilling past its end. */
  function tile(onset, slotTicks, unit, pick, tag) {
    const out = [];
    let cursor = 0;
    for (let index = 0; cursor < slotTicks; index++) {
      const duration = Math.min(unit, slotTicks - cursor);
      if (duration < minDuration) {
        const previous = out.at(-1);
        if (previous) previous.duration += duration;
        break;
      }
      out.push(mk(onset + cursor, duration, pick(index), [tag]));
      cursor += duration;
    }
    return out;
  }
}
