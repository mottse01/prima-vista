import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pageWidthForViewport, renderScoreSvg } from '../core/verovio.js';
import { xmlNoteId, xmlRestId, xmlSlurId } from '../core/musicxml.js';
import { eventShouldVanish } from '../core/curtain.js';
import { notationTickAtPlaybackTick } from '../core/playback.js';

// Renders the engraved score and everything drawn on top of it: the playhead,
// the playhead, vanishing-note drill, and per-note colouring.
//
// The overlay is driven imperatively rather than through React state. It moves
// every animation frame, and reconciling a component tree sixty times a second
// to slide one rectangle would be wasteful; measuring is also only possible
// once the SVG is in the document.

const STATE_COLOURS = {
  correct: 'var(--good)',
  late: 'var(--warn)',
  wrong: 'var(--bad)',
  missed: '#b9bfcc',
};

/**
 * Measure where every onset landed, as fractions of the rendered box, so the
 * overlay stays correct when the score is resized.
 */
function measureGeometry(host, score) {
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const box = host.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const fx = (v) => (v - box.left) / box.width;
  const fy = (v) => (v - box.top) / box.height;

  const systemEls = [...host.querySelectorAll('g.system')];
  const systems = systemEls.map((el) => {
    const r = el.getBoundingClientRect();
    return { top: fy(r.top), bottom: fy(r.bottom), left: fx(r.left), right: fx(r.right), musicLeft: fx(r.left) };
  });
  const systemOf = (el) => {
    const i = systemEls.findIndex((s) => s.contains(el));
    return i < 0 ? 0 : i;
  };

  // One entry per onset, positioned at whichever element represents it.
  const byTick = new Map();
  const consider = (id, onset) => {
    const el = host.querySelector(`[id="${id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const system = systemOf(el);
    const existing = byTick.get(onset);
    if (!existing || fx(r.left) < existing.x) {
      byTick.set(onset, { tick: onset, x: fx(r.left), system });
    }
  };

  for (const hand of ['rh', 'lh']) {
    for (const note of score.staves[hand] || []) {
      if (note.rest) consider(xmlRestId(hand, note.onset), note.onset);
      else for (const p of note.pitches) consider(xmlNoteId(hand, note.onset, p.midi), note.onset);
    }
  }

  // Engraved ties and split rests create additional written onsets.
  for (const element of host.querySelectorAll('g.note, g.rest')) {
    const match = element.id.match(/^[nr](rh|lh)-(\d+)(?:-|$)/);
    if (match) consider(element.id, Number(match[2]));
  }

  const ticks = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  // Close the timeline off at the final barline so the playhead runs to the end.
  const last = systems[systems.length - 1];
  if (ticks.length && last) {
    ticks.push({ tick: score.totalTicks, x: last.right, system: systems.length - 1 });
  }

  // Start each system's curtain just before its first event, sparing the clef.
  for (let i = 0; i < systems.length; i++) {
    const firstInSystem = ticks.find((t) => t.system === i);
    if (firstInSystem) systems[i].musicLeft = Math.max(systems[i].left, firstInSystem.x - 0.012);
  }

  return { systems, ticks };
}

/** Where the playhead sits at `tick`, interpolating between events. */
function positionAt(geom, tick) {
  const ticks = geom.ticks;
  if (!ticks.length) return null;
  if (tick <= ticks[0].tick) return { ...ticks[0] };
  for (let i = 0; i < ticks.length - 1; i++) {
    const a = ticks[i];
    const b = ticks[i + 1];
    if (tick >= a.tick && tick <= b.tick) {
      // Never glide across a line break; hold at the end of the line instead.
      if (a.system !== b.system) return { ...a };
      const f = b.tick === a.tick ? 0 : (tick - a.tick) / (b.tick - a.tick);
      return { tick, x: a.x + (b.x - a.x) * f, system: a.system };
    }
  }
  return { ...ticks[ticks.length - 1] };
}

/** Recover the generated event represented by a rendered Verovio note group. */
function eventForRenderedNote(score, element) {
  const match = element?.id?.match(/^[nr](rh|lh)-(\d+)(?:-|$)/);
  if (!match) return null;
  const hand = match[1];
  const onset = Number(match[2]);
  const source = (score.staves[hand] || []).find((event) => event.onset <= onset && event.onset + event.duration > onset);
  return source || { onset, duration: score.ts.beat };
}

/**
 * Associate expression glyphs with the note that should make them disappear.
 * Verovio retains explicit slur ids, while dynamics need to be paired to the
 * nearest rendered note in their measure because it replaces MusicXML ids.
 */
function measureExpressions(host, score) {
  const expressions = [];
  const claimed = new Set();

  for (const slur of score.slurs || []) {
    const element = host.querySelector(`[id="${xmlSlurId(slur.hand, slur.from, slur.to)}"]`);
    const source = (score.staves[slur.hand] || []).find((event) => event.onset === slur.to);
    if (!element) continue;
    expressions.push({ element, event: source || { onset: slur.to, duration: score.ts.beat } });
    claimed.add(element);
  }

  // Slurs split over a system break acquire an untagged continuation. Fade
  // that continuation with the last note it spans, preserving unread phrasing.
  for (const element of host.querySelectorAll('g.slur, g.tie')) {
    if (claimed.has(element)) continue;
    const system = element.closest('g.system');
    if (!system) continue;
    const slurBox = element.getBoundingClientRect();
    const candidates = [...system.querySelectorAll('g.note')]
      .map((note) => ({ note, box: note.getBoundingClientRect() }))
      .filter(({ note, box }) => (
        /^n(rh|lh)-/.test(note.id)
        && box.right >= slurBox.left - 4
        && box.left <= slurBox.right + 4
      ))
      .sort((a, b) => b.box.left - a.box.left
        || Math.abs((a.box.top + a.box.bottom) / 2 - (slurBox.top + slurBox.bottom) / 2)
          - Math.abs((b.box.top + b.box.bottom) / 2 - (slurBox.top + slurBox.bottom) / 2));
    const event = eventForRenderedNote(score, candidates[0]?.note);
    if (event) expressions.push({ element, event });
  }

  for (const hand of ['rh', 'lh']) {
    for (const source of score.staves[hand] || []) {
      if (!source.dynamic || source.rest || !source.pitches.length) continue;
      const note = host.querySelector(`[id="${xmlNoteId(hand, source.onset, source.pitches[0].midi)}"]`);
      const measure = note?.closest('g.measure');
      if (!note || !measure) continue;
      const noteBox = note.getBoundingClientRect();
      const noteX = (noteBox.left + noteBox.right) / 2;
      const noteY = (noteBox.top + noteBox.bottom) / 2;
      const element = [...measure.querySelectorAll('g.dynam')]
        .filter((candidate) => !claimed.has(candidate))
        .map((candidate) => {
          const box = candidate.getBoundingClientRect();
          const x = (box.left + box.right) / 2;
          const y = (box.top + box.bottom) / 2;
          return { candidate, distance: Math.abs(x - noteX) + Math.abs(y - noteY) * 0.25 };
        })
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (!element) continue;
      expressions.push({ element, event: source });
      claimed.add(element);
    }
  }

  return expressions;
}

export default function Score({
  score, showFingerings, noteStates, tick, vanishMode = 'off', vanishTick, layout = 'page', className, notationScale = 1,
}) {
  const viewportRef = useRef(null);
  const hostRef = useRef(null);
  const overlayRef = useRef(null);
  const geomRef = useRef(null);
  const paintedRef = useRef(new Set());
  const vanishedRef = useRef(new Set());
  const expressionsRef = useRef([]);
  const [pageWidth, setPageWidth] = useState(pageWidthForViewport);
  // The engraved result is tagged with the score it came from, so a stale
  // render is simply ignored rather than having to be cleared synchronously.
  const [result, setResult] = useState({ score: null, svg: null, error: null });
  const fresh = result.score === score ? result : { svg: null, error: null };
  const { svg, error } = fresh;
  const writtenTick = notationTickAtPlaybackTick(score, tick);
  const writtenVanishTick = notationTickAtPlaybackTick(score, vanishTick);

  // Engrave. Verovio is async and lazily loaded, so this settles a moment
  // after the exercise changes.
  useEffect(() => {
    const resize = () => setPageWidth((current) => {
      const next = pageWidthForViewport();
      return next === current ? current : next;
    });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    renderScoreSvg(score, { showFingerings, pageWidth: Math.round(pageWidth / notationScale), layout })
      .then((markup) => { if (!cancelled) setResult({ score, svg: markup, error: null }); })
      .catch((err) => {
        if (!cancelled) setResult({ score, svg: null, error: err.message || String(err) });
      });
    return () => { cancelled = true; };
  }, [layout, notationScale, pageWidth, score, showFingerings]);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, [layout, score]);

  const remeasure = useCallback(() => {
    if (!hostRef.current || !svg) return;
    geomRef.current = measureGeometry(hostRef.current, score);
  }, [score, svg]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = svg || '';
    paintedRef.current = new Set();
    vanishedRef.current = new Set();
    expressionsRef.current = [];
    if (!svg) { geomRef.current = null; return undefined; }
    remeasure();
    expressionsRef.current = measureExpressions(host, score);
    const ro = new ResizeObserver(remeasure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [score, svg, remeasure]);

  // Per-note colouring, applied straight to the engraved glyphs.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !svg) return;
    const states = noteStates || {};
    for (const id of paintedRef.current) {
      if (states[id]) continue;
      const el = host.querySelector(`[id="${id}"]`);
      if (el) for (const node of el.querySelectorAll('*')) node.style.removeProperty('fill');
    }
    const painted = new Set();
    for (const [id, state] of Object.entries(states)) {
      const el = host.querySelector(`[id="${id}"]`);
      if (!el) continue;
      const colour = STATE_COLOURS[state];
      if (!colour) continue;
      const head = el.querySelector('.notehead') || el;
      for (const node of head.querySelectorAll('*')) node.style.setProperty('fill', colour);
      painted.add(id);
    }
    paintedRef.current = painted;
  }, [noteStates, svg]);

  // Fade complete notation events rather than laying an opaque card over the
  // staff. During review `vanishTick` becomes null, restoring the full score.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !svg) return;
    const next = new Set();
    for (const element of host.querySelectorAll('g.note, g.rest')) {
      const event = eventForRenderedNote(score, element);
      if (!event || !eventShouldVanish(event, writtenVanishTick, vanishMode, score.ts)) continue;
      element.classList.add('sr-note-vanished');
      next.add(element.id);
    }
    for (const id of vanishedRef.current) {
      if (!next.has(id)) host.querySelector(`[id="${id}"]`)?.classList.remove('sr-note-vanished');
    }
    // A beam belongs to the whole rhythmic group; let it fade once every note
    // it joins has vanished so no disconnected strokes linger behind.
    for (const beam of host.querySelectorAll('g.beam')) {
      const notes = [...beam.querySelectorAll('g.note')];
      beam.classList.toggle('sr-beam-vanished', notes.length > 0 && notes.every((note) => note.classList.contains('sr-note-vanished')));
    }
    for (const { element, event } of expressionsRef.current) {
      element.classList.toggle(
        'sr-expression-vanished',
        eventShouldVanish(event, writtenVanishTick, vanishMode, score.ts),
      );
    }
    vanishedRef.current = next;
  }, [score, svg, vanishMode, writtenVanishTick]);

  // Playhead, redrawn in place as the take runs.
  useEffect(() => {
    const overlay = overlayRef.current;
    const geom = geomRef.current;
    if (!overlay) return;
    if (!geom) { overlay.innerHTML = ''; return; }

    const parts = [];
    if (writtenTick != null) {
      const head = positionAt(geom, writtenTick);
      if (head) {
        const sys = geom.systems[head.system];
        if (sys) {
          parts.push(`<rect class="sr-playhead-rect" x="${head.x * 100 - 0.18}" y="${sys.top * 100}" width="0.36" height="${(sys.bottom - sys.top) * 100}"/>`);
        }
        if (layout === 'scroll' && viewportRef.current && hostRef.current) {
          const target = head.x * hostRef.current.scrollWidth - viewportRef.current.clientWidth * 0.32;
          viewportRef.current.scrollLeft = Math.max(0, target);
        }
      }
    }
    overlay.innerHTML = parts.join('');
  }, [writtenTick, layout, svg]);

  return (
    <div
      ref={viewportRef}
      className={`sr-score-viewport is-${layout}`}
      tabIndex={layout === 'scroll' ? 0 : undefined}
      aria-label={layout === 'scroll' ? 'Horizontally scrolling music score' : undefined}
    >
      <div className={`sr-score sr-score--${layout} ${className || ''}`} aria-busy={!svg && !error}>
        <div ref={hostRef} className="sr-score-host" aria-label={scoreDescription(score)} role="img" />
        <svg
          ref={overlayRef}
          className="sr-score-overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        />
        {!svg && !error && (
          <div className="sr-score-loading" role="status">
            <div className="sr-staff-skeleton" aria-hidden="true">
              {Array.from({ length: 4 }, (_, system) => (
                <div className="sr-staff-skeleton-system" key={system}>
                  {Array.from({ length: 5 }, (_, line) => <span key={line} />)}
                </div>
              ))}
            </div>
            <span>Preparing notation</span>
          </div>
        )}
        {error && <div className="sr-score-error">{error}</div>}
      </div>
    </div>
  );
}

function scoreDescription(score) {
  const cadences = score.harmony?.cadences?.map((item) => item.short).join(', ');
  return [
    score.title,
    `${score.key.mode} key with ${score.key.fifths} fifths`,
    score.ts.name,
    `${score.measures} bars`,
    score.notationRepeat
      ? `bars ${score.notationRepeat.startMeasure + 1} through ${score.notationRepeat.endMeasure + 1} repeat once`
      : null,
    score.style?.label,
    score.form?.name,
    cadences ? `cadences ${cadences}` : null,
  ].filter(Boolean).join('. ');
}
