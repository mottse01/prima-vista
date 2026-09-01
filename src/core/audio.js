// Audio engine: low-latency WebAudio for live playing and a rendered WAV
// transport for reference playback. The media transport is intentional: iOS
// and embedded browsers can report a running AudioContext while still routing
// it silently, whereas an explicitly played <audio> element is much more
// reliable. Both paths are generated locally; there are no sample downloads.

import { TPQ } from './theory.js';

let ctx = null;
let bus = null;
let masterVolume = 0.82;
let mediaPlaying = 0;
let renderedReference = null;
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
  if (mediaPlaying > 0) return 'running';
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
 * Do the gesture-sensitive part of audio setup synchronously on pointer-down.
 * Safari is stricter than Chromium about retaining activation across awaits,
 * so transport buttons call this before their click handlers do any work.
 */
export function primeAudioGesture() {
  const ac = audioContext();
  if (!ac) return false;
  try {
    if (ac.state !== 'running' && ac.resume) void ac.resume().catch(() => {});
    const source = ac.createBufferSource();
    source.buffer = ac.createBuffer(1, 1, ac.sampleRate || 44100);
    source.connect(ac.destination);
    source.start(0);
    return true;
  } catch {
    return false;
  }
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
    primeAudioGesture();
    if (ac.state !== 'running' && ac.resume) await ac.resume();

    // WebKit sometimes resolves resume() one state-change before it exposes
    // `running`. Give that transition a short, bounded chance to settle.
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    while (ac.state !== 'running') {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      if (elapsed > 650) break;
      await new Promise((resolve) => setTimeout(resolve, 35));
      if (ac.state === 'interrupted' && ac.resume) await ac.resume().catch(() => {});
    }
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
  const startAt = Math.max(ac.currentTime + 0.025, Number(when) || 0);
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
  const startAt = Math.max(ac.currentTime + 0.025, Number(when) || 0);
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

// -------------------------------------------------------------------------
// Reliable reference transport
// -------------------------------------------------------------------------

const WAV_SAMPLE_RATE = 22050;

/**
 * Render a lightweight piano performance to a PCM WAV byte array.
 * Exported for deterministic regression tests and offline/download use.
 */
export function renderReferenceWav(score, {
  metronome = false,
  leadIn = 0.09,
  sampleRate = WAV_SAMPLE_RATE,
} = {}) {
  const secPerTick = 60 / score.tempo / TPQ;
  const tail = 0.48;
  const totalSeconds = leadIn + score.totalTicks * secPerTick + tail;
  const mix = new Float32Array(Math.max(1, Math.ceil(totalSeconds * sampleRate)));

  const addPiano = (start, midi, duration, gain) => {
    const frequency = midiToFreq(midi);
    const hold = Math.min(2.8, Math.max(0.16, duration * 0.94));
    const release = 0.24;
    const startSample = Math.max(0, Math.floor(start * sampleRate));
    const count = Math.min(mix.length - startSample, Math.ceil((hold + release) * sampleRate));
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.007);
      const body = 0.7 * Math.exp(-2.25 * t) + 0.3 * Math.exp(-0.48 * t);
      const releaseGain = t <= hold ? 1 : Math.max(0, 1 - (t - hold) / release);
      const phase = Math.PI * 2 * frequency * t;
      const tone = Math.sin(phase)
        + 0.3 * Math.sin(phase * 2 + 0.08)
        + 0.13 * Math.sin(phase * 3 + 0.16)
        + 0.055 * Math.sin(phase * 4.01);
      mix[startSample + i] += tone * attack * body * releaseGain * gain * 0.42;
    }
  };

  const addClick = (start, accent) => {
    const startSample = Math.max(0, Math.floor(start * sampleRate));
    const count = Math.min(mix.length - startSample, Math.ceil(0.065 * sampleRate));
    const frequency = accent ? 1560 : 1040;
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-68 * t);
      mix[startSample + i] += Math.sin(Math.PI * 2 * frequency * t) * env * (accent ? 0.34 : 0.22);
    }
  };

  for (const hand of ['rh', 'lh']) {
    for (const note of score.staves[hand] || []) {
      if (note.rest) continue;
      for (const pitch of note.pitches) {
        addPiano(
          leadIn + note.onset * secPerTick,
          pitch.midi,
          note.duration * secPerTick,
          hand === 'lh' ? 0.38 : 0.5,
        );
      }
    }
  }

  if (metronome) {
    for (let tick = 0; tick <= score.totalTicks; tick += score.ts.beat) {
      addClick(leadIn + tick * secPerTick, tick % score.ts.ticks === 0);
    }
  }

  // Soft-clip dense chords instead of normalising every exercise to a
  // different perceived volume.
  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) {
    const shaped = Math.tanh(mix[i] * 1.08) * 0.92;
    pcm[i] = Math.round(Math.max(-1, Math.min(1, shaped)) * 32767);
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return new Uint8Array(buffer);
}

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

/**
 * Play a locally rendered reference track through an HTML media element.
 * The handle is returned immediately so Audio.play() remains in the original
 * gesture. Callers can await `started` without losing control of the player.
 */
export function startReferencePlayback({ score, metronome = false, onEnd } = {}) {
  if (
    !score
    || typeof Audio === 'undefined'
    || typeof Blob === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) return null;

  const leadIn = 0.09;
  let bytes;
  if (renderedReference?.score === score && renderedReference.metronome === metronome) {
    bytes = renderedReference.bytes;
  } else {
    bytes = renderReferenceWav(score, { metronome, leadIn });
    renderedReference = { score, metronome, bytes };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const element = new Audio(url);
  element.preload = 'auto';
  element.volume = masterVolume;
  let active = false;
  let settled = false;
  let stopped = false;

  const release = (natural = false) => {
    if (settled) return;
    settled = true;
    if (active) {
      mediaPlaying = Math.max(0, mediaPlaying - 1);
      reportState();
    }
    element.onended = null;
    element.onerror = null;
    URL.revokeObjectURL(url);
    if (natural || (active && !stopped)) onEnd?.();
  };

  element.onended = () => release(true);
  element.onerror = () => release(false);
  let playPromise;
  try {
    playPromise = element.play();
  } catch (error) {
    playPromise = Promise.reject(error);
  }
  const started = Promise.resolve(playPromise)
    .then(() => {
      if (stopped) return false;
      active = true;
      mediaPlaying += 1;
      reportState();
      return true;
    })
    .catch(() => {
      release(false);
      return false;
    });

  return {
    started,
    leadIn,
    currentTime: () => element.currentTime || 0,
    stop() {
      stopped = true;
      try { element.pause(); } catch { /* already unavailable */ }
      release(false);
    },
  };
}

/** A short media-element cue for the user-facing sound check. */
export function startSoundCheck(onEnd) {
  const note = (onset, midi, duration = 22) => ({
    onset, duration, rest: false, pitches: [{ midi }],
  });
  const score = {
    tempo: 120,
    totalTicks: 84,
    ts: { beat: TPQ, ticks: TPQ * 4 },
    staves: { rh: [note(0, 60), note(18, 64), note(36, 67, 42)], lh: [] },
  };
  return startReferencePlayback({ score, onEnd });
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
