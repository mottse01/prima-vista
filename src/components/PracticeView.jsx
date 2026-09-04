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
import { seedToCode } from '../core/rng.js';
import { warmUp } from '../core/verovio.js';
import { toMusicXml } from '../core/musicxml.js';
import { CURTAIN_MODES, curtainMode } from '../core/curtain.js';
import { LEVELS } from '../core/levels.js';

const LOOK_AHEAD_MODES = CURTAIN_MODES;

/**
 * One take of one exercise. App remounts this whenever the exercise changes,
 * which is what resets the transport, the colouring and the last result.
 */
export default function PracticeView({
  score, settings, onSettings, onResult, onRegenerate, level,
  onDifficultyChange,
  midi, onConnectMidi, showKeyboard, onToggleKeyboard,
  freshRead, strongReads = 0, onPreview, onNotify,
  session, onSessionStart,
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
  const freshAtStartRef = useRef(false);
  const calibrationRef = useRef(null);

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
    const summary = grader.finish();
    setNoteStates(grader.states());
    setResult({
      ...summary,
      takeIndex: takeCountRef.current,
      assisted: assistedRef.current,
      wasFresh: freshAtStartRef.current,
    });
    setPhaseBoth('done');
    onResult({
      summary,
      elapsedSec: Math.max(0, clockRef.current() - takeStartRef.current),
      takeIndex: takeCountRef.current,
      curtain: settings.curtain,
      assisted: assistedRef.current,
    });
  }, [onResult, settings.curtain, stopEverything]);

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
    const over = t > score.totalTicks + TPQ;
    if (modeRef.current === 'listen') return !over;
    if (phaseRef.current === 'countin' && t >= 0) setPhaseBoth('playing');
    if (over) { finish(); return false; }
    return true;
  }, [finish, refreshGuide, score.totalTicks, secPerTick]);

  useEffect(() => { guideRef.current = Boolean(settings.guideKeys); }, [settings.guideKeys]);
  useEffect(() => subscribeAudioState(setSoundState), []);
  useEffect(() => { setMasterVolume(settings.masterVolume ?? 0.82); }, [settings.masterVolume]);
  useEffect(() => {
    if (!LOOK_AHEAD_MODES.some((mode) => mode.id === settings.curtain)) onSettings({ curtain: 'off' });
  }, [onSettings, settings.curtain]);

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
    stopEverything();
    onSessionStart?.();
    setListening(false);
    setResult(null);
    setNoteStates({});
    setDueNow(new Set());
    takeCountRef.current += 1;
    assistedRef.current = Boolean(previewed || settings.guideKeys);
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
  }, [finish, freshRead, onSessionStart, prepareSound, previewed, score, settings.countInBeats, settings.guideKeys, settings.metronome, settings.toleranceScale, startLoop, stopEverything]);

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

  const handleNoteOn = useCallback((midiNote) => {
    setHeld((prev) => new Set(prev).add(midiNote));
    if (settings.keySound !== false) {
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
    if (!grader || (phaseRef.current !== 'playing' && phaseRef.current !== 'countin')) return;
    grader.noteOn(midiNote, clockRef.current() - (settings.inputLatencyMs || 0) / 1000);
    setNoteStates(grader.states());
  }, [onNotify, onSettings, settings.inputLatencyMs, settings.keySound]);

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
      if (e.type === 'on') handleNoteOn(e.midi);
      else handleNoteOff(e.midi);
    });
  }, [midi, handleNoteOn, handleNoteOff]);

  const running = (phase === 'playing' || listening) && tick >= 0 && tick <= score.totalTicks;
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
  const qualifies = freshRead && !previewed && !settings.guideKeys && settings.curtain === 'off';
  const targetedIds = score.params.targeted || [];
  const focusIds = targetedIds.length ? targetedIds : (level?.focus || []);
  const focusLabels = focusIds
    .map((id) => SKILLS.find((skill) => skill.id === id)?.label)
    .filter(Boolean)
    .slice(0, 3);
  const sessionLabel = session?.remaining == null
    ? 'Open practice'
    : session.complete
      ? `${session.takes} ${session.takes === 1 ? 'read' : 'reads'} complete`
      : `${formatClock(session.remaining)} · ${session.takes} ${session.takes === 1 ? 'read' : 'reads'}`;

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
      <section className={`sr-practice-dock${level ? '' : ' is-custom'}`} aria-label="Practice controls">
        {level ? (
          <div className="sr-difficulty-control">
            <div className="sr-dock-heading">
              <span>Difficulty</span>
              <strong>Level {difficultyDraft} · {draftLevel.name}</strong>
            </div>
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
          </div>
        ) : (
          <div className="sr-custom-difficulty">
            <span>Custom exercise</span>
            <strong>Difficulty is set in Build</strong>
          </div>
        )}

        <fieldset className="sr-lookahead-control" disabled={busy}>
          <legend>
            <span>Vanishing notes</span>
            <small>Played notes fade away; harder modes fade them sooner.</small>
          </legend>
          <div className="sr-lookahead-options">
            {LOOK_AHEAD_MODES.map((mode) => (
              <label key={mode.id} title={mode.blurb}>
                <input
                  type="radio" name="look-ahead" value={mode.id}
                  checked={settings.curtain === mode.id}
                  onChange={() => onSettings({ curtain: mode.id })}
                />
                <span>{mode.id === 'off' ? 'Off' : mode.id === 'played' ? 'Played' : mode.id === 'bar' ? '1 bar' : mode.label.replace(' ahead', '')}</span>
              </label>
            ))}
          </div>
          <p>{settings.curtain === 'off' ? 'Optional focus drill' : `${curtainMode(settings.curtain).blurb} Results stay separate from level progress.`}</p>
        </fieldset>
      </section>

      <section className="sr-practice-summary" aria-label="Practice plan">
        <div className="sr-practice-summary-main">
          <span className={`sr-statuspill${qualifies ? ' is-fresh' : ' is-practice'}`}>
            {settings.curtain !== 'off' ? 'Reading-ahead drill' : qualifies ? 'Fresh read' : 'Practice take'}
          </span>
          <span>Focus: <strong>{focusLabels.length ? focusLabels.join(' · ') : 'clean baseline'}</strong></span>
          {level && <span>{strongReads}/3 strong fresh reads</span>}
        </div>
        <div className="sr-practice-session">
          <label aria-label="Practice session length">
            <select
              value={settings.sessionMinutes || 0}
              onChange={(event) => onSettings({ sessionMinutes: Number(event.target.value) })}
              disabled={busy}
            >
              <option value={0}>Open practice</option>
              <option value={5}>5-minute set</option>
              <option value={10}>10-minute set</option>
            </select>
          </label>
          <strong>{sessionLabel}</strong>
        </div>
      </section>

      <div className="sr-scorecard">
        <div className="sr-scorehead">
          <div className="sr-scoreidentity">
            <div className="sr-scorekicker">
              <span>{score.repertoire ? 'Public-domain repertoire' : score.fragment ? 'Recombined human motif' : 'Original study'}</span>
            </div>
            <h2 className="sr-scoretitle">{score.title}</h2>
            <p className="sr-scoremeta">
              {keyLabel(score.key)} · {score.ts.name} · ♩= {score.tempo} · {score.measures} bars
              {level ? <> · Level {level.id} <span className="sr-dim">{level.name}</span></> : null}
            </p>
            <details className="sr-structure">
              <summary>Structure</summary>
              <div className="sr-structure-grid">
                <div><span>Style & form</span><strong>{score.style?.label} · {score.form.name} · {score.form.label}</strong></div>
                <div><span>Harmony model</span><strong>{score.harmony.sourceProgression || score.harmony.name}</strong></div>
                <div><span>Chord path</span><strong>{score.harmony.roman}</strong></div>
                <div><span>Cadences</span><strong>{score.harmony.cadencePlan}</strong></div>
                <div><span>Phrase functions</span><strong>{score.form.phrases?.map((item) => item.function).join(' → ')}</strong></div>
                <div><span>{score.repertoire ? 'Source status' : 'Quality review'}</span><strong>{score.repertoire
                  ? `${score.repertoire.license} · provenance recorded`
                  : score.fragment
                    ? `Transposed ${score.fragment.shift > 0 ? 'up' : 'down'} ${Math.abs(score.fragment.shift)} scale step${Math.abs(score.fragment.shift) === 1 ? '' : 's'} · provenance recorded`
                    : `Best of ${score.compositionReview?.candidates || 1} candidates · ${score.compositionReview?.score || '—'}/100`}</strong></div>
              </div>
            </details>
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
            <div className="sr-seed" title={`Exercise ${seedToCode(score.seed)}`}>
            <button type="button" className="sr-copybtn" onClick={copyLink} title="Copy an exact exercise link">
              {copied ? 'Copied' : 'Share'}
            </button>
            </div>
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
      </div>

      <div className="sr-transport">
        <div className="sr-transport-main">
          {phase === 'playing' || phase === 'countin' ? (
            <button type="button" className="sr-btn sr-btn--stop" onClick={stop}>Stop</button>
          ) : (
            <button
              type="button" className="sr-btn sr-btn--primary sr-btn--start"
              onPointerDown={primeAudioGesture} onClick={start} disabled={busy}
            >
              <span className="sr-btn-icon" aria-hidden="true">▶</span>
              {audioBusy ? 'Turning on sound…' : result ? 'Play again' : qualifies ? 'Start first read' : 'Start practice'}
            </button>
          )}
          <button
            type="button" className="sr-btn" onClick={onRegenerate} disabled={busy}
          >
            New study
          </button>
          <button
            type="button" className="sr-btn sr-btn--ghost" onClick={listening ? stopReference : listen}
            onPointerDown={primeAudioGesture} disabled={busy && !listening}
            title={freshRead && !previewed ? 'Hearing the exercise first makes the next take practice-only.' : undefined}
          >
            <span className="sr-btn-icon sr-btn-icon--sound" aria-hidden="true">♪</span>
            {listening ? 'Stop playback' : 'Hear score'}
          </button>
        </div>

        <div className="sr-transport-settings">
          <label className="sr-field sr-field--slider">
            <span>Tempo <b>{score.tempo}</b></span>
            <input
              type="range" min="30" max="180" step="2" value={score.tempo}
              onChange={(e) => onSettings({ tempoOverride: Number(e.target.value) })}
              disabled={busy}
            />
          </label>
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
      </div>

      <details className="sr-device-panel">
        <summary>
          <span>Sound & keyboard</span>
          <small>{midi.status === 'connected' ? `MIDI: ${midi.inputs.join(', ') || 'connected'}` : soundLabel(soundState)}</small>
        </summary>
        <div className="sr-devicebar">
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
        />
      )}
    </div>
  );
}

