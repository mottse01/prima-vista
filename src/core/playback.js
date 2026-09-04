// Performance-order helpers.
//
// Written notation has one timeline, but a repeat barline gives the performer
// a different route through it. Keeping that route in one small module lets
// audio, grading, the playhead, and vanishing notes agree about where the
// learner is without duplicating any notes in the engraved score.

/** Measures in the order the performer should play them. */
export function playbackMeasureOrder(score) {
  const written = Array.from({ length: score.measures || 0 }, (_, measure) => measure);
  const repeat = score.notationRepeat;
  if (!repeat) return written;

  const start = Math.max(0, Math.min(score.measures - 1, repeat.startMeasure));
  const end = Math.max(start, Math.min(score.measures - 1, repeat.endMeasure));
  const extraPasses = Math.max(0, (repeat.times || 2) - 1);
  const repeated = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  return [
    ...written.slice(0, end + 1),
    ...Array.from({ length: extraPasses }, () => repeated).flat(),
    ...written.slice(end + 1),
  ];
}

/** Length of a performance, including any notated repeat. */
export function performanceTicks(score) {
  if (!score.notationRepeat) return score.totalTicks;
  return playbackMeasureOrder(score).length * score.ts.ticks;
}

/** Map the running performance clock back onto the written page. */
export function notationTickAtPlaybackTick(score, tick) {
  if (tick == null || tick < 0 || !score.notationRepeat) return tick;
  const order = playbackMeasureOrder(score);
  const total = order.length * score.ts.ticks;
  if (tick >= total) return score.totalTicks;
  const performanceMeasure = Math.floor(tick / score.ts.ticks);
  const within = tick - performanceMeasure * score.ts.ticks;
  return order[performanceMeasure] * score.ts.ticks + within;
}

/** Events copied into performance order while retaining their written onset. */
export function playbackEvents(score, hand) {
  const staff = score.staves?.[hand] || [];
  if (!score.notationRepeat) {
    return staff.map((event) => ({ ...event, notationOnset: event.onset }));
  }
  const byMeasure = new Map();
  for (const event of staff) {
    const measure = Math.floor(event.onset / score.ts.ticks);
    if (!byMeasure.has(measure)) byMeasure.set(measure, []);
    byMeasure.get(measure).push(event);
  }

  return playbackMeasureOrder(score).flatMap((measure, performanceMeasure) => (
    (byMeasure.get(measure) || []).map((event) => ({
      ...event,
      notationOnset: event.onset,
      onset: performanceMeasure * score.ts.ticks + (event.onset - measure * score.ts.ticks),
    }))
  ));
}
