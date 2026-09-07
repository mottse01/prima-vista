import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { completePuzzle, loadAdventure, LOCATIONS, locationFor, roomState, saveAdventure, pianoRelaySolved, readingLesson } from '../core/adventure.js';
import RhythmLesson from './RhythmLesson.jsx';
const AdventureScene = lazy(() => import('./AdventureScene.jsx'));

function RoomDialog({ children, onClose, title, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`pv-room-dialog ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <button type="button" className="pv-room-close" onClick={onClose} aria-label={`Close ${title}`}>×</button>{children}
  </dialog>;
}

export default function AdventureView({
  practice, onPrepareMusic, registerResult, onTools, onTravel, onRhythmEvidence, level, midi, routeOpen, routeReason, mission,
}) {
  const [adventure, setAdventure] = useState(loadAdventure);
  // One position, and it is the reading level. Location N is level N, so
  // travelling in the story is changing level and there is nothing to keep in
  // step.
  const room = roomState(adventure, level);
  const location = locationFor(level);
  const lesson = readingLesson(level);
  const finalStop = level >= LOCATIONS.length;
  // Luna is where somebody finds out whether they want this at all, so the
  // piano is open from the first second and the scaffolds are offered on the
  // strength of what the reading showed. The ordered ritual starts at Mars,
  // where the reader has already chosen to be on the journey.
  const guided = level > 1;
  const [view, setView] = useState({ id: 'room' });
  const [target, setTarget] = useState(null);
  const [menu, setMenu] = useState(false);
  const [intro, setIntro] = useState(true);
  const [terminal, setTerminal] = useState(false);
  const [rhythm, setRhythm] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [hint, setHint] = useState(false);
  const [notice, setNotice] = useState('');
  const [storageOk, setStorageOk] = useState(true);
  const [ending, setEnding] = useState(false);
  const arrivedAt = useRef(level);
  const [acousticComplete, setAcousticComplete] = useState(false);
  const interactRef = useRef(null);
  const move = (id) => { setView({ id }); setHint(false); setNotice(''); };
  const solve = useCallback((id) => setAdventure((current) => completePuzzle(current, level, id)), [level]);
  useEffect(() => { if (!saveAdventure(adventure)) window.setTimeout(() => setStorageOk(false), 0); }, [adventure]);
  useEffect(() => {
    registerResult((summary) => {
      if (terminal && summary.unscored) { setAcousticComplete(summary.fresh && !summary.assisted && summary.takeIndex === 1 && summary.curtain === 'off'); setNotice('Acoustic practice is unscored. Only an independent fresh reading can be self-confirmed; choose New music after a rehearsal.'); return; }
      if (!terminal || summary.valid === false || summary.assessmentEligible === false) return;
      if (pianoRelaySolved(summary)) { solve('music'); setNotice('Fresh reading complete. A new destination is ready.'); }
      else setNotice(summary.fresh && !summary.assisted ? 'Keep the pulse and keep going. Practice the tricky part, then choose New music for your next first read.' : 'That was useful practice. Choose New music and read without a preview or guide keys to complete this location.');
    });
    return () => registerResult(null);
  }, [registerResult, solve, terminal]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !terminal && !intro && !ending && !rhythm && !menu) setMenu(true); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [terminal, intro, ending, rhythm, menu]);
  useEffect(() => {
    if (arrivedAt.current === level) return;
    arrivedAt.current = level;
    setView({ id: 'room' }); setTarget(null); setNotice(''); setIntro(true);
  }, [level]);
  const openConsole = () => {
    if (guided && !room.signal) { setNotice('First prepare with Lyra and read the one-note rhythm. Then bring those skills to the piano.'); return; }
    onPrepareMusic(); setAcousticComplete(false); setTerminal(true); setNotice('');
  };
  const interact = (id) => {
    if (id === 'mentor') move('power');
    else if (id === 'rhythm') { move('signal'); if (room.power || !guided) setRhythm(true); else setNotice('Meet Lyra at the guidance station before the rhythm study.'); }
    else if (id === 'piano') { move('piano'); openConsole(); }
    else if (id === 'exit') {
      move('exit');
      // The route is opened by the destination's own objectives, measured from
      // real readings. The room's ritual is how a visit is spent, not a second
      // gate standing beside the first.
      if (finalStop) setEnding(true);
      else if (!routeOpen) setNotice(routeReason || 'Read here a little longer to open the next destination.');
      else onTravel(level + 1);
    }
  };
  useEffect(() => { interactRef.current = interact; });
  const onInteract = useCallback((id) => interactRef.current?.(id), []);
  const onUnavailable = useCallback(() => setFallback(true), []);
  const active = view.id;
  const status = !room.power ? (guided ? 'Prepare with Lyra' : 'Read a fresh piece, or prepare with Lyra first')
    : !room.signal ? 'Read the one-note rhythm'
      : !room.music ? 'Read a fresh piano piece'
        : routeOpen ? 'Route open · travel onward' : (routeReason || 'Keep reading here');
  return <div className={`pv-adventure${terminal ? ' is-terminal' : ''}`}>
    {/* The room's own colours while its engine arrives, rather than a line of
        text on black. The 3D chunk is already off the critical path — this is
        about what the incomplete state looks like. */}
    <Suspense fallback={
      <div className="pv-world-loading" style={{ '--sky': location.sky, '--glow': location.color }}>
        <span className="pv-world-loading-mark" aria-hidden="true" />
        <p>Entering {location.subtitle}…</p>
      </div>
    }>
      <AdventureScene location={location} room={room} onInteract={onInteract} onTarget={setTarget} view={view} paused={intro || menu || terminal || ending || rhythm} onUnavailable={onUnavailable} />
    </Suspense>
    <div className="pv-world-shade" aria-hidden="true" />
    <header className="pv-world-hud"><div><span>PRIMA VISTA / SIGHT-READING EXPEDITION</span><h1>{location.subtitle}</h1><p>{location.place} · Reading level {level}</p></div><button type="button" className="pv-hud-button" onClick={() => setMenu(true)} aria-label="Pause and open menu">Ⅱ <span>Menu</span></button></header>
    {!terminal && <>
      <div className="pv-world-objective"><span className="pv-objective-line" />{status}<small>Location {level}/{LOCATIONS.length} · {lesson.skill}</small><div className="pv-learning-steps">{[['power','Prepare'],['signal','Rhythm'],['music','First read']].map(([id,label])=><span key={id} className={room[id]?'is-complete':''}>{room[id]?'✓':'○'} {label}</span>)}</div></div>
      {!fallback && <div className={`pv-crosshair${target ? ' is-target' : ''}`} aria-hidden="true">{target ? '◉' : '+'}</div>}
      {target && !intro && !menu && !rhythm && <button type="button" className="pv-interact" onClick={() => interact(target.id)}><kbd>E</kbd>{target.label}</button>}
      {fallback && <div className="pv-world-fallback"><p>Use the stations below to continue your reading expedition.</p></div>}
      <div className="pv-world-bottom"><div className="pv-world-notice" role="status">{notice || (active==='room' ? 'Your next discovery begins with a little music.' : '')}</div>
        {active === 'power' && <section className="pv-mentor-card" aria-label="Lyra’s reading guidance"><img src="/lyra.webp" alt="Lyra, your expedition guide"/><div><span className="pv-lesson-kicker">LYRA · YOUR READING GUIDE</span><h2>{lesson.title}</h2><p>{lesson.advice}</p><p className="pv-mentor-task">{lesson.task}</p><button type="button" className="pv-world-primary" onClick={()=>{solve('power');move('signal');}}>{room.power ? 'Continue to rhythm →' : lesson.ready}</button></div></section>}
        {active === 'signal' && <section className="pv-instrument"><div><small>02 / RHYTHM READING</small><h2>{room.signal ? 'Your pulse is finding its way.' : 'Read the rhythm on one note'}</h2><p>{room.power || !guided ? 'Two bars. One pitch. Count through the longer notes and rests before adding the demands of a full score.' : 'Lyra has a short reading strategy for you first.'}</p></div><button type="button" className="pv-world-primary" disabled={guided && !room.power} onClick={()=>setRhythm(true)}>{room.signal ? 'Practice rhythm again' : 'Begin rhythm study'} →</button></section>}
        {active === 'piano' && <section className="pv-instrument"><div><small>03 / FRESH SIGHT-READING</small><h2>{room.music ? 'A new part of the sky is open.' : 'Bring the phrase to life'}</h2><p>{room.signal || !guided ? `Fresh music at reading level ${level}. Scan, find the pulse, and keep going.` : 'Prepare with Lyra and complete the one-note rhythm first.'}</p></div><button type="button" className="pv-world-primary" disabled={guided && !room.signal} onClick={openConsole}>Read a fresh piece →</button></section>}
        {active === 'exit' && <section className="pv-instrument"><div><small>YOUR NEXT DISCOVERY</small><h2>{routeOpen ? 'Take your new confidence with you.' : 'The music opens the way.'}</h2><p>{finalStop ? 'Your expedition is complete. There is always more music to discover.' : routeOpen ? `Next: ${locationFor(level + 1).subtitle}` : routeReason || status}</p>{mission && !routeOpen && <ul className="pv-route-objectives">{mission.objectives.map((objective)=><li key={objective.id} className={objective.done?'is-done':''}>{objective.done?'✓':'○'} {objective.title}{objective.need>1&&<em> · {objective.have} of {objective.need}</em>}</li>)}</ul>}</div><button type="button" className="pv-world-primary" disabled={!finalStop && !routeOpen} onClick={()=>interact('exit')}>{finalStop ? 'Complete expedition' : 'Travel onward'} →</button></section>}
        {hint && <p className="pv-world-hint">{lesson.advice} Rehearsing is useful; a different, unseen piece is your next sight-reading check.</p>}
        <nav className="pv-station-nav" aria-label="Move to a learning station">{[['room','Explore'],['power',room.power?'✓ Lyra':'Meet Lyra'],['signal',room.signal?'✓ Rhythm':'Rhythm'],['piano',room.music?'✓ First read':'Piano'],['exit','Next destination']].map(([id,label])=><button type="button" key={id} aria-current={active===id?'location':undefined} onClick={()=>move(id)}>{label}</button>)}<button type="button" aria-pressed={hint} onClick={()=>setHint(!hint)}>Reading tip</button></nav>
      </div>
    </>}
    {intro && <RoomDialog title="Arrival" onClose={()=>setIntro(false)} className="pv-arrival pv-lyra-arrival"><img src="/lyra.webp" alt="Lyra"/><span>LYRA · {location.place.toUpperCase()}</span><h2>A new place.<br/>A clearer reading.</h2><p>“I’ll help you prepare, then we’ll find the pulse on one note. When you’re ready, your fresh piano reading will open the next part of our journey.”</p><p className="pv-arrival-instruction">Your focus: {lesson.skill.toLowerCase()}. Your music stays at a difficulty that fits you.</p><button type="button" className="pv-world-primary" onClick={()=>{setIntro(false);move('power');}}>Meet Lyra →</button></RoomDialog>}
    {rhythm && <RoomDialog title="Rhythm reading" className="pv-rhythm-dialog" onClose={()=>setRhythm(false)}><RhythmLesson level={level} midi={midi} onComplete={()=>solve('signal')} onEvidence={onRhythmEvidence}/>{room.signal && <button type="button" className="pv-world-primary" onClick={()=>{setRhythm(false);move('piano');}}>Take that pulse to the piano →</button>}</RoomDialog>}
    {menu && <RoomDialog title="Expedition menu" onClose={()=>setMenu(false)}><span>YOUR SIGHT-READING JOURNEY</span><h2>{location.subtitle}</h2><p>Reading level {level} · {lesson.skill}</p><p>Progress is saved in this browser.</p>{!storageOk&&<p>Saving is unavailable. Keep this tab open to retain this session.</p>}<div className="pv-pause-actions"><button type="button" onClick={()=>setMenu(false)}>Resume</button><button type="button" onClick={()=>{setMenu(false);onTools('practice');}}>Piano settings & open practice</button><button type="button" onClick={()=>{setMenu(false);onTools('progress');}}>My reading skills</button><button type="button" onClick={()=>{setMenu(false);onTools('custom');}}>Create a focused study</button><button type="button" onClick={()=>{setMenu(false);onTools('path');}}>Musical level map</button></div><p className="pv-menu-help">Drag to look · W A S D to walk · E to interact. Station buttons work with touch and keyboard.</p></RoomDialog>}
    {terminal && <div className="pv-console-overlay"><div className="pv-console-top"><span>SIGHT-READING / {lesson.skill.toUpperCase()}</span><button type="button" onClick={()=>setTerminal(false)}>Return to room ↗</button></div><div className="pv-console-guide"><img src="/lyra.webp" alt=""/><p role="status">{room.music ? '“A new destination is open. Take a moment to notice what went well.”' : notice || '“Scan the music. Feel the pulse. Keep going. Rehearse if you need to, then choose New music for a fresh reading.”'}</p></div>{practice}{acousticComplete&&!room.music&&<section className="pv-acoustic-confirm"><p>Acoustic playing is not scored. Confirm an independent reading of this fresh piece to continue exploring. This records no measured score or level advancement.</p><button type="button" className="pv-world-primary" onClick={()=>solve('music')}>I read this fresh piece independently</button></section>}</div>}
    {ending&&<RoomDialog title="Expedition complete" onClose={()=>setEnding(false)}><span>EXPEDITION COMPLETE</span><h2>The next discovery is in the music.</h2><p>You’ve practiced preparing, finding the pulse, and reading new music across ten locations. Keep developing your reading skills with fresh pieces.</p><button type="button" className="pv-world-primary" onClick={()=>{setEnding(false);onTools('progress');}}>See my reading skills →</button></RoomDialog>}
  </div>;
}
