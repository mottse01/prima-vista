// MusicXML export.
//
// The engraver is Verovio, which takes MusicXML, so this is the bridge from the
// generator's score model to a real notation engine. It is also a feature in
// its own right: the same file opens in MuseScore, Finale or Sibelius.

import { LETTERS, TPQ, keyAlterations } from './theory.js';

const SIMPLE_UNITS = [192, 144, 96, 72, 48, 36, 24, 18, 12, 6];
const COMPOUND_UNITS = [288, 144, 72, 36, 24, 12, 6];

/**
 * Split a duration into note values that can actually be written, to be joined
 * by ties. 5/4's whole bar becomes a whole tied to a quarter, and so on.
 */
function splitDuration(ticks, compound) {
  const units = compound ? COMPOUND_UNITS : SIMPLE_UNITS;
  const out = [];
  let left = ticks;
  let guard = 0;
  while (left > 0 && guard++ < 12) {
    const u = units.find((x) => x <= left);
    if (!u) break;
    out.push(u);
    left -= u;
  }
  return out.length ? out : [ticks];
}

const HEAD_BY_TICKS = {
  192: ['w', 0], 144: ['h', 1], 96: ['h', 0], 72: ['q', 1], 48: ['q', 0],
  36: ['8', 1], 24: ['8', 0], 18: ['16', 1], 12: ['16', 0], 6: ['32', 0],
  288: ['w', 1], 16: ['8', 0], 32: ['q', 0], 8: ['16', 0],
};

/** Notehead type, dot count, and beam count for a written duration. */
function glyphForDuration(ticks) {
  const entry = HEAD_BY_TICKS[ticks] || ['q', 0];
  const [head, dots] = entry;
  const beams = head === '8' ? 1 : head === '16' ? 2 : head === '32' ? 3 : 0;
  const tuplet = ticks === 16 || ticks === 32 || ticks === 8;
  return { head, dots, beams, tuplet };
}

const TYPE_NAMES = { w: 'whole', h: 'half', q: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };

const DYNAMIC_TAGS = new Set(['p', 'pp', 'mp', 'mf', 'f', 'ff']);

/**
 * Stable id for one sounding pitch, carried through MusicXML into the rendered
 * SVG so live colouring can find it. Must be a valid XML name, so it cannot
 * start with a digit.
 */
export const xmlNoteId = (hand, onset, midi) => `n${hand}-${onset}-${midi}`;

