// Deterministic composition critic.
//
// The critic separates hard musical correctness from stylistic quality. It
// inspects the realised notes and voicings—not merely the plan that produced
// them—so a mislabeled cadence, unresolved tendency, or inaudible section
// contrast cannot pass by agreeing with its own metadata.

import { isChordTone, tonicLetter } from './theory.js';
import { metricWeight } from './rhythm.js';
import { styleBenchmark } from './styleBenchmarks.js';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const rounded = (value) => Math.round(value * 100) / 100;

function scaleDegree(key, dia) {
  return (((dia - tonicLetter(key)) % 7) + 7) % 7;
}

function chordAt(score, onset) {
  const measure = Math.floor(onset / score.ts.ticks);
  const within = onset - measure * score.ts.ticks;
  const slotTicks = score.ts.ticks / score.chordsPerMeasure;
  const slot = Math.min(score.chordsPerMeasure - 1, Math.floor(within / slotTicks));
  return score.chords[Math.min(score.chords.length - 1, measure * score.chordsPerMeasure + slot)];
}

function leadNotes(score) {
  const source = score.staves.rh?.some((note) => !note.rest) ? score.staves.rh : score.staves.lh;
  return (source || [])
    .filter((note) => !note.rest && note.pitches?.length)
    .sort((a, b) => a.onset - b.onset);
}

function bassAtSlot(score, slot) {
  if (score.params.hands !== 'both' || score.params.lhStyle === 'melodic') return null;
  const onset = slot * score.ts.ticks / score.chordsPerMeasure;
  const attacks = score.staves.lh.filter((note) => !note.rest && note.onset === onset);
  const pitches = attacks.flatMap((note) => note.pitches || []);
  return pitches.length ? Math.min(...pitches.map((pitch) => pitch.dia)) : null;
}

function reviewCadences(score, notes) {
  const cadences = score.harmony?.cadences || [];
  if (!cadences.length) return { score: 0, plan: 0, melody: 0, bass: 0, strictPac: 0, errors: ['no cadence was planned'] };
  let planChecks = 0;
  let planPassed = 0;
  let melodyChecks = 0;
  let melodyPassed = 0;
  let bassChecks = 0;
  let bassPassed = 0;
  let pacChecks = 0;
  let pacPassed = 0;

  for (const cadence of cadences) {
    cadence.slots.forEach((slot, index) => {
      const chord = score.chords[slot];
      planChecks += 1;
      if (chord?.degree === cadence.degrees[index]) planPassed += 1;

      const bass = bassAtSlot(score, slot);
      if (bass != null) {
        bassChecks += 1;
        const expected = (chord.degree + chord.inversion * 2) % 7;
        if (scaleDegree(score.key, bass) === expected) bassPassed += 1;
      }
    });

    const measureNotes = notes.filter((note) => Math.floor(note.onset / score.ts.ticks) === cadence.measure);
    const marked = measureNotes.filter((note) => note.cadence === cadence.id);
    const arrival = marked.at(-1) || measureNotes.at(-1);
    melodyChecks += 1;
    if (arrival && scaleDegree(score.key, arrival.pitches[0].dia) === cadence.melodyDegree) melodyPassed += 1;

    if (cadence.id === 'authentic') {
      pacChecks += 1;
      const bassDegrees = cadence.slots.map((slot) => {
        const bass = bassAtSlot(score, slot);
        return bass == null ? null : scaleDegree(score.key, bass);
      });
      const sopranoTonic = arrival && scaleDegree(score.key, arrival.pitches[0].dia) === 0;
      const impliedOnly = bassDegrees.every((degree) => degree == null);
      if ((impliedOnly || (bassDegrees[0] === 4 && bassDegrees.at(-1) === 0)) && sopranoTonic) pacPassed += 1;
    }
  }

  const plan = planChecks ? planPassed / planChecks : 1;
  const melody = melodyChecks ? melodyPassed / melodyChecks : 1;
  const bass = bassChecks ? bassPassed / bassChecks : 1;
  const strictPac = pacChecks ? pacPassed / pacChecks : 1;
  const errors = [];
  if (plan < 1) errors.push('a cadence does not realise its planned chords');
  if (melody < 1) errors.push('a cadence does not reach its planned melody tone');
  if (bass < 1) errors.push('a realised chord does not preserve its planned inversion');
  if (strictPac < 1) errors.push('a labeled PAC is not root-position V–I with tonic in the melody');
  return {
    score: plan * 0.3 + melody * 0.25 + bass * 0.25 + strictPac * 0.2,
    plan, melody, bass, strictPac, errors,
  };
}

