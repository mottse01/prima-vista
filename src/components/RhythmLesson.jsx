import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assessRhythm, rhythmPattern } from '../core/adventure.js';
import { now, playClick, playPianoNote, unlockAudio } from '../core/audio.js';

export default function RhythmLesson({ level, midi, onComplete }) {
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

function RhythmNotation({ events, position }) {
  return <div className="pv-rhythm-paper"><svg viewBox="0 0 800 145" role="img" aria-label={`Two bars in four-four: ${events.map(e=>`${e.rest ? 'rest' : 'note'} ${e.duration} beats`).join(', ')}`}>
    <line x1="70" x2="775" y1="82" y2="82" stroke="currentColor" strokeWidth="1.4"/>
    <text x="27" y="80" fill="currentColor" fontSize="25" fontFamily="serif">4</text><text x="27" y="102" fill="currentColor" fontSize="25" fontFamily="serif">4</text>
    {[0,4,8].map(b=><line key={b} x1={80+b*85} x2={80+b*85} y1="58" y2="99" stroke="currentColor" strokeWidth="1.5"/>)}
    {events.map((e,i)=>{const x=98+e.beat*82;const dotted=e.duration===1.5;const flags=e.duration===.25?2:e.duration===.5?1:0;return <g key={i}>
      {e.rest ? <text x={x-9} y="91" fill="currentColor" fontSize="40" fontFamily="serif">𝄽</text> : <><ellipse cx={x} cy="82" rx="9" ry="6" transform={`rotate(-20 ${x} 82)`} fill={e.duration===2?'white':'currentColor'} stroke="currentColor" strokeWidth="2"/><line x1={x+8} x2={x+8} y1="81" y2="34" stroke="currentColor" strokeWidth="2"/>{Array.from({length:flags},(_,f)=><path key={f} d={`M${x+8},${34+f*9} Q${x+30},${46+f*9} ${x+19},${61+f*9}`} fill="none" stroke="currentColor" strokeWidth="3"/>)}{dotted&&<circle cx={x+18} cy="76" r="3"/>}</>}
      <text x={x} y="127" textAnchor="middle" fill="#637472" fontSize="13">{e.beat%1===0 ? (e.beat%4)+1 : ''}</text>
    </g>;})}
    {position!==null&&<line x1={98+Math.min(8,Math.max(0,position))*82} x2={98+Math.min(8,Math.max(0,position))*82} y1="20" y2="104" stroke="#27867c" strokeWidth="2"/>}
  </svg></div>;
}
