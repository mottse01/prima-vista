import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { completePuzzle, loadAdventure, LOCATIONS, NOTE_NAMES, roomComplete, roomState, saveAdventure, travel, toggleCircuit, receiveTone, pianoRelaySolved } from '../core/adventure.js';
import { now, playPianoNote, unlockAudio } from '../core/audio.js';
const AdventureScene = lazy(() => import('./AdventureScene.jsx'));

function RoomDialog({ children, onClose, title, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`pv-room-dialog ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <button type="button" className="pv-room-close" onClick={onClose} aria-label={`Close ${title}`}>×</button>{children}
  </dialog>;
}

export default function AdventureView({ practice, onPrepareMusic, registerResult, onTools, level }) {
  const [adventure, setAdventure] = useState(loadAdventure);
  const room = roomState(adventure);
  const location = LOCATIONS[adventure.current];
  const [view, setView] = useState({ id: 'room' });
  const [switches, setSwitches] = useState([false, false, false]);
  const [signal, setSignal] = useState([]);
  const [target, setTarget] = useState(null);
  const [menu, setMenu] = useState(false);
  const [intro, setIntro] = useState(true);
  const [terminal, setTerminal] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [hint, setHint] = useState(false);
  const [notice, setNotice] = useState('');
  const [storageOk, setStorageOk] = useState(true);
  const [ending, setEnding] = useState(false);
  const interactRef = useRef(null);
  const [acousticComplete, setAcousticComplete] = useState(false);
  const move = (id) => { setView({ id }); setHint(false); setNotice(''); };
  const solve = useCallback((id) => setAdventure((current) => completePuzzle(current, id)), []);
  useEffect(() => { if (!saveAdventure(adventure)) window.setTimeout(() => setStorageOk(false), 0); }, [adventure]);
  useEffect(() => {
    registerResult((summary) => {
      if (terminal && summary.unscored) { setAcousticComplete(true); return; }
      if (!terminal || summary.valid === false || summary.assessmentEligible === false) return;
      if (pianoRelaySolved(summary)) { solve('music'); setNotice('Transmission restored. The airlock is ready.'); }
      else setNotice('The relay heard you. Reach 70 to restore the transmission; you can rehearse or slow down.');
    });
    return () => registerResult(null);
  }, [registerResult, solve, terminal]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !terminal && !intro && !ending) setMenu((open) => !open); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [terminal, intro, ending]);
  const openConsole = () => {
    if (!room.signal) { setNotice('The piano has no signal. Restore power, then decode the receiver.'); return; }
    onPrepareMusic(); setAcousticComplete(false); setTerminal(true); setNotice('');
  };
  const interact = (id) => {
    if (id.startsWith('power-')) {
      if (room.power) { setNotice('Power is already stable. Check the receiver on the other side of the room.'); return; }
      const index = Number(id.split('-')[1]);
      const next = toggleCircuit(switches, index);
      setSwitches(next); setView({ id: 'power' });
      if (next.every((value, i) => value === location.power[i])) { solve('power'); setNotice('Power restored. The receiver is awake.'); }
      else setNotice('The switches share circuits. Match the three upper indicators.');
    } else if (id.startsWith('note-')) {
      if (!room.power) { setNotice('The receiver needs power. Inspect the routing board first.'); return; }
      if (room.signal) { setNotice('Signal decoded. The piano console is ready.'); return; }
      const note = Number(id.split('-')[1]);
      void unlockAudio().then(() => playPianoNote(now(), note, .55, .5)).catch(() => {});
      const response = receiveTone(location.clue, signal, note);
      const next = response.notes; setView({ id: 'signal' });
      if (!next.length) { setSignal([]); setNotice('The receiver reset. Read the signature from left to right and try again.'); }
      else if (response.matched) { setSignal(next); solve('signal'); setNotice('Signature recognized. The piano console is receiving.'); }
      else { setSignal(next); setNotice(`Tone ${next.length} received.`); }
    } else if (id === 'piano') { move('piano'); openConsole(); }
    else if (id === 'exit') {
      move('exit');
      if (!roomComplete(adventure)) setNotice('The airlock is sealed. Restore power, decode the signal, and play the piano relay first.');
      else if (adventure.current === LOCATIONS.length - 1) setEnding(true);
      else {
        setAdventure(travel); setSwitches([false, false, false]); setSignal([]); setView({ id: 'room' }); setTarget(null); setIntro(true);
      }
    }
  };
  useEffect(() => { interactRef.current = interact; });
  const onInteract = useCallback((id) => interactRef.current?.(id), []);
  const onUnavailable = useCallback(() => setFallback(true), []);
  const active = view.id;
  const status = !room.power ? 'Restore the room’s power' : !room.signal ? 'Decode the receiver signature' : !room.music ? 'Restore the piano transmission' : 'The airlock is open';
  return <div className={`pv-adventure${terminal ? ' is-terminal' : ''}`}>
    <Suspense fallback={<div className="pv-world-loading">Entering {location.subtitle}…</div>}>
      <AdventureScene location={location} room={room} switches={room.power ? location.power : switches}
        onInteract={onInteract} onTarget={setTarget} view={view} paused={intro || menu || terminal || ending} onUnavailable={onUnavailable} />
    </Suspense>
    <div className="pv-world-shade" aria-hidden="true" />
    <header className="pv-world-hud">
      <div><span>PRIMA VISTA / {String(adventure.current + 1).padStart(2, '0')}</span><h1>{location.subtitle}</h1><p>{location.place} · {location.name}</p></div>
      <button type="button" className="pv-hud-button" onClick={() => setMenu(true)} aria-label="Pause and open menu">Ⅱ <span>Menu</span></button>
    </header>
    {!terminal && <>
      <div className="pv-world-objective"><span className="pv-objective-line" />{status}<small>{Object.values(room).filter(Boolean).length}/3 systems restored</small></div>
      {!fallback && <div className={`pv-crosshair${target ? ' is-target' : ''}`} aria-hidden="true">{target ? '◉' : '+'}</div>}
      {target && !intro && !menu && <button type="button" className="pv-interact" onClick={() => interact(target.id)}><kbd>E</kbd>{target.label}</button>}
      {fallback && <div className="pv-world-fallback"><p>The station is in navigation mode on this device.</p><p>Use the station controls below to inspect and solve every system.</p></div>}
      <div className="pv-world-bottom">
        <div className="pv-world-notice" role="status">{notice || (active === 'room' ? 'Drag to look around. Walk with W A S D, or choose a station below.' : '')}</div>
        {active === 'power' && <section className="pv-instrument" aria-label="Power routing controls"><div><small>POWER ROUTING</small><h2>{room.power ? 'Power stabilized' : 'Restore the circuit'}</h2><p>Match this pattern: {location.power.map((on, i) => <span className={`pv-lamp${on ? ' is-on' : ''}`} key={i} aria-label={`light ${i+1} ${on ? 'on' : 'off'}`}>{on ? '●' : '○'}</span>)}</p></div>
          <div className="pv-instrument-controls">{switches.map((on, i) => <button type="button" key={i} disabled={room.power} aria-pressed={room.power ? location.power[i] : on} onClick={() => interact(`power-${i}`)}>{i + 1}<span>{(room.power ? location.power[i] : on) ? 'ON' : 'OFF'}</span></button>)}</div></section>}
        {active === 'signal' && <section className="pv-instrument" aria-label="Signal receiver"><div><small>RECEIVER SIGNATURE</small><h2>{room.signal ? 'Signal recognized' : 'Play the inscription'}</h2><Signature notes={location.clue} hint={hint} /></div><div className="pv-instrument-controls pv-note-controls">{Object.entries(NOTE_NAMES).map(([note, name]) => <button type="button" key={note} disabled={!room.power || room.signal} onClick={() => interact(`note-${note}`)}>{name}</button>)}<p>{room.signal ? '3 / 3 tones received' : `${signal.length} / 3 tones received`}</p></div></section>}
        {active === 'piano' && <section className="pv-instrument"><div><small>HARMONIC RELAY</small><h2>{room.music ? 'Transmission restored' : 'The room is waiting for a song'}</h2><p>{room.signal ? `Read the score at your level (${level}). Reach 70 to restore the relay. Rehearsal is welcome.` : 'The receiver must be online first.'}</p></div><button type="button" className="pv-world-primary" disabled={!room.signal} onClick={openConsole}>Use piano console →</button></section>}
        {active === 'exit' && <section className="pv-instrument"><div><small>AIRLOCK CONTROL</small><h2>{roomComplete(adventure) ? 'You can leave now.' : 'Three systems. One way forward.'}</h2><p>{roomComplete(adventure) ? adventure.current === 9 ? 'Send the final signal home.' : `Next: ${LOCATIONS[adventure.current+1].subtitle}` : status}</p></div><button type="button" className="pv-world-primary" disabled={!roomComplete(adventure)} onClick={() => interact('exit')}>{adventure.current === 9 ? 'Send signal' : 'Leave this location'} →</button></section>}
        {hint && active === 'power' && <p className="pv-world-hint">Switch 1 flips lights 1 and 2. Switch 2 flips lights 2 and 3. Switch 3 flips only light 3. Work from left to right.</p>}
        {hint && active !== 'power' && active !== 'signal' && <p className="pv-world-hint">Restore the power board on the left, play the receiver’s three-note signature on the right, then use the piano in the centre.</p>}
        <nav className="pv-station-nav" aria-label="Move to a station">
          {[['room','Look around'],['power', room.power ? '✓ Power' : 'Power board'],['signal',room.signal ? '✓ Receiver' : 'Receiver'],['piano',room.music ? '✓ Piano' : 'Piano console'],['exit','Airlock']].map(([id,label]) => <button type="button" key={id} aria-current={active === id ? 'location' : undefined} onClick={() => move(id)}>{label}</button>)}
          <button type="button" aria-pressed={hint} onClick={() => setHint(!hint)}>Hint</button>
        </nav>
      </div>
    </>}
    {intro && <RoomDialog title="Arrival" onClose={() => setIntro(false)} className="pv-arrival"><span>INCOMING TRANSMISSION · {location.place.toUpperCase()}</span><h2>{location.name}</h2><p>{location.story}</p><p className="pv-arrival-instruction">Inspect the room. Restore its three systems. The airlock opens when your work here is done.</p><button type="button" className="pv-world-primary" onClick={() => setIntro(false)}>Enter the room →</button></RoomDialog>}
    {menu && <RoomDialog title="Expedition menu" onClose={() => setMenu(false)}><span>EXPEDITION PAUSED</span><h2>{location.subtitle}</h2><p>Your location progress is saved in this browser.</p>{!storageOk && <p>Saving is unavailable. Keep this tab open to retain this session.</p>}<div className="pv-pause-actions"><button type="button" onClick={() => setMenu(false)}>Resume exploring</button><button type="button" onClick={() => { setMenu(false); onTools('practice'); }}>Practice & piano settings</button><button type="button" onClick={() => { setMenu(false); onTools('progress'); }}>Reading progress</button><button type="button" onClick={() => { setMenu(false); onTools('custom'); }}>Build an exercise</button><button type="button" onClick={() => { setMenu(false); onTools('expedition'); }}>Musical expedition map</button></div><p className="pv-menu-help">Drag to look · W A S D to walk · arrows to turn and walk · E to interact. Station buttons work with touch and keyboard.</p></RoomDialog>}
    {terminal && <div className="pv-console-overlay"><div className="pv-console-top"><span>HARMONIC RELAY / {location.place.toUpperCase()}</span><button type="button" onClick={() => setTerminal(false)}>Return to room ↗</button></div><p className="pv-console-purpose" role="status">{room.music ? 'Transmission restored. Return to the room and leave through the airlock.' : 'Play this score to restore the transmission. Reach 70; repeats and practice aids are welcome. First-read assessment stays separate.'}</p>{practice}{acousticComplete && !room.music && <section className="pv-acoustic-confirm"><p>Acoustic playing is not scored. You can confirm that you played the inscription to continue the story; this awards no reading score or level progress.</p><button type="button" className="pv-world-primary" onClick={() => solve('music')}>I played the score — restore the relay</button></section>}</div>}
    {ending && <RoomDialog title="Expedition complete" onClose={() => setEnding(false)}><span>TRANSMISSION RECEIVED</span><h2>Someone is listening.</h2><p>Your music has crossed the entire system. Every room is awake again.</p><button type="button" className="pv-world-primary" onClick={() => { setEnding(false); onTools('progress'); }}>Open your reading journal →</button></RoomDialog>}
  </div>;
}

function Signature({ notes, hint }) {
  const ys = {60: 65, 62: 61.5, 64: 58, 65: 54.5, 67: 51};
  return <div className="pv-signature"><svg viewBox="0 0 230 105" role="img" aria-label={hint ? `Treble clef: ${notes.map(n=>NOTE_NAMES[n]).join(', ')}` : 'Treble-clef signature. Read the three notes from left to right, or use Hint for note names.'}>
    {[30,37,44,51,58].map(y=><line key={y} x1="8" y1={y} x2="222" y2={y} stroke="currentColor" strokeWidth="1"/>)}
    <text x="14" y="60" fontSize="48" fill="currentColor">𝄞</text>
    {notes.map((note,i)=><g key={i}>{note===60 && <line x1={65+i*55} y1="65" x2={85+i*55} y2="65" stroke="currentColor"/>}<ellipse cx={75+i*55} cy={ys[note]} rx="7" ry="5" fill="currentColor" transform={`rotate(-15 ${75+i*55} ${ys[note]})`}/><line x1={81+i*55} y1={ys[note]} x2={81+i*55} y2={ys[note]-26} stroke="currentColor" strokeWidth="1.4"/>{hint && <text x={75+i*55} y="99" textAnchor="middle" fill="currentColor" fontSize="15">{NOTE_NAMES[note]}</text>}</g>)}
  </svg></div>;
}
