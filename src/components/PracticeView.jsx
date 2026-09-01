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
import { CURTAIN_MODES, curtainMode, curtainOffsetTicks } from '../core/curtain.js';

/**
 * One take of one exercise. App remounts this whenever the exercise changes,
 * which is what resets the transport, the colouring and the last result.
 */
export default function PracticeView({
  score, settings, onSettings, onResult, onRegenerate, level,
  midi, onConnectMidi, showKeyboard, onToggleKeyboard,
  freshRead, strongReads = 0, showCoach, onDismissCoach, onPreview, onNotify,
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

  const secPerTick = 60 / score.tempo / TPQ;

  const setPhaseBoth = (p) => { phaseRef.current = p; setPhase(p); };

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (playbackRef.current) { playbackRef.current.stop(); playbackRef.current = null; }
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
  }, [finish, freshRead, prepareSound, previewed, score, settings.countInBeats, settings.guideKeys, settings.metronome, settings.toleranceScale, startLoop, stopEverything]);

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

  // Fetch the engraver ahead of time so the first exercise appears promptly.
  useEffect(() => { warmUp(); }, []);

  const handleNoteOn = useCallback((midiNote) => {
    setHeld((prev) => new Set(prev).add(midiNote));
    if (settings.keySound !== false) {
      if (audioState() === 'running') playPianoNote(now(), midiNote, 0.6, 0.48);
      else unlockAudio().then((ready) => { if (ready) playPianoNote(now(), midiNote, 0.6, 0.48); });
    }
    const grader = graderRef.current;
    if (!grader || (phaseRef.current !== 'playing' && phaseRef.current !== 'countin')) return;
    grader.noteOn(midiNote, clockRef.current());
    setNoteStates(grader.states());
  }, [settings.keySound]);

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

  // Not during the count-in (you are meant to read the opening bar then), not
  // during reference playback, and never once the take is over — the review is
  // the point.
  const curtainOffset = curtainOffsetTicks(settings.curtain, score.ts);
  const curtainTick = phase === 'playing' && tick >= 0 && curtainOffset !== null
    ? tick + curtainOffset
    : null;

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

  const busy = phase === 'playing' || phase === 'countin' || listening || audioBusy;
  const qualifies = freshRead && !previewed && !settings.guideKeys && settings.curtain === 'off';
  const targetedIds = score.params.targeted || [];
  const focusIds = targetedIds.length ? targetedIds : (level?.focus || []);
  const focusLabels = focusIds
    .map((id) => SKILLS.find((skill) => skill.id === id)?.label)
    .filter(Boolean)
    .slice(0, 3);

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
      {showCoach && (
        <section className="sr-coach" aria-labelledby="first-read-title">
          <div className="sr-coach-copy">
            <span className="sr-eyebrow">First read</span>
            <h2 id="first-read-title">Scan. Count in. Keep moving.</h2>
          </div>
          <p>Check the key and metre, choose a sustainable pulse, and recover forward after a slip.</p>
          <div className="sr-coach-actions">
            <button type="button" className="sr-coach-dismiss" onClick={onDismissCoach}>Dismiss tips</button>
          </div>
        </section>
      )}

      <section className="sr-readbrief" aria-label="Practice plan">
        <div className="sr-readbrief-item">
          <span className={`sr-statuspill${qualifies ? ' is-fresh' : ' is-practice'}`}>
            {settings.curtain !== 'off' ? 'Look-ahead drill' : qualifies ? 'Fresh read' : 'Practice take'}
          </span>
          <span>
            {settings.curtain !== 'off'
              ? 'Tracked separately'
              : qualifies
                ? 'Qualifies for your path'
                : 'Practice only'}
          </span>
        </div>
        <div className="sr-readbrief-item">
          <span className="sr-readbrief-label">Focus</span>
          <strong>{focusLabels.length ? focusLabels.join(' · ') : 'Build a clean baseline'}</strong>
        </div>
        {level && (
          <div className="sr-readbrief-item sr-readbrief-goal">
            <span className="sr-readbrief-label">Path</span>
            <strong>{strongReads}/2 fresh reads at 88+</strong>
          </div>
        )}
      </section>

      <div className="sr-scorecard">
        <div className="sr-scorehead">
          <div className="sr-scoreidentity">
            <div className="sr-scorekicker">
              <span>Original structured study</span>
              {score.style?.label && (
                <span className="sr-stylebadge" title={score.style.description}>{score.style.label}</span>
              )}
              {score.form?.label && (
                <span className="sr-formbadge">{score.form.name || 'Form'} · {score.form.label}</span>
              )}
              {score.harmony?.roman && (
                <span
                  className="sr-harmonybadge"
                  title={`${score.harmony.name}; closes ${score.harmony.cadence}`}
                >{score.harmony.name} · {score.harmony.roman}</span>
              )}
              {score.harmony?.cadencePlan && (
                <span
                  className="sr-cadencebadge"
                  title={score.harmony.cadences.map((item) => `${item.short}: ${item.name} (${item.roman})`).join(' → ')}
                >Cadences {score.harmony.cadencePlan}</span>
              )}
              {score.compositionReview && (
                <span
                  className={`sr-reviewbadge${score.compositionReview.passed ? ' is-passed' : ''}`}
                  title={`Composition review ${score.compositionReview.score}/100; best of ${score.compositionReview.candidates} candidates`}
                >Composition checked</span>
              )}
            </div>
            <h2 className="sr-scoretitle">{score.title}</h2>
            <p className="sr-scoremeta">
              {keyLabel(score.key)} · {score.ts.name} · ♩= {score.tempo} · {score.measures} bars
              {level ? <> · Level {level.id} <span className="sr-dim">{level.name}</span></> : null}
            </p>
          </div>
          <div className="sr-seed" title="The short seed replays this variation with the same setup. The copied link includes the full setup.">
            <span className="sr-seed-label">Exercise ID</span>
            <div className="sr-seed-row">
              <code>{seedToCode(score.seed)}</code>
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
            curtainTick={curtainTick}
          />
          {countdown != null && (
            <div className="sr-countin" aria-live="polite">{countdown}</div>
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
            type="button" className="sr-btn" onClick={listening ? stopReference : listen}
            onPointerDown={primeAudioGesture}
            disabled={busy && !listening}
            title={freshRead && !previewed ? 'Hearing the exercise first makes the next take practice-only.' : undefined}
          >
            <span className="sr-btn-icon sr-btn-icon--sound" aria-hidden="true">♪</span>
            {listening ? 'Stop playback' : freshRead && !previewed ? 'Hear the score' : 'Hear it'}
          </button>
          <button type="button" className="sr-btn" onClick={onRegenerate} disabled={busy}>
            New study
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
              <label className="sr-field sr-field--select" title={curtainMode(settings.curtain).blurb}>
                <span>Look-ahead curtain</span>
                <select value={settings.curtain} onChange={(e) => onSettings({ curtain: e.target.value })} disabled={busy}>
                  {CURTAIN_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
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
            </div>
          </details>
        </div>
      </div>

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
            ? `Curtain take (${curtain.label}) — tracked under look-ahead, and it does not move your skill map or level.`
            : assisted
              ? 'Assisted practice — hearing the exercise first or using guide keys counts at half weight and cannot advance your level.'
              : 'Replay of music you have already seen, so it counts at half weight and cannot advance your level.'}
        </p>
      )}
    </section>
  );
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
