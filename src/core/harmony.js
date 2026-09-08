// Data-driven harmonic planner. Genre vocabulary, transition probabilities,
// cadence formulae, and licensed retrogressions all live in JSON style packs.

import { chordTones, spellChordTone, tonicLetter, ROMAN } from './theory.js';
import { stylePack } from './stylePacks.js';

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
  if (roman.endsWith('42') || roman.endsWith('2')) return 3;
  if (roman.endsWith('43')) return 2;
  if (roman.endsWith('65')) return 1;
  if (roman.endsWith('64')) return 2;
  if (roman.endsWith('6')) return 1;
  return 0;
}

function realisedRoman(roman, allowSevenths, allowInversions, pack) {
  let value = allowInversions ? roman : roman.replace(/64|65|43|42|6|2$/g, '');
  if (!allowSevenths && pack.harmony.require_labelled_sevenths !== true) {
    value = value.replace(/7|65|43|42|2$/g, '');
  }
  return value;
}

function romanVariants(roman) {
  const withoutInversion = roman.replace(/64|65|43|42|6|2$/g, '');
  const withoutSeventh = withoutInversion.replace(/7$/g, '');
  return [...new Set([roman, withoutInversion, withoutSeventh])];
}

function transitionAllowed(pack, left, right) {
  if (!left || !right) return true;
  for (const from of romanVariants(left)) {
    for (const to of romanVariants(right)) {
      if (pack.harmony.transitions[from]?.[to]) return true;
      if ((pack.harmony.licensed_retrogressions || []).includes(`${from}>${to}`)) return true;
    }
  }
  return false;
}

function transitionWeight(pack, left, right) {
  if (!left) return degreeFor(pack, right) === 0 ? 1 : 0.2;
  for (const from of romanVariants(left)) {
    for (const to of romanVariants(right)) {
      const weight = pack.harmony.transitions[from]?.[to];
      if (weight) return weight;
      if ((pack.harmony.licensed_retrogressions || []).includes(`${from}>${to}`)) return 0.04;
    }
  }
  return 0;
}

/** Find an exact-length, pack-licensed bridge between two protected chords. */
function bridgePath(pack, length, left, right, original, rng) {
  if (!length) return transitionAllowed(pack, left, right) ? [] : null;
  let states = new Map([[left || '', { score: 0, path: [] }]]);
  for (let offset = 0; offset < length; offset++) {
    const next = new Map();
    for (const [previous, state] of states) {
      for (const roman of pack.harmony.vocabulary) {
        const weight = transitionWeight(pack, previous || null, roman);
        if (!weight) continue;
        const score = state.score + Math.log(weight) + (roman === original[offset] ? 0.2 : 0);
        const incumbent = next.get(roman);
        if (!incumbent || score > incumbent.score) next.set(roman, { score, path: [...state.path, roman] });
      }
    }
    states = next;
    if (!states.size) return null;
  }
  const complete = [...states.entries()]
    .filter(([last]) => !right || transitionAllowed(pack, last, right))
    .map(([, state]) => state)
    .sort((a, b) => b.score - a.score);
  if (!complete.length) return null;
  const shortlist = complete.slice(0, Math.min(3, complete.length));
  return rng.weighted(shortlist, shortlist.map((item, index) => 3 - index)).path;
}

function nextRoman(rng, pack, romans, mode) {
  const current = romans.at(-1);
  const trigram = romans.length > 1
    ? pack.harmony.trigram_transitions?.[`${romans.at(-2)}|${current}`]
    : null;
  const row = trigram
    || pack.harmony.transitions[current]
    || pack.harmony.transitions[current.replace(/[0-9°ø+]/g, '')]
    || pack.harmony.transitions[romans[0]];
  const degreeWeights = pack.harmony.mode_degree_weights?.[mode] || Array(7).fill(1);
  return pickObject(rng, Object.fromEntries(Object.entries(row).map(([candidate, weight]) => (
    [candidate, weight * (degreeWeights[degreeFor(pack, candidate)] || 1)]
  ))));
}

function cadenceChoice(rng, pack, requested, final) {
  if (requested && pack.harmony.cadences[requested]) return requested;
  const pool = pack.harmony.cadence_weights[final ? 'final' : 'internal'];
  const available = Object.fromEntries(Object.entries(pool).filter(([id]) => pack.harmony.cadences[id]));
  return pickObject(rng, available);
}

/**
 * The scale degree the melody lands on at a cadence.
 *
 * `reachable`, when given, is the set of degrees the melodic range can
 * actually sound in this key. A five-note tessitura covers five of the seven
 * degrees, and *which* five depends on the key, so the textbook arrival is not
 * always available — a beginner's hand position in C sharp major reaches a
 * different set than the same position in F. Where it is unavailable, land on
 * a chord tone of the cadence's own final chord instead: still consonant,
 * still audibly an ending, and within reach of the hand that has to play it.
 */