function reviewMotifs(score, notes) {
  const groups = new Map();
  for (const note of notes) {
    if (!note.motifKey) continue;
    const measure = Math.floor(note.onset / score.ts.ticks);
    if (!groups.has(note.motifKey)) groups.set(note.motifKey, new Map());
    const measures = groups.get(note.motifKey);
    if (!measures.has(measure)) measures.set(measure, []);
    measures.get(measure).push(note.pitches[0].dia);
  }

  let comparedNotes = 0;
  let recognisedNotes = 0;
  let comparisons = 0;
  let variedCopies = 0;
  for (const measures of groups.values()) {
    const copies = [...measures.values()];
    if (copies.length < 2 || !copies[0].length) continue;
    const base = copies[0];
    for (const copy of copies.slice(1)) {
      const length = Math.min(base.length, copy.length);
      if (!length) continue;
      comparisons += 1;
      let exact = base.length === copy.length;
      for (let i = 0; i < length; i++) {
        const baseShape = base[i] - base[0];
        const copyShape = copy[i] - copy[0];
        if (Math.abs(baseShape - copyShape) <= 1) recognisedNotes += 1;
        if (base[i] !== copy[i]) exact = false;
        comparedNotes += 1;
      }
      if (!exact) variedCopies += 1;
    }
  }
  return {
    recognition: comparedNotes ? recognisedNotes / comparedNotes : 1,
    variation: comparisons ? variedCopies / comparisons : 1,
  };
}

function reviewMelody(score, notes) {
  const intervals = notes.slice(1).map((note, i) => note.pitches[0].dia - notes[i].pitches[0].dia);
  const smallMotion = intervals.length
    ? intervals.filter((interval) => Math.abs(interval) <= 2).length / intervals.length : 1;
  const repeated = intervals.length
    ? intervals.filter((interval) => interval === 0).length / intervals.length : 0;
  let leaps = 0;
  let resolved = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    if (Math.abs(intervals[i]) < 3) continue;
    leaps += 1;
    if (Math.abs(intervals[i + 1]) <= 2 && Math.sign(intervals[i + 1]) !== Math.sign(intervals[i])) resolved += 1;
  }

  const dias = notes.map((note) => note.pitches[0].dia);
  const highest = dias.length ? Math.max(...dias) : 0;
  const apexCount = dias.filter((dia) => dia === highest).length;
  const apexIndex = dias.indexOf(highest);
  const apexPosition = dias.length > 1 ? apexIndex / (dias.length - 1) : 0.5;
  const markedClimax = notes.filter((note) => note.structural === 'climax');
  const uniqueClimax = dias.length < 3 || (apexCount === 1 && markedClimax.length === 1
    && markedClimax[0].pitches[0].dia === highest) ? 1 : 0.5;

  const tendencies = notes.filter((note) => note.tendency);
  const tendencyResolution = tendencies.length
    ? tendencies.filter((note) => note.tendencyResolved).length / tendencies.length : 1;
  const ornaments = notes.filter((note) => !note.chordTone);
  const ornamentClarity = ornaments.length
    ? ornaments.filter((note) => note.nonChordKind).length / ornaments.length : 1;
  const phraseStarts = notes.filter((note) => note.structural === 'phrase-start');
  const anchorHarmony = phraseStarts.length
    ? phraseStarts.filter((note) => isChordTone(score.key, chordAt(score, note.onset), note.pitches[0].dia)).length / phraseStarts.length : 1;

  return {
    smallMotion,
    repeated,
    leapResolution: leaps ? resolved / leaps : 1,
    uniqueClimax,
    apexPosition,
    tendencyResolution,
    ornamentClarity,
    anchorHarmony,
  };
}

