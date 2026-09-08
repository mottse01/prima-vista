import { useEffect, useRef } from 'react';
import { SCREEN, brush } from '../core/pixelart.js';

/**
 * A fixed 320 × 180 canvas fitted to the page, with hotspots laid over it.
 *
 * The canvas holds the picture and nothing else. Everything a person can touch
 * is a real button in `children`, positioned in percentages of the same
 * coordinate space, so the room comes with a tab order, focus rings and
 * accessible names already attached rather than needing a parallel navigation
 * built beside it — which is what the 3D scene this replaces had to do.
 *
 * `draw` is called with a brush and the current frame number. It should be a
 * pure function of its arguments: it runs again on every resize.
 */
export default function PixelStage({ draw, frame = 0, className = '', label, children }) {
  const canvas = useRef(null);
  const brushRef = useRef(null);
  const paint = useRef(draw);
  useEffect(() => { paint.current = draw; });

  useEffect(() => {
    const surface = canvas.current;
    const context = surface.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = false;
    surface.width = SCREEN.width;
    surface.height = SCREEN.height;
    // The canvas is always 320 × 180. Fitting it to the page is CSS's job —
    // `object-fit: contain` with nearest-neighbour scaling — so there is no
    // resize handler here and nothing is ever redrawn at another resolution.
    brushRef.current = brush(context);
    paint.current(brushRef.current, frame);
  }, [frame]);

  return (
    <div className={`pv-pixels ${className}`}>
      <div className="pv-pixels-frame">
        <canvas ref={canvas} role="img" aria-label={label} />
        {children}
      </div>
    </div>
  );
}

/**
 * A hotspot: a button laid over the picture at pixel coordinates.
 *
 * Given in the canvas's own 320 × 180 space and converted to percentages, so
 * one set of numbers describes both where a thing is drawn and where it can be
 * pressed, and the two cannot drift apart.
 */
export function Hotspot({ x, y, w, h, label, hint, onClick, onHover, disabled, current }) {
  return (
    <button
      type="button"
      className={`pv-hotspot${current ? ' is-current' : ''}`}
      style={{
        left: `${(x / SCREEN.width) * 100}%`,
        top: `${(y / SCREEN.height) * 100}%`,
        width: `${(w / SCREEN.width) * 100}%`,
        height: `${(h / SCREEN.height) * 100}%`,
      }}
      onClick={onClick}
      onPointerEnter={() => onHover?.(label)}
      onPointerLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(label)}
      onBlur={() => onHover?.(null)}
      disabled={disabled}
      aria-current={current ? 'location' : undefined}
    >
      <span className="pv-hotspot-name">{label}</span>
      {hint && <span className="pv-hotspot-hint">{hint}</span>}
    </button>
  );
}
