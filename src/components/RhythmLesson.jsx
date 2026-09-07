import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assessRhythm, rhythmEvidence, rhythmNoteId, rhythmPattern, rhythmScore } from '../core/adventure.js';
import { xmlNoteId } from '../core/musicxml.js';
import { renderScoreSvg } from '../core/verovio.js';
import { now, playClick, playPianoNote, unlockAudio } from '../core/audio.js';

export default function RhythmLesson({ level, midi, onComplete, onEvidence }) {
  const [variation, setVariation] = useState(0);
  const [tempo, setTempo] = useState(60);
  const [phase, setPhase] = useState('ready');
  const [position, setPosition] = useState(-4);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('Read the two bars first. Tap each note start and count through the longer values and rests.');
  const events = useMemo(() => rhythmPattern(level, variation), [level, variation]);
  const run = useRef(null);
  const frame = useRef(null);
  const request = useRef(0);
  const cancel = useCallback(() => {
    request.current++;
    cancelAnimationFrame(frame.current);
    run.current?.sounds.forEach((gain) => { try { gain?.disconnect(); } catch { /* already released */ } });
    run.current = null;
  }, []);
  useEffect(() => () => cancel(), [cancel]);
  const tap = useCallback(() => {
    const active = run.current;
    if (!active) return;
    const time = now() - active.start;
    if (time < -.25 || time > 8 * active.beat + .25) return;
    active.taps.push(time);
    playPianoNote(now(), 64, .18, .35);
  }, []);
  useEffect(() => {
    const key = (event) => { if (run.current && !event.defaultPrevented && event.code === 'Space' && !event.repeat && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) { event.preventDefault(); tap(); } };
    const hidden = () => { if (document.hidden && run.current) { cancel(); setPhase('ready'); setMessage('Practice paused while the page was hidden. Start again when you are ready.'); } };
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', hidden);
    const unsubscribe = midi?.subscribe?.((event) => { if (event.type === 'on') tap(); });
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', hidden); unsubscribe?.(); };
  }, [cancel, midi, tap]);
  const start = async () => {
    if (run.current || phase === 'starting') return;
    setPhase('starting'); setResult(null);
    const ticket = ++request.current;
    try {
      const available = await unlockAudio();
      if (ticket !== request.current) return;
      if (!available) { setPhase('ready'); setMessage('Sound could not start. Check your audio, then try again.'); return; }
      const beat = 60 / tempo, start = now() + .18 + 4 * beat;
      const sounds = [];
      for (let i = -4; i < 8; i++) sounds.push(playClick(start + i * beat, i % 4 === 0));
      run.current = { start, beat, taps: [], sounds };
      setPhase('countin');
      const tick = () => {
        const active = run.current;
        if (!active) return;
        const elapsed = now() - active.start;
        setPosition(elapsed / beat);
        if (elapsed >= 0) setPhase('playing');
        if (elapsed >= 8 * beat + .25) {
          const outcome = assessRhythm(events, active.taps, beat);
          setResult(outcome); setPhase('done');
          setMessage(outcome.passed ? 'A steady reading. Take that same pulse into the fresh piece.' : outcome.extras ? 'Some taps landed between the written attacks. Count through long notes and rests without adding a tap.' : 'Some note starts missed the pulse. Try a slower tempo and keep counting between attacks.');
          // Every attempt is a measured observation of a pulse, passed or not.
          onEvidence?.(rhythmEvidence(events, outcome));
          if (outcome.passed) onComplete();
          cancel(); return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch { if (ticket === request.current) { cancel(); setPhase('ready'); setMessage('Audio is unavailable. Check your sound settings and try again.'); } }
  };
  const active = phase === 'countin' || phase === 'playing' || phase === 'starting';
  return <section className="pv-rhythm-lesson" aria-label="One-note rhythm reading">
    <span className="pv-lesson-kicker">02 / RHYTHM READING</span><h2>One note. A steady pulse.</h2><p>Tap the written rhythm on one piano key, the pad below, or Space. Pitch and hold length are not scored in this exercise.</p>
    <RhythmNotation events={events} position={phase === 'playing' ? position : null} />
    <div className="pv-rhythm-control"><label>Tempo <select value={tempo} disabled={active} onChange={e=>setTempo(Number(e.target.value))}>{[40,50,60,70,80].map(t=><option value={t} key={t}>{t} bpm</option>)}</select></label>
      <button type="button" className="pv-world-primary" disabled={phase === 'starting'} onClick={() => { if (active) { cancel(); setPhase('ready'); setMessage('Stopped. Your reading progress has not changed.'); } else void start(); }}>{active ? 'Stop' : result ? 'Read it again' : 'Count me in'}</button>
      <button type="button" disabled={active} onClick={() => { setVariation(v=>v+1); setResult(null); setPhase('ready'); setMessage('New rhythm. Look over both bars before starting.'); }}>New rhythm</button></div>
    <button type="button" className={`pv-rhythm-pad${phase === 'playing' ? ' is-active' : ''}`} disabled={!active || phase === 'starting'}
      onPointerDown={(e) => { e.preventDefault(); tap(); }} onClick={(e) => { if (e.detail === 0) tap(); }} onKeyDown={(e)=>{if(e.code==='Space'){e.preventDefault();if(!e.repeat)tap();}}}>
      {phase === 'countin' ? `Count in · ${Math.max(1,Math.min(4,Math.ceil(-position)))}` : phase === 'playing' ? 'Tap the rhythm' : 'One-key practice'}<small>{midi?.status === 'connected' ? 'MIDI ready · any one key' : 'Touch · Space · or a connected MIDI key'}</small></button>
    <p className="pv-rhythm-feedback" role="status">{message}{result && <span>{result.correct}/{result.total} note starts in time{result.extras ? ` · ${result.extras} extra taps` : ''}. {result.passed ? 'Rhythm study complete.' : 'Try again when ready.'}</span>}</p>
  </section>;
}

/**
 * The rhythm, engraved.
 *
 * Rendered through the same MusicXML and the same engraver as the studies, so
 * a reader meets one set of shapes throughout. The note being read is
 * highlighted rather than swept by a line, which is what the score itself does
 * and is more use than a moving cursor.
 */
function RhythmNotation({ events, position }) {
  const host = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const node = host.current;
    node.dataset.state = 'loading';
    renderScoreSvg(rhythmScore(events), { layout: 'scroll', pageWidth: 1800 })
      .then((svg) => {
        if (cancelled || !host.current) return;
        host.current.innerHTML = svg || '';
        host.current.dataset.state = svg ? 'ready' : 'error';
      })
      .catch(() => { if (!cancelled && host.current) host.current.dataset.state = 'error'; });
    return () => { cancelled = true; };
  }, [events]);

  useEffect(() => {
    const node = host.current;
    if (!node || node.dataset.state !== 'ready') return;
    for (const element of node.querySelectorAll('.is-reading')) element.classList.remove('is-reading');
    if (position == null) return;
    const current = rhythmNoteId(events, position);
    if (!current) return;
    node.querySelector(`[id="${xmlNoteId('rh', current.onset, current.midi)}"]`)?.classList.add('is-reading');
  }, [events, position]);

  const spoken = events.map((event) => `${event.rest ? 'rest' : 'note'} ${event.duration} beats`).join(', ');
  return (
    <div className="pv-rhythm-paper">
      <div
        className="pv-rhythm-engraving" ref={host} data-state="loading"
        role="img" aria-label={`Two bars in four-four on one pitch: ${spoken}`}
      />
      <p className="pv-rhythm-placeholder">Engraving the rhythm…</p>
      <p className="pv-rhythm-fallback">
        The rhythm could not be engraved. Two bars in four-four: {spoken}.
      </p>
    </div>
  );
}