const CADENCE_RANK = {
  half: 1,
  deceptive: 1.5,
  bluesTurnaround: 1.5,
  subdominantTurn: 1.5,
  imperfect: 2,
  modal: 2.3,
  plagal: 2.5,
  authentic: 3,
};

function reviewForm(score, notes) {
  const phrases = score.form?.phrases || [];
  const expectedCadences = phrases.filter((item) => item.cadence).length;
  const cadences = score.harmony?.cadences || [];
  const coverage = expectedCadences ? Math.min(1, cadences.length / expectedCadences) : cadences.length ? 1 : 0;

  let hierarchyChecks = 0;
  let hierarchyPassed = 0;
  const cadenceByFunction = new Map(cadences.map((item) => [item.phraseFunction, item]));
  for (const phrase of phrases) {
    if (!phrase.cadence) continue;
    const cadence = cadenceByFunction.get(phrase.function)
      || cadences.find((item) => Math.floor(item.measure / 4) === phrase.index);
    if (!cadence) continue;
    hierarchyChecks += 1;
    const rank = CADENCE_RANK[cadence.id] || 1;
    if (phrase.cadenceStrength === 'strong' ? rank >= 2
      : phrase.cadenceStrength === 'open' ? rank <= 2
        : phrase.cadenceStrength === 'weak' ? rank < 3
          : true) hierarchyPassed += 1;
  }
  const hierarchy = hierarchyChecks ? hierarchyPassed / hierarchyChecks : 1;

  const byPhrase = phrases.map((phrase) => {
    const phraseNotes = notes.filter((note) => Math.floor(note.onset / score.ts.ticks / 4) === phrase.index);
    const mean = phraseNotes.length
      ? phraseNotes.reduce((sum, note) => sum + note.pitches[0].dia, 0) / phraseNotes.length : 0;
    return { phrase, mean, density: phraseNotes.length / 4 };
  });
  let contrast = phrases.length <= 1 ? 1 : 0;
  for (let i = 0; i < byPhrase.length; i++) {
    for (let j = i + 1; j < byPhrase.length; j++) {
      if (byPhrase[i].phrase.section === byPhrase[j].phrase.section) continue;
      const register = Math.abs(byPhrase[i].mean - byPhrase[j].mean) / 4;
      const density = Math.abs(byPhrase[i].density - byPhrase[j].density) / Math.max(1, byPhrase[i].density, byPhrase[j].density);
      contrast = Math.max(contrast, clamp(register * 0.65 + density * 0.7));
    }
  }

  const functionsPresent = new Set(phrases.map((item) => item.function)).size;
  const functionCoverage = phrases.length ? clamp(functionsPresent / Math.min(3, phrases.length)) : 0;
  return {
    score: coverage * 0.32 + hierarchy * 0.3 + contrast * 0.23 + functionCoverage * 0.15,
    coverage,
    hierarchy,
    contrast,
    functionCoverage,
  };
}

