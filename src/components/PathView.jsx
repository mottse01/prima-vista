import { LEVELS, STAGES } from '../core/levels.js';
import { comparableReads } from '../core/adaptive.js';

// The graded path. Levels are parameter envelopes, so each one is an endless
// supply of new material rather than a finite set of pieces to memorise.

export default function PathView({ profile, onPick }) {
  return (
    <div className="sr-path">
      <p className="sr-setup-lead">
        Choose a comfortable challenge. Your selected level is not a test result: demonstrated levels
        are marked separately, after three strong fresh reads and enough evidence in their focus skills.
        These levels describe this app’s exercises, not exam grades.
      </p>
      {STAGES.map((stage) => (
        <section key={stage} className="sr-stage">
          <h3 className="sr-stage-title">{stage}</h3>
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
    </div>
  );
}
