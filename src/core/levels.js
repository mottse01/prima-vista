import definitions from '../data/difficulty-levels.json' with { type: 'json' };

function invariant(condition, message) {
  if (!condition) throw new Error(`Invalid difficulty ladder: ${message}`);
}

function validate(definition, expectedId) {
  invariant(definition.id === expectedId, `expected level ${expectedId}`);
  invariant(typeof definition.name === 'string' && definition.name, `level ${expectedId} needs a name`);
  invariant(definition.params && definition.constraints, `level ${expectedId} needs params and constraints`);
  const c = definition.constraints;
  invariant(Array.isArray(c.tempo) && c.tempo.length === 2, `level ${expectedId} tempo range is invalid`);
  invariant(Array.isArray(c.meters) && c.meters.length, `level ${expectedId} meters are empty`);
  invariant(Math.max(...definition.params.fifths.map(Math.abs)) <= c.key_signature_accidentals,
    `level ${expectedId} exceeds its key-signature cap`);
  invariant(definition.params.chromaticRate === 0 || c.chromatic_notes > 0,
    `level ${expectedId} enables forbidden chromaticism`);
  return Object.freeze({
    ...definition,
    params: Object.freeze({
      ...definition.params,
      constraints: Object.freeze({ ...definition.constraints }),
      levelConfigVersion: 1,
    }),
  });
}

invariant(Array.isArray(definitions) && definitions.length === 10, 'exactly ten levels are required');
export const LEVELS = Object.freeze(definitions.map((definition, index) => validate(definition, index + 1)));
export const STAGES = Object.freeze([...new Set(LEVELS.map((level) => level.stage))]);

export function levelById(id) {
  return LEVELS.find((level) => level.id === Number(id)) || LEVELS[0];
}
