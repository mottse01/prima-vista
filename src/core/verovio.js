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

/**
 * Engrave a generated score.
 * @returns {Promise<string>} SVG markup
 */
export async function renderScoreSvg(score, opts = {}) {
  const toolkit = await loadToolkit();
  toolkit.setOptions(OPTIONS);
  const xml = toMusicXml(score, opts);
  if (!toolkit.loadData(xml)) {
    throw new Error(toolkit.getLog() || 'The engraver could not read this exercise.');
  }
  return toolkit.renderToSVG(1);
}

export { toMusicXml };