function ResultPanel({ result, onAgain, onNext, onRepair, tempo, repeat, assisted, curtain }) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const timing = result.meanSignedTiming;
  const rec = result.recovery;
  const coach = coachingFor(result);
  const tone = result.score >= 88 ? 'good' : result.score >= 65 ? 'steady' : 'rebuild';
  const repairTempo = suggestedRepairTempo(result, tempo);
  const shouldRepair = result.score < 88;
  return (
    <section className="sr-result" aria-live="polite">
      <div className="sr-result-score">
        <div className={`sr-bigscore is-${tone}`}>{result.score}</div>
        <div className="sr-bigscore-label">out of 100</div>
      </div>
      <div className="sr-result-coach">
        <span className="sr-eyebrow">Next best move</span>
        <strong>{coach.title}</strong>
        <p>{coach.detail}</p>
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
          detail={timing == null ? '' : timing > 0.02 ? 'you tend to drag' : timing < -0.02 ? 'you tend to rush' : 'dead centre'}
        />
        <Metric label="Recovery" value={recoveryValue(rec)} detail={recoveryDetail(rec)} />
      </div>
      <TimingStrip result={result} />
      <div className="sr-result-actions">
        {shouldRepair ? (
          <>
            <button
              type="button" className="sr-btn sr-btn--primary"
              onClick={() => repairTempo < tempo ? onRepair(repairTempo) : onAgain()}
            >Repair at {repairTempo} bpm</button>
            <button type="button" className="sr-btn" onClick={onNext}>New first read</button>
          </>
        ) : (
          <>
            <button type="button" className="sr-btn sr-btn--primary" onClick={onNext}>New first read</button>
            <button type="button" className="sr-btn" onClick={onAgain}>Repeat for fluency</button>
          </>
        )}
      </div>
      {(repeat || assisted || curtain.beats !== null) && (
        <p className="sr-result-note">
          {curtain.beats !== null
            ? `Vanishing-notes take (${curtain.label}) — tracked under reading ahead, and it does not move your skill map or level.`
            : assisted
              ? 'Assisted practice — hearing the exercise first or using guide keys counts at half weight and cannot advance your level.'
              : 'Replay of music you have already seen, so it counts at half weight and cannot advance your level.'}
        </p>
      )}
    </section>
  );
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

