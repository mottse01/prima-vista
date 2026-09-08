import { useMemo } from 'react';
import PixelStage, { Hotspot } from './PixelStage.jsx';
import { HORIZON, SCREEN, STATIONS, mix, paletteFor, ramp, stars } from '../core/pixelart.js';
import { waypointFor } from '../core/journey.js';
import { useSlowFrames } from '../core/frames.js';

// One room, one screen, no camera.
//
// The station used to be a navigable three-dimensional space you walked around
// with W A S D and later turned like a diorama. Both were a menu in a costume:
// three things to press, each opening a panel. What a single screen gives up
// is a camera nobody needed, and what it buys is a room that loads instantly,
// works the same on every device, has no fallback path when WebGL is missing,
// and whose three things to press are real buttons that a screen reader and a
// keyboard already understand.
//
// Ten rooms are drawn from one vocabulary of parts — wall, window, floor grid,
// console, and a few pieces of set dressing per kind of place — recoloured
// from each location's own palette. That is how a tile set works and it is why
// ten rooms made this way look like one world, which ten separately made
// pictures never do.

/** The view out, built from the destination's own astronomy. */
function drawWindow(pen, location, field, tick) {
  const waypoint = waypointFor(location.level || 1);
  const palette = paletteFor(location);
  const [left, top, right, bottom] = [46, 20, 274, 94];
  pen.rect(left, top, right - left, bottom - top, palette.void);
  for (const star of field) {
    if (star.x < left + 2 || star.x > right - 3 || star.y < top + 2 || star.y > bottom - 3) continue;
    const shade = star.magnitude === 2 ? '#e8f0fa' : star.magnitude === 1 ? '#8ea4c0' : '#3d4c66';
    pen.rect(star.x, star.y, 1, 1, (star.magnitude === 2 && (tick + star.phase) % 8 < 5) ? '#ffffff' : shade);
  }
  // The world this place is at, big enough to be the reason for the window.
  const shades = ramp(waypoint.colour);
  const size = Math.max(14, Math.min(46, Math.round(16 + (waypoint.radius / 69911) ** 0.3 * 30)));
  const cx = right - 58;
  const cy = bottom - 6;
  if (waypoint.ring) {
    pen.row(cx - size - 16, cy - Math.round(size * 0.45), size * 2 + 33, shades[3]);
    pen.row(cx - size - 14, cy - Math.round(size * 0.45) - 1, size * 2 + 29, shades[1]);
  }
  pen.planet(cx, cy, size, shades);
  // Mullions: the window is a window, not a hole.
  pen.rect(left, top, right - left, 2, palette.metal[1]);
  pen.rect(left, bottom - 2, right - left, 2, palette.metal[1]);
  pen.rect(left, top, 2, bottom - top, palette.metal[1]);
  pen.rect(right - 2, top, 2, bottom - top, palette.metal[1]);
  for (let x = left + 56; x < right - 8; x += 56) pen.rect(x, top, 2, bottom - top, palette.metal[1]);
  pen.row(left, top + 2, right - left, palette.metal[3]);
}

/** Floor: a converging grid, which is all a flat room needs to have depth. */
function drawFloor(pen, palette, tick) {
  pen.rect(0, HORIZON, SCREEN.width, SCREEN.height - HORIZON, palette.sky[0]);
  pen.dither(0, HORIZON, SCREEN.width, 10, palette.sky[0], palette.sky[1]);
  let y = HORIZON + 6;
  let gap = 3;
  while (y < SCREEN.height) {
    pen.row(0, y, SCREEN.width, mix(palette.sky[1], palette.accent[1], 0.25));
    y += gap;
    gap = Math.round(gap * 1.34);
  }
  for (let i = -6; i <= 6; i += 1) {
    const spread = i * 52;
    for (let step = 0; step < SCREEN.height - HORIZON; step += 1) {
      const t = step / (SCREEN.height - HORIZON);
      pen.rect(SCREEN.width / 2 + spread * t, HORIZON + step, 1, 1, mix(palette.sky[1], palette.accent[1], 0.18));
    }
  }
  // A slow band of light crossing the deck, so the room is never quite still.
  const sweep = (tick * 3) % (SCREEN.width + 120) - 60;
  pen.dither(sweep, HORIZON + 12, 40, SCREEN.height - HORIZON - 12, palette.sky[0], palette.sky[1], 1);
}

