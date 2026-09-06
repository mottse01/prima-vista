import { useMemo, useRef } from 'react';
import { SKILLS, SCORING_VERSION } from '../core/grader.js';
import { comparableReads, recentAverage, weakestSkills } from '../core/adaptive.js';
import { levelById } from '../core/levels.js';
import { CURTAIN_MODES } from '../core/curtain.js';
import { exportAll, importAll } from '../core/storage.js';

// Keep first-read evidence distinct from familiar and assisted practice.

const NOTE_ORDER = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'Cb', 'Fb', 'E#', 'B#'];

const STRANDS = [
  { id: 'pitch', label: 'Staff & key reading', skills: ['notes.treble', 'notes.bass', 'notes.ledger', 'notes.accidental'] },
  { id: 'patterns', label: 'Interval patterns', skills: ['intervals.step', 'intervals.skip', 'intervals.leap'] },
  { id: 'rhythm', label: 'Rhythm & pulse', skills: ['rhythm.quarter', 'rhythm.eighth', 'rhythm.sixteenth', 'rhythm.dotted', 'rhythm.syncopation', 'rhythm.triplet', 'rhythm.rest'] },
  { id: 'coordination', label: 'Two-hand coordination', skills: ['coordination.together'] },
];

export default function ProgressView({ profile, onDrill, onResume, onReset, onReload, onStart }) {
  const fileRef = useRef(null);
  const avg = recentAverage(profile, 10);
  const weak = weakestSkills(profile, 3);
  const level = levelById(profile.level);

  const pitchTally = useMemo(() => aggregatePitches(profile), [profile]);
  const pitchLocations = useMemo(() => aggregatePitchLocations(profile), [profile]);
  const strands = useMemo(() => STRANDS.map((strand) => ({ ...strand, ...strandEvidence(profile, strand.skills) })), [profile]);
  // Replays, assisted practice, and curtain takes are not clean first reads;
  // charting them together would flatter or distort the sight-reading trend.
  const clean = comparableReads(profile);
  const latest = clean.at(-1)?.meta?.recipe?.params;
  const history = clean.filter((h) => {
    const recipe = h.meta?.recipe?.params;
    return recipe?.tempo === latest?.tempo && recipe?.timeSignature === latest?.timeSignature
      && recipe?.hands === latest?.hands && recipe?.measures === latest?.measures;
  }).slice(-40);
  const savedExercises = [...profile.history]
    .reverse()
    .filter((take) => take.meta?.recipe)
    .filter((take, index, all) => all.findIndex((other) => (
      other.meta.recipe.seed === take.meta.recipe.seed
      && JSON.stringify(other.meta.recipe.params) === JSON.stringify(take.meta.recipe.params)
    )) === index)
    .slice(0, 8);

  return (
    <div className="sr-progress">
      <h2 className="sr-view-title">Every time you play adds up</h2>
      <p className="sr-setup-lead">A few minutes or a longer session—make room for music in your own way.</p>
      <section className="sr-stats">
        <Stat label="Selected level" value={profile.level} detail={level.name} />
        <Stat label="Comparable fresh reads" value={avg == null ? '—' : avg} detail={avg == null ? 'building new evidence' : `Level ${profile.level} · same tempo, length, hands & meter`} />
        <Stat
          label="Completed practice reads"
          value={profile.totals.takes}
          detail={`${Math.round(profile.totals.minutes)} minutes of playing${profile.streak.count ? ` · ${profile.streak.count}-day streak` : ''}`}
        />
      </section>

      <section className="sr-nextstep">
        <div>
          <span className="sr-eyebrow">Next useful step</span>
          <strong>{weak[0] ? `Spend a little time with ${weak[0].label.toLowerCase()}.` : 'Start with one piece you haven’t played before.'}</strong>
          <p>{weak[0]
            ? 'Your recent playing suggests this is a useful next step. Try a piece with a little more of this skill.'
            : 'Take a moment to look over the music, then aim to keep a steady beat. Your first few pieces will help us suggest what to try next.'}</p>
        </div>
        {weak[0] && <button type="button" className="sr-btn sr-btn--primary" onClick={() => onDrill(weak[0].id)}>Start focused read</button>}
        {!weak[0] && <button type="button" className="sr-btn sr-btn--primary" onClick={onStart}>{profile.totals.takes ? 'Continue practice' : 'Start my first read'}</button>}
      </section>
      {profile.legacySkills && <p className="sr-hint">Scoring has improved. Your past history is preserved; current skill ratings are rebuilding from the corrected measurements.</p>}

      <details className="sr-progress-more">
        <summary>
          <span><strong>More detail</strong><small>Learning strands, skill maps, history, and your data</small></span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="sr-progress-more-body">
      <section className="sr-panel">
        <h3>Learning strands</h3>
        <p className="sr-hint">A balanced reader grows several abilities together. Scores appear only after enough evidence.</p>
        <div className="sr-strandgrid">
          {strands.map((strand) => (
            <div key={strand.id} className={`sr-strand${strand.rating == null ? ' is-unproven' : ''}`}>
              <span>{strand.label}</span>
              <strong>{strand.rating == null ? 'Building evidence' : `${Math.round(strand.rating * 100)}%`}</strong>
              <small>{strand.rating == null ? 'Complete a few more fresh reads' : `${Math.round(strand.attempts)} observed notes`}</small>
            </div>
          ))}
          <div className="sr-strand is-practice">
            <span>Look-ahead & prediction</span>
            <strong>Practice goal</strong>
            <small>Use Flexible after a clean first read</small>
          </div>
        </div>
      </section>

      {weak.length > 0 && (
        <section className="sr-panel">
          <h3>Detailed skill evidence</h3>
          <p className="sr-hint">
            These are the clearest opportunities measured from your playing. A focused read changes one
            demand at a time instead of making the whole exercise harder.
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
        <h3>Note-reading map</h3>
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
                  className={`sr-heat${t.total < 4 ? ' is-unproven' : ''}`}
                  style={{ ['--acc']: acc }}
                  title={`${n}: ${t.correct}/${t.total} correct`}
                >
                  <span className="sr-heat-name">{n}</span>
                  <span className="sr-heat-val">{t.total < 4 ? 'learning' : `${Math.round(acc * 100)}%`}</span>
                </div>
              );
            })}
          </div>
        )}
        {Object.keys(pitchLocations).length > 0 && (
          <>
            <h4 className="sr-subheading">By staff and register</h4>
            <div className="sr-locationmap">
              {Object.entries(pitchLocations)
                .sort(([, a], [, b]) => a.hand.localeCompare(b.hand) || a.note.localeCompare(b.note, undefined, { numeric: true }))
                .map(([id, t]) => {
                  const accuracy = t.correct / t.total;
                  return (
                    <div key={id} className="sr-location" title={`${t.correct}/${t.total} correct`}>
                      <span>{t.hand === 'rh' ? 'Treble' : 'Bass'} {t.note}</span>
                      <strong>{t.total < 4 ? 'Learning' : `${Math.round(accuracy * 100)}%`}</strong>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </section>

      <section className="sr-panel">
        <h3>Reading ahead</h3>
        <p className="sr-hint">
          Notes fade after their attack so your eyes keep moving into the phrase. Flexible adapts the
          fade distance to rhythmic density; it is a training variation, not a higher level.
          These takes stay separate from your skill map. They show performance with disappearing notes, not a measurement of where your eyes look.
        </p>
        <div className="sr-lookahead">
          {CURTAIN_MODES.filter((m) => m.beats !== null && !m.legacy).map((m) => {
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
        <h3>Comparable first reads</h3>
        <p className="sr-hint">Same selected level, tempo, length, hands and meter. Older scoring versions and assisted practice stay out of this trend.</p>
        {history.length < 2 ? (
          <p className="sr-hint">Two takes and a trend line appears here.</p>
        ) : (
          <Sparkline points={history.map((h) => h.score)} />
        )}
      </section>

      <section className="sr-panel">
        <h3>Past exercises</h3>
        <p className="sr-hint">Saved as a seed and musical recipe, so a repeat opens the exact exercise without storing the score.</p>
        {savedExercises.length === 0 ? (
          <p className="sr-hint">Completed exercises will appear here.</p>
        ) : (
          <ul className="sr-weaklist">
            {savedExercises.map((take) => {
              const recipe = take.meta.recipe;
              return (
                <li key={`${take.at}:${recipe.seed}`}>
                  <div>
                    <b>{recipe.title || 'Saved exercise'}</b>
                    <span className="sr-dim"> · {recipe.style || 'Auto'} · score {take.score}</span>
                  </div>
                  <button type="button" className="sr-btn sr-btn--small" onClick={() => onResume(recipe)}>Practice again</button>
                </li>
              );
            })}
          </ul>
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
          <button
            type="button" className="sr-btn sr-btn--small sr-btn--ghost"
            onClick={() => {
              if (window.confirm('Reset your Prima Vista progress? Saved setups and preferences will stay.')) onReset();
            }}
          >Reset progress</button>
        </div>
      </section>
        </div>
      </details>
    </div>
  );
}

function aggregatePitches(profile) {
  const out = {};
  for (const h of profile.history) {
    if (h.scoringVersion !== SCORING_VERSION || h.repeat || h.assisted || h.curtain) continue;
    if (!h.meta?.pitches) continue;
    for (const [name, t] of Object.entries(h.meta.pitches)) {
      if (!out[name]) out[name] = { correct: 0, total: 0 };
      out[name].correct += t.correct;
      out[name].total += t.total;
    }
  }
  return out;
}

function aggregatePitchLocations(profile) {
  const out = {};
  for (const take of profile.history) {
    if (take.scoringVersion !== SCORING_VERSION || take.repeat || take.assisted || take.curtain) continue;
    if (!take.meta?.pitchLocations) continue;
    for (const [id, tally] of Object.entries(take.meta.pitchLocations)) {
      if (!out[id]) out[id] = { ...tally, correct: 0, total: 0 };
      out[id].correct += tally.correct;
      out[id].total += tally.total;
    }
  }
  return out;
}

function strandEvidence(profile, skillIds) {
  const observed = skillIds
    .map((id) => profile.skills[id])
    .filter((skill) => skill && skill.attempts >= 3);
  const attempts = observed.reduce((sum, skill) => sum + skill.attempts, 0);
  if (!attempts) return { rating: null, attempts: 0 };
  return {
    rating: observed.reduce((sum, skill) => sum + skill.rating * skill.attempts, 0) / attempts,
    attempts,
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