/** Keep the same notation, but lower the tempo enough to preserve continuity. */
function suggestedRepairTempo(result, tempo) {
  let factor = 1;
  if (result.continuity < 0.78 || result.score < 60) factor = 0.8;
  else if (result.rhythmAccuracy < 0.78 || result.score < 78) factor = 0.9;
  return Math.max(30, Math.round((tempo * factor) / 2) * 2);
}

function coachingFor(result) {
  if (result.score >= 92 && result.continuity >= 0.95) {
    return { title: 'Move on while it is still new.', detail: 'The read was accurate and continuous. A new exercise will give you better evidence than polishing this one.' };
  }
  if (result.continuity < 0.78) {
    return { title: 'Protect the pulse after a slip.', detail: 'Do not correct backward. Drop the missed note, find the next beat, and re-enter while the metronome keeps moving.' };
  }
  if (result.pitchAccuracy + 0.08 < result.rhythmAccuracy) {
    return { title: 'Scan the notes before you retry.', detail: 'Pitch recognition is the limiter. Mark the widest leap and any accidentals, then try once more 8–12 bpm slower.' };
  }
  if (result.rhythmAccuracy + 0.08 < result.pitchAccuracy) {
    return { title: 'Keep the notes; simplify the pulse.', detail: 'Pitch is secure, but attacks drifted. Tap the smallest subdivision once, keep the metronome on, and retry slower.' };
  }
  if (result.meanSignedTiming != null && result.meanSignedTiming > 0.055) {
    return { title: 'Read one beat farther ahead.', detail: 'You consistently landed late. Look at the next beat while your hands finish the current one.' };
  }
  if (result.meanSignedTiming != null && result.meanSignedTiming < -0.055) {
    return { title: 'Let the count-in set the ceiling.', detail: 'You consistently rushed. Feel the full space between clicks before starting the next note.' };
  }
  return { title: result.score >= 80 ? 'Take the win and read something new.' : 'Retry once, slightly slower.', detail: result.score >= 80
    ? 'The skills are balanced enough that fresh music is the most useful next test.'
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
