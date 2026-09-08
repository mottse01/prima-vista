// The expedition's surface. What it is meant to become — the fiction, the ten
// beats, and the three rules that bind changes here — is docs/the-reply.md.
// The rule most easily broken from this file is the first of them: the story
// never gates the instrument. Practice mode must stay reachable and plain.
import { useCallback, useEffect, useRef, useState } from 'react';
import { beatFor, completePuzzle, loadAdventure, LOCATIONS, locationFor, roomState, saveAdventure, pianoRelaySolved, readingLesson } from '../core/adventure.js';
import { lyraOnHolding, lyraSpeaks } from '../core/lyra.js';
import RhythmLesson from './RhythmLesson.jsx';
import StationScene from './StationScene.jsx';

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
  const beat = beatFor(level);
  const finalStop = level >= LOCATIONS.length;
  // Luna is where somebody finds out whether they want this at all, so the
  // piano is open from the first second and the scaffolds are offered on the
  // strength of what the reading showed. The ordered ritual starts at Mars,
  // where the reader has already chosen to be on the journey.
  const guided = level > 1;
  const [view, setView] = useState({ id: 'room' });
  const [menu, setMenu] = useState(false);
  const [intro, setIntro] = useState(true);
  const [terminal, setTerminal] = useState(false);
  const [rhythm, setRhythm] = useState(false);
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
      // She was listening, so what she says is about what she heard. The
      // sentence is selected by measured facts about this reading and never
      // invented — docs/the-reply.md, rule two.
      const opened = pianoRelaySolved(summary);
      if (opened) solve('music');
      setNotice(summary.fresh && !summary.assisted
        ? lyraSpeaks(summary, { opened, discovery: beatFor(level).discovery })
        : `${lyraOnHolding()} A preview or guide keys make it a rehearsal, and I need to hear one read cold.`);
    });
    return () => registerResult(null);
  }, [level, registerResult, solve, terminal]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !terminal && !intro && !ending && !rhythm && !menu) setMenu(true); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [terminal, intro, ending, rhythm, menu]);
  useEffect(() => {
    if (arrivedAt.current === level) return;
    arrivedAt.current = level;
    setView({ id: 'room' }); setNotice(''); setIntro(true);
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
  const active = view.id;
  // Three steps, three verbs, and the status line is always one instruction
  // about the next one. A reader arriving here is either ten years old or has
  // not touched a piano since school; neither of them should have to work out
  // what "first read" means before they are allowed to do anything.
  const STEPS = [['power', 'Look at it'], ['signal', 'Find the beat'], ['music', 'Play it']];
  const status = !room.power
    ? (guided
      ? 'Start with Lyra. She will show you what to look for.'
      : 'Play it whenever you are ready — or let Lyra show you what to look for first.')
    : !room.signal ? 'Find the beat: tap the rhythm out on one note.'
      : !room.music ? 'Play it. Read the music once through, and keep going.'
        : routeOpen ? 'Done here. The next place is open.' : (routeReason || 'Read one more here.');
  // Three bands, in this order, because the picture is a sixteen-by-nine panel
  // now rather than a full-bleed scene: what this place is, the place itself,
  // and what to do in it. Words over a drawn room are unreadable in a way that
  // words over a nearly black 3D scene were not.
  return <div className={`pv-adventure${terminal ? ' is-terminal' : ''}`}>
    <header className="pv-world-hud">
      <div><span>PRIMA VISTA / SIGHT-READING EXPEDITION</span><h1>{location.subtitle}</h1><p>{location.place} · Reading level {level}</p></div>
      {!terminal && (
        // At Luna only the reading is asked for, so only the reading is
        // listed: three empty circles beside "play it whenever you are ready"
        // reads as three things standing in the way of the piano.
        <div className="pv-world-objective"><span className="pv-objective-line" />{status}<small>Place {level} of {LOCATIONS.length} · {lesson.skill}</small><ol className="pv-learning-steps" aria-label={guided ? 'The three steps here' : 'What this place asks for'}>{(guided ? STEPS : STEPS.slice(2)).map(([id,label])=><li key={id} className={room[id]?'is-complete':''}>{room[id]?'✓':'○'} {label}</li>)}</ol></div>
      )}
      <button type="button" className="pv-hud-button" onClick={() => setMenu(true)} aria-label="Pause and open menu">Ⅱ <span>Menu</span></button>
    </header>
    <StationScene
      location={location} level={level} room={room}
      onInteract={onInteract}
      active={active}
    />
    {!terminal && <>
      <div className="pv-world-bottom"><div className="pv-world-notice" role="status">{notice || (active==='room' ? 'Tap anything in the room to use it, or use the buttons below.' : '')}</div>
        {active === 'power' && <section className="pv-mentor-card" aria-label="Lyra’s reading guidance"><img src="/lyra.webp" alt="Lyra, your expedition guide"/><div><span className="pv-lesson-kicker">LYRA · YOUR READING GUIDE</span><h2>{lesson.title}</h2><p>{lesson.advice}</p><p className="pv-mentor-task">{lesson.task}</p><button type="button" className="pv-world-primary" onClick={()=>{solve('power');move('signal');}}>{room.power ? 'Continue to rhythm →' : lesson.ready}</button></div></section>}
        {active === 'signal' && <section className="pv-instrument"><div><small>STEP 2 · FIND THE BEAT</small><h2>{room.signal ? 'You have the beat.' : 'Tap the rhythm on one note'}</h2><p>{room.power || !guided ? 'Two bars, one note. Getting the beat on its own first means there is one less thing to work out when the notes arrive.' : 'Lyra has something to show you first.'}</p></div><button type="button" className="pv-world-primary" disabled={guided && !room.power} onClick={()=>setRhythm(true)}>{room.signal ? 'Practice rhythm again' : 'Begin rhythm study'} →</button></section>}
        {active === 'piano' && <section className="pv-instrument"><div><small>STEP 3 · PLAY IT</small><h2>{room.music ? 'It has been heard.' : 'Read it at the piano'}</h2><p>{room.signal || !guided ? 'Music nobody has played, written for how you read now. Look at it, then start — and keep going past anything you get wrong.' : 'Look at it with Lyra and find the beat first.'}</p></div><button type="button" className="pv-world-primary" disabled={guided && !room.signal} onClick={openConsole}>Read a fresh piece →</button></section>}
        {active === 'exit' && <section className="pv-instrument"><div><small>MOVING ON</small><h2>{routeOpen ? 'The next place is open.' : 'Reading here is what opens the way.'}</h2><p>{finalStop ? 'The last of them is here.' : routeOpen ? `Next: ${locationFor(level + 1).subtitle}` : routeReason || status}</p>{mission && !routeOpen && <ul className="pv-route-objectives">{mission.objectives.map((objective)=><li key={objective.id} className={objective.done?'is-done':''}>{objective.done?'✓':'○'} {objective.title}{objective.need>1&&<em> · {objective.have} of {objective.need}</em>}</li>)}</ul>}</div><button type="button" className="pv-world-primary" disabled={!finalStop && !routeOpen} onClick={()=>interact('exit')}>{finalStop ? 'Complete expedition' : 'Travel onward'} →</button></section>}
        {hint && <p className="pv-world-hint">{lesson.advice} Rehearsing is useful; a different, unseen piece is your next sight-reading check.</p>}
        <nav className="pv-station-nav" aria-label="Move to a learning station">{[['room','The room'],['power',`${room.power?'✓ ':''}Look at it`],['signal',`${room.signal?'✓ ':''}Find the beat`],['piano',`${room.music?'✓ ':''}Play it`],['exit','Move on']].map(([id,label])=><button type="button" key={id} aria-current={active===id?'location':undefined} onClick={()=>move(id)}>{label}</button>)}<button type="button" aria-pressed={hint} onClick={()=>setHint(!hint)}>What to look for</button></nav>
      </div>
    </>}
    {/* Arrival says what is here and nothing about what to do about it. The
        briefing that used to live in this dialog is Lyra's station, which is
        where somebody goes when they want it. */}
    {intro && <RoomDialog title="Arrival" onClose={()=>setIntro(false)} className="pv-arrival pv-lyra-arrival"><img src="/lyra.webp" alt="Lyra"/><span>LYRA · {location.place.toUpperCase()}</span><h2>{beat.found}</h2><p>“Nobody has heard this one. It doesn’t play — it has to be read.”</p><button type="button" className="pv-world-primary" onClick={()=>{setIntro(false);move(guided ? 'power' : 'piano');}}>{guided ? 'Look at it with Lyra →' : 'Read it →'}</button></RoomDialog>}
    {rhythm && <RoomDialog title="Rhythm reading" className="pv-rhythm-dialog" onClose={()=>setRhythm(false)}><RhythmLesson level={level} midi={midi} onComplete={()=>solve('signal')} onEvidence={onRhythmEvidence}/>{room.signal && <button type="button" className="pv-world-primary" onClick={()=>{setRhythm(false);move('piano');}}>Take that pulse to the piano →</button>}</RoomDialog>}
    {menu && <RoomDialog title="Expedition menu" onClose={()=>setMenu(false)}><span>YOUR SIGHT-READING JOURNEY</span><h2>{location.subtitle}</h2><p>Reading level {level} · {lesson.skill}</p><p>Progress is saved in this browser.</p>{!storageOk&&<p>Saving is unavailable. Keep this tab open to retain this session.</p>}<div className="pv-pause-actions"><button type="button" onClick={()=>setMenu(false)}>Resume</button><button type="button" onClick={()=>{setMenu(false);onTools('practice');}}>Piano settings & open practice</button><button type="button" onClick={()=>{setMenu(false);onTools('progress');}}>My reading skills</button><button type="button" onClick={()=>{setMenu(false);onTools('custom');}}>Create a focused study</button><button type="button" onClick={()=>{setMenu(false);onTools('path');}}>Musical level map</button></div><p className="pv-menu-help">Drag to turn the station. Tap something to use it. The buttons along the bottom go to the same places.</p></RoomDialog>}
    {terminal && <div className="pv-console-overlay"><div className="pv-console-top"><span>SIGHT-READING / {lesson.skill.toUpperCase()}</span><button type="button" onClick={()=>setTerminal(false)}>Return to room ↗</button></div><div className="pv-console-guide"><img src="/lyra.webp" alt=""/><p role="status">{notice || (room.music ? '“Read another whenever you want one.”' : '“I have the marks. You have the hands. Take your time looking, then keep going once you start.”')}</p></div>{practice}{acousticComplete&&!room.music&&<section className="pv-acoustic-confirm"><p>Acoustic playing is not scored. Confirm an independent reading of this fresh piece to continue exploring. This records no measured score or level advancement.</p><button type="button" className="pv-world-primary" onClick={()=>solve('music')}>I read this fresh piece independently</button></section>}</div>}
        {/* It must not end. The transmissions do not stop — what stops is the
        guided part — and saying so is also true of the generator, so the
        ending never has to pretend there is no more music. */}
    {ending&&<RoomDialog title="The last passage" onClose={()=>setEnding(false)} className="pv-arrival pv-lyra-arrival"><img src="/lyra.webp" alt="Lyra"/><span>LYRA · HELIOPAUSE</span><h2>They are still writing.</h2><p>“That last one was theirs. Nothing on the record sounds like it, and you are the first person who has heard it.”</p><p>“They have not stopped. There are more of these than you and I will ever get through — you can read one whenever you like now, at whatever level you want it.”</p><div className="pv-pause-actions"><button type="button" className="pv-world-primary" onClick={()=>{setEnding(false);onTools('practice');}}>Read another →</button><button type="button" onClick={()=>{setEnding(false);onTools('progress');}}>What I can read now</button></div></RoomDialog>}
  </div>;
}
