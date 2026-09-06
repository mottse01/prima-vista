import classical from '../data/fragments/classical_early.json' with { type: 'json' };
import { normaliseTexture } from './accompaniment.js';

function validate(fragment) {
  if (!fragment.id || !fragment.genre || fragment.bars !== 2 || !fragment.provenance?.source_id) {
    throw new Error(`Invalid fragment: ${fragment.id || 'unknown'}`);
  }
  const [numerator, denominator] = fragment.meter.split('/').map(Number);
  const barDuration = numerator * 4 / denominator;
  if (!Number.isFinite(barDuration) || barDuration <= 0) throw new Error(`Invalid fragment meter: ${fragment.id}`);
  for (let bar = 0; bar < fragment.bars; bar++) {
    const duration = fragment.events.filter((event) => event.bar === bar).reduce((sum, event) => sum + event.dur, 0);
    if (Math.abs(duration - barDuration) > 0.0001) throw new Error(`Invalid fragment duration: ${fragment.id}, bar ${bar + 1}`);
  }
  if (fragment.events.some((event) => !Number.isInteger(event.degree)
    || event.degree < 1 || event.degree > 7 || !(event.dur > 0))) {
    throw new Error(`Invalid fragment event: ${fragment.id}`);
  }
  if (/NC|NonCommercial|SA|ShareAlike/i.test(fragment.provenance.license)) {
    throw new Error(`Commercially blocked fragment: ${fragment.id}`);
  }
  return Object.freeze(fragment);
}

export const FRAGMENTS = Object.freeze(classical.map(validate));

export function chooseFragment(rng, { meter, level, genre, lhStyle }) {
  const texture = normaliseTexture(lhStyle);
  const eligible = FRAGMENTS.filter((fragment) => (
    fragment.meter === meter
    && fragment.level <= level
    && (!genre || fragment.genre === genre)
    && (!texture || !fragment.lh_compatible.length || fragment.lh_compatible.includes(texture))
  ));
  if (!eligible.length) return null;
  return rng.pick(eligible);
}
