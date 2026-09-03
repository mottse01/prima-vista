import { useEffect, useMemo, useRef } from 'react';

// On-screen piano. Two roles: an input device for anyone without a MIDI
// keyboard, and a live picture of what your hands are doing when you have one.

const BLACK = new Set([1, 3, 6, 8, 10]);
const WHITE_OFFSET = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const midiName = (midi) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

// Home-row mapping so a laptop can drive it: two octaves from middle C.
const KEY_MAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
};

export default function Keyboard({
  low, high, held, expected, onNoteOn, onNoteOff, computerKeys = true, octaveBase = 60, className = '',
}) {
  const downRef = useRef(new Set());

  const keys = useMemo(() => {
    const out = [];
    for (let m = low; m <= high; m++) {
      const pc = ((m % 12) + 12) % 12;
      const octave = Math.floor(m / 12) - 1;
      const whiteIndex = Math.floor(m / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pc];
      out.push({ midi: m, black: BLACK.has(pc), pc, octave, whiteIndex, x: Math.floor(m / 12) * 7 + WHITE_OFFSET[pc] });
    }
    const minX = Math.min(...out.map((k) => k.x));
    for (const k of out) k.x -= minX;
    return out;
  }, [low, high]);

  const whiteCount = keys.filter((k) => !k.black).length;

  useEffect(() => {
    if (!computerKeys) return undefined;
    const down = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const idx = KEY_MAP[e.key.toLowerCase()];
      if (idx === undefined) return;
      e.preventDefault();
      const midi = octaveBase + idx;
      if (downRef.current.has(midi)) return;
      downRef.current.add(midi);
      onNoteOn(midi);
    };
    const up = (e) => {
      const idx = KEY_MAP[e.key.toLowerCase()];
      if (idx === undefined) return;
      const midi = octaveBase + idx;
      downRef.current.delete(midi);
      onNoteOff && onNoteOff(midi);
    };
    const releaseAll = () => {
      for (const midi of downRef.current) onNoteOff && onNoteOff(midi);
      downRef.current.clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [computerKeys, octaveBase, onNoteOn, onNoteOff]);

  const W = 100 / Math.max(1, whiteCount);
  return (
    <div className={`sr-keyboard ${className}`.trim()} style={{ ['--white-count']: whiteCount }}>
      <div className="sr-keyboard-head">
        <span>On-screen piano</span>
        {computerKeys && <span>Computer keys A–' start on {midiName(octaveBase)}</span>}
      </div>
      <div className="sr-keyboard-inner">
        {keys.filter((k) => !k.black).map((k) => (
          <button
            key={k.midi}
            type="button"
            className={`sr-key sr-key--white${held?.has(k.midi) ? ' is-held' : ''}${expected?.has(k.midi) ? ' is-expected' : ''}`}
            style={{ left: `${k.x * W}%`, width: `${W}%` }}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onNoteOn(k.midi); }}
            onPointerUp={() => onNoteOff && onNoteOff(k.midi)}
            onPointerCancel={() => onNoteOff && onNoteOff(k.midi)}
            onPointerLeave={() => onNoteOff && onNoteOff(k.midi)}
            aria-label={midiName(k.midi)}
          >
            {k.pc === 0 && <span className="sr-key-label">C{k.octave}</span>}
          </button>
        ))}
        {keys.filter((k) => k.black).map((k) => (
          <button
            key={k.midi}
            type="button"
            className={`sr-key sr-key--black${held?.has(k.midi) ? ' is-held' : ''}${expected?.has(k.midi) ? ' is-expected' : ''}`}
            style={{ left: `${k.x * W + W * 0.62}%`, width: `${W * 0.66}%` }}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onNoteOn(k.midi); }}
            onPointerUp={() => onNoteOff && onNoteOff(k.midi)}
            onPointerCancel={() => onNoteOff && onNoteOff(k.midi)}
            onPointerLeave={() => onNoteOff && onNoteOff(k.midi)}
            aria-label={midiName(k.midi)}
          />
        ))}
      </div>
    </div>
  );
}