/** The wall above and beside the window. */
function drawWall(pen, palette) {
  pen.rect(0, 0, SCREEN.width, HORIZON, palette.sky[1]);
  pen.rect(0, 0, SCREEN.width, 14, palette.sky[0]);
  pen.row(0, 14, SCREEN.width, palette.metal[1]);
  for (let x = 8; x < SCREEN.width; x += 32) pen.rect(x, 2, 18, 3, palette.accent[3]);
  pen.row(0, HORIZON - 1, SCREEN.width, palette.metal[0]);
}

const LYRA = [
  '....####....',
  '...######...',
  '..##hhhh##..',
  '..#hffff h..',
  '..#ffeefe#..',
  '...ffffff...',
  '....ffff....',
  '.....cc.....',
  '...cccccc...',
  '..cccccccc..',
  '.cc#cccc#cc.',
  '.cc#cccc#cc.',
  '..cccccccc..',
  '..cc.cc.cc..',
  '..cc.cc.cc..',
  '..bb.cc.bb..',
  '...b....b...',
  '..bbb..bbb..',
];

/** Lyra, standing where she can see the score. */
function drawLyra(pen, palette, tick, lit) {
  const { x, y } = STATIONS.mentor;
  // She shifts her weight every second or so. That is the whole animation and
  // it is enough to make a room feel occupied.
  const breath = tick % 16 < 8 ? 0 : 1;
  pen.rect(x + 12, y + 56, 20, 3, palette.ink);
  pen.sprite(x + 13, y + 24 + breath, LYRA, {
    '#': mix('#2b3b4a', palette.sky[0], 0.3),
    h: '#4a3a30',
    f: '#d8b49a',
    e: '#2b2320',
    c: lit ? palette.accent[3] : palette.accent[2],
    b: mix('#3a4a58', palette.sky[0], 0.2),
  });
  // A desk with her working notes on it.
  pen.rect(x + 2, y + 44, 38, 3, palette.metal[2]);
  pen.rect(x + 6, y + 47, 4, 12, palette.metal[1]);
  pen.rect(x + 32, y + 47, 4, 12, palette.metal[1]);
  pen.rect(x + 8, y + 40, 12, 4, palette.light);
  pen.row(x + 9, y + 41, 10, palette.ink);
  pen.row(x + 9, y + 43, 10, palette.ink);
}

/** The rhythm desk: one key, and a line of beats above it. */
function drawRhythmDesk(pen, palette, tick, lit, done) {
  const { x, y } = STATIONS.rhythm;
  pen.rect(x + 2, y + 26, 48, 26, palette.metal[1]);
  pen.rect(x + 2, y + 26, 48, 3, palette.metal[3]);
  pen.rect(x + 6, y + 6, 40, 20, palette.ink);
  pen.rect(x + 7, y + 7, 38, 18, mix(palette.sky[0], palette.accent[0], 0.5));
  // Five beats, one of them lit and stepping along: the pulse, made visible.
  for (let i = 0; i < 5; i += 1) {
    const on = done || i === tick % 5;
    pen.rect(x + 11 + i * 7, y + 13, 4, 4, on ? palette.accent[4] : palette.accent[1]);
  }
  pen.row(x + 10, y + 20, 32, palette.accent[lit ? 3 : 1]);
  // The single key you tap it out on.
  pen.rect(x + 16, y + 30, 20, 6, palette.light);
  pen.row(x + 16, y + 30, 20, '#ffffff');
}

