import { Suspense, lazy } from 'react';
import { LEVELS, STAGES, levelById } from '../core/levels.js';
import { comparableReads } from '../core/adaptive.js';
import { waypointFor } from '../core/constellation.js';
import { journeyProgress } from '../core/journey.js';
import { isOpen, lockReason, openThrough } from '../core/missions.js';


// The graded path. Levels are parameter envelopes, so each one is an endless
// supply of new material rather than a finite set of pieces to memorise.

// The solar system pulls in a 3D engine, which nobody reading music needs to
// download. It arrives when someone opens the path.
const SolarSystem = lazy(() => import('./SolarSystem.jsx'));

/**
 * `gated` says whether this map is the expedition's route or the practice
 * room's level list. The route is earned and shows what is still uncharted;
 * the practice list is simply every level, because practising is not gated.
 */
export default function PathView({ profile, onPick, gated = true }) {
  const current = levelById(profile.level);
  const next = LEVELS.find((item) => item.id === current.id + 1);
  const demonstrated = (profile.demonstratedLevels || []).includes(current.id);
  const progress = journeyProgress(profile);
  return (
    <div className="sr-path">
      <h2 className="sr-view-title">Your star atlas</h2>
      <p className="sr-setup-lead">
        Ten levels, ten places. Drag to look around, scroll to travel outward, and choose
        one to practise there.
      </p>
      <Suspense fallback={<div className="sr-orrery sr-orrery--loading" aria-hidden="true" />}>
        <SolarSystem profile={profile} onPick={onPick} />
      </Suspense>
      <p className="sr-journey-line">
        {gated
          ? <>The course is open through <strong>{waypointFor(openThrough(profile)).name}</strong> · <strong>{progress.reached}</strong> of {progress.total} waypoints demonstrated</>
          : <>Every level is open here. <strong>{progress.reached}</strong> of {progress.total} demonstrated in your first reads</>}
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
          <button
            type="button" className="sr-btn"
            disabled={next ? gated && !isOpen(profile, next.id) : false}
            onClick={() => onPick(next?.id || current.id)}
          >
            {!next ? 'Find another piece'
              : !gated || isOpen(profile, next.id) ? 'Practise at this level' : 'Three strong first reads to open'}
          </button>
        </section>
      </div>
      <details className="sr-path-explanation">
        <summary>How progress works</summary>
        <p>Three first reads scoring 88 or better open the next destination. Optional discoveries explore its musical skills without blocking travel. Reading objectives use independent first reads; Eclipse discoveries use their separate fluency record. A level is separately marked “Demonstrated” after three strong first reads with enough evidence in its focus skills. These are Prima Vista levels, not exam grades.</p>
        <p>If you already read music, do not start at the beginning: take the level check from Practice → “Recheck my level”. Three unseen pieces will place you, and the course opens to there.</p>
      </details>
      <details className="sr-path-all">
        <summary>Explore all {LEVELS.length} levels <span>From first notes to advanced reading</span></summary>
      {STAGES.map((stage) => (
        <section key={stage} className="sr-stage">
          <h3 className="sr-stage-title">{stage.toLowerCase() === 'mastery' ? 'Further exploration' : stage}</h3>
          <div className="sr-levels">
            {LEVELS.filter((l) => l.stage === stage).map((l) => {
              const demonstrated = (profile.demonstratedLevels || []).includes(l.id);
              const open = !gated || isOpen(profile, l.id);
              const state = !open ? 'locked' : l.id === profile.level ? 'current' : demonstrated ? 'done' : 'ahead';
              const takes = comparableReads(profile, l.id);
              const best = takes.length ? Math.max(...takes.map((t) => t.score)) : null;
              return (
                <button
                  key={l.id} type="button"
                  className={`sr-level is-${state}`}
                  aria-current={l.id === profile.level ? 'true' : undefined}
                  disabled={!open}
                  title={open ? undefined : lockReason(profile, l.id)}
                  onClick={() => onPick(l.id)}
                >
                  <span className="sr-level-num">{l.id}</span>
                  <span className="sr-level-body">
                    <b>{l.name}</b>
                    <span className="sr-waypoint">{waypointFor(l.id).name}</span>
                    <span className="sr-dim">{l.blurb}</span>
                  </span>
                  <span className="sr-level-score">
                    {!open ? 'Closed'
                      : l.id === profile.level ? 'Selected'
                        : demonstrated ? 'Demonstrated'
                          : takes.length ? 'Practiced' : 'Try this'}
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
