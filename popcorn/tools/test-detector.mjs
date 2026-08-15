/* Offline test of the detection + decision logic.
 *
 * Replays synthesised audio through a faithful stand-in for AnalyserNode
 * (Blackman window + FFT, same size and hop the app uses), then through the
 * real PopDetector/PopSession from detector.js. Deterministic and fast, so the
 * thresholds can be checked without a browser or a microwave.
 *
 * Run: node tools/test-detector.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synth, SAMPLE_RATE, DEFAULT_RATE_CURVE } from './synth-audio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// detector.js is a plain browser script; give it a window to attach to.
const windowShim = {};
new Function('window', readFileSync(join(ROOT, 'detector.js'), 'utf8'))(windowShim);
const { PopDetector, PopSession } = windowShim;

/* ── AnalyserNode stand-in ────────────────────────────────────────────────── */

const FFT_SIZE = 1024;
const FPS = 60;
const HOP = Math.round(SAMPLE_RATE / FPS); // 800 samples

const blackman = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  blackman[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE)
                     + 0.08 * Math.cos((4 * Math.PI * i) / FFT_SIZE);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);

function frameToDb(audio, end, out) {
  const start = end - FFT_SIZE;
  for (let i = 0; i < FFT_SIZE; i++) {
    const s = start + i;
    re[i] = (s >= 0 ? audio[s] : 0) * blackman[i];
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k < FFT_SIZE / 2; k++) {
    const mag = Math.hypot(re[k], im[k]) / FFT_SIZE;
    out[k] = mag > 0 ? 20 * Math.log10(mag) : -1000;
  }
}

/* ── Harness ──────────────────────────────────────────────────────────────── */

function run({ label, popAmp = 0.45, bgAmp = 0.12, seed = 1, patience = 0.5,
               sensitivity = 0.5, curve = DEFAULT_RATE_CURVE, durationSec = 70 }) {
  const { audio, popTimes } = synth({ durationSec, curve, seed, bgAmp, popAmp });

  const detector = new PopDetector(SAMPLE_RATE, FFT_SIZE);
  detector.setSensitivity(sensitivity);
  const session = new PopSession(patience);
  session.start(0);

  const db = new Float32Array(FFT_SIZE / 2);
  const events = [];
  let detected = 0;

  for (let end = HOP; end < audio.length; end += HOP) {
    const nowMs = (end / SAMPLE_RATE) * 1000;
    frameToDb(audio, end, db);
    if (detector.process(db, nowMs)) { session.addPop(nowMs); detected++; }
    const ev = session.update(nowMs);
    if (ev) events.push({ t: nowMs / 1000, ...ev });
    if (session.phase === 'done') break;
  }

  const stop = events.find((e) => e.type === 'stop');
  const warning = events.find((e) => e.type === 'warning');

  // "Truth": the moment popping genuinely finished.
  const lastRealPop = popTimes[popTimes.length - 1];
  // How many kernels were still to come when we called it.
  const missed = stop ? popTimes.filter((p) => p > stop.t).length : popTimes.length;

  return {
    label, popTimes, detected, events, stop, warning, lastRealPop, missed,
    peakRate: session.peakRate, totalPops: session.totalPops,
  };
}

function report(r) {
  const pct = ((r.detected / r.popTimes.length) * 100).toFixed(0);
  console.log(`\n── ${r.label}`);
  console.log(`   real pops ${r.popTimes.length}, detected ${r.detected} (${pct}%), peak ${r.peakRate.toFixed(1)}/s`);
  console.log(`   last real pop at ${r.lastRealPop.toFixed(1)}s`);
  if (r.warning) console.log(`   warning at ${r.warning.t.toFixed(1)}s`);
  if (r.stop) {
    const delta = r.stop.t - r.lastRealPop;
    console.log(`   STOP at ${r.stop.t.toFixed(1)}s  (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s vs last pop, ${r.missed} kernels left unpopped)`);
  } else {
    console.log(`   STOP never fired  ← ${r.events.map((e) => e.type).join(',') || 'no events'}`);
  }
  return r;
}

