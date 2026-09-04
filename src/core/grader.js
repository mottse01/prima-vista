// Real-time grader.
//
// Sight Reading Factory shows you notes and hopes for the best. This module is
// the other half of the loop: it matches what you actually played against what
// was written, and attributes every miss to a *skill*, so practice can be aimed.

import { TPQ, diaToY, pitchClassName } from './theory.js';
import { xmlNoteId } from './musicxml.js';
import { expectedEvents } from './generator.js';
import { playbackEvents } from './playback.js';

export const SKILLS = [
  { id: 'notes.treble', label: 'Treble staff notes' },
  { id: 'notes.bass', label: 'Bass staff notes' },
  { id: 'notes.ledger', label: 'Ledger-line notes' },
  { id: 'notes.accidental', label: 'Sharps & flats' },
  { id: 'intervals.step', label: 'Steps' },
  { id: 'intervals.skip', label: 'Skips (3rds)' },
  { id: 'intervals.leap', label: 'Leaps (4ths+)' },
  { id: 'rhythm.quarter', label: 'Quarters & halves' },
  { id: 'rhythm.eighth', label: 'Eighths' },
  { id: 'rhythm.sixteenth', label: 'Sixteenths' },
  { id: 'rhythm.dotted', label: 'Dotted rhythms' },
  { id: 'rhythm.syncopation', label: 'Syncopation' },
  { id: 'rhythm.triplet', label: 'Triplets' },
  { id: 'rhythm.rest', label: 'Rests' },
  { id: 'coordination.together', label: 'Hands together' },
];

const RHYTHM_TAG_TO_SKILL = {
  quarter: 'rhythm.quarter', half: 'rhythm.quarter', whole: 'rhythm.quarter',
  eighth: 'rhythm.eighth', sixteenth: 'rhythm.sixteenth', dotted: 'rhythm.dotted',
  syncopation: 'rhythm.syncopation', triplet: 'rhythm.triplet', rest: 'rhythm.rest',
};

