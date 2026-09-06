import { useMemo, useState } from 'react';
import {
  OBSERVATIONS_FOR_CONFIDENCE, nextObservation, skyProgress, skyState, waypointFor,
} from '../core/constellation.js';
import { transitStreak } from '../core/transit.js';

const percent = (value) => `${Math.round(value * 100)}%`;

/**
 * The reading map.
 *
 * Each strand the grader measures is a star; a star lights when there is
 * enough evidence behind a good rating. The point of drawing it as a sky
 * rather than as a bar chart is that an unlit star is somewhere to go, and a
 * dark region is a place you have not been yet — neither reads as a failure.
 */
export default function ConstellationView({ profile, onDrill }) {
  const sky = useMemo(() => skyState(profile), [profile]);
  const progress = useMemo(() => skyProgress(profile), [profile]);
  const next = useMemo(() => nextObservation(profile), [profile]);
  const [focus, setFocus] = useState(null);
  const streak = transitStreak(profile);
  const waypoint = waypointFor(profile.level);

  return (
    <section className="sr-sky">
      <header className="sr-sky-head">
        <div>
          <p className="sr-eyebrow">Your constellation</p>
          <h3 className="sr-sky-title">
            {progress.lit} of {progress.total} stars lit
          </h3>
          <p className="sr-sky-sub">
            {progress.charted
              ? `${progress.charted} constellation${progress.charted === 1 ? '' : 's'} fully charted.`
              : 'A star lights once you have read it well, several times over.'}
          </p>
        </div>
        <dl className="sr-sky-facts">
          <div>
            <dt>Waypoint</dt>
            <dd>{waypoint.name}</dd>
            <p>{waypoint.note}</p>
          </div>
          <div>
            <dt>Nights observed</dt>
            <dd>{streak || '—'}</dd>
            <p>{streak ? 'Consecutive days with a transit read' : 'Read a transit to begin'}</p>
          </div>
        </dl>
      </header>

      <div className="sr-sky-grid">
        {sky.map((constellation) => (
          <article
            key={constellation.id}
            className={`sr-const${constellation.charted ? ' is-charted' : ''}${constellation.untouched ? ' is-untouched' : ''}`}
            style={{ '--const-hue': constellation.hue }}
          >
            <svg viewBox="0 0 100 88" className="sr-const-map" role="img"
              aria-label={`${constellation.name}: ${constellation.litCount} of ${constellation.stars.length} stars lit`}
            >
              {constellation.lines.map(([from, to]) => {
                const a = constellation.stars[from];
                const b = constellation.stars[to];
                const live = a.lit && b.lit;
                return (
                  <line
                    key={`${from}-${to}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    className={`sr-const-line${live ? ' is-live' : ''}`}
                  />
                );
              })}
              {constellation.stars.map((star) => (
                <g key={star.id} className="sr-star-group">
                  {star.lit && (
                    <circle cx={star.x} cy={star.y} r={7 - star.magnitude} className="sr-star-halo" />
                  )}
                  <circle
                    cx={star.x} cy={star.y}
                    r={Math.max(1.4, (4.4 - star.magnitude * 0.7) * (0.45 + star.brightness * 0.75))}
                    className={`sr-star${star.lit ? ' is-lit' : ''}${star.unobserved ? ' is-dark' : ''}`}
                  />
                  <circle
                    cx={star.x} cy={star.y} r={9} className="sr-star-hit"
                    tabIndex={0} role="button"
                    aria-label={`${star.label}: ${star.unobserved ? 'not yet observed' : `${percent(star.rating)} over ${star.attempts} notes`}`}
                    onMouseEnter={() => setFocus(star)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(star)}
                    onBlur={() => setFocus(null)}
                    onClick={() => onDrill?.(star.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onDrill?.(star.id);
                      }
                    }}
                  />
                </g>
              ))}
            </svg>
            <div className="sr-const-body">
              <h4>
                {constellation.name}
                <span>{constellation.meaning}</span>
              </h4>
              <p className="sr-const-strand">{constellation.strand}</p>
              <p className="sr-const-count">
                {constellation.untouched
                  ? 'Unobserved'
                  : `${constellation.litCount}/${constellation.stars.length} lit`}
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="sr-sky-readout" aria-live="polite">
        {focus ? (
          <p>
            <strong>{focus.label}</strong>
            {focus.unobserved
              ? ' — no observations yet. It lights after eight notes read well.'
              : ` — ${percent(focus.rating)} across ${focus.attempts} notes${
                focus.attempts < OBSERVATIONS_FOR_CONFIDENCE
                  ? `, ${OBSERVATIONS_FOR_CONFIDENCE - focus.attempts} more for a confident reading`
                  : ''}.`}
          </p>
        ) : next ? (
          <p>
            Dimmest star with enough evidence to trust: <strong>{next.label}</strong> in {next.constellation.name},
            reading {percent(next.rating)}.{' '}
            <button type="button" className="sr-link" onClick={() => onDrill?.(next.id)}>
              Observe it
            </button>
          </p>
        ) : (
          <p>Point the telescope anywhere. Every read you play adds observations.</p>
        )}
      </div>
    </section>
  );
}
