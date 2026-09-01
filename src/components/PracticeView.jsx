import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Score from './Score.jsx';
import Keyboard from './Keyboard.jsx';
import TimingStrip from './TimingStrip.jsx';
import { createGrader } from '../core/grader.js';
import { TPQ, keyLabel } from '../core/theory.js';
import { audioContext, now, playPianoNote, scheduleCountIn, startPlayback } from '../core/audio.js';
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
}) {
  const [phase, setPhase] = useState('idle'); // idle | countin | playing | done
  const [noteStates, setNoteStates] = useState({});
  const [tick, setTick] = useState(-1);
  const [result, setResult] = useState(null);
  const [held, setHeld] = useState(() => new Set());
  const [listening, setListening] = useState(false);
  const [dueNow, setDueNow] = useState(() => new Set());

  const graderRef = useRef(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const frameRef = useRef(null);
  const phaseRef = useRef('idle');
  const modeRef = useRef('take');
  const guideRef = useRef(false);
  const playbackRef = useRef(null);
  const takeStartRef = useRef(0);
  const takeCountRef = useRef(0);

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
    setResult({ ...summary, takeIndex: takeCountRef.current });
    setPhaseBoth('done');
    onResult({
      summary,
      elapsedSec: now() - takeStartRef.current,
      takeIndex: takeCountRef.current,
      curtain: settings.curtain,
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
    const t = (now() - startRef.current) / secPerTick;
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

  useEffect(() => {
    frameRef.current = () => {
      if (advance()) rafRef.current = requestAnimationFrame(frameRef.current);
    };
  }, [advance]);

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => frameRef.current && frameRef.current());
  }, []);

  const start = useCallback(() => {
    audioContext();
    stopEverything();
    setResult(null);
    setNoteStates({});
    setDueNow(new Set());
    const startTime = scheduleCountIn(score, settings.countInBeats);
    startRef.current = startTime;
    takeStartRef.current = now();
    takeCountRef.current += 1;
    graderRef.current = createGrader(score, { startTime, toleranceScale: settings.toleranceScale });
    modeRef.current = 'take';
    setPhaseBoth('countin');
    playbackRef.current = startPlayback({
      score, startTime, metronome: settings.metronome, playScore: false, onEnd: () => {},
    });
    startLoop();
  }, [score, settings.countInBeats, settings.metronome, settings.toleranceScale, startLoop, stopEverything]);

  const stop = useCallback(() => {
    if (phaseRef.current === 'countin') {
      stopEverything();
      setPhaseBoth('idle');
      setTick(-1);
      return;
    }
    finish();
  }, [finish, stopEverything]);

  const listen = useCallback(() => {
    audioContext();
    stopEverything();
    setListening(true);
    setPhaseBoth('idle');
    const startTime = now() + 0.2;
    startRef.current = startTime;
    modeRef.current = 'listen';
    playbackRef.current = startPlayback({
      score, startTime, metronome: settings.metronome, playScore: true,
      onEnd: () => { setListening(false); cancelAnimationFrame(rafRef.current); setTick(-1); },
    });
    startLoop();
  }, [score, settings.metronome, startLoop, stopEverything]);

  useEffect(() => () => stopEverything(), [stopEverything]);

  // Fetch the engraver ahead of time so the first exercise appears promptly.
  useEffect(() => { warmUp(); }, []);

  const handleNoteOn = useCallback((midiNote) => {
    setHeld((prev) => new Set(prev).add(midiNote));
    if (settings.keySound !== false) playPianoNote(now(), midiNote, 0.6, 0.42);
    const grader = graderRef.current;
    if (!grader || (phaseRef.current !== 'playing' && phaseRef.current !== 'countin')) return;
    grader.noteOn(midiNote, now());
    setNoteStates(grader.states());
  }, [settings.keySound]);

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


  const countdown = phase === 'countin'
    ? Math.max(1, Math.ceil(-tick / (score.ts.beat)) )
    : null;

  return (
    <div className="sr-practice">
      <div className="sr-scorecard">
        <div className="sr-scorehead">
          <div>
            <h2 className="sr-scoretitle">{score.title}</h2>
            <p className="sr-scoremeta">
              {keyLabel(score.key)} · {score.ts.name} · ♩= {score.tempo} · {score.measures} bars
              {level ? <> · Level {level.id} <span className="sr-dim">{level.name}</span></> : null}
            </p>
          </div>
          <div className="sr-seed" title="Every exercise has a code. Share it and the same music appears.">
            <span className="sr-seed-label">Exercise code</span>
            <code>{seedToCode(score.seed)}</code>
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
          {phase === 'countin' && (
            <div className="sr-countin" aria-live="polite">{countdown}</div>
          )}
        </div>
      </div>

      <div className="sr-transport">
        <div className="sr-transport-main">
          {phase === 'playing' || phase === 'countin' ? (
            <button type="button" className="sr-btn sr-btn--stop" onClick={stop}>Stop</button>
          ) : (
            <button type="button" className="sr-btn sr-btn--primary" onClick={start}>
              {result ? 'Play again' : 'Start take'}
            </button>
          )}
          <button type="button" className="sr-btn" onClick={listening ? stopEverything : listen} disabled={phase === 'playing'}>
            {listening ? 'Stop playback' : 'Hear it'}
          </button>
          <button type="button" className="sr-btn" onClick={onRegenerate} disabled={phase === 'playing'}>
            New exercise
          </button>
          <button type="button" className="sr-btn sr-btn--ghost" onClick={() => window.print()}>Print</button>
          <button
            type="button" className="sr-btn sr-btn--ghost"
            title="Open this exercise in MuseScore, Finale or Sibelius"
            onClick={() => downloadMusicXml(score, settings.showFingerings)}
          >Export</button>
        </div>

        <div className="sr-transport-settings">
          <label className="sr-field sr-field--slider">
            <span>Tempo <b>{score.tempo}</b></span>
            <input
              type="range" min="30" max="180" step="2" value={score.tempo}
              onChange={(e) => onSettings({ tempoOverride: Number(e.target.value) })}
              disabled={phase === 'playing'}
            />
          </label>
          <label className="sr-toggle">
            <input type="checkbox" checked={settings.metronome} onChange={(e) => onSettings({ metronome: e.target.checked })} />
            <span>Metronome</span>
          </label>
          <label className="sr-toggle">
            <input type="checkbox" checked={settings.colourNotes} onChange={(e) => onSettings({ colourNotes: e.target.checked })} />
            <span>Colour notes</span>
          </label>
          <label className="sr-toggle">
            <input type="checkbox" checked={Boolean(settings.guideKeys)} onChange={(e) => onSettings({ guideKeys: e.target.checked })} />
            <span>Guide keys</span>
          </label>
          <label className="sr-field sr-field--select" title={curtainMode(settings.curtain).blurb}>
            <span>Look-ahead curtain</span>
            <select
              value={settings.curtain}
              onChange={(e) => onSettings({ curtain: e.target.value })}
              disabled={phase === 'playing'}
            >
              {CURTAIN_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="sr-inputbar">
        <div className={`sr-midi sr-midi--${midi.status}`}>
          <span className="sr-dot" />
          {midi.status === 'connected'
            ? <span>MIDI: {midi.inputs.join(', ') || 'connected'}</span>
            : midi.status === 'error'
              ? <span>{midi.error}</span>
              : <span>No MIDI keyboard connected</span>}
          {midi.status !== 'connected' && (
            <button type="button" className="sr-btn sr-btn--small" onClick={onConnectMidi}>Connect MIDI</button>
          )}
        </div>
        <button type="button" className="sr-btn sr-btn--small sr-btn--ghost" onClick={onToggleKeyboard}>
          {showKeyboard ? 'Hide keyboard' : 'Show keyboard'}
        </button>
      </div>

      {showKeyboard && (
        <Keyboard
          low={range[0]} high={range[1]} held={held} expected={dueNow}
          onNoteOn={handleNoteOn} onNoteOff={handleNoteOff}
          octaveBase={Math.max(48, Math.min(72, range[0] + 12))}
        />
      )}

      {result && (
        <ResultPanel
          result={result}
          onAgain={start}
          onNext={onRegenerate}
          repeat={result.takeIndex > 1}
          curtain={curtainMode(settings.curtain)}
        />
      )}
    </div>
  );
}

function ResultPanel({ result, onAgain, onNext, repeat, curtain }) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const timing = result.meanSignedTiming;
  const rec = result.recovery;
  return (
    <section className="sr-result" aria-live="polite">
      <div className="sr-result-score">
        <div className="sr-bigscore">{result.score}</div>
        <div className="sr-bigscore-label">out of 100</div>
      </div>
      <div className="sr-result-grid">
        <Metric label="Right notes" value={pct(result.pitchAccuracy)} detail={`${result.correct} of ${result.total}`} />
        <Metric
          label="In time"
          value={pct(result.rhythmAccuracy)}
          detail={
            result.timedNotes === 0 ? 'no notes landed'
              : result.timingOff ? `${result.timingOff} rushed or dragged`
                : 'steady'
          }
        />
        <Metric label="Kept going" value={pct(result.continuity)} detail={result.missed ? `${result.missed} skipped` : 'no stalls'} />
        <Metric
          label="Timing bias"
          value={timing == null ? '—' : `${timing > 0 ? '+' : ''}${Math.round(timing * 1000)} ms`}
          detail={timing == null ? '' : timing > 0.02 ? 'you tend to drag' : timing < -0.02 ? 'you tend to rush' : 'dead centre'}
        />
        <Metric label="Recovery" value={recoveryValue(rec)} detail={recoveryDetail(rec)} />
      </div>
      <TimingStrip result={result} />
      <div className="sr-result-actions">
        <button type="button" className="sr-btn sr-btn--primary" onClick={onNext}>Next exercise</button>
        <button type="button" className="sr-btn" onClick={onAgain}>Try this one again</button>
      </div>
      {(repeat || curtain.beats !== null) && (
        <p className="sr-result-note">
          {curtain.beats !== null
            ? `Curtain take (${curtain.label}) — tracked under look-ahead, and it does not move your skill map or level.`
            : 'Replay of music you have already seen, so it counts at half weight and cannot advance your level.'}
        </p>
      )}
    </section>
  );
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
