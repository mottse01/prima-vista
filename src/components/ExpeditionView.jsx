import { useState } from 'react';
import { WAYPOINTS } from '../core/journey.js';
import { levelById } from '../core/levels.js';
import { isOpen, lockReason, missionState, openThrough } from '../core/missions.js';
import { comparableReads } from '../core/reads.js';

const CHAPTERS = [
  ['First light', 'Find your notes. Keep a gentle pulse.'],
  ['A second voice', 'Let your two hands travel together.'],
  ['Between the stars', 'Keep the pulse alive through silence.'],
  ['A wider horizon', 'Recognize intervals and explore new keys.'],
  ['Rings of rhythm', 'Feel dotted rhythms and a lilting beat.'],
  ['In motion', 'Make small, quick notes feel effortless.'],
  ['Against the current', 'Follow rhythms that cross the beat.'],
  ['Distant echoes', 'Explore triplets and a moving bass.'],
  ['Independent orbits', 'Follow a different melody in each hand.'],
  ['Beyond the familiar', 'Read ahead into a new musical world.'],
];

export default function ExpeditionView({ profile, onLaunch, onTransit, onPractice, onProgress, onPlacement }) {
  const [selected, setSelected] = useState(profile.level);
  const place = WAYPOINTS[selected - 1];
  const mission = missionState(profile, selected);
  const open = isOpen(profile, selected);
  const reads = comparableReads(profile, selected);
  const first = mission.objectives[0];
  const next = WAYPOINTS[selected];
  const chapter = CHAPTERS[selected - 1];
  return <div className="pv-expedition">
    <section className="pv-command" aria-labelledby="pv-destination">
      <div className="pv-command-copy">
        <div className="pv-kicker"><span className="pv-status-dot" /> PIANO EXPEDITION <span>SECTOR {String(selected).padStart(2, '0')} / 10</span></div>
        <p className="pv-chapter">{chapter[0]}</p>
        <h2 id="pv-destination">{place.name}</h2>
        <p className="pv-mission-intro">{chapter[1]}</p>
        <div className="pv-route-progress" aria-label={`${first.have} of ${first.need} strong first reads`}>
          {Array.from({ length: first.need }, (_, i) => <span key={i} className={i < first.have ? 'is-lit' : ''} />)}
          <b>{first.have} / {first.need} first reads</b>
        </div>
        {/* The route is earned; the piano is not. A destination that is not
            charted yet can still be practised at — so the screen offers that
            rather than treating a deliberate choice as a wrong turn. */}
        <button type="button" className="pv-launch" onClick={() => open ? onLaunch(selected) : onPractice(selected)}>
          <span aria-hidden="true">↗</span> {open ? reads.length ? 'Continue expedition' : 'Launch mission' : `Practise at ${place.name}`} <span aria-hidden="true">→</span>
        </button>
        <p className="pv-launch-note">
          {open
            ? `${levelById(selected).params.measures} bars · your own pace · fresh music every flight`
            : `Not charted yet — ${lockReason(profile, selected)} You can read here any time in open practice.`}
        </p>
        {!open && (
          <button type="button" className="pv-launch-secondary" onClick={() => onLaunch(openThrough(profile))}>
            Return to {WAYPOINTS[openThrough(profile) - 1].name} and continue the route
          </button>
        )}
      </div>
      <div className="pv-coordinate" aria-hidden="true">PRIMA VISTA EXPLORATION PROGRAM<br />HOME SYSTEM · OUTBOUND</div>
    </section>
    <section className="pv-route" aria-label="Choose a destination">
      <div className="pv-section-line"><h3>Your journey</h3><span>{openThrough(profile)} of 10 destinations open</span></div>
      <div className="pv-waypoints">
        {WAYPOINTS.map((point) => <button key={point.level} type="button" onClick={() => setSelected(point.level)}
          className={`pv-waypoint${selected === point.level ? ' is-selected' : ''}${isOpen(profile, point.level) ? ' is-open' : ''}`}
          aria-pressed={selected === point.level} aria-label={`${point.name}, level ${point.level}, ${isOpen(profile, point.level) ? 'open' : 'locked, preview destination'}`}>
          <span className="pv-node" style={{ '--waypoint': point.colour }}>{isOpen(profile, point.level) ? String(point.level).padStart(2, '0') : '·'}</span>
          <strong>{point.name.replace('The ', '')}</strong><small>{isOpen(profile, point.level) ? point.level === profile.level ? 'Current base' : 'Charted' : 'Uncharted'}</small>
        </button>)}
      </div>
    </section>
    <div className="pv-mission-grid">
      <section className="pv-brief">
        <span className="pv-kicker">MISSION BRIEF · LEVEL {selected}</span>
        <h3>{levelById(selected).name}</h3>
        <p>{levelById(selected).blurb}</p>
        <div className="pv-objective-list">{mission.objectives.map((objective, i) => <div key={objective.id}>
          <span className={`pv-check${objective.done ? ' is-done' : ''}`} aria-hidden="true">{objective.done ? '✓' : String(i + 1).padStart(2, '0')}</span>
          <div><strong>{objective.title}</strong><small>{i === 0 ? `Flight goal · ${objective.detail}` : `Discovery challenge · ${objective.detail}`}</small></div>
          <b>{objective.have}/{objective.need}</b>
        </div>)}</div>
        <p className="pv-next">{next ? `Next stop: ${next.name}` : 'Keep exploring with new music.'} <span>Discoveries are optional; three strong first reads open the route.</span></p>
      </section>
      <div className="pv-side-missions">
        <button className="pv-side-card" type="button" onClick={onTransit}><span className="pv-card-symbol" aria-hidden="true">✧</span><span><small>DAILY DISCOVERY</small><strong>Tonight’s transit</strong><span>One fresh piece. A small reason to return.</span></span><b aria-hidden="true">↗</b></button>
        <button className="pv-side-card" type="button" onClick={() => onPractice()}><span className="pv-card-symbol" aria-hidden="true">♫</span><span><small>FREE EXPLORATION</small><strong>Open practice</strong><span>Take your time. Try, listen, and try again.</span></span><b aria-hidden="true">↗</b></button>
        <button className="pv-side-card" type="button" onClick={onProgress}><span className="pv-card-symbol" aria-hidden="true">⌁</span><span><small>YOUR DISCOVERIES</small><strong>Flight log</strong><span>{profile.totals.takes ? `${profile.totals.takes} recorded takes · see the skills you’re building` : 'Your reading skills will light up here.'}</span></span><b aria-hidden="true">↗</b></button>
      </div>
    </div>
    <div className="pv-expedition-footer"><span>Explore at your pace. Every open destination stays open.</span><button type="button" onClick={onPlacement}>Already play piano? Find your starting level →</button></div>
  </div>;
}
