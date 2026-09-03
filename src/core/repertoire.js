import catalog from '../data/repertoire.json' with { type: 'json' };
import { degreeDia, isChordTone, spellChordTone, spellInKey, TPQ } from './theory.js';
import { timeSig } from './rhythm.js';

function validate(item) {
  if (!item.id || !item.title || !item.composer || item.license !== 'Public domain') {
    throw new Error(`Invalid repertoire record: ${item.id || 'unknown'}`);
  }
  if (!Array.isArray(item.melody) || item.melody.some((bar) => (
    Math.abs(bar.reduce((sum, event) => sum + event[1], 0) - 4) > 0.0001
  ))) throw new Error(`Invalid repertoire duration: ${item.id}`);
  return Object.freeze(item);
}

export const REPERTOIRE_OPTIONS = Object.freeze(catalog.map(validate));

export function repertoireExercise(params = {}) {
  const item = REPERTOIRE_OPTIONS.find((entry) => entry.id === params.repertoireId) || REPERTOIRE_OPTIONS[0];
  const key = item.key;
  const ts = timeSig(item.meter);
  const chords = item.harmony.map((degree, index) => ({
    degree, plannedDegree: degree, plannedRoman: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'][degree],
    seventh: false, inversion: 0, inversionLocked: true,
    fn: degree === 4 ? 'D' : degree === 3 ? 'PD' : 'T', index,
    source: index >= item.harmony.length - 2 ? 'cadence' : 'repertoire',
    cadence: index >= item.harmony.length - 2 ? { id: 'authentic', position: index === item.harmony.length - 1 ? 'arrival' : 'approach' } : null,
  }));
  const rh = [];
  item.melody.forEach((bar, measure) => {
    let within = 0;
    bar.forEach(([degree, quarters], eventIndex) => {
      const dia = degreeDia(key, degree - 1, 30);
      const chord = chords[measure];
      rh.push({
        onset: measure * ts.ticks + within * TPQ,
        duration: quarters * TPQ,
        rest: false,
        pitches: [spellInKey(key, dia)],
        tags: ['repertoire', quarters < 1 ? 'eighth' : 'quarter'],
        cellId: 'repertoire', hand: 'rh', chordTone: isChordTone(key, chord, dia),
        motifKey: measure < 4 || measure >= 4 ? 'theme' : null,
        motifRole: measure < 4 ? 'statement' : 'return',
        section: measure < 4 ? 'A' : 'A′', phraseFunction: measure < 4 ? 'antecedent' : 'consequent',
        formalTransform: measure < 4 ? 'motif' : 'exact',
        cadence: measure === item.melody.length - 1 && eventIndex === bar.length - 1 ? 'authentic' : null,
        dynamic: measure === 0 && eventIndex === 0 ? 'mf' : undefined,
      });
      within += quarters;
    });
  });
  const lh = chords.map((chord, measure) => {
    const dia = degreeDia(key, chord.degree, 20);
    return {
      onset: measure * ts.ticks, duration: ts.ticks, rest: false,
      pitches: [spellChordTone(key, chord, dia)], tags: ['root', 'repertoire'],
      cellId: 'repertoire-lh', hand: 'lh',
    };
  });
  const measures = item.melody.length;
  const cadence = {
    id: 'authentic', name: 'Authentic cadence', short: 'AC', measure: measures - 1, final: true,
    slots: [measures - 2, measures - 1], degrees: item.harmony.slice(-2), melodyDegree: 0,
    strength: 'strong', phraseFunction: 'consequent', roman: 'V–I',
  };
  const units = [
    { index: 0, bars: [0, 3], role: 'antecedent', function: 'antecedent', transform: 'motif', cadence: null, section: 'A', energy: 1 },
    { index: 1, bars: [4, 7], role: 'consequent', function: 'consequent', transform: 'exact', cadence: 'authentic', section: 'A′', energy: 2 },
  ];
  return {
    seed: params.seed >>> 0, key, ts, tempo: params.tempo || item.tempo, measures,
    chords, chordsPerMeasure: 1,
    style: { id: 'real_repertoire', label: 'Public-domain repertoire', description: item.provenance },
    harmony: {
      id: item.id, name: item.work, sourceProgression: item.work, styles: ['real_repertoire'],
      degrees: [...item.harmony], roman: item.harmony.map((degree) => ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'][degree]).join('–'),
      sectionPlans: [], cadence: cadence.name, cadencePlan: cadence.short, cadences: [cadence],
    },
    form: { id: item.id, name: 'Original theme', label: 'A–A′', sections: ['A', 'A′'], phrases: units, units, plan: [], phraseLength: 4, styleId: 'real_repertoire' },
    staves: { rh, lh }, slurs: [{ hand: 'rh', from: 0, to: 4 * ts.ticks - TPQ }, { hand: 'rh', from: 4 * ts.ticks, to: measures * ts.ticks - TPQ }],
    title: `${item.title} — ${item.composer}`, params: { ...params, sourceMode: 'repertoire', repertoireId: item.id },
    generatorVersion: 2, stylePackVersion: 'repertoire-1', totalTicks: measures * ts.ticks,
    repertoire: { composer: item.composer, work: item.work, provenance: item.provenance, license: item.license },
  };
}
