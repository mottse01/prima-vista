// WebAudio engine: metronome, count-in, live keys, and a lightweight
// piano-like reference voice.

let ctx = null;
let bus = null;
let masterVolume = 0.82;
const stateListeners = new Set();

function audioConstructor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function reportState() {
  const state = audioState();
  for (const listener of stateListeners) listener(state);
}

export function audioState() {
  if (!audioConstructor()) return 'unavailable';
  return ctx?.state || 'idle';
}

export function subscribeAudioState(listener) {
  stateListeners.add(listener);
  listener(audioState());
  return () => stateListeners.delete(listener);
}

export function audioContext() {
  const AC = audioConstructor();
  if (!AC) return null;
  if (!ctx || ctx.state === 'closed') {
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      // Older WebKit accepts no constructor options.
      ctx = new AC();
    }
    bus = null;
    ctx.onstatechange = reportState;
    reportState();
  }
  return ctx;
}

/**
 * Release browser audio from autoplay suspension inside a user gesture.
 *
 * Creating a context and immediately scheduling against currentTime is not
 * reliable on Safari/iOS or inside an embedded site: currentTime can remain at
 * zero until resume() settles, leaving the entire score silently in the past.
 * Every transport action awaits this function before it computes timestamps.
 */
export async function unlockAudio() {
  const ac = audioContext();
  if (!ac) return false;

  try {
    // A one-frame silent source primes older WebKit audio stacks. start() is
    // deliberately called before the first await so it is still in the click,
    // pointer, or keyboard gesture that reached us.
    if (ac.state !== 'running' && ac.createBuffer && ac.createBufferSource) {
      const source = ac.createBufferSource();
      source.buffer = ac.createBuffer(1, 1, ac.sampleRate || 44100);
      source.connect(ac.destination);
      source.start(0);
    }
    if (ac.state !== 'running' && ac.resume) await ac.resume();
    reportState();
    return ac.state === 'running';
  } catch {
    reportState();
    return false;
  }
}

export const audioReady = () => audioState() === 'running';

export function setMasterVolume(value) {
  masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (bus && ctx) {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.018);
  }
}

/** Shared output bus with headroom for two hands and full chords. */
function output(ac = audioContext()) {
  if (!ac) return null;
  if (!bus || bus.context !== ac) {
    const g = ac.createGain();
    g.gain.value = masterVolume;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    g.connect(comp).connect(ac.destination);
    bus = g;
  }
  return bus;
}

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PARTIALS = [[1, 1], [2, 0.32], [3, 0.14], [4, 0.07], [5.02, 0.03]];
const PARTIAL_SUM = PARTIALS.reduce((a, [, amp]) => a + amp, 0);

/** A small struck-string approximation with one shared amplitude envelope. */
export function playPianoNote(when, midi, duration, gain = 0.5) {
  const ac = audioContext();
  const dest = output(ac);
  if (!ac || !dest) return null;
  if (ac.state !== 'running' && ac.resume) ac.resume().catch(() => {});

  // Never schedule at zero or behind the live clock. This is the other half of
  // the Safari fix: a newly resumed context can advance between await and use.
  const startAt = Math.max(ac.currentTime + 0.008, Number(when) || 0);
  const f = midiToFreq(midi);
  const hold = Math.min(3, Math.max(0.18, duration * 0.92));
  const release = 0.16;
  const peak = gain / PARTIAL_SUM;

  const out = ac.createGain();
  out.connect(dest);
  out.gain.setValueAtTime(0.0001, startAt);
  out.gain.exponentialRampToValueAtTime(peak, startAt + 0.006);
  out.gain.exponentialRampToValueAtTime(peak * 0.42, startAt + hold);
  out.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + release);

  for (const [mult, amp] of PARTIALS) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * mult, startAt);
    const g = ac.createGain();
    g.gain.setValueAtTime(amp, startAt);
    if (mult > 1) {
      g.gain.exponentialRampToValueAtTime(amp * 0.08, startAt + Math.min(hold, 0.5 + 0.6 / mult));
    }
    osc.connect(g).connect(out);
    osc.start(startAt);
    osc.stop(startAt + hold + release + 0.05);
  }
  return out;
}

export function playClick(when, accent = false) {
  const ac = audioContext();
  const dest = output(ac);
  if (!ac || !dest) return null;
  if (ac.state !== 'running' && ac.resume) ac.resume().catch(() => {});
  const startAt = Math.max(ac.currentTime + 0.008, Number(when) || 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 1500 : 980, startAt);
  g.gain.setValueAtTime(0.0001, startAt);
  g.gain.exponentialRampToValueAtTime(accent ? 0.24 : 0.14, startAt + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.065);
  osc.connect(g).connect(dest);
  osc.start(startAt);
  osc.stop(startAt + 0.08);
  return g;
}

/** Schedule metronome clicks and, optionally, the notated score. */
export function startPlayback({ score, startTime, metronome, playScore, onEnd }) {
  const ac = audioContext();
  if (!ac) return { stop() {} };
  const secPerTick = 60 / score.tempo / 48;
  const stops = [];

  if (metronome) {
    for (let t = 0; t <= score.totalTicks; t += score.ts.beat) {
      const g = playClick(startTime + t * secPerTick, t % score.ts.ticks === 0);
      if (g) stops.push(g);
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
            hand === 'lh' ? 0.42 : 0.56,
          );
          if (g) stops.push(g);
        }
      }
    }
  }

  const endsAt = startTime + score.totalTicks * secPerTick;
  const timer = setTimeout(() => onEnd?.(), Math.max(0, (endsAt - ac.currentTime) * 1000) + 120);

  return {
    stop() {
      clearTimeout(timer);
      const stopAt = ac.currentTime;
      for (const g of stops) {
        try {
          g.gain.cancelScheduledValues(stopAt);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), stopAt);
          g.gain.exponentialRampToValueAtTime(0.0001, stopAt + 0.06);
        } catch { /* node already finished */ }
      }
    },
  };
}

/** Count-in clicks before the exercise starts. Returns the exercise start. */
export function scheduleCountIn(score, beats) {
  const ac = audioContext();
  const secPerBeat = (score.ts.beat / 48) * (60 / score.tempo);
  if (!ac) return performance.now() / 1000 + beats * secPerBeat;
  const firstClick = ac.currentTime + 0.12;
  for (let i = 0; i < beats; i++) playClick(firstClick + i * secPerBeat, i === 0);
  return firstClick + beats * secPerBeat;
}

export const now = () => ctx?.currentTime ?? (typeof performance === 'undefined' ? 0 : performance.now() / 1000);
