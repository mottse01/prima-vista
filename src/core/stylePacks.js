import rawPacks from '../data/stylePacks.generated.js';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function invariant(condition, message) {
  if (!condition) throw new Error(`Invalid style pack: ${message}`);
}

function merge(base, override) {
  if (!isRecord(base) || !isRecord(override)) return structuredClone(override);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    out[key] = isRecord(value) && isRecord(out[key]) ? merge(out[key], value) : structuredClone(value);
  }
  return out;
}

function validateWeights(items, path) {
  invariant(Array.isArray(items) && items.length > 0, `${path} must be a non-empty array`);
  for (const [index, item] of items.entries()) {
    invariant(isRecord(item), `${path}[${index}] must be an object`);
    invariant(typeof item.weight === 'number' && item.weight > 0, `${path}[${index}].weight must be positive`);
  }
}

function validateForm(form, packId) {
  invariant(typeof form.id === 'string' && form.id, `${packId}.forms requires ids`);
  invariant(Number.isInteger(form.bars) && form.bars >= 4, `${packId}.${form.id}.bars must be >= 4`);
  invariant(Array.isArray(form.units) && form.units.length >= 2, `${packId}.${form.id}.units is incomplete`);
  const covered = new Set();
  for (const unit of form.units) {
    invariant(Array.isArray(unit.bars) && unit.bars.length === 2, `${packId}.${form.id} has an invalid unit range`);
    invariant(unit.bars[0] <= unit.bars[1], `${packId}.${form.id} has a reversed unit range`);
    for (let bar = unit.bars[0]; bar <= unit.bars[1]; bar++) covered.add(bar);
    invariant(typeof unit.role === 'string' && unit.role, `${packId}.${form.id} unit is missing role`);
    invariant(typeof unit.transform === 'string' && unit.transform, `${packId}.${form.id} unit is missing transform`);
  }
  invariant(covered.size === form.bars, `${packId}.${form.id} must cover every bar exactly once`);
  for (let bar = 0; bar < form.bars; bar++) invariant(covered.has(bar), `${packId}.${form.id} omits bar ${bar}`);
}

function validateStylePack(pack) {
  invariant(pack.schema_version === 1, `${pack.id || 'unknown'} has unsupported schema_version`);
  for (const field of ['id', 'display_name', 'description', 'title', 'version']) {
    invariant(typeof pack[field] === 'string' && pack[field], `${pack.id || 'unknown'}.${field} is required`);
  }
  validateWeights(pack.meters, `${pack.id}.meters`);
  validateWeights(pack.modes, `${pack.id}.modes`);
  invariant(Array.isArray(pack.tempo_range) && pack.tempo_range.length === 2, `${pack.id}.tempo_range is invalid`);
  invariant(pack.tempo_range.every(Number.isFinite) && pack.tempo_range[0] <= pack.tempo_range[1], `${pack.id}.tempo_range is unordered`);
  validateWeights(pack.forms, `${pack.id}.forms`);
  pack.forms.forEach((form) => validateForm(form, pack.id));
  invariant(isRecord(pack.harmony), `${pack.id}.harmony is required`);
  invariant(Array.isArray(pack.harmony.vocabulary) && pack.harmony.vocabulary.length > 0, `${pack.id}.harmony.vocabulary is empty`);
  invariant(isRecord(pack.harmony.transitions), `${pack.id}.harmony.transitions is required`);
  invariant(isRecord(pack.harmony.cadences), `${pack.id}.harmony.cadences is required`);
  invariant(Array.isArray(pack.harmony.functions_by_degree) && pack.harmony.functions_by_degree.length === 7,
    `${pack.id}.harmony.functions_by_degree must contain seven entries`);
  invariant(isRecord(pack.harmony.mode_degree_weights), `${pack.id}.harmony.mode_degree_weights is required`);
  for (const mode of ['major', 'minor']) {
    const weights = pack.harmony.mode_degree_weights[mode];
    invariant(Array.isArray(weights) && weights.length === 7 && weights.every((weight) => weight > 0),
      `${pack.id}.harmony.mode_degree_weights.${mode} must contain seven positive weights`);
  }
  invariant(typeof pack.harmony.inversion_probability === 'number'
    && pack.harmony.inversion_probability >= 0 && pack.harmony.inversion_probability <= 1,
  `${pack.id}.harmony.inversion_probability is invalid`);
  for (const roman of pack.harmony.vocabulary) {
    const row = pack.harmony.transitions[roman];
    invariant(isRecord(row) && Object.keys(row).length > 0, `${pack.id} has no transition row for ${roman}`);
    invariant(Object.values(row).every((weight) => typeof weight === 'number' && weight > 0), `${pack.id}.${roman} has an invalid transition weight`);
  }
  validateWeights(pack.lh_textures, `${pack.id}.lh_textures`);
  validateWeights(pack.rhythm_cells, `${pack.id}.rhythm_cells`);
  invariant(isRecord(pack.melody), `${pack.id}.melody is required`);
  validateWeights(pack.melody.contours, `${pack.id}.melody.contours`);
  invariant(typeof pack.melody.motif_strength === 'number' && pack.melody.motif_strength > 0,
    `${pack.id}.melody.motif_strength is invalid`);
  invariant(typeof pack.melody.climax_position === 'number'
    && pack.melody.climax_position >= 0 && pack.melody.climax_position <= 1,
  `${pack.id}.melody.climax_position is invalid`);
  invariant(isRecord(pack.development), `${pack.id}.development is required`);
  invariant(typeof pack.development.recognizable_min_ratio === 'number'
    && pack.development.recognizable_min_ratio >= 0.5 && pack.development.recognizable_min_ratio <= 1,
  `${pack.id}.development.recognizable_min_ratio is invalid`);
  invariant(typeof pack.development.fallback_transform === 'string' && pack.development.fallback_transform,
    `${pack.id}.development.fallback_transform is required`);
  invariant(isRecord(pack.expression), `${pack.id}.expression is required`);
  invariant(isRecord(pack.validator), `${pack.id}.validator is required`);
  invariant(pack.validator.coherence_min < pack.validator.coherence_max, `${pack.id} has an inverted coherence band`);
  return Object.freeze(pack);
}

const rawById = new Map(rawPacks.map((pack) => [pack.id, pack]));
const resolved = new Map();

function resolve(id, stack = []) {
  if (resolved.has(id)) return resolved.get(id);
  invariant(!stack.includes(id), `cyclic inheritance: ${[...stack, id].join(' -> ')}`);
  const raw = rawById.get(id);
  invariant(raw, `unknown pack ${id}`);
  const value = raw.extends ? merge(resolve(raw.extends, [...stack, id]), raw) : structuredClone(raw);
  delete value.extends;
  const checked = validateStylePack(value);
  resolved.set(id, checked);
  return checked;
}

export const STYLE_PACKS = Object.freeze(Object.fromEntries([...rawById.keys()].sort().map((id) => [id, resolve(id)])));
export const STYLE_PACK_LIST = Object.freeze(Object.values(STYLE_PACKS).filter((pack) => pack.enabled));

export function stylePack(id) {
  const aliases = { classical: 'classical_early', pop: 'pop_contemporary', waltz: 'romantic' };
  return STYLE_PACKS[aliases[id] || id] || STYLE_PACKS.classical_early;
}

export function weightedPick(rng, items) {
  return rng.weighted(items, items.map((item) => item.weight));
}