function reviewVoiceLeading(score) {
  if (score.params.hands !== 'both' || score.params.lhStyle === 'melodic') {
    return { score: 1, averageBassMove: 0, largestBassMove: 0, parallelBlocks: 0 };
  }
  const slotTicks = score.ts.ticks / score.chordsPerMeasure;
  const voicings = [];
  for (let slot = 0; slot < score.chords.length; slot++) {
    const onset = slot * slotTicks;
    const pitches = score.staves.lh
      .filter((note) => !note.rest && note.onset === onset)
      .flatMap((note) => note.pitches || [])
      .map((pitch) => pitch.dia)
      .sort((a, b) => a - b);
    if (pitches.length) voicings.push(pitches);
  }
  if (voicings.length < 2) return { score: 1, averageBassMove: 0, largestBassMove: 0, parallelBlocks: 0 };
  const moves = voicings.slice(1).map((voicing, i) => Math.abs(voicing[0] - voicings[i][0]));
  const averageBassMove = moves.reduce((sum, move) => sum + move, 0) / moves.length;
  const largestBassMove = Math.max(...moves);
  let parallelBlocks = 0;
  for (let i = 1; i < voicings.length; i++) {
    const a = voicings[i - 1];
    const b = voicings[i];
    const offsets = b.map((pitch, voice) => pitch - a[Math.min(voice, a.length - 1)]);
    if (offsets.length > 1 && offsets.every((offset) => offset === offsets[0]) && offsets[0] !== 0) parallelBlocks += 1;
  }
  const scoreValue = clamp(
    1 - Math.max(0, averageBassMove - 2.7) * 0.11
      - Math.max(0, largestBassMove - 7) * 0.06
      - parallelBlocks * 0.08,
  );
  return { score: scoreValue, averageBassMove, largestBassMove, parallelBlocks };
}

function reviewPlayability(score) {
  let checks = 0;
  let passed = 0;
  for (const hand of ['rh', 'lh']) {
    const events = (score.staves[hand] || []).filter((note) => !note.rest && note.pitches?.length);
    for (const note of events) {
      if (note.pitches.length < 2) continue;
      checks += 1;
      const dias = note.pitches.map((pitch) => pitch.dia);
      if (Math.max(...dias) - Math.min(...dias) <= 7) passed += 1;
    }
  }
  return checks ? passed / checks : 1;
}

function inRange(value, [low, high]) {
  if (value >= low && value <= high) return 1;
  return clamp(1 - Math.min(Math.abs(value - low), Math.abs(value - high)) * 2.5);
}

function reviewStyle(score, notes, melody, motifs, formReview) {
  const id = score.style?.id || 'classical';
  const benchmark = styleBenchmark(id);
  const finalCadence = score.harmony?.cadences?.at(-1)?.id;
  const finalCadenceFit = benchmark.finalCadences.includes(finalCadence) ? 1 : 0.45;
  const metadata = score.form?.styleId === id && score.harmony?.styles?.includes(id) ? 1 : 0;
  const motion = inRange(melody.smallMotion, benchmark.smallMotion);
  const repetition = inRange(melody.repeated, benchmark.repeatedNotes);
  const motifFit = clamp(motifs.recognition / benchmark.motifRecognition);
  const contrastFit = score.form?.phrases?.length <= 1
    ? 1 : clamp(formReview.contrast / benchmark.sectionContrast);
  let idiom = 1;
  if (id === 'blues') {
    const primary = score.chords.filter((chord) => [0, 3, 4].includes(chord.degree));
    const sevenths = primary.length ? primary.filter((chord) => chord.seventh).length / primary.length : 0;
    const blueNotes = notes.filter((note) => note.tags?.includes('blue-note')).length;
    idiom = (score.measures === 12 ? 0.45 : 0) + sevenths * 0.35 + (blueNotes || motifs.recognition >= 0.7 ? 0.2 : 0);
  } else if (id === 'waltz') {
    idiom = score.ts.name === '3/4' ? 0.7 : 0.2;
    if (score.params.hands !== 'both' || score.params.lhStyle === 'waltz') idiom += 0.3;
  } else if (id === 'pop') {
    idiom = formReview.contrast >= benchmark.sectionContrast ? 1 : 0.62;
  }
  return clamp(metadata * 0.16 + motion * 0.13 + repetition * 0.09 + motifFit * 0.2
    + contrastFit * 0.16 + finalCadenceFit * 0.12 + idiom * 0.14);
}

