// The lifecycle every WebGL scene in this app needs, written once.
//
// Both the station and the orrery have to create a renderer, keep it the size
// of its host, run a frame loop, and give every geometry, material and texture
// back when they are torn down. Writing that twice is how one of them ended up
// with a still frame that survived a resize and left the room blank — the kind
// of defect that only exists in the copy nobody just edited.
//
// This owns the lifecycle and nothing else. What to build and how to draw it
// stays with the scene.

import * as THREE from 'three';

/** Is the viewer asking for less motion? Read once, honoured by the caller. */
export const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
);

export function supportsWebGL() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Mount a renderer into `host` and keep it in step with the element's size.
 *
 * Returns null when WebGL is unavailable, so a caller can fall back rather
 * than throw. `dispose()` releases everything handed to `track()` along with
 * the renderer and its canvas.
 *
 * `run(draw)` starts a frame loop. `draw` is called with the seconds since the
 * last frame and a monotonic clock. A scene that only needs a still frame — one
 * that is paused, or on a page the browser has stopped serving frames to — can
 * ask `stage.stale` whether the last frame it drew is still valid; a resize
 * makes it stale again, because resizing a WebGL canvas clears it.
 */
export function createStage(host, {
  camera,
  alpha = true,
  antialias = true,
  maxPixelRatio = 2,
  powerPreference = 'high-performance',
  clearColor = null,
  className = '',
} = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias, alpha, powerPreference });
  } catch {
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  if (clearColor !== null) renderer.setClearColor(clearColor, alpha ? 0 : 1);
  if (className) renderer.domElement.className = className;
  host.appendChild(renderer.domElement);

  const disposables = [];
  let frame = 0;
  let firstPaint = 0;
  let stale = true;

  const applySize = () => {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    if (camera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    // A resized canvas has been cleared, so whatever was on it is gone.
    stale = true;
  };
  applySize();
  const observer = new ResizeObserver(applySize);
  observer.observe(host);

  const stage = {
    renderer,
    canvas: renderer.domElement,
    get stale() { return stale; },
    /** Mark the last drawn frame as no longer representing the scene. */
    invalidate() { stale = true; },
    /** Record that a frame was just drawn for the current size and state. */
    settle() { stale = false; },
    /** Hand over anything that must be released when the stage is disposed. */
    track(...items) {
      for (const item of items) if (item?.dispose) disposables.push(item);
      return items[0];
    },
    run(draw) {
      let previous = 0;
      let drawn = false;
      const tick = (now) => {
        frame = requestAnimationFrame(tick);
        const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
        previous = now;
        drawn = true;
        draw(delta, now);
      };
      frame = requestAnimationFrame(tick);
      // A page the browser has stopped serving animation frames to — a
      // background tab, a hidden panel — would otherwise show an empty canvas
      // until it comes forward. One frame is drawn regardless, so there is
      // always something on the glass.
      firstPaint = setTimeout(() => { if (!drawn) draw(0, performance.now()); }, 120);
    },
    dispose() {
      cancelAnimationFrame(frame);
      clearTimeout(firstPaint);
      observer.disconnect();
      for (const item of disposables) {
        try { item.dispose(); } catch { /* already released */ }
      }
      disposables.length = 0;
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return stage;
}
