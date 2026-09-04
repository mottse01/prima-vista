// Vanishing-note reading drills. The historical `curtain` setting name stays
// in storage and results so existing profiles and shared exercises keep working.
// `beats` is how far past the playhead notes vanish; `played` begins fading at
// the note's onset.

export const CURTAIN_MODES = [
  { id: 'off', label: 'Off', beats: null, blurb: 'The whole exercise stays visible.' },
  { id: 'played', label: 'As played', beats: 'played', blurb: 'Each note starts fading as soon as it plays.' },
  { id: 'beat', label: '1 beat ahead', beats: 1, blurb: 'Notes fade one beat before your hands reach them.' },
  {
    id: 'adaptive', label: 'Flexible', beats: 'adaptive',
    blurb: 'The look-ahead distance shortens for dense notes and expands for simpler ones.',
  },
  // Retained for old saved settings and shared links. The fixed long-span
  // challenges are intentionally no longer presented as the normal ladder.
  { id: 'twobeats', label: '2 beats ahead', beats: 2, legacy: true, blurb: 'Notes fade two beats before your hands reach them.' },
  { id: 'bar', label: 'A full bar ahead', beats: 'bar', legacy: true, blurb: 'A fixed full-bar challenge for very simple textures.' },
];

export const curtainMode = (id) => CURTAIN_MODES.find((m) => m.id === id) || CURTAIN_MODES[0];

export const curtainActive = (id) => curtainMode(id).beats !== null;

/** Whether a notation event should already have vanished at this playhead. */
export function eventShouldVanish(event, playheadTick, id, ts) {
  const mode = curtainMode(id);
  if (mode.beats === null || playheadTick == null || playheadTick < 0) return false;
  if (mode.beats === 'played') return event.onset <= playheadTick;
  if (mode.beats === 'adaptive') {
    const dense = event.duration <= ts.beat / 2;
    const offset = dense ? ts.beat * 0.5 : ts.beat;
    return event.onset <= playheadTick + offset;
  }
  const offset = mode.beats === 'bar' ? ts.ticks : mode.beats * ts.beat;
  return event.onset <= playheadTick + offset;
}
