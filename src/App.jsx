import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PracticeView from './components/PracticeView.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import ProgressView from './components/ProgressView.jsx';
import PathView from './components/PathView.jsx';
import CompareView from './components/CompareView.jsx';
import { generateExercise } from './core/generator.js';
import { applyResult, markExerciseSeen, paramsForLevel } from './core/adaptive.js';
import { levelById } from './core/levels.js';
import { connectMidi } from './core/midi.js';
import { codeToSeed, randomSeed } from './core/rng.js';
import { decodeExerciseParams, exactExerciseUrl, exerciseFingerprint } from './core/share.js';
import {
  loadPresets, loadProfile, loadSettings, resetProfile, savePresets, saveProfile, saveSettings,
} from './core/storage.js';

const TABS = [
  { id: 'practice', label: 'Practice', short: 'Practice' },
  { id: 'path', label: 'The path', short: 'Path' },
  { id: 'custom', label: 'Build an exercise', short: 'Build' },
  { id: 'progress', label: 'Progress', short: 'Progress' },
];

/** Read both the seed and its parameter recipe from an exact shared link. */
function exerciseFromUrl() {
  if (typeof window === 'undefined') return { seed: null, params: null };
  const search = new URLSearchParams(window.location.search);
  const code = search.get('x');
  return {
    seed: code ? codeToSeed(code) : null,
    params: decodeExerciseParams(search.get('p')),
  };
}

/** Adaptive-only fields should not leak into the custom exercise builder. */
function customisableParams(source) {
  const {
    targeted: _targeted,
    focusRhythmTags: _focusRhythmTags,
    focusIntervals: _focusIntervals,
    meters: _meters,
    fifths: _fifths,
    modes: _modes,
    level: _level,
    ...params
  } = source;
  return params;
}

