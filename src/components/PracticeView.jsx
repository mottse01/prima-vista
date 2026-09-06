import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Score from './Score.jsx';
import Keyboard from './Keyboard.jsx';
import TimingStrip from './TimingStrip.jsx';
import { createGrader, SKILLS } from '../core/grader.js';
import { TPQ, keyLabel } from '../core/theory.js';
import {
  audioState, now, playPianoNote, primeAudioGesture, scheduleCountIn, setMasterVolume,
  startPlayback, startPracticePlayback, startReferencePlayback, startSoundCheck,
  subscribeAudioState, unlockAudio,
} from '../core/audio.js';
import { warmUp } from '../core/verovio.js';
import { toMusicXml } from '../core/musicxml.js';
import { CURTAIN_MODES, curtainMode } from '../core/curtain.js';
import { LEVELS } from '../core/levels.js';

const LOOK_AHEAD_MODES = CURTAIN_MODES.filter((mode) => !mode.legacy);
const PREPARATION_SECONDS = 30;
const FOCUS_PACKS = [
  { id: 'rhythm.rest', label: 'Rests' },
  { id: 'rhythm.eighth', label: 'Rhythm' },
  { id: 'intervals.leap', label: 'Intervals' },
  { id: 'notes.ledger', label: 'Ledger notes' },
  { id: 'coordination.together', label: 'Hands together' },
];

/**
 * One take of one exercise. App remounts this whenever the exercise changes,
 * which is what resets the transport, the colouring and the last result.
 */
