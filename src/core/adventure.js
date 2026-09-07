// Story progress is local exploration, separate from musical assessment.
// Preparation and rhythm are scaffolds. Only a fresh reading opens the musical route.
export const ADVENTURE_KEY = 'prima-vista.adventure.v1';
export const LOCATIONS = [
  { name: 'The listening room', place: 'Luna', subtitle: 'Selene Observatory', color: '#70dcca', sky: '#091c2b', type: 'observatory' },
  { name: 'A garden in the dust', place: 'Mars', subtitle: 'Ares Botanical Station', color: '#edb67b', sky: '#402015', type: 'garden' },
  { name: 'The silent archive', place: 'Ceres', subtitle: 'Deep Field Repository', color: '#9baff2', sky: '#14162c', type: 'archive' },
  { name: 'Inside the storm', place: 'Jupiter', subtitle: 'Cloudbreak Research Platform', color: '#e8c28d', sky: '#392a22', type: 'observatory' },
  { name: 'The ring keeper', place: 'Saturn', subtitle: 'Cassini Listening Post', color: '#edcf96', sky: '#242539', type: 'archive' },
  { name: 'The winter greenhouse', place: 'Uranus', subtitle: 'Miranda Habitat', color: '#91dfed', sky: '#143c42', type: 'garden' },
  { name: 'Below the blue', place: 'Neptune', subtitle: 'Triton Signal Lab', color: '#7fa7f1', sky: '#0d204d', type: 'observatory' },
  { name: 'The last lantern', place: 'Pluto', subtitle: 'New Horizons Shelter', color: '#c3a7e9', sky: '#20192c', type: 'garden' },
  { name: 'Messages in the ice', place: 'Kuiper Belt', subtitle: 'Drift Archive', color: '#b3c6e6', sky: '#101827', type: 'archive' },
  { name: 'Where the song goes', place: 'Heliopause', subtitle: 'Voyager Relay', color: '#a4f2da', sky: '#082b2b', type: 'observatory' },
];
export function emptyAdventure() { return { version: 2, current: 0, rooms: {} }; }
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
    if ([1, 2].includes(saved?.version) && Number.isInteger(saved.current) && saved.current >= 0 && saved.current < LOCATIONS.length && saved.rooms && typeof saved.rooms === 'object') {
      if (saved.version === 2) return saved;
      // Keep already visited space; old circuitry never becomes reading evidence.
      return { version: 2, current: saved.current, rooms: Object.fromEntries(Object.entries(saved.rooms).filter(([index]) => Number(index) < saved.current)) };
    }
  } catch { /* A blocked store starts a session without persistence. */ }
  return emptyAdventure();
}
export function saveAdventure(state) {
  try { localStorage.setItem(ADVENTURE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function pianoRelaySolved(summary) {
  return Boolean(summary && summary.valid !== false && !summary.unscored && summary.assessmentEligible !== false && summary.fresh === true && !summary.assisted && (summary.takeIndex ?? 1) === 1 && (!summary.curtain || summary.curtain === 'off') && Number.isFinite(summary.score) && summary.score >= 70);
}

export const READING_LESSONS = [
  { title: 'Find the pulse before the first note', skill: 'Pulse & preparation', advice: 'Before you play, find the time signature and count one quiet bar. Choose a tempo that lets you read the trickiest part comfortably. Your aim is a flowing phrase.', task: 'In the rhythm study, tap once at the start of each note. Keep counting through a half note instead of tapping it twice.', ready: 'I’ll establish the pulse before I start.' },
  { title: 'Find landmarks in both staves', skill: 'Grand-staff orientation', advice: 'Find the opening note in each hand before playing. Use a familiar landmark, then read the next note by its distance from that landmark rather than starting over each time.', task: 'Find the starting hand positions before your fresh reading. First, isolate the rhythm so your attention can stay on the pulse.', ready: 'I’ll find both starting notes first.' },
  { title: 'Silence still has a pulse', skill: 'Rests & continuity', advice: 'A rest is counted time. Keep your inner beat moving through the silence, and look at the note that follows so your return is prepared.', task: 'Read the rhythm on one key. Wait through each rest without adding a note.', ready: 'I’ll count through rests and prepare the return.' },
  { title: 'Read a shape, not isolated notes', skill: 'Intervals & patterns', advice: 'After finding your first pitch, notice whether the melody repeats, steps or skips. Group small patterns into a single musical gesture. Check the key signature first.', task: 'Scan the fresh piece for a repeated shape. In the rhythm study, notice which rhythmic groups come back.', ready: 'I’ll look for repeats, steps and skips.' },
  { title: 'Feel the beat inside the rhythm', skill: 'Subdivision', advice: 'When a rhythm looks busy, keep an even subdivision underneath it. A dotted note lasts longer; the following short note fits into that same steady pulse.', task: 'Read each note start against a steady beat. A tap does not measure how long you hold a piano key; keep counting the written duration.', ready: 'I’ll subdivide the longer and shorter notes.' },
  { title: 'Choose a tempo for the whole phrase', skill: 'Tempo & fluency', advice: 'Inspect the busiest bar before choosing your tempo. A tempo that is easy at the start but impossible later interrupts the reading. Begin with enough room to think ahead.', task: 'Keep a single tempo through the rhythm study. You can lower its tempo before starting.', ready: 'I’ll choose my tempo from the busiest bar.' },
  { title: 'Keep the beat through an offbeat', skill: 'Syncopation & ties', advice: 'Locate the beats first, then place the offbeat attacks between them. A tie continues the same sound: do not strike that pitch again at the barline.', task: 'Before the fresh piece, trace any ties and locate their next new attack. The rhythm study keeps your internal pulse active.', ready: 'I’ll trace ties before I play.' },
  { title: 'Look toward the next group', skill: 'Reading ahead', advice: 'Let your eyes move toward the next small group while your hands finish the current one. Start with a small look-ahead distance; more is not always better.', task: 'Read the next rhythmic group before your tapping reaches it. Keep the page visible while you practice this.', ready: 'I’ll prepare the next small group.' },
  { title: 'Listen for two independent lines', skill: 'Independent voices', advice: 'Scan the rhythm of each hand separately, then notice where their attacks coincide. Keep track of the phrase in each voice instead of treating every vertical slice as a chord.', task: 'In your fresh piece, identify one point where the hands move together and one where they differ.', ready: 'I’ll notice how the two lines fit together.' },
  { title: 'Recover without starting over', skill: 'Recovery & musical direction', advice: 'If a note goes wrong, continue toward the next beat or clear landmark. Finishing a phrase with its pulse intact is a useful reading skill. Review the difficulty after the take.', task: 'Keep going through the fresh reading. Afterwards, choose one pattern to practice before trying new music.', ready: 'I’ll recover at the next beat or landmark.' },
];
export const readingLesson = (level) => READING_LESSONS[Math.max(0, Math.min(9, (Number(level) || 1) - 1))];

// Two bars in 4/4; negative values represent rests. Isolate rhythm from pitch.
export function rhythmPattern(level, variation = 0) {
  const bank = level <= 2 ? [[1,1,2,1,1,2], [2,1,1,1,1,2], [1,2,1,2,1,1]]
    : level <= 4 ? [[1,-1,1,1,2,1,1], [1,.5,.5,2,1,-1,1,1], [2,1,-1,1,1,1,1]]
      : level <= 6 ? [[1.5,.5,1,1,1,.5,.5,2], [1,.5,.5,-1,1,1.5,.5,2], [2,.5,.5,1,1,-1,.5,.5,1]]
        : [[1,.5,.25,.25,1,1,1.5,.5,2], [.5,.5,1,-1,1,1,.5,.25,.25,2], [1.5,.5,1,1,.5,.5,1,-1,1]];
  let beat = 0;
  return bank[variation % bank.length].map((value) => { const event = { beat, duration: Math.abs(value), rest: value < 0 }; beat += Math.abs(value); return event; });
}
export function assessRhythm(events, taps, secondsPerBeat) {
  const expected = events.filter((event) => !event.rest).map((event) => event.beat * secondsPerBeat);
  const tolerance = Math.min(.20, secondsPerBeat * .22);
  const remaining = taps.map((time, index) => ({ time, index }));
  let correct = 0;
  for (const time of expected) {
    let best = -1, distance = Infinity;
    remaining.forEach((tap, i) => { const d = Math.abs(tap.time - time); if (d < distance) { best = i; distance = d; } });
    if (best >= 0 && distance <= tolerance) { correct++; remaining.splice(best,1); }
  }
  const score = Math.max(0, Math.round((correct - remaining.length * .5) / expected.length * 100));
  return { score, correct, total: expected.length, extras: remaining.length, passed: score >= 85 && remaining.length === 0 && correct >= Math.ceil(expected.length * .85) };
}
