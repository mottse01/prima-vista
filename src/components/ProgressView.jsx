import { useMemo, useRef } from 'react';
import { SKILLS } from '../core/grader.js';
import { recentAverage, weakestSkills } from '../core/adaptive.js';
import { levelById } from '../core/levels.js';
import { CURTAIN_MODES } from '../core/curtain.js';
import { exportAll, importAll } from '../core/storage.js';

// The diagnostics page. This is the answer to "why am I still bad at this?" —
// neither competitor tells you which specific notes and rhythms are costing you.

const NOTE_ORDER = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'Cb', 'Fb', 'E#', 'B#'];

export default function ProgressView({ profile, onDrill, onReset, onReload }) {
  const fileRef = useRef(null);
  const avg = recentAverage(profile, 10);
  const weak = weakestSkills(profile, 3);
  const level = levelById(profile.level);

  const pitchTally = useMemo(() => aggregatePitches(profile), [profile]);
  const recovery = useMemo(() => aggregateRecovery(profile), [profile]);
  // Replays and curtain takes are not sight-reads; charting them flatters the trend.
  const history = profile.history.filter((h) => !h.repeat && !h.curtain).slice(-40);

  return (
    <div className="sr-progress">
      <section className="sr-stats">
        <Stat label="Current level" value={profile.level} detail={level.name} />
        <Stat label="Last 10 takes" value={avg == null ? '—' : avg} detail={avg == null ? 'no takes yet' : 'average score'} />
        <Stat label="Day streak" value={profile.streak.count || 0} detail={profile.streak.count ? 'keep it going' : 'start today'} />
        <Stat label="Notes read" value={profile.totals.notes.toLocaleString()} detail={`${Math.round(profile.totals.minutes)} minutes`} />
        <Stat
          label="Recovery"
          value={recovery.mean == null ? '—' : `${Math.round(recovery.mean * 10) / 10}`}
          detail={recovery.mean == null
            ? (recovery.takes ? 'no slips recovered from yet' : 'notes to get back on track')
            : `notes after a wrong note${recovery.unrecovered
              ? ` · ${recovery.unrecovered} ${recovery.unrecovered === 1 ? 'take' : 'takes'} never recovered`
              : ''}`}
        />
      </section>

      {weak.length > 0 && (
        <section className="sr-panel">
          <h3>What is actually costing you points</h3>
          <p className="sr-hint">
            Measured from every note you have played, not from how a piece felt. Drilling one of these
            biases the next exercises toward it.
          </p>
          <ul className="sr-weaklist">
            {weak.map((w) => (
              <li key={w.id}>
                <div>
                  <b>{w.label}</b>
                  <span className="sr-dim"> · {Math.round(w.rating * 100)}% accurate over {w.attempts} notes</span>
                </div>
                <button type="button" className="sr-btn sr-btn--small" onClick={() => onDrill(w.id)}>Drill this</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sr-panel">
        <h3>Skill map</h3>
        <div className="sr-skillgrid">
          {SKILLS.map((s) => {
            const v = profile.skills[s.id] || { rating: 0.5, attempts: 0 };
            return (
              <div key={s.id} className={`sr-skill${v.attempts < 8 ? ' is-unproven' : ''}`}>
                <div className="sr-skill-head">
                  <span>{s.label}</span>
                  <span className="sr-dim">{v.attempts < 8 ? 'not enough data' : `${Math.round(v.rating * 100)}%`}</span>
                </div>
                <div className="sr-bar"><div className="sr-bar-fill" style={{ width: `${Math.round(v.rating * 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="sr-panel">
        <h3>Which notes you misread</h3>
        {Object.keys(pitchTally).length === 0 ? (
          <p className="sr-hint">Play a few takes and this fills in.</p>
        ) : (
          <div className="sr-heatmap">
            {NOTE_ORDER.filter((n) => pitchTally[n]).map((n) => {
              const t = pitchTally[n];
              const acc = t.correct / t.total;
              return (
                <div
                  key={n}
                  className="sr-heat"
                  style={{ ['--acc']: acc }}
                  title={`${n}: ${t.correct}/${t.total} correct`}
                >
                  <span className="sr-heat-name">{n}</span>
                  <span className="sr-heat-val">{Math.round(acc * 100)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="sr-panel">
        <h3>Look-ahead</h3>
        <p className="sr-hint">
          How far ahead of your hands you can read. The curtain hides the music as you reach it,
          so the only way through is to have read it already. These takes are kept separate from
          your skill map — the curtain measures reading fluency, not whether you know the notes.
        </p>
        <div className="sr-lookahead">
          {CURTAIN_MODES.filter((m) => m.beats !== null).map((m) => {
            const v = (profile.lookAhead || {})[m.id];
            return (
              <div key={m.id} className={`sr-look${v ? '' : ' is-untried'}`}>
                <div className="sr-look-label">{m.label}</div>
                <div className="sr-look-score">{v ? v.best : '—'}</div>
                <div className="sr-look-detail">{v ? `best of ${v.takes}` : 'not tried'}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="sr-panel">
        <h3>Score history</h3>
        {history.length < 2 ? (
          <p className="sr-hint">Two takes and a trend line appears here.</p>
        ) : (
          <Sparkline points={history.map((h) => h.score)} />
        )}
      </section>

      <section className="sr-panel">
        <h3>Your data</h3>
        <p className="sr-hint">
          Everything is stored in this browser. No account, nothing uploaded. Take it with you:
        </p>
        <div className="sr-row">
          <button
            type="button" className="sr-btn sr-btn--small"
            onClick={() => {
              const blob = new Blob([exportAll()], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'prima-vista-progress.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >Export progress</button>
          <button type="button" className="sr-btn sr-btn--small" onClick={() => fileRef.current?.click()}>Import</button>
          <input
            ref={fileRef} type="file" accept="application/json" hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try { importAll(await file.text()); onReload(); } catch { /* ignore bad file */ }
              e.target.value = '';
            }}
          />
          <button type="button" className="sr-btn sr-btn--small sr-btn--ghost" onClick={onReset}>Reset everything</button>
        </div>
      </section>
    </div>
  );
}

function aggregatePitches(profile) {
  const out = {};
  for (const h of profile.history) {
    if (!h.meta?.pitches) continue;
    for (const [name, t] of Object.entries(h.meta.pitches)) {
      if (!out[name]) out[name] = { correct: 0, total: 0 };
      out[name].correct += t.correct;
      out[name].total += t.total;
    }
  }
  return out;
}

/**
 * Recovery across takes. Only genuine first reads count: a replay is not a
 * sight-read, and a curtain take is expected to derail you more often.
 */
function aggregateRecovery(profile) {
  const takes = profile.history.filter((h) => !h.repeat && !h.curtain && h.meta?.recovery);
  const means = takes.map((h) => h.meta.recovery.meanNotes).filter((n) => n != null);
  return {
    takes: takes.length,
    mean: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null,
    unrecovered: takes.filter((h) => h.meta.recovery.unrecovered > 0).length,
  };
}

function Stat({ label, value, detail }) {
  return (
    <div className="sr-stat">
      <div className="sr-stat-value">{value}</div>
      <div className="sr-stat-label">{label}</div>
      <div className="sr-stat-detail">{detail}</div>
    </div>
  );
}

function Sparkline({ points }) {
  const w = 100;
  const h = 30;
  const max = 100;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(h - (p / max) * h).toFixed(2)}`).join(' ');
  return (
    <svg className="sr-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Score history">
      <line x1="0" y1={h - (88 / max) * h} x2={w} y2={h - (88 / max) * h} className="sr-spark-target" />
      <path d={d} className="sr-spark-line" />
    </svg>
  );
}