/** Score one generated exercise against formal, harmonic, melodic, and stylistic constraints. */
export function reviewMusicality(score) {
  const notes = leadNotes(score);
  const strong = notes.filter((note) => metricWeight(score.ts, note.onset % score.ts.ticks) > 0);
  const strongHarmony = strong.length
    ? strong.filter((note) => isChordTone(score.key, chordAt(score, note.onset), note.pitches[0].dia)).length / strong.length : 1;

  const cadence = reviewCadences(score, notes);
  const body = score.chords.filter((chord) => chord.source === 'progression');
  const progressionConsistency = body.length
    ? body.filter((chord) => chord.degree === chord.plannedDegree).length / body.length : 1;
  const motifs = reviewMotifs(score, notes);
  const melody = reviewMelody(score, notes);
  const formReview = reviewForm(score, notes);
  const voiceLeading = reviewVoiceLeading(score);
  const playability = reviewPlayability(score);
  const styleCoherence = reviewStyle(score, notes, melody, motifs, formReview);

  const benchmark = styleBenchmark(score.style?.id);
  const motionScore = inRange(melody.smallMotion, benchmark.smallMotion);
  const repetitionScore = inRange(melody.repeated, benchmark.repeatedNotes);
  const melodicScore = strongHarmony * 0.16 + melody.leapResolution * 0.17
    + motionScore * 0.12 + repetitionScore * 0.08 + melody.uniqueClimax * 0.15
    + melody.tendencyResolution * 0.14 + melody.ornamentClarity * 0.08 + melody.anchorHarmony * 0.1;
  const motifScore = motifs.recognition * 0.72 + motifs.variation * 0.28;
  const harmonyScore = cadence.score * 0.68 + progressionConsistency * 0.32;
  const overall = formReview.score * 0.18 + harmonyScore * 0.23 + motifScore * 0.14
    + melodicScore * 0.24 + voiceLeading.score * 0.07 + playability * 0.06 + styleCoherence * 0.08;

  const errors = [...cadence.errors];
  if (progressionConsistency < 1) errors.push('the harmonic pattern loses its stated progression');
  if (playability < 1) errors.push('a chord exceeds a comfortable octave hand span');
  const issues = [...errors];
  if (formReview.hierarchy < 1) issues.push('cadence strength does not match a phrase function');
  if (strongHarmony < benchmark.strongBeatChordTones) issues.push('too many accented melody notes conflict with the harmony');
  if (melody.tendencyResolution < 0.82) issues.push('a leading tone or chordal seventh is left unresolved');
  if (melody.uniqueClimax < 1) issues.push('the melodic climax is repeated or unclear');
  if (motifs.recognition < benchmark.motifRecognition) issues.push('the returning idea is not recognisable enough');
  if (formReview.contrast < benchmark.sectionContrast && score.form?.phrases?.length > 1) issues.push('contrasting sections are not audibly distinct');
  if (styleCoherence < 0.72) issues.push('the realised music does not strongly fit the selected style');

  const scoreValue = Math.round(overall * 100);
  return {
    passed: scoreValue >= 82 && errors.length === 0,
    score: scoreValue,
    metrics: {
      form: rounded(formReview.score),
      phraseHierarchy: rounded(formReview.hierarchy),
      sectionContrast: rounded(formReview.contrast),
      harmony: rounded(harmonyScore),
      strongBeatHarmony: rounded(strongHarmony),
      cadenceAccuracy: rounded(cadence.score),
      cadenceBass: rounded(cadence.bass),
      strictPac: rounded(cadence.strictPac),
      motifRecognition: rounded(motifs.recognition),
      motifVariation: rounded(motifs.variation),
      smallMotion: rounded(melody.smallMotion),
      leapResolution: rounded(melody.leapResolution),
      tendencyResolution: rounded(melody.tendencyResolution),
      uniqueClimax: rounded(melody.uniqueClimax),
      voiceLeading: rounded(voiceLeading.score),
      playability: rounded(playability),
      styleCoherence: rounded(styleCoherence),
    },
    errors,
    issues,
  };
}
