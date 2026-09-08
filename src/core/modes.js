// Two ways to use the same instrument.
//
// Expedition is the fiction (docs/the-reply.md); practice is the instrument.
// The split exists so the story can never stand between a reader and a piano.
//
// The expedition and the practice room read the same generated music with the
// same grader against the same profile. What differs is what the app is *for*
// while you are in it: a journey with somewhere to get to, or a room with a
// piano in it and nothing asking anything of you.
//
// Mode is chosen once and switchable at any time, and it decides the shape of
// the app rather than merely which tab is selected — which surfaces exist,
// which one you land on, and how much chrome sits around the music.

export const MODES = [
  {
    id: 'expedition',
    name: 'Expedition',
    tagline: 'A journey outward',
    blurb: 'Ten destinations, a guide who prepares you before each one, and a '
      + 'reason to come back tomorrow. Your reading opens the route.',
    forWhom: 'Best if you want structure, or if practising alone has never quite stuck.',
    // The station is the whole screen. Its own menu is the navigation, so the
    // tab bar would only be a second one competing with it.
    home: 'adventure',
    chrome: false,
    tabs: [],
  },
  {
    id: 'practice',
    name: 'Practice',
    tagline: 'Just the music',
    blurb: 'Fresh sight-reading at any level, whenever you want it. No route, '
      + 'no story, nothing to unlock — generate a study and read it.',
    forWhom: 'Best if you know what you want to work on, or you have a lesson on Thursday.',
    home: 'practice',
    chrome: true,
    tabs: [
      { id: 'practice', label: 'Practice', short: 'Practice' },
      { id: 'custom', label: 'Build a study', short: 'Build' },
      { id: 'progress', label: 'Your reading', short: 'Reading' },
      { id: 'path', label: 'Level map', short: 'Levels' },
    ],
  },
];

const BY_ID = new Map(MODES.map((mode) => [mode.id, mode]));

export const isMode = (id) => BY_ID.has(id);

/** The chosen mode, or null when nobody has chosen yet and we must ask. */
export const modeOf = (settings) => (isMode(settings?.mode) ? BY_ID.get(settings.mode) : null);

export const otherMode = (id) => MODES.find((mode) => mode.id !== id) || MODES[0];

/**
 * Where a mode switch should land you.
 *
 * Switching modes is not a settings change with a page still underneath it —
 * it is arriving somewhere else, so it goes to that mode's home.
 */
export const homeTabFor = (id) => (BY_ID.get(id) || MODES[0]).home;

/**
 * Whether a surface belongs to a mode's own navigation.
 *
 * Everything stays reachable from both — the expedition's menu opens the
 * practice room, and the practice room links back to the station. This only
 * answers what gets a tab of its own.
 */
export function tabsFor(id) {
  return (BY_ID.get(id) || MODES[0]).tabs;
}

export const showsChrome = (id, tab) => Boolean((BY_ID.get(id) || MODES[0]).chrome) && tab !== 'adventure';
