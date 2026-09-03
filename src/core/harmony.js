// Data-driven harmonic planner. Genre vocabulary, transition probabilities,
// cadence formulae, and licensed retrogressions all live in JSON style packs.

import { chordTones, spellChordTone, tonicLetter } from './theory.js';
import { stylePack } from './stylePacks.js';

const FUNCTION_OF = ['T', 'PD', 'T', 'PD', 'D', 'T', 'D'];
const CADENCE_LABELS = {
  authentic: ['Authentic cadence', 'AC'], imperfect: ['Imperfect authentic cadence', 'IAC'],
  half: ['Half cadence', 'HC'], deceptive: ['Deceptive cadence', 'DC'],
  plagal: ['Plagal cadence', 'PC'], subdominant_turn: ['Subdominant turn', '→IV'],
  blues_turnaround: ['Blues turnaround', 'TURN'],
};

export const COMMON_CADENCES = Object.freeze(Object.fromEntries(
  Object.entries(CADENCE_LABELS).map(([id, [name, short]]) => [id, Object.freeze({ id, name, short })]),
));
export const COMMON_PROGRESSIONS = Object.freeze({ major: [], minor: [] });

function pickObject(rng, row) {
  const entries = Object.entries(row);
  return rng.weighted(entries.map(([value]) => value), entries.map(([, weight]) => weight));
}

function degreeFor(pack, roman) {
  const exact = pack.harmony.roman_degrees[roman];
  if (Number.isInteger(exact)) return exact;
  const bare = roman.replace(/[0-9°ø+]/g, '');
  const degree = pack.harmony.roman_degrees[bare];
  if (Number.isInteger(degree)) return degree;
  throw new Error(`Style pack ${pack.id} does not map Roman numeral ${roman}`);
}

function inversionFor(roman) {
  if (roman.endsWith('64')) return 2;
  if (roman.endsWith('6')) return 1;
  return 0;
}

function cadenceChoice(rng, pack, requested, final) {
  if (requested && pack.harmony.cadences[requested]) return requested;
  const pool = pack.harmony.cadence_weights[final ? 'final' : 'internal'];
  const available = Object.fromEntries(Object.entries(pool).filter(([id]) => pack.harmony.cadences[id]));
  return pickObject(rng, available);
}

function melodicArrival(cadenceId, degrees) {
  if (cadenceId === 'half' || cadenceId === 'blues_turnaround' && degrees.at(-1) === 4) return 4;
  if (cadenceId === 'deceptive') return 5;
  if (cadenceId === 'subdominant_turn') return 3;
  return degrees.at(-1) === 0 ? 0 : degrees.at(-1);
}

/**
 * Walk a pack's transition table, then splice its exact cadence formulae into
 * cadence slots fixed by the form. No pitch or rhythm exists at this stage.
 */