export default function PracticeView({
  score, settings, onSettings, onResult, onRegenerate, level,
  onDifficultyChange,
  midi, onConnectMidi, microphone, onConnectMicrophone, showKeyboard, onToggleKeyboard,
  freshRead, strongReads = 0, onPreview, onReflect, onNotify,
  session, onSessionStart, placement, onFocus, onRecheckLevel, repairHand, onRepairHand,
}) {
  const [phase, setPhase] = useState('idle'); // idle | countin | playing | done
  const [noteStates, setNoteStates] = useState({});
  const [tick, setTick] = useState(-1);
  const [result, setResult] = useState(null);
  const [held, setHeld] = useState(() => new Set());
  const [listening, setListening] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dueNow, setDueNow] = useState(() => new Set());
  const [soundState, setSoundState] = useState(audioState);
  const [audioBusy, setAudioBusy] = useState(false);
  const [calibration, setCalibration] = useState({ phase: 'idle', taps: 0, offset: settings.inputLatencyMs || 0 });
  const [standMode, setStandMode] = useState(false);
  const [difficultyDraft, setDifficultyDraft] = useState(level?.id || 1);
  const [preparation, setPreparation] = useState({ phase: 'idle', remaining: PREPARATION_SECONDS, checks: [] });
  const [pulseTap, setPulseTap] = useState({ times: [], message: 'Tap four beats at the written tempo.' });
  const [reflection, setReflection] = useState(null);

  const graderRef = useRef(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const frameRef = useRef(null);
  const phaseRef = useRef('idle');
  const modeRef = useRef('take');
  const guideRef = useRef(false);
  const playbackRef = useRef(null);
  const clockRef = useRef(now);
  const takeStartRef = useRef(0);
  const takeCountRef = useRef(0);
  const assistedRef = useRef(false);
  const unscoredRef = useRef(false);
  const freshAtStartRef = useRef(false);
  const calibrationRef = useRef(null);
  const practiceToolsRef = useRef(null);

  const secPerTick = 60 / score.tempo / TPQ;

  const setPhaseBoth = (p) => { phaseRef.current = p; setPhase(p); };

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (playbackRef.current) { playbackRef.current.stop(); playbackRef.current = null; }
    calibrationRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (phaseRef.current === 'done' || phaseRef.current === 'idle') return;
    stopEverything();
    const grader = graderRef.current;
    if (!grader) { setPhaseBoth('idle'); return; }
    if (unscoredRef.current) {
      setNoteStates({});
      setResult({ unscored: true, takeIndex: takeCountRef.current });
      setPhaseBoth('done');
      onPreview?.();
      return;
    }
    const summary = grader.finish();
    if (!summary.valid) {
      takeCountRef.current = Math.max(0, takeCountRef.current - 1);
      setNoteStates({});
      setResult({ ...summary, invalid: true, takeIndex: takeCountRef.current });
      setPhaseBoth('done');
      onNotify?.('We did not detect enough of the performance. This take was not saved.', 'down');
      return;
    }
    setNoteStates(grader.states());
    setResult({
      ...summary,
      takeIndex: takeCountRef.current,
      assisted: assistedRef.current,
      fresh: freshAtStartRef.current,
      wasFresh: freshAtStartRef.current,
    });
    setPhaseBoth('done');
    onResult({
      summary,
      elapsedSec: Math.max(0, clockRef.current() - takeStartRef.current),
      takeIndex: takeCountRef.current,
      curtain: settings.curtain,
      assisted: assistedRef.current,
      fresh: freshAtStartRef.current,
    });
  }, [onNotify, onPreview, onResult, settings.curtain, stopEverything]);

  /** Which notes are due at the playhead, for the optional keyboard guide. */
  const refreshGuide = useCallback((t) => {
    const grader = graderRef.current;
    if (!grader) return;
    const next = new Set();
    for (const e of grader.expected) {
      if (Math.abs(e.onset - t) < TPQ * 0.35 && !e.matched) next.add(e.midi);
    }
    setDueNow((prev) => {
      if (prev.size === next.size && [...next].every((m) => prev.has(m))) return prev;
      return next;
    });
  }, []);

  /** One animation frame. Returns false when the loop should stop. */
  const advance = useCallback(() => {
    const t = (clockRef.current() - startRef.current) / secPerTick;
    setTick(t);
    if (guideRef.current && modeRef.current === 'take') refreshGuide(t);
    // Give a beat of grace at the end so a late final note still counts.
    const over = t > (score.performanceTicks || score.totalTicks) + TPQ;
    if (modeRef.current === 'listen') return !over;
    if (phaseRef.current === 'countin' && t >= 0) setPhaseBoth('playing');
    if (over) { finish(); return false; }
    return true;
  }, [finish, refreshGuide, score.performanceTicks, score.totalTicks, secPerTick]);

  useEffect(() => { guideRef.current = Boolean(settings.guideKeys); }, [settings.guideKeys]);
  useEffect(() => subscribeAudioState(setSoundState), []);
  useEffect(() => { setMasterVolume(settings.masterVolume ?? 0.82); }, [settings.masterVolume]);
  useEffect(() => {
    if (!LOOK_AHEAD_MODES.some((mode) => mode.id === settings.curtain)) onSettings({ curtain: 'off' });
  }, [onSettings, settings.curtain]);

  useEffect(() => {
    if (preparation.phase !== 'active') return undefined;
    const timer = window.setInterval(() => {
      setPreparation((current) => {
        if (current.phase !== 'active') return current;
        const remaining = Math.max(0, current.remaining - 1);
        return { ...current, remaining, phase: remaining === 0 ? 'ready' : 'active' };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [preparation.phase]);

  useEffect(() => {
    frameRef.current = () => {
      if (advance()) rafRef.current = requestAnimationFrame(frameRef.current);
    };
  }, [advance]);

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => frameRef.current && frameRef.current());
  }, []);

  const prepareSound = useCallback(async () => {
    setAudioBusy(true);
    const ready = await unlockAudio();
    setAudioBusy(false);
    if (!ready) onNotify?.('Your browser blocked audio. Tap “Test sound” and check the tab is not muted.', 'down');
    return ready;
  }, [onNotify]);

  const start = useCallback(async () => {
    if (settings.inputMode === 'midi' && midi.status !== 'connected') {
      const panel = document.querySelector('.sr-device-panel');
      if (panel) { panel.open = true; panel.scrollIntoView({ block: 'nearest' }); }
      onNotify?.('Connect your MIDI piano, or choose screen keys or unscored acoustic practice.', 'down');
      return;
    }
    stopEverything();
    onSessionStart?.();
    setListening(false);
    setResult(null);
    setNoteStates({});
    setPreparation((current) => ({ ...current, phase: 'done' }));
    setPulseTap({ times: [], message: 'Tap four beats at the written tempo.' });
    setDueNow(new Set());
    takeCountRef.current += 1;
    assistedRef.current = Boolean(previewed || settings.guideKeys || repairHand || score.tempoPracticeOnly);
    unscoredRef.current = settings.inputMode === 'microphone' || microphone?.status === 'listening';
    freshAtStartRef.current = Boolean(freshRead);

    const armTake = (startTime) => {
      startRef.current = startTime;
      takeStartRef.current = startTime;
      graderRef.current = createGrader(score, { startTime, toleranceScale: settings.toleranceScale });
      modeRef.current = 'take';
      setPhaseBoth(settings.countInBeats > 0 ? 'countin' : 'playing');
      startLoop();
    };

    // The practice clock also uses media playback on iOS: count-in and
    // metronome are audible, but the notated answer remains withheld.
    const media = startPracticePlayback({
      score,
      metronome: settings.metronome,
      countInBeats: settings.countInBeats,
      onEnd: finish,
    });
    if (media) {
      playbackRef.current = media;
      clockRef.current = media.currentTime;
      armTake(media.exerciseStart);
      if (await media.started) return;
      stopEverything();
    }

    if (!(await prepareSound())) {
      takeCountRef.current = Math.max(0, takeCountRef.current - 1);
      graderRef.current = null;
      setPhaseBoth('idle');
      setTick(-1);
      return;
    }
    clockRef.current = now;
    const startTime = scheduleCountIn(score, settings.countInBeats);
    armTake(startTime);
    playbackRef.current = startPlayback({
      score, startTime, metronome: settings.metronome, playScore: false, onEnd: () => {},
    });
  }, [finish, freshRead, midi.status, microphone?.status, onNotify, onSessionStart, prepareSound, previewed, repairHand, score, settings.countInBeats, settings.guideKeys, settings.inputMode, settings.metronome, settings.toleranceScale, startLoop, stopEverything]);

  const beginPreparation = useCallback(() => {
    setPreparation({ phase: 'active', remaining: PREPARATION_SECONDS, checks: [] });
    setPulseTap({ times: [], message: 'Tap four beats at the written tempo.' });
  }, []);

  const togglePreparationCheck = useCallback((id) => {
    setPreparation((current) => ({
      ...current,
      checks: current.checks.includes(id)
        ? current.checks.filter((item) => item !== id)
        : [...current.checks, id],
    }));
  }, []);

  const tapPulse = useCallback(() => {
    const time = performance.now();
    setPulseTap((current) => {
      const times = [...current.times, time].slice(-4);
      if (times.length < 4) {
        return { times, message: `${4 - times.length} more ${4 - times.length === 1 ? 'tap' : 'taps'}` };
      }
      const intervals = times.slice(1).map((value, index) => value - times[index]);
      const writtenBeatMs = (60000 / score.tempo) * ((score.ts.beat || TPQ) / TPQ);
      const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      const spacingError = Math.abs(average - writtenBeatMs) / writtenBeatMs;
      const unevenness = Math.max(...intervals.map((value) => Math.abs(value - average))) / average;
      const steady = spacingError <= 0.22 && unevenness <= 0.2;
      if (steady) {
        setPreparation((prep) => ({
          ...prep,
          checks: prep.checks.includes('rhythm') ? prep.checks : [...prep.checks, 'rhythm'],
        }));
      }
      return {
        times: [],
        message: steady
          ? `Steady — you found the ${score.tempo} bpm pulse.`
          : average < writtenBeatMs
            ? 'A little quick. Leave more space and try four taps again.'
            : 'A little slow. Bring the taps closer and try again.',
      };
    });
  }, [score.tempo, score.ts.beat]);

  const stop = useCallback(() => {
    if (phaseRef.current === 'countin') {
      stopEverything();
      // A cancelled count-in is not a take and must not make the next first
      // read look like a replay.
      takeCountRef.current = Math.max(0, takeCountRef.current - 1);
      graderRef.current = null;
      setPhaseBoth('idle');
      setTick(-1);
      return;
    }
    finish();
  }, [finish, stopEverything]);

  const stopReference = useCallback(() => {
    stopEverything();
    setListening(false);
    setTick(-1);
  }, [stopEverything]);

  const listen = useCallback(async () => {
    stopEverything();
    setPreviewed(true);
    onPreview?.();
    setListening(true);
    setPhaseBoth('idle');
    modeRef.current = 'listen';

    const ended = () => {
      setListening(false);
      cancelAnimationFrame(rafRef.current);
      setTick(-1);
      playbackRef.current = null;
    };

    // Use a rendered media track first. It is markedly more reliable than a
    // graph of scheduled oscillators in iOS webviews and embedded browsers.
    const media = startReferencePlayback({
      score, metronome: settings.metronome, onEnd: ended,
    });
    if (media) {
      playbackRef.current = media;
      clockRef.current = media.currentTime;
      startRef.current = media.exerciseStart;
      startLoop();
      if (await media.started) return;
      stopEverything();
    }

    // WebAudio remains a fallback for browsers without Blob media playback.
    if (!(await prepareSound())) {
      setListening(false);
      setTick(-1);
      return;
    }
    clockRef.current = now;
    const startTime = now() + 0.2;
    startRef.current = startTime;
    playbackRef.current = startPlayback({
      score, startTime, metronome: settings.metronome, playScore: true, onEnd: ended,
    });
    startLoop();
  }, [onPreview, prepareSound, score, settings.metronome, startLoop, stopEverything]);

  useEffect(() => () => stopEverything(), [stopEverything]);

  useEffect(() => {
    const active = phase === 'playing' || phase === 'countin';
    document.documentElement.classList.toggle('sr-practice-running', active);
    return () => document.documentElement.classList.remove('sr-practice-running');
  }, [phase]);

  useEffect(() => () => {
    document.documentElement.classList.remove('sr-stand-mode');
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.classList.remove('sr-stand-mode');
        setStandMode(false);
      }
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  // Fetch the engraver ahead of time so the first exercise appears promptly.
  useEffect(() => { warmUp(); }, []);

  const handleNoteOn = useCallback((midiNote, source = 'screen') => {
    setHeld((prev) => new Set(prev).add(midiNote));
    if (source !== 'microphone' && settings.keySound !== false && settings.inputMode !== 'microphone') {
      if (audioState() === 'running') playPianoNote(now(), midiNote, 0.6, 0.48);
      else unlockAudio().then((ready) => { if (ready) playPianoNote(now(), midiNote, 0.6, 0.48); });
    }
    const activeCalibration = calibrationRef.current;
    if (activeCalibration) {
      const at = activeCalibration.media.currentTime();
      const available = activeCalibration.expected
        .map((expected, index) => ({ expected, index, distance: Math.abs(at - expected) }))
        .filter(({ index, distance }) => !activeCalibration.used.has(index) && distance <= 0.48)
        .sort((a, b) => a.distance - b.distance)[0];
      if (available) {
        activeCalibration.used.add(available.index);
        activeCalibration.samples.push((at - available.expected) * 1000);
        const taps = activeCalibration.samples.length;
        setCalibration((current) => ({ ...current, phase: 'active', taps }));
        if (taps === activeCalibration.expected.length) {
          const sorted = [...activeCalibration.samples].sort((a, b) => a - b);
          const offset = Math.round(Math.max(-250, Math.min(250, (sorted[1] + sorted[2]) / 2)));
          activeCalibration.media.stop();
          playbackRef.current = null;
          calibrationRef.current = null;
          onSettings({ inputLatencyMs: offset });
          setCalibration({ phase: 'done', taps, offset });
          onNotify?.(`Timing calibrated: ${offset > 0 ? '+' : ''}${offset} ms`);
        }
      }
      return;
    }
    const grader = graderRef.current;
    if (source === 'microphone' || unscoredRef.current) return;
    if (!grader || (phaseRef.current !== 'playing' && phaseRef.current !== 'countin')) return;
    grader.noteOn(midiNote, clockRef.current() - (settings.inputLatencyMs || 0) / 1000);
    setNoteStates(grader.states());
  }, [onNotify, onSettings, settings.inputLatencyMs, settings.inputMode, settings.keySound]);

  const connectMidiWithSound = useCallback(() => {
    // Start both permission-gated operations inside the same click.
    void unlockAudio();
    onConnectMidi();
  }, [onConnectMidi]);

  const testSound = useCallback(async () => {
    const media = startSoundCheck();
    if (media && await media.started) {
      onNotify?.('Sound is on');
      return;
    }
    if (!(await prepareSound())) return;
    const at = now() + 0.035;
    playPianoNote(at, 60, 0.7, 0.55);
    playPianoNote(at + 0.11, 64, 0.7, 0.5);
    playPianoNote(at + 0.22, 67, 0.9, 0.52);
    onNotify?.('Sound is on');
  }, [onNotify, prepareSound]);

  const startCalibration = useCallback(async () => {
    stopEverything();
    const calibrationScore = {
      ...score,
      tempo: 60,
      totalTicks: 0,
      staves: { rh: [], lh: [] },
    };
    const media = startPracticePlayback({
      score: calibrationScore,
      metronome: false,
      countInBeats: 4,
      onEnd: () => {
        if (!calibrationRef.current) return;
        calibrationRef.current = null;
        playbackRef.current = null;
        setCalibration((current) => ({ ...current, phase: 'idle' }));
      },
    });
    if (!media) {
      onNotify?.('Timing calibration is unavailable in this browser.', 'down');
      return;
    }
    playbackRef.current = media;
    calibrationRef.current = {
      media,
      expected: Array.from({ length: 4 }, (_, index) => media.leadIn + index),
      used: new Set(),
      samples: [],
    };
    setCalibration({ phase: 'active', taps: 0, offset: settings.inputLatencyMs || 0 });
    if (!(await media.started)) {
      calibrationRef.current = null;
      playbackRef.current = null;
      setCalibration((current) => ({ ...current, phase: 'idle' }));
      onNotify?.('Your browser blocked the calibration clicks.', 'down');
    }
  }, [onNotify, score, settings.inputLatencyMs, stopEverything]);

  const toggleStandMode = useCallback(() => {
    const next = !standMode;
    setStandMode(next);
    document.documentElement.classList.toggle('sr-stand-mode', next);
    if (next && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {});
    } else if (!next && document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [standMode]);

  const handleNoteOff = useCallback((midiNote) => {
    setHeld((prev) => { const n = new Set(prev); n.delete(midiNote); return n; });
  }, []);

  // Route live MIDI into the grader.
  useEffect(() => {
    if (!midi.subscribe) return undefined;
    return midi.subscribe((e) => {
      if (e.type === 'on') handleNoteOn(e.midi, e.source || 'midi');
      else handleNoteOff(e.midi);
    });
  }, [midi, handleNoteOn, handleNoteOff]);

  const running = (phase === 'playing' || listening)
    && tick >= 0 && tick <= (score.performanceTicks || score.totalTicks);
  const playheadTick = running ? tick : null;

  // Notes vanish only during a take. Count-in and review keep the full score
  // visible, and reference playback never turns on the drill.
  const vanishTick = phase === 'playing' && tick >= 0 && settings.curtain !== 'off' ? tick : null;

  const range = useMemo(() => {
    let lo = 127;
    let hi = 0;
    for (const hand of ['rh', 'lh']) {
      for (const n of score.staves[hand] || []) {
        for (const p of n.pitches) { lo = Math.min(lo, p.midi); hi = Math.max(hi, p.midi); }
      }
    }
    if (lo > hi) return [60, 84];
    // Round out to whole octaves so the drawn keyboard looks like a keyboard.
    return [Math.floor((lo - 2) / 12) * 12, Math.ceil((hi + 3) / 12) * 12];
  }, [score]);


  const countdown = phase === 'countin' && settings.countInBeats > 0
    ? Math.max(1, Math.ceil(-tick / (score.ts.beat)) )
    : null;

  const busy = phase === 'playing' || phase === 'countin' || listening || audioBusy || calibration.phase === 'active';
  const draftLevel = LEVELS[difficultyDraft - 1] || LEVELS[0];
  const commitDifficulty = useCallback((value) => {
    const next = Number(value);
    if (!level || next !== level.id) onDifficultyChange?.(next);
  }, [level, onDifficultyChange]);
  const acousticPractice = settings.inputMode === 'microphone' || microphone?.status === 'listening';
  const qualifies = freshRead && !previewed && !settings.guideKeys && settings.curtain === 'off' && !acousticPractice && !score.tempoPracticeOnly;
  const targetedIds = score.params.targeted || [];
  const realizedFocus = [
    ...(score.params.focusRhythmTags || []).map((tag) => `rhythm.${tag}`),
    ...(score.params.focusIntervals || []).map((tag) => `intervals.${tag}`),
  ];
  const focusIds = targetedIds.length ? targetedIds : realizedFocus.length ? realizedFocus : (level?.focus || []);
  const focusLabels = focusIds
    .map((id) => SKILLS.find((skill) => skill.id === id)?.label)
    .filter(Boolean)
    .slice(0, 1);
  const prepItems = preparationItems(score);
  const sessionLabel = session?.remaining == null
    ? 'Open practice'
    : session.complete
      ? `${session.takes} ${session.takes === 1 ? 'read' : 'reads'} complete`
      : `${formatClock(session.remaining)} · ${session.takes} ${session.takes === 1 ? 'read' : 'reads'}`;
  const journeyPhase = result ? 'review' : phase === 'playing' || phase === 'countin' ? 'play' : 'prepare';
  const dailyStep = session?.minutes ? Math.min(2, session.takes % 3) : null;

  const copyLink = async () => {
    const ok = await copyText(window.location.href);
    if (!ok) {
      onNotify?.('Could not copy the link in this browser', 'down');
      return;
    }
    setCopied(true);
    onNotify?.('Exact exercise link copied');
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="sr-practice">
      <nav className="sr-flowsteps" aria-label="Practice stages">
        {[
          ['prepare', placement?.active ? `Level check ${placement.total - placement.remaining + 1}/${placement.total}` : 'Prepare'],
          ['play', 'Play'],
          ['review', 'Review'],
        ].map(([id, label], index) => (
          <span key={id} className={journeyPhase === id ? 'is-current' : ''} aria-current={journeyPhase === id ? 'step' : undefined}>
            <b>{index + 1}</b>{label}
          </span>
        ))}
      </nav>
      <div className="sr-studio-header">
      <section className={`sr-practice-dock is-compact${level ? '' : ' is-custom'}`} aria-label="Practice controls">
        <div className="sr-practice-dock-current">
          <span>{level ? `Level ${difficultyDraft}` : 'Custom exercise'}</span>
          <strong>{level ? draftLevel.name : 'Your chosen settings'}</strong>
          <small>{level ? `${strongReads}/3 strong first reads` : 'Your choice of musical challenge'}</small>
        </div>
        {level && <div className="sr-quick-level">
            <input
              type="range" min="1" max={LEVELS.length} step="1" value={difficultyDraft}
              aria-label="Difficulty level"
              aria-valuetext={`Level ${difficultyDraft}, ${draftLevel.name}`}
              disabled={busy}
              onChange={(event) => setDifficultyDraft(Number(event.target.value))}
              onPointerUp={(event) => commitDifficulty(event.currentTarget.value)}
              onKeyUp={(event) => commitDifficulty(event.currentTarget.value)}
              onBlur={(event) => commitDifficulty(event.currentTarget.value)}
            />
            <div className="sr-difficulty-scale" aria-hidden="true">
              <span>Foundations</span><span>Fluency</span><span>Advanced</span>
            </div>
        </div>}
        <details className="sr-practice-tools" ref={practiceToolsRef} onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}>
          <summary>Settings</summary>
          <div className="sr-practice-tools-panel">
            <div className="sr-settings-heading"><strong>Make it your practice</strong><button type="button" className="sr-btn sr-btn--ghost" onClick={() => {
              practiceToolsRef.current.open = false;
              practiceToolsRef.current.querySelector('summary')?.focus();
            }}>Done</button></div>
        <div className="sr-practice-session">
          <label aria-label="Practice session length">
            <select
              value={settings.sessionMinutes || 0}
              onChange={(event) => onSettings({ sessionMinutes: Number(event.target.value) })}
              disabled={busy}
            >
              <option value={0}>Open practice</option>
              <option value={2}>2-minute practice</option>
              <option value={5}>5-minute practice</option>
              <option value={10}>10-minute practice</option>
            </select>
          </label>
          {session?.minutes > 0 && <strong>{sessionLabel}</strong>}
        </div>
          {level ? (
            <div className="sr-difficulty-control">
            <div className="sr-dock-heading">
              <span>Difficulty</span>
              <strong>Level {difficultyDraft} · {draftLevel.name}</strong>
            </div>
            <label className="sr-field"><span>Choose a level</span>
              <select aria-label="Choose a level" value={difficultyDraft} disabled={busy} onChange={(event) => { setDifficultyDraft(Number(event.target.value)); commitDifficulty(event.target.value); }}>
                {LEVELS.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
              </select>
            </label>
            </div>
          ) : (
            <div className="sr-custom-difficulty">
              <span>Custom exercise</span>
              <strong>Difficulty is set in Build</strong>
            </div>
          )}

        <div className="sr-view-preferences">
          <label className="sr-toggle"><input type="checkbox" checked={settings.preparationTips !== false} disabled={busy} onChange={(event) => onSettings({ preparationTips: event.target.checked })} /><span>Preparation tips</span></label>
          <p className="sr-hint">A short scan and a suggested practice sequence. Turn off for a quieter view.</p>
          <label className="sr-toggle"><input type="checkbox" checked={Boolean(settings.comfortView)} disabled={busy} onChange={(event) => onSettings({ comfortView: event.target.checked })} /><span>Comfort view · larger text and controls</span></label>
        </div>
        <fieldset className="sr-lookahead-control" disabled={busy}>
          <legend>
            <span>Eclipse</span>
            <small>Notes go dark ahead of the playhead, so the only way through is to read ahead.</small>
          </legend>
          <div className="sr-lookahead-options">
            {LOOK_AHEAD_MODES.map((mode) => (
              <label key={mode.id} title={mode.blurb}>
                <input
                  type="radio" name="look-ahead" value={mode.id}
                  checked={settings.curtain === mode.id}
                  onChange={() => onSettings({ curtain: mode.id })}
                />
                <span>{mode.short || mode.label}</span>
              </label>
            ))}
          </div>
          <p>{settings.curtain === 'off' ? 'Optional fluency drill' : `${curtainMode(settings.curtain).blurb} Results stay separate from level progress.`}</p>
        </fieldset>
        <fieldset className="sr-focus-packs" disabled={busy || !level}>
          <legend>Practice focus</legend>
          <p>Ask the next fresh study to emphasize one reading skill.</p>
          <div>
            {FOCUS_PACKS.map((pack) => (
              <button key={pack.id} type="button" onClick={() => onFocus?.(pack.id)}>{pack.label}</button>
            ))}
            <button type="button" className="sr-recheck-level" onClick={onRecheckLevel}>Recheck my level</button>
          </div>
        </fieldset>
        <details className="sr-playback-options">
          <summary>Sound, tempo &amp; feedback</summary>
        <div className="sr-transport-settings">
          <button type="button" className="sr-input-ready" disabled={busy} onClick={() => {
            const panel = document.querySelector('.sr-device-panel');
            if (practiceToolsRef.current) practiceToolsRef.current.open = false;
            if (panel) { panel.open = !panel.open; if (panel.open) panel.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
          }}>{acousticPractice ? 'Acoustic · unscored' : midi.status === 'connected' ? 'MIDI connected' : 'Sound & input'}</button>
          <label className="sr-field sr-field--slider">
            <span>Tempo <b>{score.tempo}</b> <small>♩/min</small></span>
            <input
              type="range" min="30" max="180" step="2" value={score.tempo}
              onChange={(e) => onSettings({ tempoOverride: Number(e.target.value) })}
              disabled={busy}
            />
          </label>
          {score.tempoPracticeOnly && <p className="sr-hint">This tempo is outside the level-check range. Your take is practice-only.</p>}
          <label className="sr-toggle">
            <input type="checkbox" checked={settings.metronome} disabled={busy} onChange={(e) => onSettings({ metronome: e.target.checked })} />
            <span>Metronome</span>
          </label>
          <details className="sr-aids">
            <summary>Aids & feedback</summary>
            <div className="sr-aids-popover">
              <label className="sr-toggle">
                <input type="checkbox" checked={settings.colourNotes} disabled={busy} onChange={(e) => onSettings({ colourNotes: e.target.checked })} />
                <span>Colour notes after you play</span>
              </label>
              <label className="sr-toggle" title="Guide keys make the take practice-only.">
                <input type="checkbox" checked={Boolean(settings.guideKeys)} disabled={busy} onChange={(e) => onSettings({ guideKeys: e.target.checked })} />
                <span>Guide on-screen keys <em>assist</em></span>
              </label>
              <label className="sr-toggle">
                <input type="checkbox" checked={Boolean(settings.showFingerings)} disabled={busy} onChange={(e) => onSettings({ showFingerings: e.target.checked })} />
                <span>Show available fingerings</span>
              </label>
              <label className="sr-toggle">
                <input type="checkbox" checked={settings.keySound !== false} disabled={busy} onChange={(e) => onSettings({ keySound: e.target.checked })} />
                <span>Sound on-screen keys</span>
              </label>
              <label className="sr-field sr-field--select">
                <span>Count-in</span>
                <select value={settings.countInBeats} onChange={(e) => onSettings({ countInBeats: Number(e.target.value) })} disabled={busy}>
                  <option value={0}>None</option>
                  <option value={1}>1 beat</option>
                  <option value={2}>2 beats</option>
                  <option value={4}>4 beats</option>
                </select>
              </label>
              <div className="sr-calibration">
                <div>
                  <strong>Timing calibration</strong>
                  <span>
                    {calibration.phase === 'active'
                      ? `Tap any key with each click · ${calibration.taps}/4`
                      : `Current correction: ${(settings.inputLatencyMs || 0) > 0 ? '+' : ''}${settings.inputLatencyMs || 0} ms`}
                  </span>
                </div>
                <button type="button" className="sr-btn sr-btn--small" onClick={startCalibration} disabled={busy}>
                  {calibration.phase === 'done' ? 'Recalibrate' : 'Calibrate'}
                </button>
              </div>
            </div>
          </details>
          <details className="sr-aids sr-more">
            <summary>More</summary>
            <div className="sr-aids-popover sr-more-popover">
              <button type="button" className="sr-btn sr-btn--ghost" onClick={copyLink}>{copied ? 'Link copied' : 'Share exercise link'}</button>
              <button type="button" className="sr-btn sr-btn--ghost" onClick={() => window.print()} disabled={busy}>Print score</button>
              <button
                type="button" className="sr-btn sr-btn--ghost"
                title="Open this exercise in MuseScore, Finale or Sibelius"
                onClick={() => downloadMusicXml(score, settings.showFingerings)}
                disabled={busy}
              >Export MusicXML</button>
              <button type="button" className="sr-btn sr-btn--ghost" onClick={toggleStandMode} disabled={busy}>
                {standMode ? 'Exit music stand' : 'Music stand mode'}
              </button>
            </div>
          </details>
        </div>
        </details>
          </div>
        </details>
      </section>

      <div className="sr-transport">
        <div className="sr-transport-main">
          {phase === 'playing' || phase === 'countin' ? (
            <button type="button" className="sr-btn sr-btn--stop" onClick={stop}>Stop</button>
          ) : (
            <button
              type="button" className="sr-btn sr-btn--primary sr-btn--start"
              onPointerDown={primeAudioGesture}
              onClick={start}
              disabled={busy}
            >
              <span className="sr-btn-icon" aria-hidden="true">▶</span>
              {audioBusy ? 'Turning on sound…'
                : result ? 'Play again'
                    : qualifies && preparation.phase === 'active' ? `Start when ready · ${preparation.remaining}s`
                      : 'Start practice'}
            </button>
          )}
          <button
            type="button" className="sr-btn" onClick={onRegenerate} disabled={busy}
          >
            New music
          </button>
          <button
            type="button" className="sr-btn sr-btn--ghost" onClick={listening ? stopReference : listen}
            onPointerDown={primeAudioGesture} disabled={busy && !listening}
            title={freshRead && !previewed ? 'Hearing the exercise first makes the next take practice-only.' : undefined}
          >
            <span className="sr-btn-icon sr-btn-icon--sound" aria-hidden="true">♪</span>
            {listening ? 'Stop listening' : 'Listen'}
          </button>
        </div>

        {standMode && <button type="button" className="sr-btn sr-btn--small sr-exit-stand" onClick={toggleStandMode}>Exit stand</button>}
      </div>

      <section className="sr-practice-summary" aria-label="Practice plan">
        <div className="sr-practice-summary-main">
          <span className={`sr-statuspill${qualifies ? ' is-fresh' : ' is-practice'}`}>
            {repairHand ? `${repairHand === 'rh' ? 'Right' : 'Left'}-hand practice`
              : acousticPractice ? 'Acoustic · unscored'
              : settings.curtain !== 'off' ? 'Reading-ahead drill'
              : !qualifies ? 'Practice only'
              : placement?.active ? `Level check · ${placement.remaining} left`
              : dailyStep === 0 ? 'Warm-up read'
                : dailyStep === 1 ? 'First read'
                  : dailyStep === 2 ? 'Try a different study'
                    : 'First read'}
          </span>
          <span>Focus: <strong>{focusLabels.length ? focusLabels.join(' · ') : 'keep a steady beat'}</strong></span>
        </div>
        {settings.preparationTips !== false && freshRead && !result && preparation.phase === 'idle' && <button type="button" className="sr-btn sr-btn--ghost sr-prep-toggle" onClick={beginPreparation} disabled={busy}>30-second preparation</button>}
      </section>

      </div>

      {settings.preparationTips !== false && session?.minutes > 0 && !placement?.active && (
        <ol className="sr-daily-plan" aria-label="Daily practice plan">
          {['Find the pulse', 'Read something fresh', 'Apply it to new music'].map((label, index) => (
            <li key={label} className={index === dailyStep ? 'is-current' : index < dailyStep ? 'is-done' : ''}>
              <span>{index < dailyStep ? '✓' : index + 1}</span>{label}
            </li>
          ))}
        </ol>
      )}

      {settings.preparationTips !== false && freshRead && !result && preparation.phase !== 'idle' && (
        <section className={`sr-preparation is-${preparation.phase}`} aria-label="Silent preparation">
          <div className="sr-preparation-head">
            <div>
              <strong>{preparation.phase === 'idle'
                ? 'Notice the key, pulse and a repeating shape.'
                : preparation.phase === 'ready'
                  ? 'Your scan is complete.'
                  : preparation.phase === 'active'
                    ? `${preparation.remaining} seconds to notice the structure.`
                    : 'Prepared for this first read.'}</strong>
            </div>
            {preparation.phase === 'idle' && (
              <button type="button" className="sr-btn sr-btn--small" onClick={beginPreparation}>Optional 30-second scan</button>
            )}
          </div>
          {preparation.phase !== 'idle' && (
            <div className="sr-preparation-body">
              <div className="sr-preparation-grid">
                {prepItems.map((item) => {
                  const checked = preparation.checks.includes(item.id);
                  return (
                    <button
                      key={item.id} type="button"
                      className={`sr-preparation-item${checked ? ' is-checked' : ''}`}
                      aria-pressed={checked}
                      onClick={() => togglePreparationCheck(item.id)}
                    >
                      <span aria-hidden="true">{checked ? '✓' : item.step}</span>
                      <div><b>{item.label}</b><small>{item.detail}</small></div>
                    </button>
                  );
                })}
              </div>
              <div className="sr-pulse-practice" aria-live="polite">
                <button type="button" onClick={tapPulse}>
                  <span aria-hidden="true">{pulseTap.times.length ? '●'.repeat(pulseTap.times.length) : '○○○○'}</span>
                  Tap pulse
                </button>
                <p>{pulseTap.message}</p>
              </div>
            </div>
          )}
        </section>
      )}

      {settings.scoreLayout !== 'scroll' && (
        <aside className="sr-landscape-tip">
          <div><strong>Turn this into a music stand</strong><span>Scrolling view keeps the next notes in sight on a landscape phone.</span></div>
          <button type="button" className="sr-btn sr-btn--primary" onClick={() => { onSettings({ scoreLayout: 'scroll' }); toggleStandMode(); }}>Use scrolling stand</button>
        </aside>
      )}

      <div className="sr-scorecard">
        <div className="sr-scorehead">
          <div className="sr-scoreidentity">
            <div className="sr-scorekicker">
              <span>{score.repertoire ? 'Public-domain repertoire' : score.fragment ? 'Recombined human motif' : 'Original study'}</span>
            </div>
            <h2 className="sr-scoretitle">{score.title}</h2>
            <p className="sr-scoremeta">
              {keyLabel(score.key)} · {score.ts.name} · ♩= {score.tempo} · {score.measures} bars
              {score.notationRepeat ? <> · one phrase repeats</> : null}
            </p>

          </div>
          <div className="sr-score-actions">
            <fieldset className="sr-layout-switch" disabled={busy}>
              <legend>Score view</legend>
              {[
                { id: 'page', label: 'Page', title: 'Show the whole score in conventional systems' },
                { id: 'scroll', label: 'Scroll', title: 'Keep the score on one line and follow the playhead' },
              ].map((option) => (
                <label key={option.id} title={option.title}>
                  <input
                    type="radio" name="score-layout" value={option.id}
                    checked={(settings.scoreLayout || 'page') === option.id}
                    onChange={() => onSettings({ scoreLayout: option.id })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>

            <label className="sr-notation-size">Music size
              <select value={settings.notationScale || 1} onChange={(event) => onSettings({ notationScale: Number(event.target.value) })} disabled={busy}>
                <option value={1}>Standard</option><option value={1.25}>Larger</option><option value={1.5}>Largest</option>
              </select>
            </label>
          </div>
        </div>

        <div className={`sr-scorearea${phase === 'countin' ? ' is-countin' : ''}`}>
          <Score
            score={score}
            showFingerings={settings.showFingerings}
            noteStates={settings.colourNotes ? noteStates : null}
            tick={playheadTick}
            vanishMode={settings.curtain}
            vanishTick={vanishTick}
            layout={settings.scoreLayout || 'page'}
            notationScale={settings.notationScale || 1}
          />
          {countdown != null && (
            <div className="sr-countin" aria-live="polite">{countdown}</div>
          )}
          {settings.colourNotes && Object.keys(noteStates).length > 0 && (
            <div className="sr-feedback-legend" aria-label="Score feedback key">
              <span><b aria-hidden="true">✓</b> correct</span>
              <span><b aria-hidden="true">△</b> early or late</span>
              <span><b aria-hidden="true">×</b> wrong</span>
              <span><b aria-hidden="true">○</b> missed</span>
            </div>
          )}
        </div>
            <details className="sr-structure">
              <summary>Structure</summary>
              <div className="sr-structure-grid">
                <div><span>Style & form</span><strong>{score.style?.label} · {score.form.name} · {score.form.label}</strong></div>
                <div><span>Harmony model</span><strong>{score.harmony.sourceProgression || score.harmony.name}</strong></div>
                <div><span>Chord path</span><strong>{score.harmony.roman}</strong></div>
                <div><span>Cadences</span><strong>{score.harmony.cadencePlan}</strong></div>
                <div><span>Phrase functions</span><strong>{score.form.phrases?.map((item) => item.function).join(' → ')}</strong></div>
                {score.notationRepeat && (
                  <div><span>Repeat</span><strong>Bars {score.notationRepeat.startMeasure + 1}–{score.notationRepeat.endMeasure + 1} play twice</strong></div>
                )}
                <div><span>{score.repertoire ? 'Source status' : 'Quality review'}</span><strong>{score.repertoire
                  ? `${score.repertoire.license} · provenance recorded`
                  : score.fragment
                    ? `Transposed ${score.fragment.shift > 0 ? 'up' : 'down'} ${Math.abs(score.fragment.shift)} scale step${Math.abs(score.fragment.shift) === 1 ? '' : 's'} · provenance recorded`
                    : `Automated composition checks · not a teacher assessment`}</strong></div>
              </div>
            </details>
      </div>


      <details className="sr-device-panel">
        <summary>
          <span>Sound & keyboard</span>
          <small>{midi.status === 'connected' ? `MIDI: ${midi.inputs.join(', ') || 'connected'}` : soundLabel(soundState)}</small>
        </summary>
        <div className="sr-devicebar">
          <label className="sr-field"><span>How you play</span>
            <select value={settings.inputMode || 'screen'} disabled={busy} onChange={(event) => {
              if (microphone?.status === 'listening' && event.target.value !== 'microphone') onConnectMicrophone();
              onSettings({ inputMode: event.target.value });
              if (event.target.value === 'screen' && !showKeyboard) onToggleKeyboard();
            }}>
              <option value="screen">Screen or computer keys</option><option value="midi">MIDI piano · assessed</option><option value="microphone">Acoustic piano · unscored</option>
            </select>
          </label>
          <div className={`sr-sound sr-sound--${soundState}`} aria-live="polite">
            <span className="sr-sound-icon" aria-hidden="true">♪</span>
            <span className="sr-sound-status">{soundLabel(soundState)}</span>
            <button
              type="button" className="sr-btn sr-btn--small" onPointerDown={primeAudioGesture}
              onClick={testSound} disabled={busy}
            >Test sound</button>
            <label className="sr-volume">
              <span>Volume <b>{Math.round((settings.masterVolume ?? 0.82) * 100)}%</b></span>
              <input
                type="range" min="0" max="1" step="0.05" value={settings.masterVolume ?? 0.82}
                onChange={(e) => onSettings({ masterVolume: Number(e.target.value) })}
                aria-label="Playback volume"
              />
            </label>
          </div>

          <div className="sr-inputbar">
            <div className={`sr-midi sr-midi--${midi.status}`}>
              <span className="sr-dot" />
              {midi.status === 'connected'
                ? <span>MIDI: {midi.inputs.join(', ') || 'connected'}</span>
                : midi.status === 'connecting'
                  ? <span>Requesting MIDI access…</span>
                  : midi.status === 'ready'
                    ? <span>MIDI ready — plug in or switch on your keyboard</span>
                    : midi.status === 'error'
                      ? <span>{midi.error}</span>
                      : <span>No MIDI keyboard connected</span>}
              {!['connected', 'ready'].includes(midi.status) && (
                <button
                  type="button" className="sr-btn sr-btn--small" onPointerDown={primeAudioGesture}
                  onClick={connectMidiWithSound} disabled={midi.status === 'connecting'}
                >
                  {midi.status === 'connecting' ? 'Connecting…' : 'Connect MIDI'}
                </button>
              )}
            </div>
            <button type="button" className="sr-btn sr-btn--small sr-btn--ghost" onClick={onToggleKeyboard}>
              {showKeyboard ? 'Hide keyboard' : 'Show keyboard'}
            </button>
          </div>
          <div className={`sr-microphone sr-microphone--${microphone?.status || 'idle'}`}>
            <div>
              <strong>Acoustic piano</strong>
              <span>{microphone?.status === 'listening'
                ? `Listening${microphone.midi != null ? ` · heard ${midiLabel(microphone.midi)}` : ' · play one note at a time'}`
                : microphone?.status === 'connecting' ? 'Requesting microphone access…'
                  : microphone?.status === 'error' ? microphone.error
                    : 'Optional single-note detector · A1–C6 · experimental'}</span>
              <small>Acoustic practice is unscored. Detection can miss notes and chords; it never changes your level or skill ratings.</small>
            </div>
            <div className="sr-mic-meter" aria-label="Pitch signal clarity, not detection accuracy">
              <span style={{ width: `${Math.round((microphone?.confidence || 0) * 100)}%` }} />
            </div>
            <button
              type="button" className="sr-btn sr-btn--small"
              onClick={onConnectMicrophone} disabled={microphone?.status === 'connecting' || busy}
            >{microphone?.status === 'listening' ? 'Stop listening' : 'Use microphone'}</button>
          </div>
        </div>
      </details>

      {showKeyboard && (
        <Keyboard
          low={range[0]} high={range[1]} held={held} expected={dueNow}
          onNoteOn={handleNoteOn} onNoteOff={handleNoteOff}
          octaveBase={Math.max(48, Math.min(72, range[0] + 12))}
          className={phase === 'playing' || phase === 'countin' ? 'is-playing' : ''}
        />
      )}

      {result && (
          <ResultPanel
            result={result}
          onAgain={start}
          onNext={onRegenerate}
          onRepair={(tempo) => onSettings({ tempoOverride: tempo })}
          tempo={score.tempo}
          repeat={result.takeIndex > 1 || !result.wasFresh}
          assisted={result.assisted}
            curtain={curtainMode(settings.curtain)}
            score={score}
            focusIds={focusIds}
            reflection={reflection}
            placement={placement}
            repairHand={repairHand}
            onRepairHand={onRepairHand}
            onReflect={(choice) => {
              setReflection(choice.label);
              onReflect?.(choice);
            }}
          />
      )}
    </div>
  );
}

export function ResultPanel({
  result, onAgain, onNext, onRepair, tempo, repeat, assisted, curtain,
  score, focusIds, reflection, onReflect, placement, repairHand, onRepairHand,
}) {
  if (result.unscored) return (
    <section className="sr-result" aria-live="polite">
      <div className="sr-result-coach"><span className="sr-eyebrow">Unscored acoustic practice</span>
        <strong>How comfortably did you keep the pulse?</strong>
        <p>Listen back to the reference and choose one passage to revisit. Experimental microphone detection does not assess your playing or change your level.</p>
      </div>
      <button type="button" className="sr-btn sr-btn--primary" onClick={onNext}>Try a different study</button>
      <button type="button" className="sr-btn" onClick={onAgain}>Practice this again</button>
    </section>
  );
  if (result.invalid) {
    return (
      <section className="sr-result sr-result--invalid" aria-live="polite">
        <div className="sr-result-coach">
          <span className="sr-eyebrow">Let’s check your connection</span>
          <strong>We couldn’t receive enough notes to give feedback.</strong>
          <p>Check the MIDI connection or open the on-screen keyboard, then try again. Your progress and streak were not changed.</p>
        </div>
        <button type="button" className="sr-btn sr-btn--primary" onClick={onAgain}>Try this first read again</button>
      </section>
    );
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  const timing = result.meanSignedTiming;
  const rec = result.recovery;
  const coach = coachingFor(result);
  const hands = handNote(result);
  const tone = result.score >= 88 ? 'good' : result.score >= 65 ? 'steady' : 'rebuild';
  const repairTempo = suggestedRepairTempo(result, tempo);
  const shouldRepair = result.score < 88;
  return (
    <section className="sr-result" aria-live="polite">
      <div className="sr-result-coach">
        <span className="sr-eyebrow">Practice complete</span>
        <p className="sr-observed-strength">{observedStrength(result)}</p>
        <strong>{coach.title}</strong>
        <p>{coach.detail}</p>
        {hands && <p className="sr-hand-note">{hands}</p>}
      </div>
      <div className="sr-result-actions">
        {placement?.active ? (
          <>
            <button type="button" className="sr-btn sr-btn--primary" onClick={onNext}>Next level-check read</button>
            <button type="button" className="sr-btn" onClick={onAgain}>Repeat for confidence</button>
          </>
        ) : placement?.complete ? (
          <button type="button" className="sr-btn sr-btn--primary" onClick={onNext}>Start at level {placement.recommended}</button>
        ) : shouldRepair ? (
          <>
            <button
              type="button" className="sr-btn sr-btn--primary"
              onClick={() => repairTempo < tempo ? onRepair(repairTempo) : onAgain()}
            >Try again at {repairTempo} bpm</button>
            <button type="button" className="sr-btn" onClick={onNext}>New first read</button>
          </>
        ) : (
          <>
            <button type="button" className="sr-btn sr-btn--primary" onClick={onNext}>New first read</button>
            <button type="button" className="sr-btn" onClick={onAgain}>Repeat for fluency</button>
          </>
        )}
      </div>
      <div className="sr-learning-review">
        <div className="sr-pattern-insight">
          <span className="sr-eyebrow">See the pattern</span>
          <strong>{patternInsight(score)}</strong>
          <p>{score.form?.label || 'Follow the phrase shape'} · {score.harmony?.cadencePlan || 'listen for the cadence'}</p>
        </div>
        <fieldset className="sr-reflection">
          <legend>What would you like to practice next?</legend>
          <div>
            {reflectionChoices(focusIds).map((choice) => (
              <button
                type="button" key={choice.label}
                className={reflection === choice.label ? 'is-on' : ''}
                aria-pressed={reflection === choice.label}
                onClick={() => onReflect(choice)}
              >{choice.label}</button>
            ))}
          </div>
          <small>{reflection ? 'Your next fresh study will take this into account.' : 'Your answer helps choose the next fresh study.'}</small>
        </fieldset>
      </div>
      {!placement?.active && !placement?.complete && !repairHand && score.staves.rh?.length > 0 && score.staves.lh?.length > 0 && (
        <div className="sr-hand-repair">
          <span>You can also try one hand at a time:</span>
          <button type="button" onClick={() => onRepairHand?.('rh', repairTempo)}>Right hand only</button>
          <button type="button" onClick={() => onRepairHand?.('lh', repairTempo)}>Left hand only</button>
        </div>
      )}
      {(placement?.active || placement?.complete || repeat || assisted || curtain.beats !== null) && (
        <p className="sr-result-note">
          {placement?.active || placement?.complete
            ? 'Level-check read — used to recommend a comfortable starting point, not to advance the learning path.'
            : curtain.beats !== null
            ? `Eclipse take (${curtain.label}) — tracked under reading ahead, and it does not move your constellation or level.`
            : assisted
              ? 'Assisted practice — saved separately from your first-read skill ratings and cannot advance your level.'
              : 'Replay — useful practice, saved separately from first-read skill ratings and cannot advance your level.'}
        </p>
      )}
      <details className="sr-result-details"><summary>Notes, timing &amp; score</summary>
      <div className="sr-result-score">
        <div className={`sr-bigscore is-${tone}`}>{result.score}</div>
        <div className="sr-bigscore-label">out of 100</div>
      </div>
      <div className="sr-result-grid">
        <Metric label="Right notes" value={pct(result.pitchAccuracy)} detail={`${result.correct} of ${result.total}${result.extras ? ` · ${result.extras} extra` : ''}`} />
        <Metric
          label="In time"
          value={pct(result.rhythmAccuracy)}
          detail={
            result.timedNotes === 0 ? 'no notes landed'
              : result.timingOff ? `${result.timingOff} rushed or dragged`
                : 'steady'
          }
        />
        <Metric label="Kept going" value={pct(result.continuity)} detail={`${result.attacksKept ?? result.correct} of ${result.attackCount ?? result.total} attacks`} />
        <Metric
          label="Timing bias"
          value={timing == null ? '—' : `${timing > 0 ? '+' : ''}${Math.round(timing * 1000)} ms`}
          detail={timing == null ? '' : timing > 0.02 ? 'later than the reference beat' : timing < -0.02 ? 'earlier than the reference beat' : 'close to the reference beat'}
        />
        <Metric label="Recovery" value={recoveryValue(rec)} detail={recoveryDetail(rec)} />
      </div>
      <TimingStrip result={result} />
      </details>
    </section>
  );
}

function preparationItems(score) {
  const rhythm = (score.params?.focusRhythmTags || score.params?.rhythmTags || []).at(-1);
  const rhythmLabel = rhythm ? rhythm.replace('sixteenth', 'sixteenth-note').replace('dotted', 'dotted-note') : 'steady quarter-note';
  const leftHand = (score.params?.lhStyle || 'simple').replace('_', ' ');
  return [
    { id: 'frame', step: '1', label: 'Key & metre', detail: `${keyLabel(score.key)} · ${score.ts.name}` },
    { id: 'rhythm', step: '2', label: 'Tap the trickiest rhythm', detail: `${rhythmLabel} pattern · feel the pulse first` },
    { id: 'hands', step: '3', label: 'Place your hands', detail: `${leftHand} left hand · find the widest move` },
    { id: 'phrase', step: '4', label: 'Imagine the opening sound', detail: `${score.form?.label || 'follow the phrase'} · notice how the music ends` },
  ];
}

function reflectionChoices(focusIds = []) {
  const rhythmSkill = focusIds.find((id) => id.startsWith('rhythm.')) || 'rhythm.quarter';
  const pitchSkill = focusIds.find((id) => id.startsWith('notes.')) || 'notes.treble';
  return [
    { label: 'Pulse or rhythm', skillId: rhythmSkill },
    { label: 'Notes or key', skillId: pitchSkill },
    { label: 'Left-hand pattern', skillId: 'notes.bass' },
    { label: 'Hands together', skillId: 'coordination.together' },
    { label: 'Ready for new music', skillId: null },
  ];
}

function patternInsight(score) {
  const motif = score.development?.motif;
  if (motif?.rhythm?.length) return 'Read the recurring rhythm and contour as one musical word.';
  if (score.notationRepeat) return 'The repeated phrase is a chunk: recognize it before reading individual notes.';
  return 'Group intervals, harmony, and rhythm into shapes instead of naming every note.';
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${remainder} left`;
}

function soundLabel(state) {
  if (state === 'running') return 'Sound on';
  if (state === 'unavailable') return 'Audio unavailable in this browser';
  if (state === 'suspended' || state === 'interrupted') return 'Sound paused — tap to resume';
  return 'Sound starts on your first tap';
}

function midiLabel(midi) {
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Keep the same notation, but lower the tempo enough to preserve continuity. */
function suggestedRepairTempo(result, tempo) {
  let factor = 1;
  if (result.continuity < 0.78 || result.score < 60) factor = 0.8;
  else if (result.rhythmAccuracy < 0.78 || result.score < 78) factor = 0.9;
  return Math.max(30, Math.round((tempo * factor) / 2) * 2);
}

/**
 * What the two hands did differently.
 *
 * Rhythm strands are shared between the hands, so a strand score can never say
 * which hand was late. The grader records per-hand accuracy and timing, and
 * this turns a real gap between them into one sentence a pianist can act on.
 * Nothing is said unless the gap is large enough to be worth practising.
 */
function handNote(result) {
  const rh = result.hands?.rh;
  const lh = result.hands?.lh;
  if (!rh || !lh || rh.notes < 6 || lh.notes < 6) return null;

  const drift = (hand) => (hand.meanSignedTiming == null ? 0 : hand.meanSignedTiming);
  const gap = drift(lh) - drift(rh);
  const ms = Math.round(Math.abs(gap) * 1000);
  if (ms >= 55) {
    return gap > 0
      ? `Your left hand is landing about ${ms} ms behind your right. Try counting the bass in and letting the melody follow it.`
      : `Your left hand is running about ${ms} ms ahead of your right. Let the melody set the beat and place the bass under it.`;
  }

  const accuracy = (hand) => (hand.pitchAccuracy == null ? 1 : hand.pitchAccuracy);
  const difference = accuracy(rh) - accuracy(lh);
  if (Math.abs(difference) >= 0.18) {
    return difference > 0
      ? `The bass staff cost more notes than the treble this time — ${Math.round(accuracy(lh) * 100)}% against ${Math.round(accuracy(rh) * 100)}%. A left-hand-only read is the fastest way to close that.`
      : `The treble staff cost more notes than the bass this time — ${Math.round(accuracy(rh) * 100)}% against ${Math.round(accuracy(lh) * 100)}%.`;
  }
  return null;
}

function observedStrength(result) {
  if (result.continuity >= 0.95) return 'You kept going through the music.';
  if (result.rhythmAccuracy >= 0.85) return 'Most of your notes landed with the beat.';
  if (result.pitchAccuracy >= 0.85) return 'You found most of the written notes.';
  return 'You’ve completed a practice read. Let’s choose one small next step.';
}

function coachingFor(result) {
  if (result.score >= 92 && result.continuity >= 0.95) {
    return { title: 'You’re ready for new music.', detail: 'Try another piece at this level and bring the same steady beat.' };
  }
  if (result.continuity < 0.78) {
    return { title: 'Protect the pulse after a slip.', detail: 'Do not correct backward. Drop the missed note, find the next beat, and re-enter while the metronome keeps moving.' };
  }
  if (result.pitchAccuracy + 0.08 < result.rhythmAccuracy) {
    return { title: 'Scan the notes before you retry.', detail: 'Find the biggest jumps and any sharps or flats first. Then try again at a comfortable tempo.' };
  }
  if (result.rhythmAccuracy + 0.08 < result.pitchAccuracy) {
    return { title: 'Keep the notes; simplify the pulse.', detail: 'Tap the trickiest rhythm before playing it. Let the metronome help you keep a steady beat.' };
  }
  if (result.meanSignedTiming != null && result.meanSignedTiming > 0.055) {
    return { title: 'Read one beat farther ahead.', detail: 'You consistently landed late. Look at the next beat while your hands finish the current one.' };
  }
  if (result.meanSignedTiming != null && result.meanSignedTiming < -0.055) {
    return { title: 'Let the count-in set the ceiling.', detail: 'You consistently rushed. Feel the full space between clicks before starting the next note.' };
  }
  return { title: result.score >= 80 ? 'Take the win and read something new.' : 'Retry once, slightly slower.', detail: result.score >= 80
    ? 'Take what you learned into a piece you haven’t played before.'
    : 'Lower the tempo just enough to keep moving; the goal is a continuous read, not a perfect correction.' };
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Hand the exercise off to real notation software. */
function downloadMusicXml(score, showFingerings) {
  const blob = new Blob([toMusicXml(score, { showFingerings })], { type: 'application/vnd.recordare.musicxml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${score.title.replace(/[^\w]+/g, '-').toLowerCase()}.musicxml`;
  a.click();
  URL.revokeObjectURL(url);
}

/** How quickly a wrong or dropped note stopped costing you the notes after it. */
function recoveryValue(rec) {
  if (!rec || rec.episodes === 0) return 'clean';
  // Every slip ran to the end of the take without the line steadying again.
  if (rec.meanNotes == null) return 'never';
  const n = Math.round(rec.meanNotes * 10) / 10;
  return `${n} ${n === 1 ? 'note' : 'notes'}`;
}

function recoveryDetail(rec) {
  if (!rec || rec.episodes === 0) return 'no slips to recover from';
  if (rec.meanNotes == null) return 'the line never steadied again';
  const parts = [`${rec.episodes} ${rec.episodes === 1 ? 'slip' : 'slips'}`];
  if (rec.worstNotes != null) parts.push(`worst ${rec.worstNotes}`);
  if (rec.unrecovered) parts.push(`${rec.unrecovered} never recovered`);
  return parts.join(' · ');
}

function Metric({ label, value, detail }) {
  return (
    <div className="sr-metric">
      <div className="sr-metric-label">{label}</div>
      <div className="sr-metric-value">{value}</div>
      <div className="sr-metric-detail">{detail}</div>
    </div>
  );
}
