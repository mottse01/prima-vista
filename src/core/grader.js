// Real-time grader.
//
// Match performed attacks to written music. Live colors are provisional;
// later chord tones may revise a tentative substitution.

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
  { id: 'rhythm.rest', label: 'Re-entry after rests' },
  { id: 'rhythm.silence', label: 'No new notes in full rests' },
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

export const SCORING_VERSION = 2;

// Ordered, maximum-cardinality pitch matching with minimum total timing error.
// Equal timestamps are canonicalized so MIDI delivery order has no effect.
function matchSamePitch(expected, performed, window, match) {
  const columns = performed.length + 1;
  const values = new Float64Array((expected.length + 1) * columns);
  const paths = new Uint8Array(values.length);
  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= performed.length; j++) {
      const at = i * columns + j;
      const above = values[at - columns];
      const left = values[at - 1];
      values[at] = Math.max(above, left);
      paths[at] = above >= left ? 1 : 2;
      const distance = Math.abs(expected[i - 1].at - performed[j - 1].time);
      const paired = values[at - columns - 1] + 1000000 - distance;
      if (distance <= window && paired >= values[at]) {
        values[at] = paired;
        paths[at] = 3;
      }
    }
  }
  let i = expected.length;
  let j = performed.length;
  while (i && j) {
    const path = paths[i * columns + j];
    if (path === 3) { match(expected[--i], performed[--j], false); }
    else if (path === 1) i -= 1;
    else j -= 1;
  }
}

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

  const inputs = [];
  let played = [];
  const states = {}; // note id -> 'correct' | 'late' | 'wrong' | 'missed'
  let extras = 0;
  let finished = false;

  function rematch() {
    for (const e of expected) e.matched = null;
    for (const key of Object.keys(states)) delete states[key];
    played = inputs.map((input) => ({ ...input, verdict: 'extra' }))
      .sort((a, b) => a.time - b.time || a.midi - b.midi || a.id - b.id);
    const match = (event, input, wrong) => {
      const delta = input.time - event.at;
      const ok = Math.abs(delta) <= goodTiming;
      event.matched = { time: input.time, delta, ok, ...(wrong ? { wrongPitch: input.midi } : {}) };
      input.target = event.key;
      input.delta = delta;
      input.verdict = wrong ? 'wrong' : ok ? 'correct' : 'timing';
      states[event.key] = wrong ? 'wrong' : ok ? 'correct' : 'late';
    };
    for (const midi of new Set(expected.map((e) => e.midi))) {
      matchSamePitch(expected.filter((e) => e.midi === midi), played.filter((p) => p.midi === midi), window, match);
    }
    // Only unmatched pitches can now be substitutions. Never consume a correct
    // chord tone simply because an extra note arrived a few messages earlier.
    for (const input of played.filter((p) => !p.target)) {
      const near = expected.filter((e) => !e.matched && Math.abs(e.at - input.time) <= window)
        .sort((a, b) => Math.abs(a.at - input.time) - Math.abs(b.at - input.time)
          || Math.abs(a.midi - input.midi) - Math.abs(b.midi - input.midi) || a.index - b.index)[0];
      if (near) match(near, input, true);
    }
    extras = played.filter((p) => !p.target).length;
    if (finished) for (const e of expected) if (!e.matched) states[e.key] = 'missed';
  }

  function noteOn(midi, time) {
    if (finished || !Number.isFinite(time) || !Number.isFinite(midi)) return { verdict: 'ignored' };
    const id = inputs.length;
    inputs.push({ id, midi, time });
    rematch();
    const input = played.find((p) => p.id === id);
    return { verdict: input.verdict, delta: input.delta, key: input.target };
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

    // Rhythm strands are shared between the hands, so a strand score can never
    // say which hand was late. These per-hand tallies can, which is what makes
    // "your left hand is rushing" a thing the app can actually tell you.
    const hands = {
      rh: { total: 0, pitchCorrect: 0, onTime: 0, timed: 0, absDelta: 0, signedDelta: 0, skills: {} },
      lh: { total: 0, pitchCorrect: 0, onTime: 0, timed: 0, absDelta: 0, signedDelta: 0, skills: {} },
    };

    for (const e of expected) {
      const m = e.matched;
      const pitchOk = Boolean(m && !m.wrongPitch);
      if (!m) missed += 1;
      else if (m.wrongPitch) wrong += 1;
      else if (!m.ok) { timingOff += 1; correct += 1; }
      else correct += 1;

      if (m && !m.wrongPitch) {
        absDelta += Math.abs(m.delta);
        signedDelta += m.delta;
        deltaCount += 1;
      }

      const hand = hands[e.hand];
      if (hand) {
        hand.total += 1;
        if (pitchOk) hand.pitchCorrect += 1;
        if (m?.ok) hand.onTime += 1;
        if (m && !m.wrongPitch) {
          hand.timed += 1;
          hand.absDelta += Math.abs(m.delta);
          hand.signedDelta += m.delta;
        }
        for (const s of e.skills) {
          if (!hand.skills[s]) hand.skills[s] = { correct: 0, total: 0 };
          hand.skills[s].total += 1;
          const ok = s.startsWith('notes.') || s.startsWith('intervals.') ? pitchOk : Boolean(m?.ok);
          if (ok) hand.skills[s].correct += 1;
        }
      }

      for (const s of e.skills) {
        const timingOk = Boolean(m?.ok);
        bump(s, s.startsWith('notes.') || s.startsWith('intervals.') ? pitchOk : timingOk);
      }
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

    // Silence can be attributed without guessing a hand only where the whole
    // score rests. This explicitly measures new attacks, not sustain/pedaling.
    const staffEvents = ['rh', 'lh'].flatMap((hand) => playbackEvents(score, hand));
    const boundaries = [...new Set(staffEvents.flatMap((e) => [e.onset, e.onset + e.duration]))].sort((a, b) => a - b);
    let silentStart = null;
    for (let i = 0; i < boundaries.length; i++) {
      const from = boundaries[i];
      const to = boundaries[i + 1];
      const silent = to != null && !staffEvents.some((e) => !e.rest && e.onset < to && e.onset + e.duration > from);
      if (silent && silentStart == null) silentStart = from;
      if (!silent && silentStart != null) {
        const startsAt = startTime + silentStart * secPerTick;
        const endsAt = startTime + from * secPerTick;
        const intrusions = inputs.some((p) => p.time >= startsAt && p.time < endsAt
          && !expected.some((e) => e.matched?.time === p.time && e.midi === p.midi && e.matched.ok));
        bump('rhythm.silence', !intrusions);
        silentStart = null;
      }
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
      scoringVersion: SCORING_VERSION,
      total, correct, wrong, missed, extras, timingOff, timedNotes: deltaCount,
      pitchAccuracy, rhythmAccuracy, continuity, overall, attackCount, attacksKept,
      meanAbsTiming: deltaCount ? absDelta / deltaCount : null,
      meanSignedTiming: deltaCount ? signedDelta / deltaCount : null,
      skills: skillTally,
      hands: Object.fromEntries(Object.entries(hands).map(([hand, data]) => [hand, {
        notes: data.total,
        pitchAccuracy: data.total ? data.pitchCorrect / data.total : null,
        rhythmAccuracy: data.total ? data.onTime / data.total : null,
        meanAbsTiming: data.timed ? data.absDelta / data.timed : null,
        meanSignedTiming: data.timed ? data.signedDelta / data.timed : null,
        skills: data.skills,
      }])),
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
      finished = true;
      rematch();
      return summary();
    },
    window,
    goodTiming,
  };
}