export function planProgression(rng, {
  measures, chordsPerMeasure = 1, allowSevenths = false, allowInversions = false,
  mode = 'major', form = null, compositionStyle = 'classical_early',
}) {
  const pack = stylePack(compositionStyle);
  const slots = measures * chordsPerMeasure;
  const tonic = pack.harmony.vocabulary.find((roman) => degreeFor(pack, roman) === 0)
    || pack.harmony.vocabulary[0];
  const romans = [tonic];
  while (romans.length < slots) {
    const current = romans.at(-1);
    const row = pack.harmony.transitions[current]
      || pack.harmony.transitions[current.replace(/[0-9°ø+]/g, '')]
      || pack.harmony.transitions[tonic];
    romans.push(pickObject(rng, row));
  }

  const cadenceEnds = form?.plan
    ? form.plan.filter((bar) => bar.cadence).map((bar) => bar.measure)
    : [measures - 1];
  const cadences = [];
  const cadenceSlot = new Map();

  for (const measure of [...new Set(cadenceEnds)]) {
    const final = measure === measures - 1;
    const planBar = form?.plan?.[measure];
    const id = cadenceChoice(rng, pack, planBar?.cadenceType, final);
    const formulas = pack.harmony.cadences[id];
    const formula = structuredClone(rng.pick(formulas));
    const endSlot = Math.min(slots - 1, (measure + 1) * chordsPerMeasure - 1);
    const startSlot = Math.max(0, endSlot - formula.length + 1);
    const applied = formula.slice(formula.length - (endSlot - startSlot + 1));
    applied.forEach((roman, index) => {
      const slot = startSlot + index;
      romans[slot] = roman;
      cadenceSlot.set(slot, { id, position: index === applied.length - 1 ? 'arrival' : 'approach' });
    });
    const degrees = applied.map((roman) => degreeFor(pack, roman));
    const [name, short] = CADENCE_LABELS[id] || [id.replaceAll('_', ' '), id.toUpperCase()];
    cadences.push({
      id, name, short, measure, final,
      slots: applied.map((_, index) => startSlot + index), degrees,
      melodyDegree: melodicArrival(id, degrees),
      strength: planBar?.cadenceStrength || (final ? 'strong' : 'weak'),
      phraseFunction: planBar?.phraseFunction || null,
      roman: applied.join('–'),
    });
  }

  const alteredSevenths = new Set(pack.harmony.altered_sevenths || []);
  const chords = romans.map((roman, index) => {
    const degree = degreeFor(pack, roman);
    const mark = cadenceSlot.get(index);
    const labelledSeventh = roman.includes('7');
    let inversion = inversionFor(roman);
    if (allowInversions && !mark && inversion === 0 && rng.chance(0.24)) inversion = 1;
    return {
      degree, plannedDegree: degree, plannedRoman: roman,
      seventh: labelledSeventh && (allowSevenths || pack.harmony.require_labelled_sevenths === true),
      inversion, inversionLocked: Boolean(mark) || inversionFor(roman) > 0,
      fn: FUNCTION_OF[degree], index,
      source: mark ? 'cadence' : 'progression',
      cadence: mark || null,
      bluesDominant: mode === 'major' && alteredSevenths.has(degree) && labelledSeventh,
    };
  });

  const degrees = chords.map((chord) => chord.degree);
  const unitPlans = (form?.units || []).map((unit) => {
    const first = unit.bars[0] * chordsPerMeasure;
    const last = Math.min(chords.length, (unit.bars[1] + 1) * chordsPerMeasure);
    return { phrase: unit.index, function: unit.role, roman: romans.slice(first, last).join('–') };
  });

  return {
    chords,
    progression: {
      id: `${pack.id}:${form?.id || 'free'}`, name: `${form?.name || pack.display_name} harmony`,
      sourceProgression: `${pack.display_name} transition model`, style: pack.display_name,
      styles: [pack.id], degrees, roman: unitPlans.map((item) => item.roman).join(' | '),
      sectionPlans: unitPlans, cadence: cadences.at(-1)?.name || null,
      cadencePlan: cadences.map((item) => item.short).join(' → '), cadences,
      stylePackVersion: pack.version,
    },
  };
}

/** Voice a chord with minimum movement and a fixed cadential bass when required. */
export function voiceChord(key, chord, prevVoicing, { lowDia, highDia }) {
  const centre = Math.round((lowDia + highDia) / 2);
  const base = chordTones(key, chord, centre - 2);
  const candidates = [];
  for (let rotation = 0; rotation < base.length; rotation++) {
    for (let octave = -1; octave <= 1; octave++) {
      const voicing = base.map((_, index) => {
        const source = (rotation + index) % base.length;
        return base[source] + (rotation + index >= base.length ? 7 : 0) + octave * 7;
      }).sort((a, b) => a - b);
      if (voicing[0] < lowDia || voicing.at(-1) > highDia) continue;
      if (chord.inversionLocked) {
        const bassDegree = ((voicing[0] - tonicLetter(key)) % 7 + 7) % 7;
        if (bassDegree !== (chord.degree + chord.inversion * 2) % 7) continue;
      }
      candidates.push(voicing);
    }
  }
  if (!candidates.length) {
    const desired = (chord.degree + chord.inversion * 2) % 7;
    const choices = Array.from({ length: highDia - lowDia + 1 }, (_, index) => lowDia + index)
      .filter((dia) => ((dia - tonicLetter(key)) % 7 + 7) % 7 === desired);
    return [choices.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0] ?? lowDia];
  }
  if (!prevVoicing) return candidates.sort((a, b) => Math.abs(a[0] - centre) - Math.abs(b[0] - centre))[0];
  const cost = (voicing) => voicing.reduce((sum, pitch, index) => (
    sum + Math.abs(pitch - prevVoicing[Math.min(index, prevVoicing.length - 1)])
  ), 0);
  return candidates.sort((a, b) => cost(a) - cost(b))[0];
}

export function spellVoicing(key, chord, voicing) {
  return voicing.map((dia) => spellChordTone(key, chord, dia));
}
