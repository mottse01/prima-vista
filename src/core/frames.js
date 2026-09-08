// A slow clock, for art that was drawn on a machine with a slow clock.
//
// Sixteen-bit animation ran at a handful of frames a second and that is a
// large part of why it reads the way it does: a sprite bobbing at eight frames
// a second looks hand-made, and the same sprite interpolated at sixty looks
// like a modern engine imitating one.
//
// It is also honest about cost. Nothing in this application needs a repaint
// every sixteen milliseconds to show somebody a room they are about to read
// music in, and a page that is not being looked at should not be drawing at
// all.

import { useEffect, useState } from 'react';

/** Eight frames a second: fast enough to breathe, slow enough to be drawn. */
export const FRAME_MS = 125;

export const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

/**
 * A frame counter that stops when the page is hidden or when somebody has
 * asked for less movement. Reduced motion holds on frame zero, which every
 * scene is drawn to look correct at rather than mid-bob.
 */
export function useSlowFrames(active = true) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active || prefersReducedMotion()) return undefined;
    let timer = null;
    const tick = () => setFrame((value) => (value + 1) % 4096);
    const start = () => {
      if (timer == null && !document.hidden) timer = window.setInterval(tick, FRAME_MS);
    };
    const stop = () => { if (timer != null) { window.clearInterval(timer); timer = null; } };
    const visibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', visibility);
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [active]);
  return frame;
}
