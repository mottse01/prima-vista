import { LEVELS, STAGES } from '../core/levels.js';

// The graded path. Levels are parameter envelopes, so each one is an endless
// supply of new material rather than a finite set of pieces to memorise.

export default function PathView({ profile, onPick }) {
  return (
    <div className="sr-path">
      <p className="sr-setup-lead">
        Ten levels from one-hand five-finger reading to a full-page concert study. Each level is a
        description of what music you should be able to read — not a fixed set of pieces — so
        it never runs out and you can never memorise your way through it. You can try any level.
        Three fresh reads at 88 or above, with enough evidence in the level’s focus skills, confirm that it is secure.
      </p>
      {STAGES.map((stage) => (
        <section key={stage} className="sr-stage">
          <h3 className="sr-stage-title">{stage}</h3>
          <div className="sr-levels">
            {LEVELS.filter((l) => l.stage === stage).map((l) => {
              const state = l.id < profile.level ? 'done' : l.id === profile.level ? 'current' : 'ahead';
              const takes = profile.history.filter((h) =>
                h.level === l.id && !h.repeat && !h.assisted && !h.curtain);
              const best = takes.length ? Math.max(...takes.map((t) => t.score)) : null;
              return (
                <button
                  key={l.id} type="button"
                  className={`sr-level is-${state}`}
                  onClick={() => onPick(l.id)}
                >
                  <span className="sr-level-num">{l.id}</span>
                  <span className="sr-level-body">
                    <b>{l.name}</b>
                    <span className="sr-dim">{l.blurb}</span>
                  </span>
                  <span className="sr-level-score">
                    {best == null ? '' : `best ${best}`}
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
