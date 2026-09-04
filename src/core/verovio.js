// Verovio renderer.
//
// The engraving is done by Verovio, the same engine behind scholarly and
// commercial editions: it implements the professional rules for spacing, beam
// slopes, slur shapes, accidental stacking and collision avoidance that a
// hand-rolled renderer never gets right. We hand it MusicXML and it hands back
// SVG carrying the note ids we chose, which is what lets the playhead, the
// look-ahead curtain and live note colouring find individual notes again.
//
// The toolkit is a WebAssembly module of some size, so it is imported lazily:
// the page shell renders immediately and the engraver arrives just behind it.

import { toMusicXml } from './musicxml.js';

let toolkitPromise = null;
let renderQueue = Promise.resolve();
const renderCache = new Map();

function loadToolkit() {
  if (!toolkitPromise) {
    toolkitPromise = (async () => {
      const [wasm, esm] = await Promise.all([
        import('verovio/wasm'),
        import('verovio/esm'),
      ]);
      const module = await wasm.default();
      return new esm.VerovioToolkit(module);
    })().catch((err) => {
      // Let a later attempt retry rather than caching the failure forever.
      toolkitPromise = null;
      throw err;
    });
  }
  return toolkitPromise;
}

/** Start fetching the engraver before anything needs it. */
export const warmUp = () => loadToolkit().catch(() => {});

// A fixed page width keeps line breaking deterministic; the SVG carries a
// viewBox, so it scales to whatever width the page gives it.
const PAGE_WIDTH = 2100;

export function pageWidthForViewport() {
  if (typeof window === 'undefined') return 1850;
  if (window.innerWidth < 560) return 860;
  if (window.innerWidth < 900) return 1200;
  if (window.innerWidth < 1220) return 1500;
  return 1850;
}

const OPTIONS = {
  scale: 40,
  pageWidth: PAGE_WIDTH,
  pageMarginLeft: 40,
  pageMarginRight: 40,
  pageMarginTop: 30,
  pageMarginBottom: 10,
  adjustPageHeight: true,
  breaks: 'auto',
  header: 'none',
  footer: 'none',
  svgViewBox: true,
  svgRemoveXlink: true,
  spacingStaff: 8,
  spacingSystem: 10,
};

export function scoreLayoutOptions(layout, pageWidth) {
  if (layout === 'scroll') {
    return {
      ...OPTIONS,
      pageWidth,
      breaks: 'none',
      adjustPageWidth: true,
      adjustPageHeight: true,
    };
  }
  return { ...OPTIONS, pageWidth, breaks: 'auto', adjustPageWidth: false };
}

/**
 * Engrave a generated score.
 * @returns {Promise<string>} SVG markup
 */
export async function renderScoreSvg(score, opts = {}) {
  const { pageWidth = PAGE_WIDTH, layout = 'page', ...musicXmlOptions } = opts;
  const xml = toMusicXml(score, musicXmlOptions);
  const key = `${layout}:${pageWidth}:${musicXmlOptions.showFingerings ? 1 : 0}:${hashText(xml)}`;
  if (renderCache.has(key)) return renderCache.get(key);

  const job = renderQueue.then(async () => {
    const toolkit = await loadToolkit();
    toolkit.setOptions(scoreLayoutOptions(layout, pageWidth));
    if (!toolkit.loadData(xml)) {
      throw new Error(toolkit.getLog() || 'The engraver could not read this exercise.');
    }
    return toolkit.renderToSVG(1);
  });
  renderQueue = job.catch(() => {});
  renderCache.set(key, job);
  if (renderCache.size > 12) renderCache.delete(renderCache.keys().next().value);
  try {
    return await job;
  } catch (error) {
    renderCache.delete(key);
    throw error;
  }
}

/** Prepare a future exercise without making its notation visible. */
export const primeScoreRender = (score, opts = {}) => renderScoreSvg(score, opts).catch(() => null);

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export { toMusicXml };