/** Rests are identified too, so the playhead can glide through silence. */
export const xmlRestId = (hand, onset) => `r${hand}-${onset}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Per-measure accidental memory, seeded from the key signature. */
function accidentalTracker(fifths) {
  const keyAlt = keyAlterations(fifths);
  let measure = new Map();
  return {
    reset() { measure = new Map(); },
    /** MusicXML accidental name to print, or null if it is already implied. */
    needed(p) {
      const slot = `${p.letter}:${p.octave}`;
      const current = measure.has(slot) ? measure.get(slot) : keyAlt[p.letter];
      if (current === p.alter) return null;
      measure.set(slot, p.alter);
      return { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' }[String(p.alter)];
    },
  };
}

/**
 * Expand one generated note into the notes actually written, splitting
 * durations that cannot be drawn as a single value into tied notes.
 */
function writtenNotes(note, compound) {
  const parts = splitDuration(note.duration, compound);
  let t = note.onset;
  return parts.map((d, i) => {
    const w = {
      onset: t,
      duration: d,
      rest: note.rest,
      pitches: note.pitches,
      source: note,
      tieFrom: i > 0,
      tieTo: i < parts.length - 1,
      ...glyphForDuration(d),
    };
    t += d;
    return w;
  });
}

/**
 * Beam runs of short notes inside a beam group, so Verovio draws beams rather
 * than a row of flags. Rests and quarter-or-longer notes break a run.
 */
function assignBeams(notes, ts) {
  for (const n of notes) n.beam = null;
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      run.forEach((n, i) => {
        n.beam = i === 0 ? 'begin' : i === run.length - 1 ? 'end' : 'continue';
      });
    }
    run = [];
  };
  for (const n of notes) {
    if (n.rest || n.beams === 0) { flush(); continue; }
    const prev = run[run.length - 1];
    const sameGroup = !prev
      || Math.floor((prev.onset % ts.ticks) / ts.beamGroup) === Math.floor((n.onset % ts.ticks) / ts.beamGroup);
    const contiguous = !prev || prev.onset + prev.duration === n.onset;
    if (prev && (!sameGroup || !contiguous)) flush();
    run.push(n);
  }
  flush();
}

function pitchXml(p) {
  const alter = p.alter ? `<alter>${p.alter}</alter>` : '';
  return `<pitch><step>${LETTERS[p.letter]}</step>${alter}<octave>${p.octave}</octave></pitch>`;
}

function notationsXml(w, { slurStart, slurStop, fingering }) {
  const bits = [];
  if (w.tieTo) bits.push('<tied type="start"/>');
  if (w.tieFrom) bits.push('<tied type="stop"/>');
  if (slurStop) bits.push('<slur number="1" type="stop"/>');
  if (slurStart) bits.push('<slur number="1" type="start"/>');
  const art = w.source.articulation;
  if (art && !w.tieFrom) {
    const tag = { staccato: 'staccato', accent: 'accent', tenuto: 'tenuto' }[art];
    if (tag) bits.push(`<articulations><${tag}/></articulations>`);
  }
  if (fingering != null) bits.push(`<technical><fingering>${fingering}</fingering></technical>`);
  return bits.length ? `<notations>${bits.join('')}</notations>` : '';
}

function noteXml(w, { staff, voice, hand, accidentals, slurStart, slurStop, fingering }) {
  const type = TYPE_NAMES[w.head] || 'quarter';
  const dots = '<dot/>'.repeat(w.dots);
  const tuplet = w.tuplet
    ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
    : '';

  if (w.rest) {
    return `<note id="${xmlRestId(hand, w.onset)}"><rest/><duration>${w.duration}</duration><voice>${voice}</voice>`
      + `<type>${type}</type>${dots}${tuplet}<staff>${staff}</staff></note>`;
  }

  return w.pitches.map((p, i) => {
    const chord = i > 0 ? '<chord/>' : '';
    const id = ` id="${xmlNoteId(hand, w.onset, p.midi)}"`;
    const acc = accidentals[i] ? `<accidental>${accidentals[i]}</accidental>` : '';
    // <tie> is the sounding tie; <tied> inside <notations> is the drawn slur.
    const ties = (w.tieTo ? '<tie type="start"/>' : '') + (w.tieFrom ? '<tie type="stop"/>' : '');
    const beam = i === 0 && w.beam ? `<beam number="1">${w.beam}</beam>` : '';
    const notations = i === 0
      ? notationsXml(w, { slurStart, slurStop, fingering })
      : (w.tieTo || w.tieFrom
        ? `<notations>${w.tieTo ? '<tied type="start"/>' : ''}${w.tieFrom ? '<tied type="stop"/>' : ''}</notations>`
        : '');
    return `<note${id}>${chord}${pitchXml(p)}${ties}<duration>${w.duration}</duration>`
      + `<voice>${voice}</voice><type>${type}</type>${dots}${acc}${tuplet}`
      + `<staff>${staff}</staff>${beam}${notations}</note>`;
  }).join('');
}

/**
 * Serialise a generated score as MusicXML.
 *
 * @param {object} score  from generateExercise
 * @param {object} opts   { showFingerings }
 */
export function toMusicXml(score, opts = {}) {
  const { ts, key } = score;
  const hands = [];
  if (score.staves.rh && score.staves.rh.length) hands.push({ hand: 'rh', staff: 1, voice: 1, clef: { sign: 'G', line: 2 } });
  if (score.staves.lh && score.staves.lh.length) hands.push({ hand: 'lh', staff: hands.length + 1, voice: 5, clef: { sign: 'F', line: 4 } });

  // Written notes per hand, grouped by measure, with beams resolved.
  const byHand = {};
  for (const h of hands) {
    const written = [];
    for (const n of score.staves[h.hand]) written.push(...writtenNotes(n, ts.compound));
    written.sort((a, b) => a.onset - b.onset);
    assignBeams(written, ts);
    const measures = Array.from({ length: score.measures }, () => []);
    for (const w of written) {
      measures[Math.min(score.measures - 1, Math.floor(w.onset / ts.ticks))].push(w);
    }
    byHand[h.hand] = measures;
  }

  const accidentals = {};
  for (const h of hands) accidentals[h.hand] = accidentalTracker(key.fifths);

  const slurStarts = new Set((score.slurs || []).map((s) => `${s.hand}:${s.from}`));
  const slurStops = new Set((score.slurs || []).map((s) => `${s.hand}:${s.to}`));

  const measures = [];
  for (let m = 0; m < score.measures; m++) {
    for (const h of hands) accidentals[h.hand].reset();
    const parts = [];

    if (m === 0) {
      const clefs = hands
        .map((h) => `<clef number="${h.staff}"><sign>${h.clef.sign}</sign><line>${h.clef.line}</line></clef>`)
        .join('');
      parts.push(
        `<attributes><divisions>${TPQ}</divisions>`
        + `<key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`
        + `<time><beats>${ts.num}</beats><beat-type>${ts.den}</beat-type></time>`
        + `<staves>${hands.length}</staves>${clefs}</attributes>`,
      );
    }

    hands.forEach((h, hi) => {
      if (hi > 0) parts.push(`<backup><duration>${ts.ticks}</duration></backup>`);
      for (const w of byHand[h.hand][m]) {
        // A dynamic marking is a direction, placed before the note it governs.
        const dyn = w.source.dynamic;
        if (dyn && !w.tieFrom && DYNAMIC_TAGS.has(dyn)) {
          parts.push(
            `<direction placement="below"><direction-type><dynamics><${dyn}/></dynamics>`
            + `</direction-type><staff>${h.staff}</staff></direction>`,
          );
        }
        const accs = w.rest || w.tieFrom
          ? []
          : w.pitches.map((p) => accidentals[h.hand].needed(p));
        parts.push(noteXml(w, {
          staff: h.staff,
          voice: h.voice,
          hand: h.hand,
          accidentals: accs,
          slurStart: slurStarts.has(`${h.hand}:${w.onset}`) && !w.tieFrom,
          slurStop: slurStops.has(`${h.hand}:${w.onset}`) && !w.tieFrom,
          fingering: opts.showFingerings && !w.rest && !w.tieFrom ? w.source.fingering : null,
        }));
      }
    });

    const finalBar = m === score.measures - 1
      ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
      : '';
    measures.push(`<measure number="${m + 1}">${parts.join('')}${finalBar}</measure>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${esc(score.title)}</work-title></work>
  <identification><encoding><software>Prima Vista</software></encoding></identification>
  <part-list><score-part id="P1"><part-name print-object="no">Piano</part-name></score-part></part-list>
  <part id="P1">${measures.join('')}</part>
</score-partwise>`;
}
