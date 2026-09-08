import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HORIZON, SCREEN, STATIONS, brush, luminance, mix, paletteFor, ramp, stars,
} from '../src/core/pixelart.js';
import { LOCATIONS } from '../src/core/adventure.js';

test('a ramp is five steps that can be told apart, whatever it starts from', () => {
  // A ramp whose steps collapse into each other is a flat colour wearing five
  // names, and everything drawn against it loses its shape. The awkward cases
  // are the extremes: near-white has no room for two steps above it and
  // near-black none below, so the run has to slide rather than flatten.
  for (const base of ['#70dcca', '#edb67b', '#101827', '#f4f8f2', '#000000', '#ffffff']) {
    const steps = ramp(base);
    assert.equal(steps.length, 5);
    for (let i = 1; i < steps.length; i += 1) {
      assert.ok(
        luminance(steps[i]) - luminance(steps[i - 1]) > 0.04,
        `${base} step ${i} (${steps[i]}) is not clearly lighter than ${steps[i - 1]}`,
      );
    }
  }
  // A colour with real room either side keeps its place in the middle of its
  // ramp. A bright mint does not have that room, and sliding is the right
  // answer for it rather than three identical highlights.
  assert.equal(ramp('#808080')[2], '#808080');
  assert.notEqual(ramp('#f4f8f2')[2], '#f4f8f2');
  // Sliding still keeps the colour: the middle step of a mint ramp is mint.
  const [r, g, b] = ['1', '3', '5'].map((i) => parseInt(ramp('#70dcca')[2][Number(i)] + ramp('#70dcca')[2][Number(i) + 1], 16));
  assert.ok(g > r && g > b && b > r, 'the ramp kept the hue it was given');
});

test('every destination gets a palette its own room is legible in', () => {
  // Palettes are derived from the two colours a location already carries, so a
  // new destination cannot arrive without one — but derivation is only worth
  // having if what comes out is actually readable.
  for (const location of LOCATIONS) {
    const palette = paletteFor(location);
    assert.ok(palette.accent.length === 5 && palette.sky.length === 5);
    // What is drawn on the wall has to separate from the wall.
    assert.ok(
      Math.abs(luminance(palette.accent[3]) - luminance(palette.sky[1])) >= 0.12,
      `${location.place} draws its accent too close to its wall`,
    );
    // And the darkest thing has to be darker than the room.
    assert.ok(luminance(palette.ink) < luminance(palette.sky[1]), location.place);
  }
  // A location with nothing set still answers rather than throwing.
  assert.ok(paletteFor().accent[2]);
  assert.ok(paletteFor({}).sky[0]);
});

test('mixing stays inside the range and hits its ends exactly', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  // Out-of-range amounts clamp rather than producing a colour that is not one.
  assert.equal(mix('#000000', '#ffffff', -3), '#000000');
  assert.equal(mix('#000000', '#ffffff', 9), '#ffffff');
  assert.equal(mix('#abc', '#abc', 0.5), '#aabbcc', 'three-digit hex is understood');
});

test('a starfield is the same starfield every time', () => {
  // React remounts components freely. A field regenerated on each mount would
  // shimmer, which on a picture that is meant to be still reads as a fault.
  const once = stars(4242, 40, SCREEN.width, SCREEN.height);
  const twice = stars(4242, 40, SCREEN.width, SCREEN.height);
  assert.deepEqual(once, twice);
  assert.notDeepEqual(once, stars(4243, 40, SCREEN.width, SCREEN.height));
  assert.equal(once.length, 40);
  for (const star of once) {
    assert.ok(Number.isInteger(star.x) && star.x >= 0 && star.x < SCREEN.width);
    assert.ok(Number.isInteger(star.y) && star.y >= 0 && star.y < SCREEN.height);
    assert.ok([0, 1, 2].includes(star.magnitude));
  }
});

test('nothing in the room is drawn off the screen or on top of the next thing', () => {
  // The same numbers place the picture and the buttons over it, so a station
  // that overlaps another is a station whose hotspot steals its neighbour's
  // taps.
  const boxes = Object.entries(STATIONS);
  for (const [name, box] of boxes) {
    assert.ok(box.x >= 0 && box.x + box.w <= SCREEN.width, `${name} runs off the side`);
    assert.ok(box.y >= 0 && box.y + box.h <= SCREEN.height, `${name} runs off the bottom`);
    // Big enough to hit with a thumb once the picture is scaled up.
    assert.ok(box.w >= 30 && box.h >= 40, `${name} is too small to press`);
  }
  for (const [nameA, a] of boxes) {
    for (const [nameB, b] of boxes) {
      if (nameA >= nameB) continue;
      const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlaps, false, `${nameA} and ${nameB} overlap`);
    }
  }
  assert.ok(HORIZON > 0 && HORIZON < SCREEN.height);
});

test('the brush never draws between pixels', () => {
  // Fractional coordinates are what turn pixel art into a photograph of pixel
  // art, so every operation rounds before it touches the canvas.
  const calls = [];
  const ctx = {
    set fillStyle(value) { this._fill = value; },
    get fillStyle() { return this._fill; },
    fillRect(x, y, w, h) { calls.push([x, y, w, h]); },
  };
  const pen = brush(ctx);
  pen.rect(3.4, 7.6, 5.5, 2.2, '#fff');
  pen.disc(10.5, 10.5, 3.2, '#fff');
  pen.sprite(2.7, 4.2, ['#.#'], { '#': '#fff' });
  for (const call of calls) {
    for (const value of call) assert.ok(Number.isInteger(value), `${call} is not on the grid`);
  }
  assert.ok(calls.length > 3);
  // Zero-sized rectangles would be invisible; the brush floors at one pixel.
  calls.length = 0;
  pen.rect(0, 0, 0.2, 0.2, '#fff');
  assert.deepEqual(calls[0].slice(2), [1, 1]);
});
