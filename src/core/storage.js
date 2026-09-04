// Local-first persistence. Everything lives in the browser: no account, no
// server, nothing to subscribe to. Export/import makes it portable.

import { emptyProfile } from './adaptive.js';

const KEY = 'sightread.profile.v1';
const PRESETS_KEY = 'sightread.presets.v1';
const SETTINGS_KEY = 'sightread.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadProfile() {
  const stored = read(KEY, null);
  if (!stored || ![1, 2, 3, 4].includes(stored.version)) return emptyProfile();
  const blank = emptyProfile();
  // Earlier builds recorded completely silent runs as hundreds of failed
  // notes. If every stored take is unmistakably silent, keep the learner's
  // chosen level but clear the corrupted evidence once during migration.
  const allTakesWereSilent = stored.version < 4
    && stored.history?.length > 0
    && stored.history.every((take) => take.pitchAccuracy === 0
      && take.rhythmAccuracy === 0
      && take.continuity === 0);
  if (allTakesWereSilent) return { ...blank, level: stored.level || 1 };
  return {
    ...blank,
    ...stored,
    version: 4,
    skills: { ...blank.skills, ...stored.skills },
    seenExercises: stored.seenExercises || [],
  };
}

export const saveProfile = (p) => write(KEY, p);
export const resetProfile = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export const loadPresets = () => read(PRESETS_KEY, []);
export const savePresets = (list) => write(PRESETS_KEY, list);

export const DEFAULT_SETTINGS = {
  metronome: true,
  countInBeats: 4,
  showFingerings: false,
  reference: false,
  colourNotes: true,
  toleranceScale: 1,
  scale: 9,
  // Page shows a conventional multi-system score; scroll keeps one continuous system.
  scoreLayout: 'page',
  // Vanishing-note drill (historical setting name retained for compatibility).
  curtain: 'off',
  guideKeys: false,
  keySound: true,
  masterVolume: 0.82,
  coachDismissed: false,
  sessionMinutes: 0,
  inputLatencyMs: 0,
  onboardingComplete: false,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export function exportAll() {
  return JSON.stringify({ profile: loadProfile(), presets: loadPresets(), settings: loadSettings() }, null, 2);
}

export function importAll(json) {
  const data = JSON.parse(json);
  if (data.profile) write(KEY, data.profile);
  if (data.presets) write(PRESETS_KEY, data.presets);
  if (data.settings) write(SETTINGS_KEY, data.settings);
}
