// Story progress is local exploration, separate from musical assessment.
// Rehearsal can solve a story console without becoming first-read evidence.
export const ADVENTURE_KEY = 'prima-vista.adventure.v1';
export const LOCATIONS = [
  { name: 'The listening room', place: 'Luna', subtitle: 'Selene Observatory', color: '#70dcca', sky: '#091c2b', type: 'observatory', story: 'The observatory has gone quiet. A repeating signal is still reaching the dish. Restore the instruments and find where it came from.', clue: [60, 64, 62], power: [true, false, true] },
  { name: 'A garden in the dust', place: 'Mars', subtitle: 'Ares Botanical Station', color: '#edb67b', sky: '#402015', type: 'garden', story: 'Something is growing beneath the red dust. The station’s last gardener left a melody in the irrigation controls. Bring the habitat back to life.', clue: [64, 62, 67], power: [false, true, false] },
  { name: 'The silent archive', place: 'Ceres', subtitle: 'Deep Field Repository', color: '#9baff2', sky: '#14162c', type: 'archive', story: 'A thousand recordings wait in the dark. One carries the coordinates of the next station. Wake the archive and follow its musical signature.', clue: [67, 60, 64], power: [true, true, false] },
  { name: 'Inside the storm', place: 'Jupiter', subtitle: 'Cloudbreak Research Platform', color: '#e8c28d', sky: '#392a22', type: 'observatory', story: 'The storm has knocked the relay out of alignment. Restore its three systems to hear the transmission above the wind.', clue: [62, 67, 64], power: [false, true, true] },
  { name: 'The ring keeper', place: 'Saturn', subtitle: 'Cassini Listening Post', color: '#edcf96', sky: '#242539', type: 'archive', story: 'An old listening post watches the rings. Its keeper divided a message between the power board, receiver, and piano console.', clue: [65, 64, 60], power: [true, false, false] },
  { name: 'The winter greenhouse', place: 'Uranus', subtitle: 'Miranda Habitat', color: '#91dfed', sky: '#143c42', type: 'garden', story: 'Under the blue ice, the greenhouse is sleeping. A sequence of tones will bring warmth back to its instruments.', clue: [64, 65, 62], power: [false, false, true] },
  { name: 'Below the blue', place: 'Neptune', subtitle: 'Triton Signal Lab', color: '#7fa7f1', sky: '#0d204d', type: 'observatory', story: 'The receiver follows a pulse beneath the interference. Trace it from the power board to the piano console.', clue: [67, 65, 62], power: [true, true, true] },
  { name: 'The last lantern', place: 'Pluto', subtitle: 'New Horizons Shelter', color: '#c3a7e9', sky: '#20192c', type: 'garden', story: 'Someone left this shelter ready for a visitor. Its lanterns will show the way once the room remembers its song.', clue: [62, 60, 65], power: [false, true, false] },
  { name: 'Messages in the ice', place: 'Kuiper Belt', subtitle: 'Drift Archive', color: '#b3c6e6', sky: '#101827', type: 'archive', story: 'Between the small worlds, a drifting archive has kept the expedition’s oldest music. Restore its voice.', clue: [65, 67, 60], power: [true, false, true] },
  { name: 'Where the song goes', place: 'Heliopause', subtitle: 'Voyager Relay', color: '#a4f2da', sky: '#082b2b', type: 'observatory', story: 'At the edge of the journey, the signal is clear. Bring the final relay online and send a little music back home.', clue: [60, 67, 65], power: [true, true, false] },
];
export const NOTE_NAMES = { 60: 'C', 62: 'D', 64: 'E', 65: 'F', 67: 'G' };
export function emptyAdventure() { return { version: 1, current: 0, rooms: {} }; }
export function roomState(state, index = state.current) {
  return { power: false, signal: false, music: false, ...(state.rooms[index] || {}) };
}
export function roomComplete(state, index = state.current) {
  const room = roomState(state, index);
  return room.power && room.signal && room.music;
}
export function completePuzzle(state, puzzle) {
  if (!['power', 'signal', 'music'].includes(puzzle)) return state;
  const room = roomState(state);
  if (puzzle === 'signal' && !room.power || puzzle === 'music' && !room.signal) return state;
  return { ...state, rooms: { ...state.rooms, [state.current]: { ...room, [puzzle]: true } } };
}
export function travel(state) {
  if (!roomComplete(state) || state.current >= LOCATIONS.length - 1) return state;
  return { ...state, current: state.current + 1 };
}
export function loadAdventure() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADVENTURE_KEY));
    if (saved?.version === 1 && Number.isInteger(saved.current) && saved.current >= 0 && saved.current < LOCATIONS.length && saved.rooms && typeof saved.rooms === 'object') return saved;
  } catch { /* A blocked store starts a session without persistence. */ }
  return emptyAdventure();
}
export function saveAdventure(state) {
  try { localStorage.setItem(ADVENTURE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

/** Triangular circuit: all eight lamp patterns are reachable. */
export function toggleCircuit(switches, index) {
  if (!Number.isInteger(index) || index < 0 || index > 2) return switches;
  return switches.map((value, i) => i === index || (index < 2 && i === index + 1) ? !value : value);
}
export function receiveTone(signature, received, note) {
  const next = [...received, note];
  if (next.length > signature.length || next.some((value, i) => value !== signature[i])) return { notes: [], matched: false };
  return { notes: next, matched: next.length === signature.length };
}
export function pianoRelaySolved(summary) {
  return Boolean(summary && summary.valid !== false && !summary.unscored && summary.assessmentEligible !== false && Number.isFinite(summary.score) && summary.score >= 70);
}
