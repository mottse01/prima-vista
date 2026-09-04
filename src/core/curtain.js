// Vanishing-note reading drills. The historical `curtain` setting name stays
// in storage and results so existing profiles and shared exercises keep working.
// `beats` is how far past the playhead notes vanish; `played` waits until each
// note's written value has finished.

export const CURTAIN_MODES = [
  { id: 'off', label: 'Off', beats: null, blurb: 'The whole exercise stays visible.' },
  { id: 'played', label: 'After playing', beats: 'played', blurb: 'Each note fades once its written value ends.' },
  { id: 'beat', label: '1 beat ahead', beats: 1, blurb: 'Notes fade one beat before your hands reach them.' },
  { id: 'twobeats', label: '2 beats ahead', beats: 2, blurb: 'Notes fade two beats before your hands reach them.' },
  { id: 'bar', label: 'A full bar ahead', beats: 'bar', blurb: 'The next bar fades, so you must have read it already.' },
];

export const curtainMode = (id) => CURTAIN_MODES.find((m) => m.id === id) || CURTAIN_MODES[0];

export const curtainActive = (id) => curtainMode(id).beats !== null;

/** Whether a notation event should already have vanished at this playhead. */
export function eventShouldVanish(event, playheadTick, id, ts) {
  const mode = curtainMode(id);
  if (mode.beats === null || playheadTick == null || playheadTick < 0) return false;
  if (mode.beats === 'played') return event.onset + event.duration <= playheadTick;
  const offset = mode.beats === 'bar' ? ts.ticks : mode.beats * ts.beat;
  return event.onset <= playheadTick + offset;
}
