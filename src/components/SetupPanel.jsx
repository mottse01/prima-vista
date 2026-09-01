import { useMemo, useState } from 'react';
import { KEY_NAMES, LETTERS } from '../core/theory.js';
import { TIME_SIGNATURES } from '../core/rhythm.js';
import { codeToSeed, randomSeed, seedToCode } from '../core/rng.js';

// The custom builder. Sight Reading Factory's real strength is how finely a
// teacher can specify an exercise; this matches that and adds the things it
// cannot do — a shareable exercise code, and a live left-hand texture choice.

const FIFTHS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];

const RHYTHM_OPTIONS = [
  { id: 'eighth', label: 'Eighths' },
  { id: 'rest', label: 'Rests' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'syncopation', label: 'Syncopation' },
  { id: 'sixteenth', label: 'Sixteenths' },
  { id: 'triplet', label: 'Triplets' },
];

const LH_STYLES = [
  { id: 'roots', label: 'Single bass notes' },
  { id: 'blocked', label: 'Blocked triads' },
  { id: 'alberti', label: 'Alberti bass' },
  { id: 'broken', label: 'Broken chords' },
  { id: 'waltz', label: 'Waltz (bass–chord–chord)' },
  { id: 'sustained', label: 'Sustained chords' },
  { id: 'melodic', label: 'Independent melody (two voices)' },
];

const diaName = (dia) => `${LETTERS[((dia % 7) + 7) % 7]}${Math.floor(dia / 7)}`;

