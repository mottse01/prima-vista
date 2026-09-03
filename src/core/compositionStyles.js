// Public style API backed entirely by versioned JSON packs.
// Adding a genre means adding one JSON file; the build catalog discovers it.

import { STYLE_PACK_LIST, stylePack, weightedPick } from './stylePacks.js';

const TEXTURE_TO_UI = {
  block_chord: 'blocked', root_fifth: 'roots', broken_octave: 'broken',
  contrapuntal: 'melodic', walking: 'broken', stride: 'waltz',
};

function publicProfile(pack) {
  return Object.freeze({
    id: pack.id, label: pack.display_name, description: pack.description,
    title: pack.title, version: pack.version, pack,
    motifStrength: 18,
    stepwiseAdjustment: pack.melody.step_ratio_target - 0.72,
    nonChordMultiplier: Math.max(0.55, Math.min(1.25, 1 - (pack.melody.step_ratio_target - 0.72))),
    blueNoteRate: pack.melody.blue_note_density || 0,
    climaxPosition: 0.64,
  });
}

export const COMPOSITION_STYLES = Object.freeze(Object.fromEntries(
  STYLE_PACK_LIST.map((pack) => [pack.id, publicProfile(pack)]),
));

const AUTO = Object.freeze({
  id: 'auto', label: 'Auto', description: 'Chooses a style pack that fits the metre and level.',
  title: 'Motivic Study', version: '1',
});

export const STYLE_OPTIONS = Object.freeze([AUTO, ...Object.values(COMPOSITION_STYLES)]);
export const STYLE_IDS = Object.freeze(STYLE_OPTIONS.map((item) => item.id));

export function compositionStyle(id) {
  return COMPOSITION_STYLES[stylePack(id).id];
}

/** Resolve Auto from pack data without a genre-specific branch. */
export function resolveCompositionStyle(rng, requested, context = {}) {
  if (requested && requested !== 'auto') return compositionStyle(requested);
  const eligible = STYLE_PACK_LIST.filter((pack) => (
    pack.provenance.model === 'bootstrap-hand-audited'
    &&
    pack.meters.some((meter) => meter.value === context.timeSignature)
    && pack.forms.some((form) => form.min_level <= (context.level || 1))
  ));
  const pool = eligible.length ? eligible : STYLE_PACK_LIST;
  const weighted = pool.map((pack) => ({
    pack,
    weight: pack.meters.find((meter) => meter.value === context.timeSignature)?.weight || 0.08,
  }));
  return compositionStyle(weightedPick(rng, weighted).pack.id);
}

/** Apply only generic, pack-declared defaults. Level constraints are enforced later. */
export function styleSetupPatch(id, params = {}) {
  if (id === 'auto') return { compositionStyle: 'auto' };
  const pack = stylePack(id);
  const meter = [...pack.meters].sort((a, b) => b.weight - a.weight)[0]?.value;
  const texture = [...pack.lh_textures]
    .filter((item) => item.min_level <= (params.level || 10))
    .sort((a, b) => b.weight - a.weight)[0]?.id;
  const bestForm = [...pack.forms]
    .filter((item) => item.min_level <= (params.level || 10))
    .sort((a, b) => b.weight - a.weight)[0];
  return {
    compositionStyle: pack.id,
    ...(meter ? { timeSignature: meter } : {}),
    ...(bestForm ? { measures: bestForm.bars } : {}),
    ...(params.hands === 'both' && texture ? { lhStyle: TEXTURE_TO_UI[texture] || texture } : {}),
  };
}

function repeatToLength(form, bars) {
  if (form.bars === bars) return structuredClone(form);
  const source = form.units;
  const units = [];
  let cursor = 0;
  let index = 0;
  while (cursor < bars) {
    const template = source[index % source.length];
    const sourceLength = template.bars[1] - template.bars[0] + 1;
    const length = Math.min(sourceLength, bars - cursor);
    const isFinal = cursor + length === bars;
    units.push({
      ...structuredClone(template), bars: [cursor, cursor + length - 1],
      transform: index === 0 ? 'motif' : template.transform,
      cadence: isFinal ? (template.cadence || 'authentic') : template.cadence,
    });
    cursor += length;
    index += 1;
  }
  return { ...structuredClone(form), id: `${form.id}_${bars}`, name: `${form.name} (${bars} bars)`, bars, units };
}

/** Return a pack-authored phrase plan fitted to the requested length. */
export function formForStyle(styleId, bars, rng = null, level = 1) {
  const pack = stylePack(styleId);
  const eligible = pack.forms.filter((form) => form.min_level <= level);
  const exact = eligible.filter((form) => form.bars === bars);
  const candidates = exact.length ? exact : eligible.length ? eligible : pack.forms;
  const selected = rng ? weightedPick(rng, candidates) : [...candidates].sort((a, b) => b.weight - a.weight)[0];
  const form = repeatToLength(selected, bars);
  const plan = Array.from({ length: bars }, (_, measure) => {
    const unitIndex = form.units.findIndex((unit) => measure >= unit.bars[0] && measure <= unit.bars[1]);
    const unit = form.units[unitIndex];
    return {
      measure, unitIndex, phrase: unitIndex,
      section: String.fromCharCode(65 + (unitIndex % 26)),
      phraseFunction: unit.role, role: unit.role, transform: unit.transform,
      transformValue: unit.transform_value || 0,
      cadenceStrength: unit.cadence ? (measure === bars - 1 ? 'strong' : 'weak') : 'none',
      cadenceType: measure === unit.bars[1] ? unit.cadence : null,
      cadence: measure === unit.bars[1] && Boolean(unit.cadence),
      motifKey: unitIndex === 0 ? 'motif' : `${unit.transform}:${unit.transform_value || 0}`,
      shift: unit.transform === 'transpose_diatonic' ? (unit.transform_value || 0) : 0,
      energy: Math.min(3, 1 + Math.floor(unitIndex / 2)),
      density: ['fragment', 'diminish'].includes(unit.transform) ? 3 : 1,
      registerShift: unit.transform === 'expand_intervals' ? 2 : 0,
      harmonicRole: unit.role,
    };
  });
  const mappedUnits = form.units.map((unit, index) => ({
    ...unit,
    index,
    function: unit.role,
    section: String.fromCharCode(65 + (index % 26)),
    energy: plan[unit.bars[0]].energy,
    cadenceStrength: unit.cadence ? (unit.bars[1] === bars - 1 ? 'strong' : 'weak') : 'none',
  }));
  return {
    id: form.id, name: form.name,
    label: form.units.map((_, index) => String.fromCharCode(65 + (index % 26))).join('–'),
    sections: form.units.map((_, index) => String.fromCharCode(65 + (index % 26))),
    units: mappedUnits,
    phrases: mappedUnits,
    plan, phraseLength: Math.max(1, Math.round(bars / form.units.length)), styleId: pack.id,
  };
}
