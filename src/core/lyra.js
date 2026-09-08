// Lyra's voice.
//
// She reads and cannot play. She has been working on these inscriptions for
// years, she knows what the marks mean, and she cannot make them speak — so
// she needs somebody who can sound one at sight. See docs/the-reply.md.
//
// Which means she is listening while you read, hearing it for the first time
// as well, and what she says afterwards is about what she just heard. One
// sentence. The companion in Moss never says a word, and is the most loved
// thing in that game; the failure mode for a guide character is not saying too
// little.
//
// Rule two of the story: the fiction never fakes the measurement. Every line
// below is selected by something the grader actually measured, and none of
// them congratulates a reading that did not happen. If she has nothing true to
// say she says nothing, which is why several of these return null.

import { STEADY_SPREAD, UNBROKEN_HESITATION } from './fluency.js';

// Her thresholds are deliberately looser than the ones a mission gates on.
// Falling short of steady is a fact worth recording; being *well* past it is
// the only thing worth interrupting somebody about. Expressed as multiples of
// the shared thresholds so the two cannot drift apart.
/** A gap this much longer than the reader's own pace is a stop you can hear. */
const AUDIBLE_STOP = UNBROKEN_HESITATION * 1.6;
/** Spread this wide is a pulse that moved, not one that sat off-centre. */
const WANDERING = STEADY_SPREAD * 1.75;
/** Below this, the notes were not the thing that went wrong. */
const NOTES_MOSTLY_THERE = 0.85;
/** One hand this far behind the other is worth naming. */
const HAND_GAP = 0.18;

const handAccuracy = (summary, hand) => summary?.hands?.[hand]?.pitchAccuracy ?? null;

/**
 * What Lyra says after a reading. One sentence, or nothing.
 *
 * Ordered by what most needs saying rather than by severity. A stop is worth
 * naming before a wrong note is, because stopping is the thing that does not
 * get better on its own — and a reader who kept going through a page of wrong
 * notes has done the harder half already and should be told so.
 */
export function lyraOnReading(summary, { firstHearing = false } = {}) {
  if (!summary || summary.valid === false || summary.assessmentEligible === false) return null;
  if (summary.unscored) {
    return 'I could not hear that one well enough to write anything down. Play it into the keyboard and I will listen properly.';
  }

  const { fluency = {}, pitchAccuracy = 0, wrong = 0, misreadInKey = 0, missed = 0 } = summary;
  const heard = firstHearing ? 'That is the first time anyone has heard it. ' : '';

  if (fluency.hesitation != null && fluency.hesitation > AUDIBLE_STOP) {
    return 'You stopped somewhere to work out a character — everything either side of it was steady, so it is one place, not the whole passage.';
  }
  if (fluency.spread != null && fluency.spread > WANDERING) {
    return 'The metre of the line got away from you. Take the pulse from the busiest bar before you start, not from the first one.';
  }
  // Playing something in place of the written note, and having it fit the key,
  // is a better error than a random one: it means the harmony was being used
  // to predict. Worth telling somebody, because it never looks like progress.
  if (wrong >= 3 && misreadInKey / wrong >= 0.6) {
    return 'Where you missed a note you put another one from the same key in its place — you were reading the harmony, not just the symbols.';
  }
  if (missed >= 3 && missed > wrong * 2) {
    return 'There were places where nothing came at all. A wrong note played in time is worth more to me than a gap; I can hear through a wrong note.';
  }
  // Before "some of it was wrong", because knowing *which staff* is where to
  // look next and "some of it" is not.
  const rh = handAccuracy(summary, 'rh');
  const lh = handAccuracy(summary, 'lh');
  if (rh != null && lh != null && Math.abs(rh - lh) >= HAND_GAP) {
    return lh < rh
      ? 'The lower staff is costing you more than the upper one. It is the same script down there, only the landmarks are different.'
      : 'The upper staff is costing you more than the lower one this time, which is the less usual way round.';
  }

  if (fluency.steady && fluency.unbroken && pitchAccuracy < NOTES_MOSTLY_THERE) {
    return 'You read it straight through and some of it was wrong. That is the right order to fix those in.';
  }

  if (fluency.steady && fluency.unbroken && pitchAccuracy >= NOTES_MOSTLY_THERE) {
    return `${heard}You held one pulse the whole way and the notes were there. That is what it sounds like when someone can read.`;
  }
  if (pitchAccuracy >= NOTES_MOSTLY_THERE) {
    return `${heard}The notes were nearly all there. What is left is the pulse underneath them.`;
  }
  return null;
}

/**
 * What Lyra says when a reading opens the route.
 *
 * Deliberately about the passage rather than about the reader: the thing that
 * happened is that a piece of music nobody had heard has now been heard.
 */
export function lyraOnOpening(discovery) {
  return discovery
    ? `So that is what they meant by it. ${discovery}`
    : 'So that is what they meant by it.';
}

/**
 * What she says when a reading was honest work but did not open the route.
 *
 * Never "try again" — the next passage is a different one, and reading this
 * one twice is rehearsal, which is a different and less useful thing here.
 */
export const lyraOnHolding = () => 'There are more of these than we will get through. Take a fresh one when you are ready.';

/** Everything she has to say about one reading, in the order she says it. */
export function lyraSpeaks(summary, { opened = false, discovery = null } = {}) {
  const observation = lyraOnReading(summary, { firstHearing: opened });
  const outcome = opened ? lyraOnOpening(discovery) : null;
  return [outcome, observation].filter(Boolean).join(' ') || lyraOnHolding();
}
