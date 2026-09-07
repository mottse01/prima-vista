import { useMemo } from 'react';
import { missionState } from '../core/missions.js';
import { waypointFor } from '../core/journey.js';

// Where you are, and what this place is asking for.
//
// The panel sits above the music because the objectives are the reason the
// music is there. Everything on it is checked against readings you have
// actually done, so nothing can be filled in by sitting at the instrument
// without reading anything.

export default function MissionPanel({ profile, level, onOpenPath }) {
  const mission = useMemo(() => missionState(profile, level), [profile, level]);
  const waypoint = waypointFor(level);
  const next = mission.objectives.find((item) => !item.done);
  const nextPlace = level < 10 ? waypointFor(level + 1) : null;

  return (
    <section className={`sr-mission${mission.cleared ? ' is-cleared' : ''}`}>
      <header className="sr-mission-head">
        <span
          className="sr-mission-body"
          aria-hidden="true"
          style={{ '--body-colour': waypoint.colour }}
        />
        <div className="sr-mission-title">
          <span className="sr-eyebrow">
            {mission.cleared ? 'Cleared' : 'Destination'} · Level {level}
          </span>
          <h3>{waypoint.name}</h3>
          <p>
            {mission.cleared
              ? nextPlace
                ? `Everything here is done. ${nextPlace.name} is open.`
                : 'Everything here is done. This is the edge of the Sun’s reach.'
              : next?.detail || waypoint.note}
          </p>
        </div>
        <div className="sr-mission-count">
          <strong>{mission.done}<span>/{mission.total}</span></strong>
          <span>objectives</span>
        </div>
      </header>

      <ol className="sr-objectives">
        {mission.objectives.map((objective) => (
          <li key={objective.id} className={objective.done ? 'is-done' : ''}>
            <span className="sr-objective-mark" aria-hidden="true">
              {objective.done ? '✓' : ''}
            </span>
            <span className="sr-objective-text">
              <b>{objective.title}</b>
              {objective.need > 1 && (
                <span className="sr-objective-progress">
                  <span style={{ width: `${(objective.have / objective.need) * 100}%` }} />
                  <em>{objective.have} of {objective.need}</em>
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {onOpenPath && (
        <button type="button" className="sr-link sr-mission-link" onClick={onOpenPath}>
          {mission.cleared && nextPlace ? `Set course for ${nextPlace.name}` : 'See the whole journey'}
        </button>
      )}
    </section>
  );
}