const results = [];

results.push(report(run({ label: 'typical bag' })));
results.push(report(run({ label: 'typical bag, different seed', seed: 7 })));
results.push(report(run({ label: 'quiet pops (popAmp 0.18)', popAmp: 0.18 })));
results.push(report(run({ label: 'loud microwave (bgAmp 0.30)', bgAmp: 0.30 })));
results.push(report(run({ label: 'patience 0 (call it early)', patience: 0 })));
results.push(report(run({ label: 'patience 1 (call it late)', patience: 1 })));

// A weak bag that never gets vigorous — must not be abandoned mid-pop.
results.push(report(run({
  label: 'weak bag (peaks at ~4 pops/s)',
  curve: [[0, 0], [8, 0.3], [20, 3], [34, 4], [48, 2], [58, 0.4], [64, 0.05], [75, 0]],
  durationSec: 75,
})));

// A bag with a real lull in the middle — the classic false-stop trap.
results.push(report(run({
  label: 'bag with a mid-run lull',
  curve: [[0, 0], [8, 0.4], [14, 7], [20, 9], [24, 0.6], [27, 0.5], [31, 8],
          [38, 11], [46, 4], [52, 1], [56, 0.3], [60, 0.05], [70, 0]],
  durationSec: 70,
})));

/* ── Negative cases: nothing here should ever produce a "stop" ─────────────── */

const negatives = [];

// A microwave running with no popcorn in it at all.
negatives.push(run({
  label: 'microwave running, no popcorn',
  curve: [[0, 0], [240, 0]],
  durationSec: 240,
}));

// A near-silent room: no microwave, no pops. Guards against the detector
// chasing its own noise floor down until it fires on nothing.
negatives.push(run({
  label: 'quiet room, nothing happening',
  curve: [[0, 0], [240, 0]],
  bgAmp: 0.004,
  durationSec: 240,
}));

// Popping that starts but is still going strong when we run out of tape — the
// detector must not call it done just because the bag is vigorous.
negatives.push(run({
  label: 'still popping hard at the end',
  curve: [[0, 0], [6, 0.5], [14, 9], [40, 12], [60, 11]],
  durationSec: 60,
}));

for (const r of negatives) {
  console.log(`\n── ${r.label}`);
  console.log(`   real pops ${r.popTimes.length}, detected ${r.detected}`);
  console.log(`   events: ${r.events.map((e) => e.type + '@' + e.t.toFixed(0) + 's').join(', ') || 'none'}`);
}

/* ── Assertions ───────────────────────────────────────────────────────────── */

console.log('\n── checks');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

for (const r of results) {
  check(`${r.label}: fired`, !!r.stop);
  if (!r.stop) continue;
  check(`${r.label}: not before the popping ended`,
    r.stop.t > r.lastRealPop - 6, `stop ${r.stop.t.toFixed(1)}s vs last pop ${r.lastRealPop.toFixed(1)}s`);
  check(`${r.label}: within 6s of the last pop`,
    Math.abs(r.stop.t - r.lastRealPop) < 6, `${(r.stop.t - r.lastRealPop).toFixed(1)}s`);
  check(`${r.label}: leaves under 4% unpopped`,
    r.missed / r.popTimes.length < 0.04, `${r.missed}/${r.popTimes.length}`);
  check(`${r.label}: warned before stopping`, !!r.warning);
}

for (const r of negatives) {
  check(`${r.label}: never says stop`, !r.stop,
    r.stop ? `fired at ${r.stop.t.toFixed(1)}s` : '');
}

const noPopcorn = negatives[0];
check('no popcorn: falls back to "nothing heard"',
  noPopcorn.events.some((e) => e.type === 'nothing-heard'));

const early = results.find((r) => r.label.startsWith('patience 0'));
const late = results.find((r) => r.label.startsWith('patience 1'));
if (early?.stop && late?.stop) {
  check('patience slider actually moves the trigger',
    late.stop.t > early.stop.t + 0.5,
    `early ${early.stop.t.toFixed(1)}s vs late ${late.stop.t.toFixed(1)}s`);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
