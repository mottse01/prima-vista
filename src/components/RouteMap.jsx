import { useMemo, useState } from 'react';
import PixelStage, { Hotspot } from './PixelStage.jsx';
import { SCREEN, mix, paletteFor, ramp, stars } from '../core/pixelart.js';
import { journeyState } from '../core/journey.js';
import { isOpen, lockReason } from '../core/missions.js';
import { useSlowFrames } from '../core/frames.js';

// The route, drawn flat.
//
// This replaces an orbiting three-dimensional solar system that cost half a
// megabyte of engine to show ten dots in a row. What a reader needs from it is
// what a sixteen-bit overworld map gave you in one glance: where you are, what
// you have opened, what is next, and a path between them you can see. None of
// that wanted a camera.
//
// The line is the trajectory the Voyagers actually took, which is also the
// order the levels go in and the order the passages were written — see
// docs/the-reply.md. The distances are compressed, monotonically: what is
// further out is drawn further out.

/** Where each waypoint sits on the ribbon. */
const NODES = Array.from({ length: 10 }, (_, index) => ({
  x: 32 + index * 29,
  // A wave rather than a straight line, so the eye travels along it and the
  // ten places do not read as a row of buttons.
  y: 92 + Math.round(Math.sin(index * 0.72 + 0.4) * 26),
}));

/** Compressed body sizes: Jupiter must be biggest, Ceres smallest, all legible. */
const sizeFor = (waypoint) => {
  if (!waypoint.radius) return 2;
  return Math.max(3, Math.min(11, Math.round(3 + (waypoint.radius / 69911) ** 0.32 * 8)));
};

export default function RouteMap({ profile, onPick, gated = true }) {
  // The expedition's route is earned; the practice room's map is not. Reading
  // `isOpen` unconditionally would have locked the piano room behind the
  // course, which is the one thing the two rooms exist to keep separate.
  const reachable = (level) => !gated || isOpen(profile, level);
  const frame = useSlowFrames();
  const [hover, setHover] = useState(null);
  const journey = useMemo(() => journeyState(profile), [profile]);
  const field = useMemo(() => stars(20260908, 150, SCREEN.width, SCREEN.height), []);

  const draw = (pen, tick) => {
    const deep = '#070b14';
    pen.clear(deep);
    // Three depths of star, the faintest of which never twinkles. A field
    // where everything moves reads as static noise.
    for (const star of field) {
      const shade = star.magnitude === 2 ? '#dfe9f5' : star.magnitude === 1 ? '#8fa3bd' : '#41506a';
      const lit = star.magnitude === 2 && (tick + star.phase) % 8 < 5;
      pen.rect(star.x, star.y, 1, 1, lit ? '#ffffff' : shade);
    }
    // The Sun, off the left edge: everything here is measured from it.
    const sun = ramp('#ffd48a');
    pen.disc(-14, 90, 36, sun[1]);
    pen.disc(-14, 90, 31, sun[2]);
    pen.disc(-18, 86, 23, sun[4]);

    journey.forEach((waypoint, index) => {
      const node = NODES[index];
      const open = reachable(waypoint.level);
      const previous = index === 0 ? { x: 12, y: 90 } : NODES[index - 1];
      // The path is solid as far as the course is open and dotted past it, so
      // the shape of the whole journey is visible from the first day.
      const steps = Math.max(1, Math.round(Math.hypot(node.x - previous.x, node.y - previous.y)));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = previous.x + (node.x - previous.x) * t;
        const y = previous.y + (node.y - previous.y) * t;
        if (open) pen.rect(x, y, 1, 1, mix('#2f4a63', waypoint.colour, 0.35));
        else if (step % 4 === 0) pen.rect(x, y, 1, 1, '#243247');
      }
    });

    journey.forEach((waypoint, index) => {
      const node = NODES[index];
      const open = reachable(waypoint.level);
      const size = sizeFor(waypoint);
      const shades = ramp(open ? waypoint.colour : mix(waypoint.colour, '#101827', 0.72));
      // Saturn is the one body a child will look for, so it keeps its rings.
      if (waypoint.ring) {
        pen.row(node.x - size - 4, node.y, size * 2 + 9, shades[open ? 3 : 1]);
        pen.row(node.x - size - 3, node.y - 1, size * 2 + 7, shades[open ? 1 : 0]);
      }
      pen.planet(node.x, node.y, size, shades);
      if (waypoint.reached) {
        // A ring of light around somewhere you have read: the map's only
        // reward, and it is a picture rather than a number.
        pen.rect(node.x - size - 3, node.y - size - 3, 3, 1, shades[4]);
        pen.rect(node.x - size - 3, node.y - size - 3, 1, 3, shades[4]);
        pen.rect(node.x + size + 1, node.y + size + 3, 3, 1, shades[4]);
        pen.rect(node.x + size + 3, node.y + size + 1, 1, 3, shades[4]);
      }
      if (waypoint.current) {
        // The craft, bobbing. It is the only thing on this map that moves.
        const lift = tick % 8 < 4 ? 0 : 1;
        const top = node.y - size - 12 + lift;
        pen.sprite(node.x - 3, top, [
          '..#..',
          '.###.',
          '#####',
          '#.#.#',
          '..o..',
        ], { '#': '#dfe9f5', o: '#ffd48a' });
      }
      if (!open) {
        const palette = paletteFor({ sky: '#0d1520', color: waypoint.colour });
        pen.rect(node.x - 1, node.y - size - 7, 3, 3, palette.metal[2]);
        pen.rect(node.x, node.y - size - 6, 1, 1, palette.ink);
      }
    });
  };

  return (
    <PixelStage
      className="pv-route"
      draw={draw}
      frame={frame}
      label="The route outward from the Sun, with ten destinations along it."
    >
      {journey.map((waypoint, index) => {
        const open = reachable(waypoint.level);
        const node = NODES[index];
        const size = sizeFor(waypoint) + 7;
        return (
          <Hotspot
            key={waypoint.level}
            x={node.x - size} y={node.y - size} w={size * 2} h={size * 2}
            label={waypoint.name}
            hint={open ? `Level ${waypoint.level}` : lockReason(profile, waypoint.level)}
            current={waypoint.current}
            disabled={!open}
            onHover={setHover}
            onClick={() => onPick(waypoint.level)}
          />
        );
      })}
      <p className="pv-route-readout" role="status">
        {hover || `${journey.find((item) => item.current)?.name || 'Luna'} · you are here`}
      </p>
    </PixelStage>
  );
}
