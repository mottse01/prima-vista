// Eclipse — the vanishing-note reading drill.
//
// In the story this app is heading toward (docs/the-reply.md) the writing does
// not survive being read: one pass, and the marks are gone behind you. That is
// the fiction and this is the mechanism, and they ask for exactly the same
// behaviour — which is the only reason the fiction is worth having.
//
// Notes are eclipsed a fixed distance ahead of the playhead, so the only way
// to keep playing is to have already read ahead. This measures eye-hand span,
// which is the actual mechanism of sight-reading.
//
// The historical `curtain` setting name stays
// in storage and results so existing profiles and shared exercises keep working.
// `beats` is how far past the playhead notes vanish; `played` begins fading at
// the note's onset.

export const CURTAIN_MODES = [
  { id: 'off', label: 'Off', short: 'Off', beats: null, blurb: 'The whole exercise stays visible.' },
  { id: 'played', label: 'Eclipse · as played', short: 'Played', beats: 'played', blurb: 'Each note starts fading as soon as it plays.' },
  { id: 'beat', label: 'Eclipse · 1 beat ahead', short: '1 beat', beats: 1, blurb: 'Notes fade one beat before your hands reach them.' },
  {
    id: 'adaptive', label: 'Eclipse · flexible', short: 'Flexible', beats: 'adaptive',
    blurb: 'The look-ahead distance shortens for dense notes and expands for simpler ones.',
  },
  // Retained for old saved settings and shared links. The fixed long-span
  // challenges are intentionally no longer presented as the normal ladder.
  { id: 'twobeats', label: 'Eclipse · 2 beats ahead', short: '2 beats', beats: 2, legacy: true, blurb: 'Notes fade two beats before your hands reach them.' },
  { id: 'bar', label: 'Eclipse · a full bar ahead', short: '1 bar', beats: 'bar', legacy: true, blurb: 'A fixed full-bar challenge for very simple textures.' },
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
