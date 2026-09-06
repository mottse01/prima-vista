// Lightweight monophonic pitch tracking for acoustic-piano practice. The
// detector deliberately waits for two agreeing frames before emitting a note,
// trading a little latency for fewer octave errors and room-noise triggers.

export function frequencyToMidi(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  return 69 + 12 * Math.log2(frequency / 440);
}

export function detectPitch(samples, sampleRate) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.012) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / 1100));
  const maxLag = Math.min(samples.length - 2, Math.ceil(sampleRate / 55));
  // Cumulative mean normalized difference (YIN): choose the first convincing
  // period, not the highest correlation among its multiples. A later multiple
  // can be marginally cleaner while identifying a completely different octave.
  const normalized = new Float64Array(maxLag + 1);
  normalized[0] = 1;
  const length = samples.length - maxLag;
  let sum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let index = 0; index < length; index++) {
      const a = samples[index];
      const b = samples[index + lag];
      const delta = a - b;
      difference += delta * delta;
    }
    sum += difference;
    normalized[lag] = sum > 0 ? difference * lag / sum : 1;
  }
  let bestLag = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (normalized[lag] >= 0.12) continue;
    while (lag < maxLag && normalized[lag + 1] < normalized[lag]) lag += 1;
    bestLag = lag;
    break;
  }
  if (!bestLag) return null;
  const a = normalized[bestLag - 1];
  const b = normalized[bestLag];
  const c = normalized[bestLag + 1] ?? b;
  const denominator = a - 2 * b + c;
  const adjustment = denominator ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * denominator))) : 0;
  return { frequency: sampleRate / (bestLag + adjustment), clarity: 1 - b, rms };
}

export async function connectMicrophone(onEvent, onStatus = () => {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone input is not available in this browser.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Audio input is not available in this browser.');
  }

  const context = new AudioContextCtor();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  let closed = false;
  let candidate = null;
  let candidateFrames = 0;
  let active = null;
  let silentFrames = 0;
  let lastStatusAt = 0;

  const update = (time) => {
    if (closed) return;
    analyser.getFloatTimeDomainData(samples);
    const pitch = detectPitch(samples, context.sampleRate);
    const rounded = pitch ? Math.round(frequencyToMidi(pitch.frequency)) : null;
    const midi = rounded != null && rounded >= 21 && rounded <= 108 ? rounded : null;

    if (midi == null) {
      candidate = null;
      candidateFrames = 0;
      silentFrames += 1;
      if (active != null && silentFrames >= 3) {
        onEvent({ type: 'off', midi: active, source: 'microphone' });
        active = null;
      }
    } else {
      silentFrames = 0;
      if (candidate === midi) candidateFrames += 1;
      else { candidate = midi; candidateFrames = 1; }
      if (candidateFrames >= 2 && active !== midi) {
        if (active != null) onEvent({ type: 'off', midi: active, source: 'microphone' });
        active = midi;
        onEvent({ type: 'on', midi, velocity: 0.7, source: 'microphone' });
      }
    }

    if (time - lastStatusAt > 120) {
      lastStatusAt = time;
      onStatus({
        status: 'listening',
        confidence: pitch ? Math.max(0, Math.min(1, pitch.clarity)) : 0,
        midi: active,
      });
    }
    frame = requestAnimationFrame(update);
  };
  frame = requestAnimationFrame(update);
  onStatus({ status: 'listening', confidence: 0, midi: null });

  return {
    close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      if (active != null) onEvent({ type: 'off', midi: active, source: 'microphone' });
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      onStatus({ status: 'idle', confidence: 0, midi: null });
    },
  };
}
