import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PracticeView from './components/PracticeView.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import ProgressView from './components/ProgressView.jsx';
import PathView from './components/PathView.jsx';
import CompareView from './components/CompareView.jsx';
import { generateExercise } from './core/generator.js';
import { applyResult, paramsForLevel } from './core/adaptive.js';
import { levelById } from './core/levels.js';
import { connectMidi } from './core/midi.js';
import { codeToSeed, randomSeed, seedToCode } from './core/rng.js';
import {
  loadPresets, loadProfile, loadSettings, resetProfile, savePresets, saveProfile, saveSettings,
} from './core/storage.js';

const TABS = [
  { id: 'practice', label: 'Practice' },
  { id: 'path', label: 'The path' },
  { id: 'custom', label: 'Custom' },
  { id: 'progress', label: 'Progress' },
  { id: 'compare', label: 'How it compares' },
];

/** Read an exercise code out of the URL so a shared link opens the same music. */
function seedFromUrl() {
  if (typeof window === 'undefined') return null;
  const code = new URLSearchParams(window.location.search).get('x');
  return code ? codeToSeed(code) : null;
}

export default function App() {
  const [profile, setProfile] = useState(loadProfile);
  const [settings, setSettings] = useState(loadSettings);
  const [presets, setPresets] = useState(loadPresets);
  const [tab, setTab] = useState('practice');
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [toast, setToast] = useState(null);

  const [params, setParams] = useState(() => {
    const urlSeed = seedFromUrl();
    const p = loadProfile();
    return paramsForLevel(p.level, p, { seed: urlSeed ?? randomSeed() });
  });

  const score = useMemo(() => generateExercise(params), [params]);
  const level = params.level ? levelById(params.level) : null;

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { savePresets(presets); }, [presets]);

  // Keep the address bar in step, so the current exercise is always shareable.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('x', seedToCode(score.seed));
    window.history.replaceState(null, '', url);
  }, [score.seed]);

  // --- MIDI ---------------------------------------------------------------
  const subsRef = useRef(new Set());
  const [midiState, setMidiState] = useState({ status: 'idle', inputs: [], error: null });

  const subscribe = useCallback((fn) => {
    subsRef.current.add(fn);
    return () => subsRef.current.delete(fn);
  }, []);

  const handleConnectMidi = useCallback(async () => {
    try {
      await connectMidi(
        (e) => { for (const fn of subsRef.current) fn(e); },
        (inputs) => setMidiState((s) => ({ ...s, status: 'connected', inputs })),
      );
      setMidiState((s) => ({ ...s, status: 'connected' }));
    } catch (err) {
      setMidiState({ status: 'error', inputs: [], error: err.message || 'Could not reach MIDI.' });
    }
  }, []);

  const midi = useMemo(() => ({ ...midiState, subscribe }), [midiState, subscribe]);

  // --- Exercise flow ------------------------------------------------------
  const nextFromLevel = useCallback((levelId = profile.level, opts = {}) => {
    setParams(paramsForLevel(levelId, profile, { seed: randomSeed(), ...opts }));
    setTab('practice');
  }, [profile]);

  const regenerate = useCallback(() => {
    if (params.level) nextFromLevel(params.level);
    else setParams({ ...params, seed: randomSeed() });
  }, [nextFromLevel, params]);

  const handleResult = useCallback(({ summary, elapsedSec, takeIndex, curtain }) => {
    setProfile((prev) => {
      const { profile: next, promoted, demoted } = applyResult(prev, {
        level: params.level || null,
        summary,
        seed: score.seed,
        elapsedSec,
        takeIndex,
        curtain,
        meta: { pitches: summary.pitches, recovery: summary.recovery },
      });
      if (promoted) setToast({ kind: 'up', text: `Level ${next.level} unlocked — ${levelById(next.level).name}` });
      else if (demoted) setToast({ kind: 'down', text: `Stepping back to level ${next.level} to rebuild.` });
      return next;
    });
  }, [params.level, score.seed]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  const drillSkill = useCallback((skillId) => {
    const forced = {
      ...profile,
      skills: { ...profile.skills, [skillId]: { rating: 0.05, attempts: 60 } },
    };
    setParams(paramsForLevel(profile.level, forced, { seed: randomSeed() }));
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

  const customParams = useMemo(() => ({ ...params }), [params]);

  return (
    <div className="sr-app">
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
            >{t.label}</button>
          ))}
        </nav>
        <div className="sr-headerstat">
          <span className="sr-level-badge">Level {profile.level}</span>
          {profile.streak.count > 0 && <span className="sr-streak">{profile.streak.count}-day streak</span>}
        </div>
      </header>

      <main className="sr-main">
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
          />
        )}

        {tab === 'path' && (
          <PathView profile={profile} onPick={(id) => nextFromLevel(id)} />
        )}

        {tab === 'custom' && (
          <SetupPanel
            params={customParams}
            onChange={(p) => setParams({ ...p, level: null })}
            onGenerate={(p) => { setParams({ ...p, level: null }); setTab('practice'); }}
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
          Everything runs in your browser. Nothing is uploaded, and there is nothing to subscribe to.
          Connect a MIDI keyboard for real feedback, or play along on the on-screen keys.
        </p>
      </footer>
    </div>
  );
}
