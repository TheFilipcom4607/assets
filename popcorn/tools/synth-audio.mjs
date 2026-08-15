/* Synthesises a microwave-popping-a-bag-of-popcorn recording, so the detector
   can be tested without standing in a kitchen. Used by test-detector.mjs and
   test-browser.mjs. */

export const SAMPLE_RATE = 48000;

/* A plausible pops-per-second curve: nothing for the first few seconds, a fast
   ramp, a plateau, then a long decay into silence. Times in seconds. */
export const DEFAULT_RATE_CURVE = [
  [0, 0], [6, 0.2], [10, 1.5], [16, 8], [24, 13], [32, 10],
  [40, 4], [46, 1.2], [50, 0.4], [53, 0.1], [58, 0.02], [70, 0],
];

function rateAt(curve, t) {
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (t <= curve[i][0]) {
      const [t0, r0] = curve[i - 1];
      const [t1, r1] = curve[i];
      return r0 + (r1 - r0) * ((t - t0) / (t1 - t0));
    }
  }
  return curve[curve.length - 1][1];
}

// Deterministic PRNG so test runs are reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function schedulePops(curve, durationSec, seed = 1) {
  const rnd = mulberry32(seed);
  const times = [];
  const dt = 0.001;
  for (let t = 0; t < durationSec; t += dt) {
    if (rnd() < rateAt(curve, t) * dt) times.push(t);
  }
  return times;
}

/* Returns { audio: Float32Array, popTimes: number[] }.
   popAmp scales the pops relative to the microwave noise — lower it to check
   the detector still works on a quiet bag. */
export function synth({
  durationSec = 70,
  curve = DEFAULT_RATE_CURVE,
  seed = 1,
  bgAmp = 0.12,
  popAmp = 0.45,
} = {}) {
  const n = Math.round(durationSec * SAMPLE_RATE);
  const audio = new Float32Array(n);
  const rnd = mulberry32(seed ^ 0x9e3779b9);

  // ── Microwave background: mains hum harmonics + a low-passed fan ──────────
  const harmonics = [[120, 1], [240, 0.6], [360, 0.35], [480, 0.2], [600, 0.12]];
  let lp1 = 0, lp2 = 0;
  const lpA = 1 - Math.exp((-2 * Math.PI * 700) / SAMPLE_RATE); // ~700 Hz fan

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let hum = 0;
    for (const [f, a] of harmonics) hum += a * Math.sin(2 * Math.PI * f * t);
    hum /= 2.27;

    const white = rnd() * 2 - 1;
    lp1 += lpA * (white - lp1);
    lp2 += lpA * (lp1 - lp2);

    // Slow turntable wobble.
    const wobble = 1 + 0.08 * Math.sin(2 * Math.PI * 0.16 * t);

    audio[i] = bgAmp * wobble * (0.55 * hum + 1.9 * lp2 + 0.02 * white);
  }

  // ── Pops: short broadband bursts with a fast exponential decay ────────────
  const popTimes = schedulePops(curve, durationSec, seed);
  for (const pt of popTimes) {
    const start = Math.round(pt * SAMPLE_RATE);
    const tau = 0.0025 + rnd() * 0.003;      // 2.5-5.5 ms
    const amp = popAmp * (0.55 + rnd() * 0.9);
    const len = Math.min(n - start, Math.round(0.05 * SAMPLE_RATE));
    let hp = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t / tau);
      const white = rnd() * 2 - 1;
      // One-pole high-pass tilts the burst upward in frequency, like a real pop.
      hp = 0.85 * (hp + white - prev);
      prev = white;
      audio[start + i] += amp * env * (0.75 * hp + 0.25 * white);
    }
  }

  // Guard against clipping when several pops land on top of each other.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(audio[i]));
  if (peak > 0.99) {
    const g = 0.99 / peak;
    for (let i = 0; i < n; i++) audio[i] *= g;
  }

  return { audio, popTimes };
}

/* 16-bit mono PCM WAV — the only format Chrome's fake audio capture accepts. */
export function toWav(audio, sampleRate = SAMPLE_RATE) {
  const bytes = audio.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}
