// Public style API backed entirely by versioned JSON packs.
// Adding a genre means adding one JSON file; the build catalog discovers it.

import { STYLE_PACK_LIST, stylePack, weightedPick } from './stylePacks.js';

function publicProfile(pack) {
  return Object.freeze({
    id: pack.id, label: pack.display_name, description: pack.description,
    title: pack.title, version: pack.version, pack,
    motifStrength: pack.melody.motif_strength,
    stepwiseAdjustment: pack.melody.step_ratio_target - 0.72,
    nonChordMultiplier: Math.max(0.55, Math.min(1.25, 1 - (pack.melody.step_ratio_target - 0.72))),
    blueNoteRate: pack.melody.blue_note_density || 0,
    climaxPosition: pack.melody.climax_position,
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
  if (requested && requested !== 'auto') {
    const selected = compositionStyle(requested);
    if (context.timeSignature && !selected.pack.meters.some((meter) => meter.value === context.timeSignature)) {
      throw new Error(`${selected.label} does not support ${context.timeSignature}`);
    }
    return selected;
  }
  const compatible = STYLE_PACK_LIST.filter((pack) => (
    pack.meters.some((meter) => meter.value === context.timeSignature)
    && pack.forms.some((form) => form.min_level <= (context.level || 1))
  ));
  if (!compatible.length) throw new Error(`No style pack supports ${context.timeSignature}`);
  // Every enabled pack is reachable from Auto. A hand-audited pack is still
  // the likelier choice, because its grammar has been checked by a person —
  // but a learner who only ever meets two dialects never learns to read a
  // third, and the idioms that make a left hand interesting all live in the
  // packs that were previously unreachable.
  const weighted = compatible.map((pack) => ({
    pack,
    weight: (pack.meters.find((meter) => meter.value === context.timeSignature)?.weight || 0.08)
      * (pack.provenance.model === 'bootstrap-hand-audited' ? 2.2 : 1),
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
    ...(params.hands === 'both' && texture ? { lhStyle: texture } : {}),
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

function cadenceStrength(unit) {
  if (!unit.cadence) return 'none';
  if (['half', 'deceptive', 'subdominant_turn', 'blues_turnaround'].includes(unit.cadence)) return 'open';
  return 'strong';
}

/** Return a pack-authored phrase plan fitted to the requested length. */
export function formForStyle(styleId, bars, rng = null, level = 1) {
  const pack = stylePack(styleId);
  const eligible = pack.forms.filter((form) => form.min_level <= level);
  const exact = eligible.filter((form) => form.bars === bars);
  const candidates = exact.length ? exact : eligible.length ? eligible : pack.forms;
  const selected = rng ? weightedPick(rng, candidates) : [...candidates].sort((a, b) => b.weight - a.weight)[0];
  const form = repeatToLength(selected, bars);
  const advanced = pack.development.advanced_transforms || {};
  const fallback = pack.development.fallback_transform;
  form.units = form.units.map((unit) => (
    advanced[unit.transform] && level < advanced[unit.transform]
      ? { ...unit, transform: fallback, transform_value: 0 }
      : unit
  ));
  const plan = Array.from({ length: bars }, (_, measure) => {
    const unitIndex = form.units.findIndex((unit) => measure >= unit.bars[0] && measure <= unit.bars[1]);
    const unit = form.units[unitIndex];
    return {
      measure, unitIndex, phrase: unitIndex,
      section: String.fromCharCode(65 + (unitIndex % 26)),
      phraseFunction: unit.role, role: unit.role, transform: unit.transform,
      transformValue: unit.transform_value || 0,
      cadenceStrength: cadenceStrength(unit),
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
    cadenceStrength: cadenceStrength(unit),
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
