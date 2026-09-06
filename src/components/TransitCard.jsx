import { useMemo } from 'react';
import {
  transitBlurb, transitDay, transitResult, transitStreak, transitTaken,
} from '../core/transit.js';

const DATE_FORMAT = { weekday: 'long', month: 'long', day: 'numeric' };

/**
 * Tonight's Transit.
 *
 * One piece a day, the same eight bars for every reader, and only one attempt
 * at reading it cold — because a first read genuinely happens once. Everything
 * is computed from the date, so nothing about it needs a server or an account.
 */
export default function TransitCard({ profile, active, onRead, onLeave }) {
  const day = transitDay();
  const taken = transitTaken(profile);
  const result = transitResult(profile, day);
  const streak = transitStreak(profile);
  const label = useMemo(() => new Date().toLocaleDateString(undefined, DATE_FORMAT), []);

  return (
    <section className={`sr-transit${active ? ' is-active' : ''}${taken ? ' is-done' : ''}`}>
      <div className="sr-transit-body">
        <p className="sr-eyebrow">Tonight’s Transit · {label}</p>
        <h3>
          {taken
            ? `Read at ${result?.score ?? '—'}`
            : active ? 'This is tonight’s transit' : 'One piece. Everyone. Once.'}
        </h3>
        <p className="sr-transit-note">
          {taken
            ? 'Come back tomorrow for the next one. You can still replay this piece as practice — it just will not be a first read any more.'
            : `Every reader opens the same music today, generated from the date itself and set at your own level. ${transitBlurb(profile.level)}`}
        </p>
      </div>
      <div className="sr-transit-side">
        <div className="sr-transit-streak">
          <strong>{streak}</strong>
          <span>{streak === 1 ? 'night observed' : 'nights observed'}</span>
        </div>
        {active ? (
          <button type="button" className="sr-btn" onClick={onLeave}>Back to practice</button>
        ) : (
          <button type="button" className="sr-btn sr-btn--primary" onClick={onRead}>
            {taken ? 'Open tonight’s transit' : 'Read tonight’s transit'}
          </button>
        )}
      </div>
    </section>
  );
}