/** The piano: the only thing in the room that is the point of the room. */
function drawPiano(pen, palette, tick, lit, done) {
  const { x, y } = STATIONS.piano;
  pen.rect(x + 4, y + 20, 80, 24, palette.metal[1]);
  pen.rect(x + 4, y + 20, 80, 3, palette.metal[3]);
  pen.rect(x + 8, y + 44, 5, 6, palette.metal[0]);
  pen.rect(x + 75, y + 44, 5, 6, palette.metal[0]);
  // Keys.
  for (let i = 0; i < 22; i += 1) pen.rect(x + 8 + i * 3.4, y + 24, 3, 12, palette.light);
  for (let i = 0; i < 22; i += 1) {
    if ([2, 6].includes(i % 7)) continue;
    pen.rect(x + 10 + i * 3.4, y + 24, 2, 7, palette.ink);
  }
  // The stand, with a passage on it. Bars of it light up while it waits.
  pen.rect(x + 18, y - 12, 52, 30, palette.ink);
  pen.rect(x + 20, y - 10, 48, 26, palette.light);
  for (let line = 0; line < 5; line += 1) pen.row(x + 24, y - 6 + line * 3, 40, mix(palette.ink, palette.light, 0.4));
  for (let note = 0; note < 6; note += 1) {
    const on = done || (tick + note) % 12 < 6;
    pen.rect(x + 27 + note * 6, y - 5 + (note % 3) * 3, 3, 2, on ? palette.accent[0] : mix(palette.ink, palette.light, 0.55));
  }
  if (lit) pen.row(x + 18, y - 13, 52, palette.accent[4]);
}

/** The airlock: the way onward, shut until the reading opens it. */
function drawExit(pen, palette, tick, open) {
  const { x, y } = STATIONS.exit;
  pen.rect(x, y, 32, 46, palette.metal[0]);
  pen.rect(x + 2, y + 2, 28, 42, palette.ink);
  const gap = open ? 9 : 1;
  pen.rect(x + 3, y + 3, 13 - gap, 40, palette.metal[2]);
  pen.rect(x + 17 + gap, y + 3, 13 - gap, 40, palette.metal[2]);
  if (open) {
    pen.rect(x + 14, y + 3, 5, 40, mix(palette.accent[4], palette.sky[0], (tick % 8) / 12));
  }
  pen.rect(x + 12, y - 6, 9, 4, open ? palette.accent[4] : palette.warm[2]);
}