function melodicArrival(rng, cadenceId, degrees, reachable = null) {
  const preferred = idiomaticArrival(rng, cadenceId, degrees);
  if (!reachable?.length || reachable.includes(preferred)) return preferred;
  const root = degrees.at(-1);
  return [root, (root + 2) % 7, (root + 4) % 7].find((d) => reachable.includes(d)) ?? preferred;
}

/** The arrival the cadence is named for, before range is taken into account. */
function idiomaticArrival(rng, cadenceId, degrees) {
  if (cadenceId === 'half' || cadenceId === 'blues_turnaround' && degrees.at(-1) === 4) return 4;
  if (cadenceId === 'deceptive') return 5;
  if (cadenceId === 'subdominant_turn') return 3;
  // An imperfect authentic cadence is defined by its melody: the third or the
  // fifth above the tonic, never the tonic itself. Choosing between them is
  // what gives a study several distinguishable phrase endings.
  if (cadenceId === 'imperfect' && degrees.at(-1) === 0) return rng.chance(0.6) ? 2 : 4;
  return degrees.at(-1) === 0 ? 0 : degrees.at(-1);
}

/**
 * Walk a pack's transition table, then splice its exact cadence formulae into
 * cadence slots fixed by the form. No pitch or rhythm exists at this stage.
 */