/** Annotate each expected event with the skills it exercises. */
export function analyseEvents(score) {
  const events = expectedEvents(score);
  const groups = new Map();
  const handsAtOnset = new Map();
  // A rest is read successfully when the player carries the pulse through the
  // silence and returns at the right place. Attach one observation to the
  // first attack after each notated rest; raw rest events are intentionally
  // absent from expectedEvents because there is no pitch to match.
  const restReentries = new Set();
  for (const hand of ['rh', 'lh']) {
    const staff = playbackEvents(score, hand);
    staff.forEach((event, index) => {
      if (!event.rest) return;
      const reentry = staff.slice(index + 1).find((candidate) => !candidate.rest);
      if (reentry) restReentries.add(`${hand}:${reentry.onset}`);
    });
  }
  for (const event of events) {
    const key = `${event.hand}:${event.onset}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
    if (!handsAtOnset.has(event.onset)) handsAtOnset.set(event.onset, new Set());
    handsAtOnset.get(event.onset).add(event.hand);
  }

  // Melodic intervals run from one hand-position/attack to the next. Vertical
  // thirds inside a blocked chord are not melodic skips, and must not pollute
  // the learner's interval diagnosis.
  const anchorForGroup = new Map();
  const intervalForEvent = new WeakMap();
  for (const hand of ['rh', 'lh']) {
    const handGroups = [...groups.entries()]
      .filter(([key]) => key.startsWith(`${hand}:`))
      .sort((a, b) => a[1][0].onset - b[1][0].onset);
    let previous = null;
    for (const [key, attack] of handGroups) {
      const anchor = attack.reduce((best, event) => {
        if (!best) return event;
        return hand === 'rh'
          ? (event.pitch.dia > best.pitch.dia ? event : best)
          : (event.pitch.dia < best.pitch.dia ? event : best);
      }, null);
      anchorForGroup.set(key, anchor);
      if (previous) {
        const steps = Math.abs(anchor.pitch.dia - previous.pitch.dia);
        intervalForEvent.set(anchor, steps <= 1
          ? 'intervals.step'
          : steps === 2 ? 'intervals.skip' : 'intervals.leap');
      }
      previous = anchor;
    }
  }

  return events.map((e, i) => {
    const clef = e.hand === 'rh' ? 'treble' : 'bass';
    const y = diaToY(clef, e.pitch.dia);
    const skills = new Set();
    skills.add(e.hand === 'rh' ? 'notes.treble' : 'notes.bass');
    if (y < -0.2 || y > 4.2) skills.add('notes.ledger');
    // Reading a sharp or flat from the key signature is still accidental
    // fluency; written chromatic accidentals are included by the same test.
    if (e.pitch.alter !== 0) skills.add('notes.accidental');

    const intervalSkill = intervalForEvent.get(e);
    if (intervalSkill) skills.add(intervalSkill);

    for (const tag of e.tags || []) {
      const s = RHYTHM_TAG_TO_SKILL[tag];
      if (s) skills.add(s);
    }
    if (!(e.tags || []).some((t) => RHYTHM_TAG_TO_SKILL[t])) skills.add('rhythm.quarter');
    // Simultaneous pitches in one hand form a chord; coordination means the
    // two hands actually attack together. Count one anchor per hand so a triad
    // does not create three times as much evidence as a single bass note.
    const groupKey = `${e.hand}:${e.onset}`;
    if (restReentries.has(groupKey) && anchorForGroup.get(groupKey) === e) {
      skills.add('rhythm.rest');
    }
    if ((handsAtOnset.get(e.onset)?.size || 0) > 1 && anchorForGroup.get(groupKey) === e) {
      skills.add('coordination.together');
    }

    return {
      ...e,
      index: i,
      // Same id the MusicXML carries, so the renderer can colour this note.
      key: xmlNoteId(e.hand, e.notationOnset ?? e.onset, e.midi),
      skills: [...skills],
      pitchClass: pitchClassName(e.pitch),
    };
  });
}

// A run of this many clean attacks counts as being back in control.
const STABLE_RUN = 2;

/**
 * How long a mistake derails you.
 *
 * Accuracy alone hides the thing that separates a sight-reader from a
 * practiser: not whether you slip, but whether the slip takes the next four
 * notes down with it. Attacks (chords count once) are walked in order, and each
 * run of trouble is measured from its first bad attack to the point where two
 * clean ones in a row resume.
 *
 * "Bad" here means a wrong or dropped note, deliberately *not* a late one.
 * Playing steadily behind the beat is a tempo problem, already reported as
 * timing bias; counting it here would mark a player who is merely slow as
 * permanently derailed, which is both wrong and useless to them.
 */
function analyseRecovery(expected) {
  const byOnset = new Map();
  for (const e of expected) {
    const m = e.matched;
    const good = Boolean(m && !m.wrongPitch);
    // A chord is only as good as its worst note.
    byOnset.set(e.onset, (byOnset.get(e.onset) ?? true) && good);
  }
  const attacks = [...byOnset.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([onset, good]) => ({ onset, good }));

  const episodes = [];
  let start = null;
  let clean = 0;

  attacks.forEach((a, i) => {
    if (a.good) {
      clean += 1;
      if (start !== null && clean >= STABLE_RUN) {
        // Recovered: the stable run began `clean - 1` attacks back.
        episodes.push({ start, end: i - (STABLE_RUN - 1), recovered: true });
        start = null;
      }
    } else {
      clean = 0;
      if (start === null) start = i;
    }
  });
  if (start !== null) episodes.push({ start, end: attacks.length, recovered: false });

  const lengths = episodes.filter((e) => e.recovered).map((e) => e.end - e.start);
  const unrecovered = episodes.filter((e) => !e.recovered).length;

  return {
    episodes: episodes.length,
    unrecovered,
    meanNotes: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null,
    worstNotes: lengths.length ? Math.max(...lengths) : null,
  };
}

/**
 * Stateful matcher. Feed it note-on events with an audio-clock timestamp;
 * ask for `summary()` when the take is over.
 */
export function createGrader(score, { startTime, toleranceScale = 1 } = {}) {
  const events = analyseEvents(score);
  const secPerTick = 60 / score.tempo / TPQ;
  const expected = events.map((e) => ({ ...e, at: startTime + e.onset * secPerTick, matched: null }));

  // A note counts as on time within half a beat, floored so slow tempi stay fair.
  const beatSec = (score.ts.beat / TPQ) * (60 / score.tempo);
  const window = Math.max(0.28, beatSec * 0.6) * toleranceScale;
  const goodTiming = Math.max(0.09, beatSec * 0.22) * toleranceScale;

  const played = [];
  const states = {}; // note id -> 'correct' | 'late' | 'wrong' | 'missed'
  let extras = 0;

  function noteOn(midi, time) {
    let best = null;
    let bestDist = Infinity;
    for (const e of expected) {
      if (e.matched) continue;
      if (e.midi !== midi) continue;
      const d = Math.abs(e.at - time);
      if (d < bestDist && d <= window) { best = e; bestDist = d; }
    }

    if (best) {
      const delta = time - best.at;
      const ok = Math.abs(delta) <= goodTiming;
      best.matched = { time, delta, ok };
      states[best.key] = ok ? 'correct' : 'late';
      played.push({ midi, time, verdict: ok ? 'correct' : 'timing', target: best.key, delta });
      return { verdict: ok ? 'correct' : 'timing', delta, key: best.key };
    }

    // Nothing of that pitch is due — if something else was due here, it's a
    // wrong note rather than a spurious extra.
    let near = null;
    let nearDist = Infinity;
    for (const e of expected) {
      if (e.matched) continue;
      const d = Math.abs(e.at - time);
      if (d < nearDist && d <= window) { near = e; nearDist = d; }
    }
    if (near) {
      near.matched = { time, delta: time - near.at, ok: false, wrongPitch: midi };
      states[near.key] = 'wrong';
      played.push({ midi, time, verdict: 'wrong', target: near.key });
      return { verdict: 'wrong', key: near.key, expectedMidi: near.midi };
    }

    extras += 1;
    played.push({ midi, time, verdict: 'extra' });
    return { verdict: 'extra' };
  }

  function summary() {
    const skillTally = {};
    const bump = (id, ok) => {
      if (!skillTally[id]) skillTally[id] = { correct: 0, total: 0 };
      skillTally[id].total += 1;
      if (ok) skillTally[id].correct += 1;
    };
    const pitchTally = {};
    const pitchLocations = {};

    let correct = 0;
    let wrong = 0;
    let missed = 0;
    let timingOff = 0;
    let absDelta = 0;
    let deltaCount = 0;
    let signedDelta = 0;

    for (const e of expected) {
      const m = e.matched;
      const pitchOk = Boolean(m && !m.wrongPitch);
      const fullyOk = Boolean(m && m.ok && !m.wrongPitch);
      if (!m) missed += 1;
      else if (m.wrongPitch) wrong += 1;
      else if (!m.ok) { timingOff += 1; correct += 1; }
      else correct += 1;

      if (m && !m.wrongPitch) {
        absDelta += Math.abs(m.delta);
        signedDelta += m.delta;
        deltaCount += 1;
      }
      for (const s of e.skills) bump(s, fullyOk);
      if (!pitchTally[e.pitchClass]) pitchTally[e.pitchClass] = { correct: 0, total: 0 };
      pitchTally[e.pitchClass].total += 1;
      if (pitchOk) pitchTally[e.pitchClass].correct += 1;
      const locationName = `${e.hand}:${e.pitchClass}${e.pitch.octave}`;
      if (!pitchLocations[locationName]) {
        pitchLocations[locationName] = {
          correct: 0, total: 0, hand: e.hand, note: `${e.pitchClass}${e.pitch.octave}`,
        };
      }
      pitchLocations[locationName].total += 1;
      if (pitchOk) pitchLocations[locationName].correct += 1;
    }

    // Every expected note in time order, with the timing error where we have
    // one. This is what the per-note timing strip draws.
    const timeline = expected.map((e) => {
      const m = e.matched;
      let verdict;
      if (!m) verdict = 'missed';
      else if (m.wrongPitch) verdict = 'wrong';
      else if (!m.ok) verdict = 'timing';
      else verdict = 'correct';
      return {
        onset: e.onset,
        hand: e.hand,
        delta: m && !m.wrongPitch ? m.delta : null,
        verdict,
      };
    });

    const total = expected.length || 1;
    // Extra notes matter: key-mashing must not produce the same pitch score as
    // a clean reading that found the written notes.
    const pitchAccuracy = correct / (total + extras);
    const rhythmAccuracy = deltaCount ? (deltaCount - timingOff) / total : 0;
    // Continuity is attack-based, not another spelling of note accuracy. A
    // wrong note played on the beat still shows that the pulse kept moving;
    // an entirely absent attack is a stall.
    const attacks = new Map();
    for (const event of expected) {
      const current = attacks.get(event.onset) || false;
      attacks.set(event.onset, current || Boolean(event.matched));
    }
    const attackCount = attacks.size || 1;
    const attacksKept = [...attacks.values()].filter(Boolean).length;
    const continuity = attacksKept / attackCount;
    const inputCoverage = attacksKept / attackCount;
    const minimumDetectedAttacks = Math.min(3, attackCount);
    const valid = played.length > 0
      && attacksKept >= minimumDetectedAttacks
      && inputCoverage >= 0.12;
    const overall = 0.5 * pitchAccuracy + 0.3 * rhythmAccuracy + 0.2 * continuity;

    return {
      total, correct, wrong, missed, extras, timingOff, timedNotes: deltaCount,
      pitchAccuracy, rhythmAccuracy, continuity, overall, attackCount, attacksKept,
      meanAbsTiming: deltaCount ? absDelta / deltaCount : null,
      meanSignedTiming: deltaCount ? signedDelta / deltaCount : null,
      skills: skillTally,
      pitches: pitchTally,
      pitchLocations,
      played,
      timeline,
      recovery: analyseRecovery(expected),
      valid,
      inputCoverage,
      minimumDetectedAttacks,
      invalidReason: valid ? null : 'not-enough-input',
      // Scales the timing strip so takes are comparable to each other.
      window,
      goodTiming,
      totalTicks: score.performanceTicks || score.totalTicks,
      barTicks: score.ts.ticks,
      score: Math.round(overall * 100),
    };
  }

  return {
    events,
    expected,
    noteOn,
    summary,
    states: () => ({ ...states }),
    /** Mark everything still unplayed once the take ends. */
    finish() {
      for (const e of expected) if (!e.matched) states[e.key] = 'missed';
      return summary();
    },
    window,
    goodTiming,
  };
}
