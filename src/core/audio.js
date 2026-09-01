// WebAudio engine: metronome, count-in, and a light piano-ish voice used for
// reference playback (useful for practice, but no longer a qualifying first read).

let ctx = null;
let bus = null;

export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browsers start the context suspended until a gesture. resume() is async,
  // but scheduling ahead of `currentTime` stays valid once it wakes.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Shared output bus. Everything goes through one compressor so that a
 * three-note left-hand chord under a melody does not clip — five partials per
 * note adds up fast.
 */
function output() {
  const ac = audioContext();
  if (!ac) return null;
  if (!bus || bus.context !== ac) {
    const g = ac.createGain();
    // Headroom for the worst case: a three-note left-hand chord under the
    // melody, five partials each, all struck together.
    g.gain.value = 0.62;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    g.connect(comp).connect(ac.destination);
    bus = g;
  }
  return bus;
}

/** True once the context is actually running, so the UI can prompt if not. */
export const audioReady = () => Boolean(ctx && ctx.state === 'running');

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A struck-string approximation: a handful of partials over one amplitude
 * envelope.
 *
 * The envelope has to live in exactly one place. An earlier version decayed the
 * master gain *and* each partial exponentially, and the two multiplied: notes
 * collapsed to silence in about 300ms regardless of their written length, which
 * made playback all but inaudible. The master gain now holds the note for its
 * duration and the partials only shade its colour.
 */
const PARTIALS = [[1, 1], [2, 0.32], [3, 0.14], [4, 0.07], [5.02, 0.03]];
const PARTIAL_SUM = PARTIALS.reduce((a, [, amp]) => a + amp, 0);

export function playPianoNote(when, midi, duration, gain = 0.5) {
  const ac = audioContext();
  const dest = output();
  if (!ac || !dest) return null;
  const f = midiToFreq(midi);

  // How long the note actually sings, and the short release that ends it.
  const hold = Math.min(3, Math.max(0.18, duration * 0.92));
  const release = 0.14;
  const peak = gain / PARTIAL_SUM;

  const out = ac.createGain();
  out.connect(dest);
  out.gain.setValueAtTime(0.0001, when);
  out.gain.exponentialRampToValueAtTime(peak, when + 0.006);
  // A real string loses energy while it rings, but must stay audible
  // throughout — hence a decay to a fraction rather than to nothing.
  out.gain.exponentialRampToValueAtTime(peak * 0.4, when + hold);
  out.gain.exponentialRampToValueAtTime(0.0001, when + hold + release);

  for (const [mult, amp] of PARTIALS) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * mult, when);
    const g = ac.createGain();
    // Upper partials fade first, which is what makes a struck string mellow as
    // it rings. They fade toward a floor, never silencing the note itself.
    g.gain.setValueAtTime(amp, when);
    if (mult > 1) {
      g.gain.exponentialRampToValueAtTime(amp * 0.08, when + Math.min(hold, 0.5 + 0.6 / mult));
    }
    osc.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + hold + release + 0.05);
  }
  return out;
}

export function playClick(when, accent = false) {
  const ac = audioContext();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 1600 : 1050, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.2 : 0.11, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(g).connect(output() || ac.destination);
  osc.start(when);
  osc.stop(when + 0.08);
}

/**
 * Schedules metronome clicks and (optionally) the score itself.
 * Returns a handle with stop().
 */
export function startPlayback({ score, startTime, metronome, playScore, onEnd }) {
  const ac = audioContext();
  if (!ac) return { stop() {} };
  const secPerTick = 60 / score.tempo / 48;
  const stops = [];

  if (metronome) {
    const beatTicks = score.ts.beat;
    const total = score.totalTicks;
    for (let t = 0; t <= total; t += beatTicks) {
      const at = startTime + t * secPerTick;
      playClick(at, t % score.ts.ticks === 0);
    }
  }

  if (playScore) {
    for (const hand of ['rh', 'lh']) {
      for (const note of score.staves[hand] || []) {
        if (note.rest) continue;
        for (const p of note.pitches) {
          const g = playPianoNote(
            startTime + note.onset * secPerTick,
            p.midi,
            note.duration * secPerTick,
            hand === 'lh' ? 0.38 : 0.5,
          );
          if (g) stops.push(g);
        }
      }
    }
  }

  const endsAt = startTime + score.totalTicks * secPerTick;
  const timer = setTimeout(() => onEnd && onEnd(), Math.max(0, (endsAt - ac.currentTime) * 1000) + 120);

  return {
    stop() {
      clearTimeout(timer);
      const now = ac.currentTime;
      for (const g of stops) {
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        } catch { /* node already finished */ }
      }
    },
  };
}

/** Count-in clicks before the exercise starts. Returns the exercise start time. */
export function scheduleCountIn(score, beats) {
  const ac = audioContext();
  const secPerBeat = (score.ts.beat / 48) * (60 / score.tempo);
  if (!ac) return performance.now() / 1000 + beats * secPerBeat;
  const start = ac.currentTime + 0.18;
  for (let i = 0; i < beats; i++) playClick(start + i * secPerBeat, i === 0);
  return start + beats * secPerBeat;
}

export const now = () => (audioContext() ? audioContext().currentTime : performance.now() / 1000);
