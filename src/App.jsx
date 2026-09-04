import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PracticeView from './components/PracticeView.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import ProgressView from './components/ProgressView.jsx';
import PathView from './components/PathView.jsx';
import CompareView from './components/CompareView.jsx';
import OnboardingModal from './components/OnboardingModal.jsx';
import { generateExercise } from './core/generator.js';
import { applyResult, markExerciseSeen, paramsForLevel } from './core/adaptive.js';
import { levelById } from './core/levels.js';
import { connectMidi } from './core/midi.js';
import { codeToSeed, randomSeed } from './core/rng.js';
import { decodeExerciseParams, exactExerciseUrl, exerciseFingerprint } from './core/share.js';
import { pageWidthForViewport, primeScoreRender } from './core/verovio.js';
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
    constraints: _constraints,
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
  const [showOnboarding, setShowOnboarding] = useState(() => {
    const shared = exerciseFromUrl();
    const existingProfile = loadProfile();
    const isNewReader = existingProfile.totals.takes === 0 && existingProfile.history.length === 0;
    return isNewReader && !loadSettings().onboardingComplete && !(shared.seed != null && shared.params);
  });
  const nextPathLevelRef = useRef(null);
  const preparedExerciseRef = useRef(null);
  const [session, setSession] = useState(() => ({
    minutes: loadSettings().sessionMinutes || 0,
    startedAt: null,
    takes: 0,
  }));
  const [sessionNow, setSessionNow] = useState(0);

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
      .slice(-3)
      .reverse();
    let count = 0;
    for (const take of eligible) {
      if (take.score < 88) break;
      count += 1;
    }
    return Math.min(3, count);
  }, [params.level, profile.history]);

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { savePresets(presets); }, [presets]);

  useEffect(() => {
    if (!session.startedAt || !session.minutes) return undefined;
    const timer = window.setInterval(() => setSessionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session.minutes, session.startedAt]);

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
    const prepared = preparedExerciseRef.current;
    const canUsePrepared = prepared && prepared.level === levelId && Object.keys(opts).length === 0;
    preparedExerciseRef.current = null;
    setParams(canUsePrepared
      ? prepared.params
      : paramsForLevel(levelId, profile, { seed: randomSeed(), ...opts }));
    setTab('practice');
  }, [profile]);

  const regenerate = useCallback(() => {
    if (params.level) nextFromLevel(nextPathLevelRef.current ?? params.level);
    else setParams({ ...params, seed: randomSeed() });
  }, [nextFromLevel, params]);

  const handleResult = useCallback(({ summary, elapsedSec, takeIndex, curtain, assisted }) => {
    setSession((current) => current.startedAt ? { ...current, takes: current.takes + 1 } : current);
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
        meta: {
          pitches: summary.pitches,
          recovery: summary.recovery,
          recipe: {
            seed: score.seed,
            params: score.params,
            generatorVersion: score.generatorVersion,
            stylePackVersion: score.stylePackVersion,
            title: score.title,
            style: score.style.label,
          },
        },
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
  }, [params.level, score, scoreId]);

  const startSession = useCallback(() => {
    if (!settings.sessionMinutes) return;
    const startedAt = Date.now();
    setSession((current) => {
      const stillRunning = current.startedAt
        && current.minutes === settings.sessionMinutes
        && startedAt - current.startedAt < settings.sessionMinutes * 60 * 1000;
      return stillRunning
        ? current
        : { minutes: settings.sessionMinutes, startedAt, takes: 0 };
    });
    setSessionNow(startedAt);
  }, [settings.sessionMinutes]);

  const sessionInfo = useMemo(() => {
    const total = session.minutes * 60;
    const elapsed = session.startedAt ? Math.floor((sessionNow - session.startedAt) / 1000) : 0;
    return {
      ...session,
      remaining: session.minutes ? Math.max(0, total - elapsed) : null,
      complete: Boolean(session.minutes && session.startedAt && elapsed >= total),
    };
  }, [session, sessionNow]);

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
    if (patch.sessionMinutes != null) {
      setSession({ minutes: patch.sessionMinutes, startedAt: null, takes: 0 });
      setSessionNow(Date.now());
    }
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const chooseStartingLevel = useCallback((levelId) => {
    const nextProfile = { ...profile, level: levelId };
    setProfile(nextProfile);
    setParams(paramsForLevel(levelId, nextProfile, { seed: randomSeed(), targeting: false }));
    setSettings((current) => ({ ...current, onboardingComplete: true }));
    setShowOnboarding(false);
    setTab('practice');
  }, [profile]);

  const changeDifficulty = useCallback((levelId) => {
    const chosen = levelById(levelId);
    const nextProfile = { ...profile, level: chosen.id };
    nextPathLevelRef.current = null;
    preparedExerciseRef.current = null;
    setProfile(nextProfile);
    setParams(paramsForLevel(chosen.id, nextProfile, { seed: randomSeed(), targeting: false }));
    setToast({ kind: 'info', text: `Level ${chosen.id} · ${chosen.name}` });
    setTab('practice');
  }, [profile]);

  // Compose and engrave the likely next adaptive study while the learner is
  // reading this one. The same score is then ready when “New study” is tapped.
  useEffect(() => {
    if (!params.level) return undefined;
    let cancelled = false;
    const prepare = () => {
      if (cancelled) return;
      const nextParams = paramsForLevel(params.level, profile, { seed: randomSeed() });
      const nextScore = generateExercise(nextParams);
      preparedExerciseRef.current = { level: params.level, params: nextParams };
      void primeScoreRender(nextScore, {
        pageWidth: pageWidthForViewport(),
        showFingerings: settings.showFingerings,
      });
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(prepare, { timeout: 1400 })
      : window.setTimeout(prepare, 240);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [params.level, profile, scoreId, settings.showFingerings]);

  const customParams = useMemo(() => customisableParams(params), [params]);

  return (
    <div className="sr-app">
      <a className="sr-skip" href="#practice-main">Skip to practice</a>
      <header className="sr-header">
        <div className="sr-brand">
          <span className="sr-logo" aria-hidden="true">𝄞</span>
          <div>
            <h1>Prima Vista</h1>
            <p>Build confidence, one fresh score at a time</p>
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
            onDifficultyChange={changeDifficulty}
            level={level}
            midi={midi}
            onConnectMidi={handleConnectMidi}
            showKeyboard={showKeyboard}
            onToggleKeyboard={() => setShowKeyboard((v) => !v)}
            freshRead={!seenBefore}
            strongReads={strongReads}
            onPreview={handlePreview}
            onNotify={notify}
            session={sessionInfo}
            onSessionStart={startSession}
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
            onResume={(recipe) => {
              setParams({ ...recipe.params, seed: recipe.seed });
              setTab('practice');
            }}
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

      {showOnboarding && <OnboardingModal onChoose={chooseStartingLevel} />}
    </div>
  );
}