export function planProgression(rng, {
  measures, chordsPerMeasure = 1, allowSevenths = false, allowInversions = false,
  mode = 'major', form = null, compositionStyle = 'classical_early',
  melodyDegrees = null,
}) {
  const pack = stylePack(compositionStyle);
  const slots = measures * chordsPerMeasure;
  const tonic = pack.harmony.vocabulary.find((roman) => degreeFor(pack, roman) === 0)
    || pack.harmony.vocabulary[0];
  const romans = [tonic];
  while (romans.length < slots) {
    romans.push(nextRoman(rng, pack, romans, mode));
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
    const endSlot = Math.min(slots - 1, (measure + 1) * chordsPerMeasure - 1);
    const scored = formulas.map((candidate) => {
      const start = Math.max(0, endSlot - candidate.length + 1);
      const appliedCandidate = candidate.slice(candidate.length - (endSlot - start + 1));
      const before = start > 0 ? romans[start - 1] : null;
      const after = endSlot + 1 < romans.length ? romans[endSlot + 1] : null;
      return {
        formula: candidate,
        score: Number(transitionAllowed(pack, before, appliedCandidate[0]))
          + Number(transitionAllowed(pack, appliedCandidate.at(-1), after)),
      };
    });
    const bestScore = Math.max(...scored.map((item) => item.score));
    const formula = structuredClone(rng.pick(scored.filter((item) => item.score === bestScore)).formula);
    const startSlot = Math.max(0, endSlot - formula.length + 1);
    const applied = formula.slice(formula.length - (endSlot - startSlot + 1));

    // Cadence splicing must not create an arbitrary seam. If the random walk
    // cannot enter the selected formula, replace the immediately preceding
    // slot with a two-sided bridge from the pack's own transition model.
    if (startSlot > 0 && !transitionAllowed(pack, romans[startSlot - 1], applied[0])) {
      const previous = startSlot > 1 ? romans[startSlot - 2] : null;
      const bridges = pack.harmony.vocabulary.filter((roman) => (
        transitionAllowed(pack, previous, roman) && transitionAllowed(pack, roman, applied[0])
      ));
      if (bridges.length) romans[startSlot - 1] = rng.pick(bridges);
    }
    applied.forEach((roman, index) => {
      const slot = startSlot + index;
      romans[slot] = roman;
      cadenceSlot.set(slot, { id, position: index === applied.length - 1 ? 'arrival' : 'approach' });
    });
    if (endSlot + 1 < romans.length && !transitionAllowed(pack, applied.at(-1), romans[endSlot + 1])) {
      const exits = Object.keys(pack.harmony.transitions[applied.at(-1)] || {});
      if (exits.length) romans[endSlot + 1] = rng.pick(exits);
    }
    const degrees = applied.map((roman) => degreeFor(pack, roman));
    const melodyDegree = melodicArrival(rng, id, degrees, melodyDegrees);
    // What makes an authentic cadence perfect is the tonic in the soprano. If
    // the range could not reach it, the cadence is an imperfect one — so call
    // it that, rather than printing a label the music does not earn.
    const cadenceId = id === 'authentic' && melodyDegree !== 0 ? 'imperfect' : id;
    if (cadenceId !== id) {
      applied.forEach((_, index) => {
        const slot = startSlot + index;
        cadenceSlot.set(slot, { ...cadenceSlot.get(slot), id: cadenceId });
      });
    }
    const [name, short] = CADENCE_LABELS[cadenceId]
      || [cadenceId.replaceAll('_', ' '), cadenceId.toUpperCase()];
    cadences.push({
      id: cadenceId, name, short, measure, final,
      slots: applied.map((_, index) => startSlot + index), degrees,
      melodyDegree,
      strength: planBar?.cadenceStrength || (final ? 'strong' : 'weak'),
      phraseFunction: planBar?.phraseFunction || null,
      roman: applied.join('–'),
    });
  }

  // Solve every mutable span between protected cadence chords as one path.
  // This prevents a repair at one cadence from silently breaking another.
  const fixed = new Set([0, ...cadenceSlot.keys()]);
  let cursor = 0;
  while (cursor < romans.length) {
    if (fixed.has(cursor)) { cursor += 1; continue; }
    const start = cursor;
    while (cursor < romans.length && !fixed.has(cursor)) cursor += 1;
    const end = cursor - 1;
    const leftIndex = start - 1;
    const rightIndex = cursor < romans.length ? cursor : null;
    const bridge = bridgePath(
      pack, end - start + 1,
      leftIndex >= 0 ? romans[leftIndex] : null,
      rightIndex == null ? null : romans[rightIndex],
      romans.slice(start, end + 1), rng,
    );
    if (!bridge) throw new Error(`No licensed harmonic bridge into cadence at slot ${rightIndex ?? slots}`);
    bridge.forEach((roman, offset) => { romans[start + offset] = roman; });
  }

  const alteredSevenths = new Set(pack.harmony.altered_sevenths || []);
  const chords = romans.map((roman, index) => {
    const degree = degreeFor(pack, roman);
    const mark = cadenceSlot.get(index);
    const labelledSeventh = roman.includes('7');
    let inversion = allowInversions ? inversionFor(roman) : 0;
    if (allowInversions && !mark && inversion === 0 && rng.chance(pack.harmony.inversion_probability)) inversion = 1;
    const outputRoman = realisedRoman(roman, allowSevenths, allowInversions, pack);
    return {
      degree, plannedDegree: degree, plannedRoman: outputRoman, modelRoman: roman,
      displayRoman: mode === 'minor' ? outputRoman.replace(/^[ivIV]+[°ø+]?/, ROMAN.minor[degree]) : outputRoman,
      seventh: labelledSeventh && (allowSevenths || pack.harmony.require_labelled_sevenths === true),
      inversion, inversionLocked: Boolean(mark) || inversionFor(roman) > 0,
      fn: pack.harmony.functions_by_degree[degree], index,
      source: mark ? 'cadence' : 'progression',
      cadence: mark || null,
      bluesDominant: mode === 'major' && alteredSevenths.has(degree) && labelledSeventh,
    };
  });

  const degrees = chords.map((chord) => chord.degree);
  for (const cadence of cadences) {
    cadence.roman = cadence.slots.map((slot) => chords[slot].displayRoman).join('–');
  }
  const unitPlans = (form?.units || []).map((unit) => {
    const first = unit.bars[0] * chordsPerMeasure;
    const last = Math.min(chords.length, (unit.bars[1] + 1) * chordsPerMeasure);
    return { phrase: unit.index, function: unit.role, roman: chords.slice(first, last).map((chord) => chord.displayRoman).join('–') };
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

/** Which chord member is in the bass: 0 root, 2 third, 4 fifth, 6 seventh. */
export function bassInversionOffset(key, chord, bassDia) {
  const rootClass = ((chord.degree + tonicLetter(key)) % 7 + 7) % 7;
  const bassClass = ((bassDia % 7) + 7) % 7;
  return ((bassClass - rootClass) % 7 + 7) % 7;
}

function voicingCandidates(key, chord, { lowDia, highDia, rootPositionOnly = false }) {
  const centre = Math.round((lowDia + highDia) / 2);
  const base = chordTones(key, chord, centre - 2);
  const candidates = [];
  const relaxed = [];
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
      // A level that has not introduced inversions should not quietly read
      // them in the bass staff. Root position is preferred, not enforced: a
      // locked cadence chord or a cramped range still gets a legal voicing.
      if (rootPositionOnly && !chord.inversionLocked && bassInversionOffset(key, chord, voicing[0]) !== 0) {
        relaxed.push(voicing);
        continue;
      }
      candidates.push(voicing);
    }
  }
  if (!candidates.length && relaxed.length) return relaxed;
  if (!candidates.length) {
    const desired = (chord.degree + chord.inversion * 2) % 7;
    const choices = Array.from({ length: highDia - lowDia + 1 }, (_, index) => lowDia + index)
      .filter((dia) => ((dia - tonicLetter(key)) % 7 + 7) % 7 === desired);
    return [[choices.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0] ?? lowDia]];
  }
  return candidates;
}

