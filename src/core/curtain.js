// The look-ahead curtain.
//
// An opaque card that follows the playhead and hides the music as you reach it
// — the digital version of a teacher covering the bar you are playing. If you
// have not already read it, you cannot play it.
//
// `beats` is how far PAST the playhead the curtain's edge sits, so larger
// values force you to read further ahead of your hands.

export const CURTAIN_MODES = [
  { id: 'off', label: 'Off', beats: null, blurb: 'The whole exercise stays visible.' },
  { id: 'back', label: 'No looking back', beats: -1, blurb: 'Covers the beat you have just played.' },
  { id: 'now', label: 'At the note', beats: 0, blurb: 'Covers everything up to the note you are on.' },
  { id: 'beat', label: '1 beat ahead', beats: 1, blurb: 'You must read a beat ahead of your hands.' },
  { id: 'twobeats', label: '2 beats ahead', beats: 2, blurb: 'You must read two beats ahead.' },
  { id: 'bar', label: 'A full bar ahead', beats: 'bar', blurb: 'You must have read the next bar already.' },
];

export const curtainMode = (id) => CURTAIN_MODES.find((m) => m.id === id) || CURTAIN_MODES[0];

export const curtainActive = (id) => curtainMode(id).beats !== null;

/** How far past the playhead the curtain's edge sits, in ticks, for this metre. */
export function curtainOffsetTicks(id, ts) {
  const mode = curtainMode(id);
  if (mode.beats === null) return null;
  return mode.beats === 'bar' ? ts.ticks : mode.beats * ts.beat;
}
