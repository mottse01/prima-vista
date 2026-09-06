import { Suspense, lazy } from 'react';
import { LEVELS, STAGES, levelById } from '../core/levels.js';
import { comparableReads } from '../core/adaptive.js';
import { waypointFor } from '../core/constellation.js';
import { journeyProgress } from '../core/journey.js';


// The graded path. Levels are parameter envelopes, so each one is an endless
// supply of new material rather than a finite set of pieces to memorise.

// The solar system pulls in a 3D engine, which nobody reading music needs to
// download. It arrives when someone opens the path.
const SolarSystem = lazy(() => import('./SolarSystem.jsx'));

export default function PathView({ profile, onPick }) {
  const current = levelById(profile.level);
  const next = LEVELS.find((item) => item.id === current.id + 1);
  const demonstrated = (profile.demonstratedLevels || []).includes(current.id);
  const progress = journeyProgress(profile);
  return (
    <div className="sr-path">
      <h2 className="sr-view-title">Your next musical step</h2>
      <p className="sr-setup-lead">
        Ten levels, ten places. Drag to look around, scroll to travel outward, and choose
        a body to practise there — any of them, any time.
      </p>
      <Suspense fallback={<div className="sr-orrery sr-orrery--loading" aria-hidden="true" />}>
        <SolarSystem profile={profile} onPick={onPick} />
      </Suspense>
      <p className="sr-journey-line">
        <strong>{progress.reached}</strong> of {progress.total} waypoints demonstrated ·
        furthest reached <strong>{progress.furthest.name}</strong>
      </p>
      <div className="sr-path-spotlight">
        <section className="sr-path-current">
          <span className="sr-eyebrow">Where you are · Level {current.id} · {waypointFor(current.id).name}</span>
          <h3>{current.name}</h3>
          <p>{current.blurb}</p>
          <p className="sr-waypoint-note">{waypointFor(current.id).note}</p>
          {demonstrated && <span className="sr-milestone">✓ Shown in your first reads</span>}
          <button type="button" className="sr-btn sr-btn--primary" onClick={() => onPick(current.id)}>Practice at this level</button>
        </section>
        <section className="sr-path-next">
          <span className="sr-eyebrow">{next ? `Explore next · Level ${next.id} · ${waypointFor(next.id).name}` : 'Keep exploring'}</span>
          <h3>{next ? next.name : 'Fresh music, familiar skills'}</h3>
          <p>{next ? next.blurb : 'There is always more music to read. Keep exploring new pieces, or revisit a level for a relaxed practice.'}</p>
          <button type="button" className="sr-btn" onClick={() => onPick(next?.id || current.id)}>{next ? 'Try this when you’re ready' : 'Find another piece'}</button>
        </section>
      </div>
      <details className="sr-path-explanation">
        <summary>How progress works</summary>
        <p>Your selected level is a starting point, not a test result. A level is marked “Demonstrated” only after three strong first reads and enough evidence in its focus skills. These are Prima Vista levels, not exam grades. Assisted practice and familiar pieces remain useful practice, but don’t count toward this milestone.</p>
      </details>
      <details className="sr-path-all">
        <summary>Explore all {LEVELS.length} levels <span>From first notes to advanced reading</span></summary>
      {STAGES.map((stage) => (
        <section key={stage} className="sr-stage">
          <h3 className="sr-stage-title">{stage.toLowerCase() === 'mastery' ? 'Further exploration' : stage}</h3>
          <div className="sr-levels">
            {LEVELS.filter((l) => l.stage === stage).map((l) => {
              const demonstrated = (profile.demonstratedLevels || []).includes(l.id);
              const state = l.id === profile.level ? 'current' : demonstrated ? 'done' : 'ahead';
              const takes = comparableReads(profile, l.id);
              const best = takes.length ? Math.max(...takes.map((t) => t.score)) : null;
              return (
                <button
                  key={l.id} type="button"
                  className={`sr-level is-${state}`}
                  aria-current={l.id === profile.level ? 'true' : undefined}
                  onClick={() => onPick(l.id)}
                >
                  <span className="sr-level-num">{l.id}</span>
                  <span className="sr-level-body">
                    <b>{l.name}</b>
                    <span className="sr-waypoint">{waypointFor(l.id).name}</span>
                    <span className="sr-dim">{l.blurb}</span>
                  </span>
                  <span className="sr-level-score">
                    {l.id === profile.level ? 'Selected' : demonstrated ? 'Demonstrated' : takes.length ? 'Practiced' : 'Try this'}
                    {best != null && <small>best {best}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      </details>
    </div>
  );
}
