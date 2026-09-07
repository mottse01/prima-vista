import { missionState, openThrough } from '../core/missions.js';
import { waypointFor } from '../core/journey.js';

export default function ExpeditionDebrief({ receipt, profile, onExplore, onLaunch }) {
  const after = missionState(profile, receipt.level);
  const unlocked = openThrough(profile) > receipt.frontier;
  const found = after.objectives.filter((item) => item.done && !receipt.before?.objectives.find((old) => old.id === item.id)?.done);
  const flight = after.objectives[0];
  const gained = flight.have > (receipt.before?.objectives[0]?.have || 0);
  return <section className={`pv-debrief${unlocked ? ' is-unlocked' : ''}`} aria-label="Expedition update">
    <span className="pv-debrief-mark" aria-hidden="true">{unlocked ? '✧' : gained ? '✓' : '♫'}</span>
    <div><span className="pv-kicker">{unlocked ? 'NEW DESTINATION OPEN' : 'EXPEDITION UPDATE'}</span>
      <h3>{unlocked ? `Next stop: ${waypointFor(openThrough(profile)).name}` : gained ? 'Another signal charted.' : receipt.eligible ? 'Every flight teaches you something.' : 'A little more confidence.'}</h3>
      <p>{receipt.eligible ? `${flight.have} of ${flight.need} strong first reads at ${waypointFor(receipt.level).name}.` : 'Practice helps you prepare. A fresh, unassisted reading can open the route.'}</p>
      {found.length > 0 && <p className="pv-discoveries">{found.map((item) => `✓ ${item.title}`).join(' · ')}</p>}
    </div>
    <button type="button" className="sr-btn sr-btn--primary" onClick={() => unlocked ? onLaunch(openThrough(profile)) : onExplore()}>{unlocked ? 'Travel onward →' : 'See your journey →'}</button>
  </section>;
}
