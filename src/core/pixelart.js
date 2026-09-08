// The world, drawn a pixel at a time.
//
// Everything the expedition shows is rendered on a 320 × 180 canvas and scaled
// up by whole numbers. That resolution is close to what a SNES put on a
// television, and the constraint is doing real work rather than being a
// costume: a small fixed grid and a short palette make ten rooms cohere with
// each other in a way that ten separately made pictures never do. It is also
// the reason this can be drawn in code at all.
//
// The rule that keeps it looking deliberate: nothing here draws a gradient, a
// blur or a partial pixel. Shape comes from flat blocks of colour off a ramp,
// and shading from dithering between two steps of that ramp.
//
// Text is not drawn here. Labels and every interactive hotspot are real DOM
// elements sitting over the canvas, so the picture stays a picture and a
// screen reader gets a room full of buttons.

export const SCREEN = { width: 320, height: 180 };

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const hex = (value) => {
  const clean = String(value || '#000000').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
};
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => (
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
)).join('')}`;

/** Mix two colours by a fraction, staying on the integer grid. */
export const mix = (a, b, amount) => {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const t = Math.max(0, Math.min(1, amount));
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};

/** Perceived brightness, which is what decides whether two colours read apart. */
export const luminance = (colour) => {
  const [r, g, b] = hex(colour);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** The same colour, moved to a given brightness by way of black or white. */
const atLuminance = (colour, target) => {
  const here = luminance(colour);
  if (target <= here) return here <= 0 ? colour : mix(colour, '#000000', 1 - target / here);
  return here >= 1 ? colour : mix(colour, '#ffffff', (target - here) / (1 - here));
};

// How far apart the five steps sit, in brightness. Two below the colour and
// two above it, spaced a little wider going down, because shadow needs more
// room to separate than highlight does.
const RAMP_STEPS = [-0.3, -0.15, 0, 0.13, 0.26];
const RAMP_FLOOR = 0.04;
const RAMP_CEILING = 0.96;

/**
 * A five-step ramp from one colour: two darker, the colour, two lighter.
 *
 * A ramp rather than free colour is what makes a limited palette read as a
 * choice. Everything drawn against it picks a step, never something between —
 * which only works if the steps can actually be told apart.
 *
 * A colour already near white has no room for two steps above it, and one near
 * black none below. Rather than let the ramp collapse into three of the same
 * colour, the whole run slides until it fits. The hue is kept; where the
 * original sits inside the run is not guaranteed for an extreme colour, which
 * is the correct trade and the one a person would make by hand.
 */
export function ramp(base, { shade = null, tint = null } = {}) {
  const here = luminance(base);
  const wanted = RAMP_STEPS.map((delta) => here + delta);
  const overflow = Math.max(0, wanted.at(-1) - RAMP_CEILING);
  const underflow = Math.max(0, RAMP_FLOOR - wanted[0]);
  const shift = overflow > 0 ? -overflow : underflow;
  const steps = wanted.map((target) => (
    Math.max(RAMP_FLOOR, Math.min(RAMP_CEILING, target + shift))
  ));
  return steps.map((target, index) => {
    const moved = atLuminance(base, target);
    // A shade or tint given by a caller colours the ends without changing how
    // far apart they are.
    if (index === 0 && shade) return mix(moved, shade, 0.25);
    if (index === 4 && tint) return mix(moved, tint, 0.25);
    return moved;
  });
}

/**
 * A location's whole palette, derived from the two colours it already carries.
 *
 * Deriving rather than hand-listing means a new destination cannot arrive
 * without a palette, and a retuned one cannot drift out of step with itself.
 */
export function paletteFor(location = {}) {
  const sky = location.sky || '#0d1520';
  const accent = location.color || '#8fd8c4';
  return {
    void: mix(sky, '#000000', 0.55),
    sky: ramp(sky, { tint: accent }),
    accent: ramp(accent),
    metal: ramp(mix('#5a6b76', sky, 0.35)),
    warm: ramp(mix('#c8a06a', sky, 0.2)),
    ink: mix(sky, '#000000', 0.75),
    light: '#eef4f0',
  };
}

// ---------------------------------------------------------------------------
// A surface to draw on
// ---------------------------------------------------------------------------

/**
 * Wrap a 2D context in the only drawing operations this art style allows.
 *
 * Every coordinate is rounded, so nothing lands between pixels and turns soft
 * when it is scaled up.
 */
export function brush(ctx) {
  const round = Math.round;
  const api = {
    ctx,
    clear(colour) {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, SCREEN.width, SCREEN.height);
      return api;
    },
    rect(x, y, w, h, colour) {
      ctx.fillStyle = colour;
      ctx.fillRect(round(x), round(y), Math.max(1, round(w)), Math.max(1, round(h)));
      return api;
    },
    /** A horizontal run of single pixels — the workhorse for everything. */
    row(x, y, w, colour) { return api.rect(x, y, w, 1, colour); },
    column(x, y, h, colour) { return api.rect(x, y, 1, h, colour); },
    /**
     * Two colours interleaved on a checker, which is how a machine with
     * sixteen colours made a third one.
     */
    dither(x, y, w, h, a, b, phase = 0) {
      api.rect(x, y, w, h, a);
      ctx.fillStyle = b;
      for (let row = 0; row < round(h); row += 1) {
        for (let col = (row + phase) % 2; col < round(w); col += 2) {
          ctx.fillRect(round(x) + col, round(y) + row, 1, 1);
        }
      }
      return api;
    },
    /**
     * A filled circle on the pixel grid, drawn span by span so the edge is a
     * staircase rather than an anti-aliased smudge.
     */
    disc(cx, cy, r, colour) {
      ctx.fillStyle = colour;
      const radius = Math.max(1, round(r));
      for (let dy = -radius; dy <= radius; dy += 1) {
        const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
        if (half < 0) continue;
        ctx.fillRect(round(cx) - half, round(cy) + dy, half * 2 + 1, 1);
      }
      return api;
    },
    /** A body lit from one side: a disc, a terminator, and a highlight. */
    planet(cx, cy, r, shades) {
      api.disc(cx, cy, r, shades[1]);
      const radius = Math.max(1, round(r));
      for (let dy = -radius; dy <= radius; dy += 1) {
        const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
        if (half <= 0) continue;
        const lit = Math.max(0, half - Math.round(radius * 0.55) + Math.round(Math.abs(dy) * 0.2));
        if (lit > 0) ctx.fillStyle = shades[3], ctx.fillRect(round(cx) - half, round(cy) + dy, lit, 1);
      }
      if (radius > 3) api.disc(cx - radius * 0.4, cy - radius * 0.4, Math.max(1, radius * 0.22), shades[4]);
      return api;
    },
    /** A dotted run, for a route not travelled yet. */
    dots(x, y, w, colour, gap = 3) {
      for (let i = 0; i < round(w); i += gap) api.rect(x + i, y, 1, 1, colour);
      return api;
    },
    /**
     * Draw a sprite from rows of palette keys, one character per pixel.
     * Any key with no colour behind it — `.` by convention — is left clear.
     */
    sprite(x, y, rows, colours) {
      rows.forEach((line, dy) => {
        [...line].forEach((key, dx) => {
          const colour = colours[key];
          if (!colour) return;
          ctx.fillStyle = colour;
          ctx.fillRect(round(x) + dx, round(y) + dy, 1, 1);
        });
      });
      return api;
    },
  };
  return api;
}

/**
 * Deterministic noise, so a starfield is the same starfield every time the
 * component mounts and does not shimmer when React remounts it.
 */
export function stars(seed, count, width, height) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: Math.floor(next() * width),
    y: Math.floor(next() * height),
    // Three brightnesses, weighted toward the faintest, which is what makes a
    // field of dots read as depth rather than as confetti.
    magnitude: next() < 0.08 ? 2 : next() < 0.3 ? 1 : 0,
    phase: Math.floor(next() * 8),
  }));
}


// ---------------------------------------------------------------------------
// The station's layout
// ---------------------------------------------------------------------------

/** Where the floor meets the wall. Everything in the room is placed off it. */
export const HORIZON = 104;

/**
 * Where the room's parts live, in the canvas's own coordinate space.
 *
 * One set of numbers says both where a thing is drawn and where it can be
 * pressed, so the picture and the buttons over it cannot drift apart.
 */
export const STATIONS = {
  mentor: { x: 30, y: 88, w: 42, h: 62 },
  rhythm: { x: 236, y: 92, w: 54, h: 56 },
  piano: { x: 116, y: 102, w: 88, h: 52 },
  exit: { x: 274, y: 30, w: 34, h: 50 },
};