/** Set dressing, so an archive is not a greenhouse with different lights. */
function drawDressing(pen, palette, type, tick) {
  const shelf = (x, y) => {
    pen.rect(x, y, 16, 34, palette.metal[0]);
    for (let i = 0; i < 5; i += 1) {
      pen.rect(x + 1, y + 2 + i * 7, 14, 5, palette.metal[1]);
      pen.rect(x + 2, y + 3 + i * 7, 11, 3, palette.accent[i % 2 ? 1 : 2]);
    }
  };
  const plant = (x, y, tall) => {
    pen.rect(x, y + tall, 12, 6, palette.metal[1]);
    for (let i = 0; i < 3; i += 1) {
      const lean = (tick + i * 3) % 16 < 8 ? 0 : 1;
      pen.rect(x + 3 + i * 3, y + 2, 1, tall - 2, '#4f9f76');
      pen.rect(x + 1 + i * 3 + lean, y + 2 + i, 5, 1, '#6fbf90');
    }
  };
  if (type === 'garden' || type === 'greenhouse') {
    plant(8, 118, 16); plant(24, 126, 12); plant(292, 120, 14);
    if (type === 'greenhouse') for (const x of [6, 290]) pen.rect(x, 104, 20, 2, palette.accent[3]);
  } else if (type === 'archive') {
    shelf(6, 104); shelf(292, 106);
  } else if (type === 'workshop') {
    pen.rect(6, 112, 26, 4, palette.metal[2]);
    pen.rect(8, 116, 3, 14, palette.metal[1]); pen.rect(28, 116, 3, 14, palette.metal[1]);
    for (let i = 0; i < 4; i += 1) pen.rect(10 + i * 5, 106, 2, 6, palette.warm[3]);
    pen.rect(294, 110, 18, 5, palette.metal[1]);
  } else if (type === 'shelter') {
    pen.rect(6, 116, 24, 18, palette.metal[1]);
    pen.rect(6, 116, 24, 3, palette.metal[3]);
    const flicker = tick % 12 < 7 ? 4 : 3;
    pen.rect(292, 112, 12, 14, palette.metal[0]);
    pen.rect(294, 114, 8, 10, palette.warm[flicker]);
  } else if (type === 'relay') {
    for (const [x, y] of [[10, 100], [292, 104]]) {
      pen.rect(x + 6, y + 10, 3, 22, palette.metal[1]);
      pen.rect(x, y, 16, 4, palette.metal[3]);
      pen.rect(x + 2, y + 4, 12, 3, palette.metal[2]);
      pen.rect(x + 7, y - 4, 1, 5, palette.accent[(tick % 8 < 4) ? 4 : 2]);
    }
  } else {
    // An observatory: a telescope pointed at whatever is outside.
    pen.rect(8, 108, 4, 26, palette.metal[1]);
    pen.rect(2, 96, 22, 8, palette.metal[2]);
    pen.rect(2, 96, 22, 2, palette.metal[4]);
    pen.rect(292, 116, 16, 18, palette.metal[1]);
    pen.rect(295, 119, 10, 8, palette.accent[(tick % 16 < 8) ? 2 : 1]);
  }
}

export default function StationScene({ location, level, room, onInteract, onHover, active }) {
  const frame = useSlowFrames();
  const field = useMemo(() => stars(location.place.length * 7919 + level, 110, SCREEN.width, SCREEN.height), [location.place, level]);
  const palette = useMemo(() => paletteFor(location), [location]);
  const complete = room.power && room.signal && room.music;

  const draw = (pen, tick) => {
    pen.clear(palette.sky[1]);
    drawWall(pen, palette);
    drawWindow(pen, { ...location, level }, field, tick);
    drawFloor(pen, palette, tick);
    drawDressing(pen, palette, location.type, tick);
    drawExit(pen, palette, tick, complete);
    drawLyra(pen, palette, tick, active === 'power');
    drawRhythmDesk(pen, palette, tick, active === 'signal', room.signal);
    drawPiano(pen, palette, tick, active === 'piano', room.music);
  };

  const steps = [
    ['mentor', 'power', 'Look at it', 'Lyra shows you what to notice'],
    ['rhythm', 'signal', 'Find the beat', 'Tap the rhythm on one note'],
    ['piano', 'music', 'Play it', 'Read the passage at the piano'],
  ];

  return (
    <PixelStage
      className="pv-station"
      draw={draw}
      frame={frame}
      label={`${location.subtitle} at ${location.place}. Lyra, a rhythm desk, a piano, and the way onward.`}
    >
      {steps.map(([id, flag, label, hint]) => (
        <Hotspot
          key={id}
          {...STATIONS[id]}
          label={room[flag] ? `✓ ${label}` : label}
          hint={hint}
          current={active === (id === 'mentor' ? 'power' : id === 'rhythm' ? 'signal' : 'piano')}
          onHover={onHover}
          onClick={() => onInteract(id === 'mentor' ? 'mentor' : id === 'rhythm' ? 'rhythm' : 'piano')}
        />
      ))}
      <Hotspot
        {...STATIONS.exit}
        label="Move on"
        hint={complete ? 'The way onward is open' : 'Reading here opens it'}
        current={active === 'exit'}
        onHover={onHover}
        onClick={() => onInteract('exit')}
      />
    </PixelStage>
  );
}