export default function SetupPanel({ params, onChange, onGenerate, presets, onSavePreset, onLoadPreset, onDeletePreset }) {
  const [presetName, setPresetName] = useState('');
  const [seedInput, setSeedInput] = useState('');

  const set = (patch) => onChange({ ...params, ...patch });
  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const keyOptions = useMemo(
    () => FIFTHS.map((f) => ({ f, label: KEY_NAMES[params.keyMode][String(f)] })),
    [params.keyMode],
  );

  return (
    <div className="sr-setup">
      <p className="sr-setup-lead">
        Set the parameters and the generator writes music to match — a different piece every time,
        with real harmony behind it. Nothing here is behind a paywall.
      </p>

      <div className="sr-setup-grid">
        <Group title="Key">
          <div className="sr-segmented">
            {['major', 'minor'].map((m) => (
              <button
                key={m} type="button"
                className={`sr-seg${params.keyMode === m ? ' is-on' : ''}`}
                onClick={() => set({ keyMode: m })}
              >{m}</button>
            ))}
          </div>
          <div className="sr-chips">
            {keyOptions.map(({ f, label }) => (
              <button
                key={f} type="button"
                className={`sr-chip${params.keyFifths === f ? ' is-on' : ''}`}
                onClick={() => set({ keyFifths: f })}
              >{label}</button>
            ))}
          </div>
        </Group>

        <Group title="Metre">
          <div className="sr-chips">
            {Object.keys(TIME_SIGNATURES).map((name) => (
              <button
                key={name} type="button"
                className={`sr-chip${params.timeSignature === name ? ' is-on' : ''}`}
                onClick={() => set({ timeSignature: name })}
              >{name}</button>
            ))}
          </div>
          <Slider label="Tempo" suffix=" bpm" min={30} max={180} step={2}
            value={params.tempo} onChange={(v) => set({ tempo: v })} />
          <div className="sr-chips">
            {[4, 8, 12, 16, 24].map((m) => (
              <button
                key={m} type="button"
                className={`sr-chip${params.measures === m ? ' is-on' : ''}`}
                onClick={() => set({ measures: m })}
              >{m} bars</button>
            ))}
          </div>
        </Group>

        <Group title="Rhythm">
          <div className="sr-chips">
            {RHYTHM_OPTIONS.map((o) => (
              <button
                key={o.id} type="button"
                className={`sr-chip${params.rhythmTags.includes(o.id) ? ' is-on' : ''}`}
                onClick={() => set({ rhythmTags: toggleIn(params.rhythmTags, o.id) })}
              >{o.label}</button>
            ))}
          </div>
          <Slider label="Rest frequency" min={0} max={0.4} step={0.02}
            value={params.restRate} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ restRate: v })} />
        </Group>

        <Group title="Hands & texture">
          <div className="sr-segmented">
            {[['both', 'Both hands'], ['rh', 'Right only'], ['lh', 'Left only']].map(([id, label]) => (
              <button
                key={id} type="button"
                className={`sr-seg${params.hands === id ? ' is-on' : ''}`}
                onClick={() => set({ hands: id })}
              >{label}</button>
            ))}
          </div>
          <label className="sr-field">
            <span>Left-hand pattern</span>
            <select value={params.lhStyle} onChange={(e) => set({ lhStyle: e.target.value })}>
              {LH_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="sr-field">
            <span>Chords per bar</span>
            <select value={params.chordsPerMeasure} onChange={(e) => set({ chordsPerMeasure: Number(e.target.value) })}>
              <option value={1}>1 — one chord per bar</option>
              <option value={2}>2 — faster harmonic rhythm</option>
            </select>
          </label>
          <Check label="Seventh chords" checked={params.allowSevenths} onChange={(v) => set({ allowSevenths: v })} />
          <Check label="Inversions (moving bass line)" checked={params.allowInversions} onChange={(v) => set({ allowInversions: v })} />
        </Group>

        <Group title="Range">
          <RangeRow
            label="Right hand" low={params.rhLow} high={params.rhHigh}
            min={21} max={45}
            onLow={(v) => set({ rhLow: Math.min(v, params.rhHigh - 2) })}
            onHigh={(v) => set({ rhHigh: Math.max(v, params.rhLow + 2) })}
          />
          <RangeRow
            label="Left hand" low={params.lhLow} high={params.lhHigh}
            min={8} max={32}
            onLow={(v) => set({ lhLow: Math.min(v, params.lhHigh - 2) })}
            onHigh={(v) => set({ lhHigh: Math.max(v, params.lhLow + 2) })}
          />
          <p className="sr-hint">
            Widen these past the staff to drill ledger lines — the exact gap most readers never close.
          </p>
        </Group>

        <Group title="Melodic shape">
          <Slider label="Largest leap" suffix=" steps" min={1} max={7} step={1}
            value={params.maxLeap} onChange={(v) => set({ maxLeap: v })} />
          <Slider label="Stepwise motion" min={0.3} max={0.95} step={0.05}
            value={params.stepwiseBias} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ stepwiseBias: v })} />
          <Slider label="Non-chord tones" min={0} max={0.6} step={0.05}
            value={params.nonChordRate} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ nonChordRate: v })} />
          <Slider label="Chromaticism" min={0} max={0.6} step={0.05}
            value={params.chromaticRate} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ chromaticRate: v })} />
        </Group>

        <Group title="Notation">
          <Check label="Dynamics" checked={params.dynamics} onChange={(v) => set({ dynamics: v })} />
          <Check label="Articulations" checked={params.articulations} onChange={(v) => set({ articulations: v })} />
          <Check label="Phrase slurs" checked={params.slurs} onChange={(v) => set({ slurs: v })} />
          <Check label="Fingering hints" checked={params.fingerings} onChange={(v) => set({ fingerings: v })} />
        </Group>

        <Group title="Exercise code">
          <p className="sr-hint">
            Every exercise is reproducible from its code. Give a class the same code and everyone
            reads the same music — no accounts, no assignments to set up.
          </p>
          <div className="sr-row">
            <input
              className="sr-input" placeholder={seedToCode(params.seed || 0)} value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)} aria-label="Exercise code"
            />
            <button
              type="button" className="sr-btn sr-btn--small"
              onClick={() => {
                const s = codeToSeed(seedInput);
                if (s != null) onGenerate({ ...params, seed: s });
              }}
            >Load code</button>
          </div>
        </Group>

        <Group title="Presets">
          <div className="sr-row">
            <input
              className="sr-input" placeholder="Name this setup" value={presetName}
              onChange={(e) => setPresetName(e.target.value)} aria-label="Preset name"
            />
            <button
              type="button" className="sr-btn sr-btn--small"
              onClick={() => { if (presetName.trim()) { onSavePreset(presetName.trim(), params); setPresetName(''); } }}
            >Save</button>
          </div>
          <ul className="sr-presets">
            {presets.length === 0 && <li className="sr-hint">No saved setups yet.</li>}
            {presets.map((p) => (
              <li key={p.id}>
                <button type="button" className="sr-linkbtn" onClick={() => onLoadPreset(p)}>{p.name}</button>
                <button type="button" className="sr-linkbtn sr-linkbtn--danger" onClick={() => onDeletePreset(p.id)}>remove</button>
              </li>
            ))}
          </ul>
        </Group>
      </div>

      <div className="sr-setup-actions">
        <button
          type="button" className="sr-btn sr-btn--primary sr-btn--large"
          onClick={() => onGenerate({ ...params, seed: randomSeed() })}
        >Generate exercise</button>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <section className="sr-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix = '', format }) {
  return (
    <label className="sr-field sr-field--slider">
      <span>{label} <b>{format ? format(value) : value}{suffix}</b></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="sr-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function RangeRow({ label, low, high, min, max, onLow, onHigh }) {
  return (
    <div className="sr-rangerow">
      <span className="sr-rangerow-label">{label}</span>
      <div className="sr-rangerow-controls">
        <label>
          <span className="sr-dim">from</span>
          <input type="range" min={min} max={max} value={low} onChange={(e) => onLow(Number(e.target.value))} />
          <b>{diaName(low)}</b>
        </label>
        <label>
          <span className="sr-dim">to</span>
          <input type="range" min={min} max={max} value={high} onChange={(e) => onHigh(Number(e.target.value))} />
          <b>{diaName(high)}</b>
        </label>
      </div>
    </div>
  );
}
