import { useMemo, useState } from 'react';
import { KEY_NAMES, LETTERS } from '../core/theory.js';
import { TIME_SIGNATURES } from '../core/rhythm.js';
import { codeToSeed, randomSeed, seedToCode } from '../core/rng.js';
import { STYLE_OPTIONS, metresFor, styleSetupPatch } from '../core/compositionStyles.js';
import { REPERTOIRE_OPTIONS } from '../core/repertoire.js';
import { TEXTURES } from '../core/accompaniment.js';

const FIFTHS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];

const RHYTHM_OPTIONS = [
  { id: 'eighth', label: 'Eighths' },
  { id: 'rest', label: 'Rests' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'syncopation', label: 'Syncopation' },
  { id: 'sixteenth', label: 'Sixteenths' },
  { id: 'triplet', label: 'Triplets' },
];

const LH_STYLES = TEXTURES.map((texture) => ({ id: texture.id, label: texture.label }));

const diaName = (dia) => `${LETTERS[((dia % 7) + 7) % 7]}${Math.floor(dia / 7)}`;

export default function SetupPanel({ params, onChange, onGenerate, presets, onSavePreset, onLoadPreset, onDeletePreset }) {
  const [presetName, setPresetName] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [seedError, setSeedError] = useState('');

  const set = (patch) => onChange({ ...params, ...patch });
  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const keyOptions = useMemo(
    () => FIFTHS.map((f) => ({ f, label: KEY_NAMES[params.keyMode][String(f)] })),
    [params.keyMode],
  );
  const sourceMode = params.sourceMode || 'generated';
  // Only offer metres the chosen style can be written in. Picking a style
  // already moves the metre to one that fits; this stops the next click from
  // moving it back to one that does not.
  const metreOptions = useMemo(() => {
    const supported = metresFor(params.compositionStyle) || Object.keys(TIME_SIGNATURES);
    // A preset saved by an older build can carry a pairing this style no
    // longer allows. Keep it listed so the control still shows what is set —
    // but only if it is a metre at all, so a missing value cannot become one.
    if (supported.includes(params.timeSignature) || !TIME_SIGNATURES[params.timeSignature]) return supported;
    return [...supported, params.timeSignature];
  }, [params.compositionStyle, params.timeSignature]);
  const selectedRepertoire = REPERTOIRE_OPTIONS.find((item) => item.id === params.repertoireId) || REPERTOIRE_OPTIONS[0];

  return (
    <div className="sr-setup">
      <div className="sr-setup-heading">
        <div>
          <span className="sr-eyebrow">Custom study</span>
          <h2>Set the musical essentials.</h2>
        </div>
        <p>The composer handles phrase shape, repetition, harmony, cadences, and engraving. Open advanced controls only when you need them.</p>
      </div>

      <div className="sr-source-choice">
        <div className="sr-segmented" aria-label="Practice source">
          <button type="button" className={`sr-seg${sourceMode === 'generated' ? ' is-on' : ''}`}
            aria-pressed={sourceMode === 'generated'} onClick={() => set({ sourceMode: 'generated' })}>Freshly generated</button>
          <button type="button" className={`sr-seg${sourceMode === 'recombined' ? ' is-on' : ''}`}
            aria-pressed={sourceMode === 'recombined'} onClick={() => set({ sourceMode: 'recombined', timeSignature: '4/4', measures: 8 })}>Recombined motifs</button>
          <button type="button" className={`sr-seg${sourceMode === 'repertoire' ? ' is-on' : ''}`}
            aria-pressed={sourceMode === 'repertoire'} onClick={() => set({ sourceMode: 'repertoire' })}>Public-domain repertoire</button>
        </div>
      </div>

      {sourceMode === 'repertoire' ? (
        <div className="sr-setup-grid sr-setup-grid--basic">
          <Group title="Real repertoire">
            <label className="sr-field">
              <span>Piece</span>
              <select value={selectedRepertoire.id} onChange={(event) => set({ repertoireId: event.target.value })}>
                {REPERTOIRE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.title} — {item.composer}</option>)}
              </select>
            </label>
            <p className="sr-hint">{selectedRepertoire.subtitle}. {selectedRepertoire.provenance}</p>
          </Group>
        </div>
      ) : <>
      {sourceMode === 'recombined' && (
        <p className="sr-hint">Starts from a provenance-tracked public-domain motif, then transposes, reharmonizes, and develops it into a new study.</p>
      )}
      <div className="sr-setup-grid sr-setup-grid--basic">
        <Group title="Style" className="sr-group--style">
          <label className="sr-field">
            <span>Musical style</span>
            <select value={params.compositionStyle || 'auto'}
              onChange={(event) => set(styleSetupPatch(event.target.value, params))}>
              {STYLE_OPTIONS.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
            </select>
          </label>
          <p className="sr-hint">{STYLE_OPTIONS.find((style) => style.id === (params.compositionStyle || 'auto'))?.description}</p>
        </Group>

        <Group title="Key, metre & length">
          <div className="sr-segmented" aria-label="Mode">
            {['major', 'minor'].map((mode) => (
              <button
                key={mode} type="button"
                className={`sr-seg${params.keyMode === mode ? ' is-on' : ''}`}
                aria-pressed={params.keyMode === mode}
                onClick={() => set({ keyMode: mode })}
              >{mode}</button>
            ))}
          </div>
          <label className="sr-field">
            <span>Key</span>
            <select value={params.keyFifths} onChange={(event) => set({ keyFifths: Number(event.target.value) })}>
              {keyOptions.map(({ f, label }) => <option key={f} value={f}>{label}</option>)}
            </select>
          </label>
          <div className="sr-builder-row">
            <label className="sr-field">
              <span>Metre</span>
              <select value={params.timeSignature} onChange={(event) => set({ timeSignature: event.target.value })}>
                {metreOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="sr-field">
              <span>Length</span>
              <select value={params.measures} onChange={(event) => set({ measures: Number(event.target.value) })}>
                {[4, 8, 12, 16, 20, 24].map((bars) => <option key={bars} value={bars}>{bars} bars</option>)}
              </select>
            </label>
          </div>
          <Slider label="Tempo" suffix=" bpm" min={30} max={180} step={2}
            value={params.tempo} onChange={(value) => set({ tempo: value })} />
        </Group>

        <Group title="Hands">
          <div className="sr-segmented">
            {[['both', 'Grand staff'], ['rh', 'Melody only (treble)'], ['lh', 'Melody only (bass)']].map(([id, label]) => (
              <button
                key={id} type="button"
                className={`sr-seg${params.hands === id ? ' is-on' : ''}`}
                aria-pressed={params.hands === id}
                onClick={() => set({ hands: id })}
              >{label}</button>
            ))}
          </div>
          <label className="sr-field">
            <span>Left-hand texture</span>
            <select value={params.lhStyle} onChange={(event) => set({ lhStyle: event.target.value })} disabled={params.hands === 'rh'}>
              {LH_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
            </select>
          </label>
          <p className="sr-hint">Style chooses a sensible default; the texture remains editable.</p>
        </Group>
      </div>

      <details className="sr-advanced">
        <summary>
          <span>Advanced controls</span>
          <small>Rhythm, harmony, range, melodic behavior, and notation</small>
        </summary>
        <div className="sr-setup-grid">
          <Group title="Rhythm vocabulary">
            <div className="sr-chips">
              {RHYTHM_OPTIONS.map((option) => (
                <button
                  key={option.id} type="button"
                  className={`sr-chip${params.rhythmTags.includes(option.id) ? ' is-on' : ''}`}
                  aria-pressed={params.rhythmTags.includes(option.id)}
                  onClick={() => set({ rhythmTags: toggleIn(params.rhythmTags, option.id) })}
                >{option.label}</button>
              ))}
            </div>
            <Slider label="Rest frequency" min={0} max={0.4} step={0.02}
              value={params.restRate} format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => set({ restRate: value })} />
          </Group>

          <Group title="Harmony & accompaniment">
            <label className="sr-field">
              <span>Chords per bar</span>
              <select value={params.chordsPerMeasure} onChange={(event) => set({ chordsPerMeasure: Number(event.target.value) })} disabled={params.hands === 'rh'}>
                <option value={1}>1 — spacious</option>
                <option value={2}>2 — more movement</option>
              </select>
            </label>
            <Check label="Seventh chords" checked={params.allowSevenths} disabled={params.hands === 'rh'} onChange={(value) => set({ allowSevenths: value })} />
            <Check label="Inversions and moving bass" checked={params.allowInversions} disabled={params.hands === 'rh'} onChange={(value) => set({ allowInversions: value })} />
          </Group>

          <Group title="Range">
            <RangeRow label="Right hand" low={params.rhLow} high={params.rhHigh} min={21} max={45}
              onLow={(value) => set({ rhLow: Math.min(value, params.rhHigh - 2) })}
              onHigh={(value) => set({ rhHigh: Math.max(value, params.rhLow + 2) })} />
            <RangeRow label="Left hand" low={params.lhLow} high={params.lhHigh} min={8} max={32}
              onLow={(value) => set({ lhLow: Math.min(value, params.lhHigh - 2) })}
              onHigh={(value) => set({ lhHigh: Math.max(value, params.lhLow + 2) })} />
          </Group>

          <Group title="Melodic behavior">
            <Slider label="Largest leap" suffix=" steps" min={1} max={7} step={1}
              value={params.maxLeap} onChange={(value) => set({ maxLeap: value })} />
            <Slider label="Stepwise motion" min={0.3} max={0.95} step={0.05}
              value={params.stepwiseBias} format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => set({ stepwiseBias: value })} />
            <Slider label="Non-chord tones" min={0} max={0.6} step={0.05}
              value={params.nonChordRate} format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => set({ nonChordRate: value })} />
            <Slider label="Chromaticism" min={0} max={0.6} step={0.05}
              value={params.chromaticRate} format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => set({ chromaticRate: value })} />
          </Group>

          <Group title="Notation">
            <Check label="Dynamics" checked={params.dynamics} onChange={(value) => set({ dynamics: value })} />
            <Check label="Articulations" checked={params.articulations} onChange={(value) => set({ articulations: value })} />
            <Check label="Phrase slurs" checked={params.slurs} onChange={(value) => set({ slurs: value })} />
            <Check label="Fingering hints" checked={params.fingerings} onChange={(value) => set({ fingerings: value })} />
          </Group>

          <Group title="Variation seed">
            <p className="sr-hint">A seed recreates a variation with this setup. The practice screen can share the exact finished exercise.</p>
            <div className="sr-row">
              <input className="sr-input" placeholder={seedToCode(params.seed || 0)} value={seedInput}
                onChange={(event) => { setSeedInput(event.target.value); setSeedError(''); }} aria-label="Variation seed" />
              <button type="button" className="sr-btn sr-btn--small" onClick={() => {
                const seed = codeToSeed(seedInput);
                if (seed != null) onGenerate({ ...params, seed });
                else setSeedError('Enter a valid alphanumeric seed (usually 6 characters).');
              }}>Load seed</button>
            </div>
            {seedError && <p className="sr-field-error" role="alert">{seedError}</p>}
          </Group>

          <Group title="Presets">
            <div className="sr-row">
              <input className="sr-input" placeholder="Name this setup" value={presetName}
                onChange={(event) => setPresetName(event.target.value)} aria-label="Preset name" />
              <button type="button" className="sr-btn sr-btn--small" onClick={() => {
                if (presetName.trim()) { onSavePreset(presetName.trim(), params); setPresetName(''); }
              }}>Save</button>
            </div>
            <ul className="sr-presets">
              {presets.length === 0 && <li className="sr-hint">No saved setups yet.</li>}
              {presets.map((preset) => (
                <li key={preset.id}>
                  <button type="button" className="sr-linkbtn" onClick={() => onLoadPreset(preset)}>{preset.name}</button>
                  <button type="button" className="sr-linkbtn sr-linkbtn--danger" onClick={() => onDeletePreset(preset.id)}>remove</button>
                </li>
              ))}
            </ul>
          </Group>
        </div>
      </details>
      </>}

      <div className="sr-setup-actions">
        <button type="button" className="sr-btn sr-btn--primary sr-btn--large"
          onClick={() => onGenerate({ ...params, seed: randomSeed() })}>{sourceMode === 'repertoire' ? 'Open repertoire' : 'Generate study'}</button>
      </div>
    </div>
  );
}

function Group({ title, children, className = '' }) {
  return <section className={`sr-group${className ? ` ${className}` : ''}`}><h3>{title}</h3>{children}</section>;
}

function Slider({ label, value, min, max, step, onChange, suffix = '', format }) {
  return (
    <label className="sr-field sr-field--slider">
      <span>{label} <b>{format ? format(value) : value}{suffix}</b></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Check({ label, checked, disabled = false, onChange }) {
  return (
    <label className="sr-toggle">
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function RangeRow({ label, low, high, min, max, onLow, onHigh }) {
  return (
    <div className="sr-rangerow">
      <span className="sr-rangerow-label">{label}</span>
      <div className="sr-rangerow-controls">
        <label><span className="sr-dim">from</span><input type="range" min={min} max={max} value={low} onChange={(event) => onLow(Number(event.target.value))} /><b>{diaName(low)}</b></label>
        <label><span className="sr-dim">to</span><input type="range" min={min} max={max} value={high} onChange={(event) => onHigh(Number(event.target.value))} /><b>{diaName(high)}</b></label>
      </div>
    </div>
  );
}
