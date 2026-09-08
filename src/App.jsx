import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdventureView from './components/AdventureView.jsx';
import ExpeditionDebrief from './components/ExpeditionDebrief.jsx';
import ExpeditionView from './components/ExpeditionView.jsx';
import PracticeView from './components/PracticeView.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import ProgressView from './components/ProgressView.jsx';
import PathView from './components/PathView.jsx';
import CompareView from './components/CompareView.jsx';
import TransitCard from './components/TransitCard.jsx';
import MissionPanel from './components/MissionPanel.jsx';
import ModeChoice from './components/ModeChoice.jsx';
import { homeTabFor, modeOf, otherMode, tabsFor } from './core/modes.js';
import OnboardingModal from './components/OnboardingModal.jsx';
import { DEFAULT_PARAMS, generateExercise } from './core/generator.js';
import { applyPracticeEvidence, applyResult, comparableReads, eligibleFirstRead, markExerciseSeen, paramsForLevel, placementRecommendation } from './core/adaptive.js';
import { levelById } from './core/levels.js';
import { waypointFor } from './core/constellation.js';
import { recordTransit, transitParams, transitStreak } from './core/transit.js';
import { isOpen, lockReason, missionState, openTo, openThrough } from './core/missions.js';
import { connectMidi } from './core/midi.js';
import { connectMicrophone } from './core/microphone.js';
import { codeToSeed, randomSeed } from './core/rng.js';
import { decodeExerciseParams, exactExerciseUrl, exerciseFingerprint } from './core/share.js';
import { pageWidthForViewport, primeScoreRender } from './core/verovio.js';
import {
  loadPresets, loadProfile, loadSettings, resetProfile, savePresets, saveProfile, saveSettings,
} from './core/storage.js';


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
  // A shared link is a piece of music somebody sent you, so it opens at the
  // piano whichever room you normally use.
  const [tab, setTab] = useState(() => (
    exerciseFromUrl().seed != null ? 'practice' : homeTabFor(loadSettings().mode || 'expedition')
  ));
  const [showKeyboard, setShowKeyboard] = useState(() => (loadSettings().inputMode || 'screen') === 'screen');
  const [repairHand, setRepairHand] = useState(null);
  const [transitActive, setTransitActive] = useState(false);
  const [placement, setPlacement] = useState(null);
  const [toast, setToast] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const adventureResultRef = useRef(null);
  const registerAdventureResult = useCallback((handler) => { adventureResultRef.current = handler; }, []);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const nextPathLevelRef = useRef(null);
  const preparedExerciseRef = useRef(null);
  const learnerTargetRef = useRef(null);
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

  /**
   * Compose the study, and always come back with music.
   *
   * The generator writes twenty candidates and gives up if none of them
   * survives its own critic. That is the right answer for a library, but the
   * app renders during a dropdown change, so a throw here used to blank the
   * whole page — a reader picking a key would simply lose the app.
   *
   * A refusal is almost always the seed rather than the request: every
   * combination that fails at one seed succeeds at another. So try a few more,
   * and only if the request itself is impossible fall back to something known
   * to work and say so.
   */
  const { score, generationNotice } = useMemo(() => {
    const seeds = [params.seed, ...Array.from({ length: 6 }, (_, i) => (params.seed + (i + 1) * 7919) >>> 0)];
    for (const seed of seeds) {
      try { return { score: generateExercise({ ...params, seed }), generationNotice: null }; } catch { /* try another */ }
    }
    for (const fallback of [paramsForLevel(profile.level, profile, { seed: params.seed, targeting: false }), DEFAULT_PARAMS]) {
      try {
        return {
          score: generateExercise(fallback),
          generationNotice: 'That combination could not be written as readable music. This study uses your level’s settings instead.',
        };
      } catch { /* keep trying */ }
    }
    throw new Error('The composer could not write any music for these settings.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const practiceScore = useMemo(() => {
    if (!repairHand) return score;
    return {
      ...score,
      staves: {
        rh: repairHand === 'rh' ? score.staves.rh : [],
        lh: repairHand === 'lh' ? score.staves.lh : [],
      },
      slurs: (score.slurs || []).filter((slur) => slur.hand === repairHand),
    };
  }, [repairHand, score]);
  const scoreId = useMemo(() => exerciseFingerprint(score.params, score.seed), [score]);
  const level = params.level ? levelById(params.level) : null;
  const seenBefore = (profile.seenExercises || []).includes(scoreId)
    || (profile.seenSeeds || []).includes(score.seed);
  const strongReads = useMemo(() => {
    if (!params.level) return 0;
    const eligible = comparableReads(profile, params.level)
      .slice(-3)
      .reverse();
    let count = 0;
    for (const take of eligible) {
      if (take.score < 88) break;
      count += 1;
    }
    return Math.min(3, count);
  }, [params.level, profile]);

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { savePresets(presets); }, [presets]);
  useEffect(() => {
    document.documentElement.classList.toggle('sr-comfort', Boolean(settings.comfortView));
    return () => document.documentElement.classList.remove('sr-comfort');
  }, [settings.comfortView]);

  useEffect(() => {
    if (!session.startedAt || !session.minutes) return undefined;
    const timer = window.setInterval(() => setSessionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session.minutes, session.startedAt]);

  // Keep the address bar in step. Unlike a seed alone, this link includes the
  // exact generator recipe and therefore opens identical music for everyone.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === 'practice') window.history.replaceState(null, '', exactExerciseUrl(score, url.href));
    else { url.searchParams.delete('x'); url.searchParams.delete('p'); window.history.replaceState(null, '', url.href); }
  }, [score, tab]);

  // --- MIDI ---------------------------------------------------------------
  const subsRef = useRef(new Set());
  const midiConnectionRef = useRef(null);
  const microphoneConnectionRef = useRef(null);
  const [midiState, setMidiState] = useState({ status: 'idle', inputs: [], error: null });
  const [microphoneState, setMicrophoneState] = useState({ status: 'idle', confidence: 0, midi: null, error: null });

  const subscribe = useCallback((fn) => {
    subsRef.current.add(fn);
    return () => subsRef.current.delete(fn);
  }, []);

  const handleConnectMidi = useCallback(async () => {
    microphoneConnectionRef.current?.close();
    microphoneConnectionRef.current = null;
    setMicrophoneState({ status: 'idle', confidence: 0, midi: null, error: null });
    setSettings((current) => ({ ...current, inputMode: 'midi' }));
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

  const handleConnectMicrophone = useCallback(async () => {
    if (microphoneConnectionRef.current) {
      microphoneConnectionRef.current.close();
      microphoneConnectionRef.current = null;
      setMicrophoneState({ status: 'idle', confidence: 0, midi: null, error: null });
      setSettings((current) => ({ ...current, inputMode: 'screen' }));
      return;
    }
    setMicrophoneState({ status: 'connecting', confidence: 0, midi: null, error: null });
    setSettings((current) => ({ ...current, inputMode: 'microphone' }));
    try {
      const connection = await connectMicrophone(
        (event) => { for (const fn of subsRef.current) fn(event); },
        (state) => setMicrophoneState((current) => ({ ...current, ...state, error: null })),
      );
      microphoneConnectionRef.current = connection;
    } catch (err) {
      setMicrophoneState({ status: 'error', confidence: 0, midi: null, error: err.message || 'Could not reach the microphone.' });
    }
  }, []);

  useEffect(() => () => {
    midiConnectionRef.current?.close();
    microphoneConnectionRef.current?.close();
  }, []);

  const midi = useMemo(() => ({ ...midiState, subscribe }), [midiState, subscribe]);

  // --- Exercise flow ------------------------------------------------------
  const nextFromLevel = useCallback((levelId = profile.level, opts = {}) => {
    setRepairHand(null);
    nextPathLevelRef.current = null;
    const prepared = preparedExerciseRef.current;
    const canUsePrepared = prepared && prepared.level === levelId && Object.keys(opts).length === 0;
    preparedExerciseRef.current = null;
    setParams(canUsePrepared
      ? prepared.params
      : paramsForLevel(levelId, profile, { seed: randomSeed(), ...opts }));
    setTab((current) => current === 'adventure' ? 'adventure' : 'practice');
  }, [profile]);

  const regenerate = useCallback(() => {
    setRepairHand(null);
    if (params.level) {
      const targetSkill = learnerTargetRef.current;
      learnerTargetRef.current = null;
      nextFromLevel(nextPathLevelRef.current ?? params.level, targetSkill ? { targetSkill } : {});
    }
    else setParams({ ...params, seed: randomSeed() });
  }, [nextFromLevel, params]);

  const handleResult = useCallback(({ summary, elapsedSec, takeIndex, curtain, assisted, fresh }) => {
    adventureResultRef.current?.({ ...summary, fresh, assisted, takeIndex, curtain });
    const eligible = eligibleFirstRead({ summary, takeIndex, curtain, assisted, fresh });
    setReceipt({ scoreId, level: params.level, eligible: eligible && !placement?.active,
      before: params.level ? missionState(profile, params.level) : null,
      frontier: openThrough(profile), score: summary.score });
    const placementScores = placement?.active && eligible ? [...placement.scores, summary.score] : null;
    const placementComplete = Boolean(placementScores && placementScores.length >= placement.total);
    const placementLevel = placementComplete
      ? placementRecommendation(placement.startLevel, placementScores)
      : null;
    setSession((current) => current.startedAt ? { ...current, takes: current.takes + 1 } : current);
    const readingTransit = transitActive && eligible;
    setProfile((prev) => {
      const { profile: next, promoted, demoted } = applyResult(prev, {
        level: params.level || null,
        summary,
        seed: score.seed,
        exerciseId: scoreId,
        elapsedSec,
        takeIndex,
        curtain,
        assisted: assisted || Boolean(placement?.active),
        meta: {
          placement: Boolean(placement?.active),
          pitches: summary.pitches,
          pitchLocations: summary.pitchLocations,
          recovery: summary.recovery,
          // What was actually on the page, for the objectives that ask about
          // the music rather than about the playing.
          tiedOverBarline: [...score.staves.rh, ...score.staves.lh].some((note) => (
            !note.rest
            && Math.floor(note.onset / score.ts.ticks)
              !== Math.floor((note.onset + note.duration - 1) / score.ts.ticks)
          )),
          textures: [...new Set(score.staves.lh.map((note) => note.texture).filter(Boolean))],
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
      if (placementComplete) {
        next.level = placementLevel;
        // Placement is the way in. Three unseen pieces put a returning
        // pianist where they belong, and the course opens to there.
        Object.assign(next, openTo(next, placementLevel));
        nextPathLevelRef.current = placementLevel;
      } else if (promoted) {
        nextPathLevelRef.current = next.level;
        setToast({
          kind: 'up',
          text: `Landed on ${waypointFor(next.level).name} — level ${next.level}, ${levelById(next.level).name}`,
        });
      } else if (demoted) {
        nextPathLevelRef.current = next.level;
        setToast({
          kind: 'down',
          text: `A gentler next flight at ${waypointFor(next.level).name}. All your open destinations stay open.`,
        });
      }
      // A transit is recorded only for a genuine first read, which is the
      // whole point of it: the streak counts cold reads, not repeats.
      return readingTransit
        ? recordTransit(next, { score: summary.score, level: params.level || next.level })
        : next;
    });
    if (placement?.active && placementScores) {
      if (placementComplete) {
        const recommended = levelById(placementLevel);
        setPlacement({ ...placement, active: false, complete: true, scores: placementScores, recommended: placementLevel });
        setToast({ kind: 'up', text: `Level check complete — start at Level ${placementLevel}, ${recommended.name}` });
      } else {
        setPlacement({ ...placement, scores: placementScores, remaining: placement.total - placementScores.length });
      }
    } else if (placement?.active) {
      setToast({ kind: 'info', text: 'Practice saved. Choose New music for the next independent level-check read.' });
    }
  }, [params.level, placement, profile, score, scoreId, transitActive]);

  const handleReflection = useCallback(({ label, skillId }) => {
    learnerTargetRef.current = skillId || null;
    setProfile((current) => {
      const history = [...current.history];
      for (let index = history.length - 1; index >= 0; index--) {
        if (history[index].seed !== score.seed) continue;
        history[index] = {
          ...history[index],
          meta: { ...(history[index].meta || {}), reflection: label },
        };
        break;
      }
      return { ...current, history };
    });
  }, [score.seed]);

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
    setRepairHand(null);
    setParams(paramsForLevel(profile.level, profile, { seed: randomSeed(), targetSkill: skillId }));
    setTab((current) => current === 'adventure' ? 'adventure' : 'practice');
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

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    setSettings((current) => ({ ...current, onboardingComplete: true }));
  }, []);

  const chooseStartingLevel = useCallback((levelId, preferences = {}) => {
    // Choosing where to begin is a placement, not progress: it opens the
    // course to that point so a returning pianist starts where they belong.
    const nextProfile = openTo({ ...profile, level: levelId }, levelId);
    setProfile(nextProfile);
    setParams(paramsForLevel(levelId, nextProfile, { seed: randomSeed(), targeting: false }));
    setSettings((current) => ({
      ...current,
      onboardingComplete: true,
      sessionMinutes: 5,
      inputMode: preferences.inputMode || 'screen',
      comfortView: Boolean(preferences.comfortView),
      preparationTips: preferences.preparationTips !== false,
      curtain: 'off',
      guideKeys: false,
    }));
    setSession({ minutes: 5, startedAt: null, takes: 0 });
    setSessionNow(Date.now());
    setPlacement(preferences.inputMode === 'microphone' ? null : { active: true, complete: false, startLevel: levelId, total: 3, remaining: 3, scores: [] });
    if (preferences.inputMode === 'screen') setShowKeyboard(true);
    if (preferences.inputMode === 'midi') void handleConnectMidi();
    if (preferences.inputMode === 'microphone') void handleConnectMicrophone();
    setShowOnboarding(false);
    setTab('practice');
  }, [handleConnectMicrophone, handleConnectMidi, profile]);

  // Tonight's transit is an ordinary exercise built from today's date, so it
  // travels through the same generator, grader and profile as anything else.
  const readTransit = useCallback(() => {
    const { params: transit } = transitParams(profile);
    preparedExerciseRef.current = null;
    setRepairHand(null);
    setTransitActive(true);
    setParams(transit);
    setTab('practice');
  }, [profile]);

  const leaveTransit = useCallback(() => {
    setTransitActive(false);
    setParams(paramsForLevel(profile.level, profile, { seed: randomSeed() }));
  }, [profile]);

  /**
   * The one place a level is chosen.
   *
   * The expedition has a route you earn, and the map enforces it. Practice
   * does not: the piano room is always open at any level, which is how a
   * reader warms up somewhere easy, stretches somewhere hard, or works on the
   * piece their teacher set this week. Only a move made *along the route* is
   * checked against it.
   */
  const changeDifficulty = useCallback((levelId, { alongRoute = true } = {}) => {
    if (alongRoute && !isOpen(profile, levelId)) {
      setToast({ kind: 'info', text: `${waypointFor(levelId).name} is not charted yet. ${lockReason(profile, levelId)}` });
      return;
    }
    setPlacement(null);
    setTransitActive(false);
    const chosen = levelById(levelId);
    const nextProfile = { ...profile, level: chosen.id };
    nextPathLevelRef.current = null;
    preparedExerciseRef.current = null;
    setRepairHand(null);
    setProfile(nextProfile);
    setParams(paramsForLevel(chosen.id, nextProfile, { seed: randomSeed(), targeting: false }));
    setToast({
      kind: 'info',
      // Setting a course and opening the piano are different acts, and the
      // expedition should not claim credit for the second one.
      text: alongRoute
        ? `Course set for ${waypointFor(chosen.id).name} · level ${chosen.id}, ${chosen.name}`
        : `Practising at level ${chosen.id} · ${chosen.name}`,
    });
    setSettings((current) => ({ ...current, curtain: 'off', guideKeys: false }));
    setTab((current) => current === 'adventure' ? 'adventure' : 'practice');
  }, [profile]);

  // Compose and engrave the likely next adaptive study while the learner is
  // reading this one. The same score is then ready when “New study” is tapped.
  useEffect(() => {
    if (!params.level || tab !== 'practice') return undefined;
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
  }, [params.level, profile, scoreId, settings.showFingerings, tab]);

  const customParams = useMemo(() => customisableParams(params), [params]);
  // Somebody who followed a link came for that piece of music, not to be asked
  // a question about how they like to practise. The link opens at the piano
  // and the choice waits until they go looking for it.
  const sharedArrival = useMemo(() => exerciseFromUrl().seed != null, []);
  const mode = modeOf(settings) || (sharedArrival ? modeOf({ mode: 'practice' }) : null);

  /**
   * Choose a room, or move to the other one.
   *
   * Switching is arriving somewhere else, not a preference change with the old
   * page still underneath, so it lands on that mode's own home. Nothing about
   * the reader is touched: levels, history and the skill map are one profile
   * shared by both.
   */
  const chooseMode = useCallback((id) => {
    setSettings((current) => ({ ...current, mode: id }));
    setRepairHand(null);
    setTransitActive(false);
    setTab(homeTabFor(id));
  }, []);
  const nightsObserved = useMemo(() => transitStreak(profile), [profile]);

  const practiceElement = (
          <PracticeView
            key={`${score.seed}:${score.tempo}:${repairHand || 'both'}`}
            score={practiceScore}
            debrief={receipt?.scoreId === scoreId && receipt.level && <ExpeditionDebrief receipt={receipt} profile={profile} onExplore={() => setTab('adventure')} onLaunch={changeDifficulty} />}
            settings={settings}
            onSettings={practiceSettings}
            onResult={handleResult}
            onUnscoredComplete={(take) => adventureResultRef.current?.({ ...take, unscored: true })}
            onRegenerate={regenerate}
            onDifficultyChange={(levelId) => changeDifficulty(levelId, { alongRoute: false })}
            expedition={mode?.id !== 'practice'}
            level={level}
            midi={midi}
            onConnectMidi={handleConnectMidi}
            microphone={microphoneState}
            onConnectMicrophone={handleConnectMicrophone}
            showKeyboard={showKeyboard}
            onToggleKeyboard={() => setShowKeyboard((v) => !v)}
            freshRead={!seenBefore}
            strongReads={strongReads}
            onPreview={handlePreview}
            onReflect={handleReflection}
            onNotify={notify}
            session={sessionInfo}
            onSessionStart={startSession}
            placement={placement}
            onFocus={drillSkill}
            onRecheckLevel={() => setShowOnboarding(true)}
            repairHand={repairHand}
            onRepairHand={(hand, tempo) => {
              setRepairHand(hand);
              setParams((current) => ({ ...current, tempo }));
              setTab((current) => current === 'adventure' ? 'adventure' : 'practice');
            }}
          />
  );

  // Nobody has said which room they want yet, so the landing screen asks.
  if (!mode) {
    return (
      <div className="sr-app is-choosing">
        <div className="sr-starfield" aria-hidden="true" />
        <ModeChoice onChoose={chooseMode} />
        {toast && <div className={`sr-toast sr-toast--${toast.kind}`} role="status">{toast.text}</div>}
      </div>
    );
  }

  return (
    <div className={`sr-app${tab === 'adventure' ? ' is-adventure' : ''} is-${mode.id}`}>
      <div className="sr-starfield" aria-hidden="true" />
      <a className="sr-skip" href="#practice-main">Skip to practice</a>
      <header className="sr-header">
        <div className="sr-brand">
          <svg className="sr-logo" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M9 37V11h9c8 0 12 3.6 12 9s-4.7 9-12 9H9" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m22 27 8 10 12-26" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1>Prima <span>Vista</span></h1>
            <p>{mode.id === 'expedition' ? 'THE SIGHT-READING EXPEDITION' : 'SIGHT-READING PRACTICE'}</p>
          </div>
        </div>
        <nav className="sr-tabs" aria-label="Sections">
          {tabsFor(mode.id).map((t) => (
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
        <button
          type="button" className="sr-modeswitch"
          onClick={() => chooseMode(otherMode(mode.id).id)}
          title="Everything carries over. You can come back at any time."
        >{otherMode(mode.id).name} mode <span aria-hidden="true">→</span></button>
        <div className="sr-headerstat">
          <button
            type="button" className="sr-comfort-toggle"
            aria-pressed={Boolean(settings.comfortView)}
            onClick={() => setSettings((current) => ({ ...current, comfortView: !current.comfortView }))}
          >Aa <span>Comfort</span></button>
          <span className="sr-level-badge">
            Level {profile.level}
            <em>{waypointFor(profile.level).name}</em>
          </span>
          {nightsObserved > 0 && (
            <span className="sr-streak" title="Consecutive days with a first read of Tonight’s Transit">
              {nightsObserved} {nightsObserved === 1 ? 'night' : 'nights'}
            </span>
          )}
        </div>
      </header>

      <main className="sr-main" id="practice-main">
        {/* The request could not be written as readable music, so say what
            happened rather than leaving the reader wondering why the settings
            they chose are not the ones on the page. */}
        {generationNotice && (
          <p className="sr-generation-notice" role="status">{generationNotice}</p>
        )}
        {tab === 'adventure' && <AdventureView practice={practiceElement} level={profile.level} midi={midi}
          registerResult={registerAdventureResult} onTools={setTab}
          routeOpen={isOpen(profile, profile.level + 1)}
          routeReason={lockReason(profile, profile.level + 1)}
          mission={missionState(profile, profile.level)}
          onTravel={(next) => changeDifficulty(next, { alongRoute: true })}
          onRhythmEvidence={(tallies) => setProfile((current) => applyPracticeEvidence(current, tallies))}
          onPrepareMusic={() => { nextFromLevel(profile.level); setTab('adventure'); setReceipt(null); setPlacement(null); setTransitActive(false); setSettings((s) => ({ ...s, curtain: 'off', guideKeys: false })); }} />}

        {/* In the expedition the piano is a place you walked to, so the strip
            says where from and what the destination wants. In the practice
            room it is just the piano, and the daily piece is the only thing
            worth offering beside it. */}
        {tab === 'practice' && mode.id === 'expedition' && <div className="pv-practice-heading">
          <button type="button" onClick={() => setTab('adventure')}>← Station</button>
          <span>{transitActive ? 'DAILY DISCOVERY' : params.level ? `SECTOR ${String(params.level).padStart(2, '0')} · ${waypointFor(params.level).name.toUpperCase()}` : 'MUSIC LAB'} · PIANO FLIGHT</span>
          <details className="pv-flight-brief"><summary>Mission brief</summary><div>
            {params.level && <MissionPanel profile={profile} level={params.level} onOpenPath={() => setTab('path')} />}
            <TransitCard profile={profile} active={transitActive} onRead={readTransit} onLeave={leaveTransit} />
          </div></details>
        </div>}
        {tab === 'practice' && mode.id === 'practice' && (
          <TransitCard profile={profile} active={transitActive} onRead={readTransit} onLeave={leaveTransit} />
        )}
        {tab === 'practice' && practiceElement}

        {tab === 'path' && mode.id === 'practice' && (
          <PathView profile={profile} gated={false} onPick={(id) => changeDifficulty(id, { alongRoute: false })} />
        )}
        {tab === 'path' && mode.id === 'expedition' && (
          <>
            <ExpeditionView profile={profile}
              onLaunch={(id) => { if (!settings.onboardingComplete && !profile.totals.takes) setShowOnboarding(true); else changeDifficulty(id); }}
              onTransit={readTransit}
              onPractice={(level) => {
                if (level) changeDifficulty(level, { alongRoute: false });
                setTab('practice');
              }}
              onProgress={() => setTab('progress')} onPlacement={() => setShowOnboarding(true)} />
            <PathView profile={profile} onPick={changeDifficulty} />
          </>
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
            onStart={() => setTab('practice')}
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

      {showOnboarding && <OnboardingModal onChoose={chooseStartingLevel} onDismiss={dismissOnboarding} />}
    </div>
  );
}