/** Voice one chord, retained for callers that do not yet have phrase context. */
export function voiceChord(key, chord, prevVoicing, range) {
  const candidates = voicingCandidates(key, chord, range);
  const centre = Math.round((range.lowDia + range.highDia) / 2);
  if (!prevVoicing) return candidates.sort((a, b) => Math.abs(a[0] - centre) - Math.abs(b[0] - centre))[0];
  const cost = (voicing) => voicing.reduce((sum, pitch, index) => (
    sum + Math.abs(pitch - prevVoicing[Math.min(index, prevVoicing.length - 1)])
  ), 0);
  return candidates.sort((a, b) => cost(a) - cost(b))[0];
}

/**
 * Cost of moving one voicing to the next.
 *
 * The upper voices want to move as little as possible and to hold common
 * tones. The bass wants the opposite: a bass line is a line, so a step is
 * cheaper than standing still, and only wide leaps are expensive. Scoring the
 * two groups the same way is what produces a bass that never moves.
 */
function transitionCost(previous, current, preferStepwiseBass = false) {
  const upperMovement = current.slice(1).reduce((sum, pitch, index) => (
    sum + Math.abs(pitch - previous[Math.min(index + 1, previous.length - 1)])
  ), 0);
  const previousClasses = new Set(previous.map((pitch) => ((pitch % 7) + 7) % 7));
  const retained = current.filter((pitch) => previousClasses.has(((pitch % 7) + 7) % 7)).length;
  const distance = Math.abs(current[0] - previous[0]);
  let bass;
  if (!preferStepwiseBass) {
    bass = distance * 1.35;
  } else if (distance === 1) bass = -1.7;
  else if (distance === 0) bass = 1.1;
  else if (distance === 2) bass = 0.1;
  else if (distance <= 4) bass = 0.85;
  else bass = 0.85 + (distance - 4) * 1.1;
  return upperMovement - retained * 1.35 + bass;
}

/**
 * Choose all accompaniment voicings together. Dynamic programming lets a
 * locally less-obvious inversion win when it produces a smoother phrase and
 * avoids parallel perfect intervals against the realised melody.
 */
export function voiceChordSequence(key, chords, {
  lowDia, highDia, upperStaff = [], slotTicks = 48, forbidOuterParallels = false,
  preferStepwiseBass = false, rootPositionOnly = false,
}) {
  const layers = chords.map((chord) => voicingCandidates(key, chord, { lowDia, highDia, rootPositionOnly }));
  const topAt = (onset) => {
    const pitches = upperStaff.filter((event) => (
      !event.rest && event.onset <= onset && event.onset + event.duration > onset
    )).flatMap((event) => event.pitches || []);
    return pitches.length ? Math.max(...pitches.map((pitch) => pitch.dia)) : null;
  };
  let states = layers[0].map((voicing, index) => ({
    cost: Math.abs(voicing[0] - (lowDia + highDia) / 2), path: [index], voicing,
  }));
  for (let slot = 1; slot < layers.length; slot++) {
    const previousTop = topAt((slot - 1) * slotTicks);
    const currentTop = topAt(slot * slotTicks);
    const chord = chords[slot];
    states = layers[slot].map((voicing, index) => {
      let best = null;
      // A six-four is a specific device — cadential, passing, or over a pedal —
      // not a general-purpose voicing. Cadence chords declare their own.
      const sixFour = preferStepwiseBass && !chord.inversionLocked
        && bassInversionOffset(key, chord, voicing[0]) === 4 ? 3.2 : 0;
      for (const state of states) {
        let cost = state.cost + transitionCost(state.voicing, voicing, preferStepwiseBass) + sixFour;
        if (previousTop != null && currentTop != null) {
          const topMove = Math.sign(currentTop - previousTop);
          const bassMove = Math.sign(voicing[0] - state.voicing[0]);
          if (forbidOuterParallels) {
            const before = ((previousTop - state.voicing[0]) % 7 + 7) % 7;
            const after = ((currentTop - voicing[0]) % 7 + 7) % 7;
            if (topMove && topMove === bassMove && [0, 4].includes(before) && before === after) cost += 18;
          }
          // Outer voices moving against each other is what makes two staves
          // sound like two parts rather than one chord with a melody on top.
          if (preferStepwiseBass && topMove) {
            if (bassMove && topMove !== bassMove) cost -= 1.25;
            else if (!bassMove) cost -= 0.35;
          }
        }
        if (!best || cost < best.cost) best = { cost, path: [...state.path, index], voicing };
      }
      return best;
    });
  }
  const winner = [...states].sort((a, b) => a.cost - b.cost)[0];
  return winner.path.map((index, slot) => layers[slot][index]);
}

export function spellVoicing(key, chord, voicing) {
  return voicing.map((dia) => spellChordTone(key, chord, dia));
}
