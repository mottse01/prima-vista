// Deterministic composition critic.
//
// This is deliberately a rules engine rather than an LLM call: it is instant,
// reproducible from the exercise seed, works offline, and can reject a weak
// candidate before the notation reaches the player.

import { isChordTone, tonicLetter } from './theory.js';
import { metricWeight } from './rhythm.js';

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

function reviewCadences(score, notes) {
  const cadences = score.harmony?.cadences || [];
  if (!cadences.length) return 1;
  let checks = 0;
  let passed = 0;

  for (const cadence of cadences) {
    cadence.slots.forEach((slot, i) => {
      checks += 1;
      if (score.chords[slot]?.degree === cadence.degrees[i]) passed += 1;
    });
    const measureNotes = notes.filter((note) => Math.floor(note.onset / score.ts.ticks) === cadence.measure);
    const marked = measureNotes.filter((note) => note.cadence === cadence.id);
    const arrival = marked[0] || measureNotes[measureNotes.length - 1];
    checks += 1;
    if (arrival && scaleDegree(score.key, arrival.pitches[0].dia) === cadence.melodyDegree) passed += 1;
  }
  return checks ? passed / checks : 1;
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
    ? intervals.filter((interval) => Math.abs(interval) <= 2).length / intervals.length
    : 1;
  const repeated = intervals.length
    ? intervals.filter((interval) => interval === 0).length / intervals.length
    : 0;

  let leaps = 0;
  let resolved = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    if (Math.abs(intervals[i]) < 3) continue;
    leaps += 1;
    if (Math.abs(intervals[i + 1]) <= 2 && Math.sign(intervals[i + 1]) !== Math.sign(intervals[i])) {
      resolved += 1;
    }
  }
  const leapResolution = leaps ? resolved / leaps : 1;

  const dias = notes.map((note) => note.pitches[0].dia);
  const span = dias.length ? Math.max(...dias) - Math.min(...dias) : 0;
  const apex = dias.length > 1 ? dias.indexOf(Math.max(...dias)) / (dias.length - 1) : 0.5;
  const contour = span <= 1 || (apex >= 0.18 && apex <= 0.86) ? 1 : 0.65;

  return { smallMotion, repeated, leapResolution, contour };
}

function reviewVoiceLeading(score) {
  if (score.params.hands !== 'both' || score.params.lhStyle === 'melodic') return 1;
  const slotTicks = score.ts.ticks / score.chordsPerMeasure;
  const basses = [];
  for (let slot = 0; slot < score.chords.length; slot++) {
    const onset = slot * slotTicks;
    const attacks = score.staves.lh.filter((note) => !note.rest && note.onset === onset);
    const pitches = attacks.flatMap((note) => note.pitches || []);
    if (pitches.length) basses.push(Math.min(...pitches.map((pitch) => pitch.dia)));
  }
  if (basses.length < 2) return 1;
  const moves = basses.slice(1).map((bass, i) => Math.abs(bass - basses[i]));
  const average = moves.reduce((sum, move) => sum + move, 0) / moves.length;
  const largest = Math.max(...moves);
  return clamp(1 - Math.max(0, average - 2.5) * 0.12 - Math.max(0, largest - 7) * 0.05);
}

/** Score one generated exercise against explicit compositional constraints. */
export function reviewMusicality(score) {
  const notes = leadNotes(score);
  const strong = notes.filter((note) => metricWeight(score.ts, note.onset % score.ts.ticks) > 0);
  const strongHarmony = strong.length
    ? strong.filter((note) => isChordTone(score.key, chordAt(score, note.onset), note.pitches[0].dia)).length / strong.length
    : 1;

  const cadenceAccuracy = reviewCadences(score, notes);
  const pattern = score.harmony?.degrees || [];
  const body = score.chords.filter((chord) => chord.source === 'progression');
  const progressionConsistency = body.length && pattern.length
    ? body.filter((chord) => chord.degree === pattern[chord.index % pattern.length]).length / body.length
    : 1;
  const cadenceIds = (score.harmony?.cadences || []).map((item) => item.id);
  const cadenceVariety = cadenceIds.length > 1
    ? Math.min(1, new Set(cadenceIds).size / Math.min(2, cadenceIds.length))
    : 1;

  const expectedPhrases = Math.ceil(score.measures / (score.form?.phraseLength || 4));
  const formCoverage = Math.min(1, (score.harmony?.cadences?.length || 0) / expectedPhrases);
  const motifs = reviewMotifs(score, notes);
  const melody = reviewMelody(score, notes);
  const voiceLeading = reviewVoiceLeading(score);

  const formScore = formCoverage;
  const harmonyScore = cadenceAccuracy * 0.5 + progressionConsistency * 0.35 + cadenceVariety * 0.15;
  const motifScore = motifs.recognition * 0.8 + (score.measures <= 4 ? 1 : 0.6 + motifs.variation * 0.4) * 0.2;
  const motionScore = clamp(melody.smallMotion / 0.68);
  const repetitionScore = clamp(1 - Math.max(0, melody.repeated - 0.24) / 0.35);
  const melodyScore = strongHarmony * 0.28 + melody.leapResolution * 0.28
    + motionScore * 0.2 + repetitionScore * 0.14 + melody.contour * 0.1;
  const overall = formScore * 0.12 + harmonyScore * 0.25 + motifScore * 0.22
    + melodyScore * 0.34 + voiceLeading * 0.07;

  const issues = [];
  if (formCoverage < 1) issues.push('phrase structure lacks cadential punctuation');
  if (cadenceAccuracy < 1) issues.push('a cadence is not realised in both harmony and melody');
  if (progressionConsistency < 1) issues.push('the harmonic pattern loses its stated progression');
  if (strongHarmony < 0.62) issues.push('too many accented melody notes conflict with the harmony');
  if (melody.leapResolution < 0.6) issues.push('too many melodic leaps are left unresolved');
  if (motifs.recognition < 0.5) issues.push('the repeated idea is not recognisable enough');

  const scoreValue = Math.round(overall * 100);
  return {
    passed: scoreValue >= 80 && issues.length === 0,
    score: scoreValue,
    metrics: {
      form: rounded(formScore),
      harmony: rounded(harmonyScore),
      strongBeatHarmony: rounded(strongHarmony),
      cadenceAccuracy: rounded(cadenceAccuracy),
      motifRecognition: rounded(motifs.recognition),
      motifVariation: rounded(motifs.variation),
      smallMotion: rounded(melody.smallMotion),
      leapResolution: rounded(melody.leapResolution),
      voiceLeading: rounded(voiceLeading),
    },
    issues,
  };
}