export default function App() {
  const [profile, setProfile] = useState(loadProfile);
  const [settings, setSettings] = useState(loadSettings);
  const [presets, setPresets] = useState(loadPresets);
  const [tab, setTab] = useState('practice');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [toast, setToast] = useState(null);
  const nextPathLevelRef = useRef(null);

  const [params, setParams] = useState(() => {
    const shared = exerciseFromUrl();
    const p = loadProfile();
    if (shared.seed != null && shared.params) return { ...shared.params, seed: shared.seed };
    return paramsForLevel(p.level, p, { seed: shared.seed ?? randomSeed() });
  });

  const score = useMemo(() => generateExercise(params), [params]);
  const scoreId = useMemo(() => exerciseFingerprint(score.params, score.seed), [score]);
  const level = params.level ? levelById(params.level) : null;
  const seenBefore = (profile.seenExercises || []).includes(scoreId)
    || (profile.seenSeeds || []).includes(score.seed);
  const strongReads = useMemo(() => {
    if (!params.level) return 0;
    const eligible = profile.history
      .filter((take) => take.level === params.level && !take.repeat && !take.assisted && !take.curtain)
      .slice(-2)
      .reverse();
    let count = 0;
    for (const take of eligible) {
      if (take.score < 88) break;
      count += 1;
    }
    return Math.min(2, count);
  }, [params.level, profile.history]);

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { savePresets(presets); }, [presets]);

  // Keep the address bar in step. Unlike a seed alone, this link includes the
  // exact generator recipe and therefore opens identical music for everyone.
  useEffect(() => {
    window.history.replaceState(null, '', exactExerciseUrl(score, window.location.href));
  }, [score]);

  // --- MIDI ---------------------------------------------------------------
  const subsRef = useRef(new Set());
  const midiConnectionRef = useRef(null);
  const [midiState, setMidiState] = useState({ status: 'idle', inputs: [], error: null });

  const subscribe = useCallback((fn) => {
    subsRef.current.add(fn);
    return () => subsRef.current.delete(fn);
  }, []);

  const handleConnectMidi = useCallback(async () => {
    setMidiState({ status: 'connecting', inputs: [], error: null });
    try {
      const connection = await connectMidi(
        (e) => { for (const fn of subsRef.current) fn(e); },
        (inputs) => setMidiState((s) => ({ ...s, status: inputs.length ? 'connected' : 'ready', inputs })),
      );
      midiConnectionRef.current?.close();
      midiConnectionRef.current = connection;
      setMidiState((s) => ({ ...s, status: s.inputs.length ? 'connected' : 'ready' }));
    } catch (err) {
      setMidiState({ status: 'error', inputs: [], error: err.message || 'Could not reach MIDI.' });
    }
  }, []);

  useEffect(() => () => midiConnectionRef.current?.close(), []);

  const midi = useMemo(() => ({ ...midiState, subscribe }), [midiState, subscribe]);

  // --- Exercise flow ------------------------------------------------------
  const nextFromLevel = useCallback((levelId = profile.level, opts = {}) => {
    nextPathLevelRef.current = null;
    setParams(paramsForLevel(levelId, profile, { seed: randomSeed(), ...opts }));
    setTab('practice');
  }, [profile]);

  const regenerate = useCallback(() => {
    if (params.level) nextFromLevel(nextPathLevelRef.current ?? params.level);
    else setParams({ ...params, seed: randomSeed() });
  }, [nextFromLevel, params]);

  const handleResult = useCallback(({ summary, elapsedSec, takeIndex, curtain, assisted }) => {
    setProfile((prev) => {
      const { profile: next, promoted, demoted } = applyResult(prev, {
        level: params.level || null,
        summary,
        seed: score.seed,
        exerciseId: scoreId,
        elapsedSec,
        takeIndex,
        curtain,
        assisted,
        meta: { pitches: summary.pitches, recovery: summary.recovery },
      });
      if (promoted) {
        nextPathLevelRef.current = next.level;
        setToast({ kind: 'up', text: `Level ${next.level} unlocked — ${levelById(next.level).name}` });
      } else if (demoted) {
        nextPathLevelRef.current = next.level;
        setToast({ kind: 'down', text: `Stepping back to level ${next.level} to rebuild.` });
      }
      return next;
    });
  }, [params.level, score.seed, scoreId]);

  const handlePreview = useCallback(() => {
    setProfile((prev) => markExerciseSeen(prev, scoreId));
  }, [scoreId]);

  const notify = useCallback((text, kind = 'info') => setToast({ kind, text }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  const drillSkill = useCallback((skillId) => {
    setParams(paramsForLevel(profile.level, profile, { seed: randomSeed(), targetSkill: skillId }));
    setTab('practice');
  }, [profile]);

  const practiceSettings = useCallback((patch) => {
    if (patch.tempoOverride != null) {
      // Same seed, same music, new tempo.
      setParams((p) => ({ ...p, tempo: patch.tempoOverride }));
      return;
    }
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const customParams = useMemo(() => customisableParams(params), [params]);

  return (
    <div className="sr-app">
      <a className="sr-skip" href="#practice-main">Skip to practice</a>
      <header className="sr-header">
        <div className="sr-brand">
          <span className="sr-logo" aria-hidden="true">𝄞</span>
          <div>
            <h1>Prima Vista</h1>
            <p>Sight-reading that reads you back</p>
          </div>
        </div>
        <nav className="sr-tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id} type="button"
              className={`sr-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span className="sr-tab-long">{t.label}</span>
              <span className="sr-tab-short">{t.short}</span>
            </button>
          ))}
        </nav>
        <div className="sr-headerstat">
          <span className="sr-level-badge">Level {profile.level}</span>
          {profile.streak.count > 0 && <span className="sr-streak">{profile.streak.count}-day streak</span>}
        </div>
      </header>

      <main className="sr-main" id="practice-main">
        {tab === 'practice' && (
          <PracticeView
            key={`${score.seed}:${score.tempo}`}
            score={score}
            settings={settings}
            onSettings={practiceSettings}
            onResult={handleResult}
            onRegenerate={regenerate}
            level={level}
            midi={midi}
            onConnectMidi={handleConnectMidi}
            showKeyboard={showKeyboard}
            onToggleKeyboard={() => setShowKeyboard((v) => !v)}
            freshRead={!seenBefore}
            strongReads={strongReads}
            showCoach={profile.totals.takes === 0 && !settings.coachDismissed}
            onDismissCoach={() => setSettings((s) => ({ ...s, coachDismissed: true }))}
            onPreview={handlePreview}
            onNotify={notify}
          />
        )}

        {tab === 'path' && (
          <PathView profile={profile} onPick={(id) => nextFromLevel(id)} />
        )}

        {tab === 'custom' && (
          <SetupPanel
            params={customParams}
            onChange={(p) => setParams({ ...customisableParams(p), level: null })}
            onGenerate={(p) => { setParams({ ...customisableParams(p), level: null }); setTab('practice'); }}
            presets={presets}
            onSavePreset={(name, p) => setPresets((list) => [...list, { id: String(Date.now()), name, params: p }])}
            onLoadPreset={(preset) => { setParams({ ...preset.params, seed: randomSeed(), level: null }); setTab('practice'); }}
            onDeletePreset={(id) => setPresets((list) => list.filter((p) => p.id !== id))}
          />
        )}

        {tab === 'progress' && (
          <ProgressView
            profile={profile}
            onDrill={drillSkill}
            onReset={() => { resetProfile(); setProfile(loadProfile()); }}
            onReload={() => { setProfile(loadProfile()); setPresets(loadPresets()); setSettings(loadSettings()); }}
          />
        )}

        {tab === 'compare' && <CompareView />}
      </main>

      {toast && (
        <div className={`sr-toast sr-toast--${toast.kind}`} role="status">{toast.text}</div>
      )}

      <footer className="sr-footer">
        <p>
          Practice data stays in this browser. Connect a MIDI keyboard for full feedback, or use
          the on-screen and computer keys. <button type="button" className="sr-footer-link" onClick={() => setTab('compare')}>Why Prima Vista?</button>
        </p>
      </footer>
    </div>
  );
}
