import { MODES } from '../core/modes.js';

// The fork, asked once.
//
// Both sides read the same generated music with the same grader against the
// same profile, so this is not a difficulty setting and nothing is given up by
// either answer. It is a question about what somebody came here to do, and it
// is asked plainly because the honest answer changes the whole shape of the
// app around them.

export default function ModeChoice({ onChoose, current }) {
  return (
    <section className="pv-modes" aria-labelledby="pv-modes-title">
      <div className="pv-modes-inner">
        <p className="pv-modes-kicker">Prima Vista · The sight-reading expedition</p>
        <h1 id="pv-modes-title">How do you want to read today?</h1>
        <p className="pv-modes-lead">
          The music is the same either way — freshly generated, graded as you play, at a
          level that fits you. Choose the room you want it in.
        </p>

        <div className="pv-modes-grid">
          {MODES.map((mode) => (
            <article key={mode.id} className={`pv-mode${current === mode.id ? ' is-current' : ''}`}>
              <span className="pv-mode-art" aria-hidden="true" data-mode={mode.id}>
                {mode.id === 'expedition' ? <ExpeditionMark /> : <PracticeMark />}
              </span>
              <p className="pv-mode-tagline">{mode.tagline}</p>
              <h2>{mode.name}</h2>
              <p className="pv-mode-blurb">{mode.blurb}</p>
              <p className="pv-mode-for">{mode.forWhom}</p>
              <button type="button" className="pv-mode-choose" onClick={() => onChoose(mode.id)}>
                {current === mode.id ? `Continue in ${mode.name.toLowerCase()}` : `Start in ${mode.name.toLowerCase()}`}
                <span aria-hidden="true"> →</span>
              </button>
            </article>
          ))}
        </div>

        <p className="pv-modes-note">
          You can switch at any time, and nothing resets when you do. Your levels, your
          reading history and your skill map are the same in both.
        </p>
      </div>
    </section>
  );
}

/** A course outward: a sun, an orbit and somewhere further on. */
function ExpeditionMark() {
  return (
    <svg viewBox="0 0 96 60" role="presentation" focusable="false">
      <ellipse cx="30" cy="30" rx="26" ry="11" className="pv-mark-orbit" />
      <ellipse cx="30" cy="30" rx="40" ry="19" className="pv-mark-orbit is-far" />
      <circle cx="30" cy="30" r="5.5" className="pv-mark-sun" />
      <circle cx="56" cy="30" r="3" className="pv-mark-body" />
      <circle cx="70" cy="30" r="2" className="pv-mark-body is-dim" />
      <circle cx="82" cy="30" r="1.4" className="pv-mark-body is-dim" />
    </svg>
  );
}

/** A stave and a phrase on it. */
function PracticeMark() {
  return (
    <svg viewBox="0 0 96 60" role="presentation" focusable="false">
      {[18, 24, 30, 36, 42].map((y) => (
        <line key={y} x1="8" x2="88" y1={y} y2={y} className="pv-mark-stave" />
      ))}
      {[[26, 30], [40, 24], [54, 27], [68, 21]].map(([x, y]) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx="4.4" ry="3.2" transform={`rotate(-18 ${x} ${y})`} className="pv-mark-head" />
          <line x1={x + 4} x2={x + 4} y1={y - 1} y2={y - 15} className="pv-mark-stem" />
        </g>
      ))}
    </svg>
  );
}
