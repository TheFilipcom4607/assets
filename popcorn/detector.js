'use strict';

/* ---------------------------------------------------------------------------
 * PopDetector — turns a stream of FFT frames into individual "pop" events.
 *
 * A running microwave is loud, but it is loud in a *steady, low-frequency* way:
 * magnetron hum around 60/120 Hz plus harmonics, a broadband cooling fan, a
 * turntable motor. A kernel going off is the opposite: a very short broadband
 * transient with a lot of energy above 2 kHz.
 *
 * So we don't look at loudness at all. We look at the frame-to-frame *increase*
 * of energy in a 2-9 kHz band (spectral flux), and compare it against a running
 * estimate of the noise floor. That makes the detector immune to absolute level,
 * which matters a lot on iOS where Safari applies its own gain control that we
 * cannot fully turn off.
 * ------------------------------------------------------------------------- */

const BAND_LOW_HZ = 2000;
const BAND_HIGH_HZ = 9000;
const FLOOR_FRAMES = 240;  // ~4 s at 60 fps.
const FLOOR_PERCENTILE = 0.25;
                           // At the height of the popping, pops occupy nearly
                           // half the frames, so a *median* of recent flux is
                           // pulled up by the pops themselves and the detector
                           // starts missing them right when the rate matters
                           // most. A low percentile stays pinned to the
                           // microwave's actual noise floor.
const REFRACTORY_MS = 55;  // Two real kernels can pop 50 ms apart; the ring-out
                           // of a single pop lasts less than that.

class PopDetector {
  constructor(sampleRate, fftSize) {
    this.sampleRate = sampleRate;
    this.binCount = fftSize / 2;
    const hz = sampleRate / fftSize;
    this.lo = Math.max(1, Math.floor(BAND_LOW_HZ / hz));
    this.hi = Math.min(this.binCount - 1, Math.ceil(BAND_HIGH_HZ / hz));

    this.prev = new Float32Array(this.binCount);
    this.hasPrev = false;

    this.history = new Float32Array(FLOOR_FRAMES);
    this.historyLen = 0;
    this.historyIdx = 0;
    this.scratch = new Float32Array(FLOOR_FRAMES);

    this.bandMagEma = 0;
    this.lastPopAt = -1e9;
    this.prevFlux = 0;

    // Exposed for the on-screen meter.
    this.flux = 0;
    this.threshold = 0;
    this.ratio = 0;

    this.setSensitivity(0.5);
  }

  /* 0 = only obvious pops, 1 = jumpy. The two knobs move together: how far above
     the noise floor a frame must sit, and how much it must add relative to the
     ambient band energy. */
  setSensitivity(s) {
    this.sensitivity = Math.min(1, Math.max(0, s));
    this.k = 13 - this.sensitivity * 9;             // 13 (strict) .. 4 (loose)
    this.relFloor = 0.45 - this.sensitivity * 0.35; // 0.45 .. 0.10
  }

  /* Called when we deliberately made noise ourselves (voice alerts) or when the
     audio graph was interrupted. Drops the differencing state so we don't emit
     a phantom onset on the next frame. */
  resetContinuity() {
    this.hasPrev = false;
    this.prevFlux = 0;
  }

  /* db: Float32Array from AnalyserNode.getFloatFrequencyData().
     Returns true when this frame is the onset of a pop. */
  process(db, nowMs) {
    const { lo, hi, prev } = this;
    let flux = 0;
    let bandMag = 0;

    for (let i = lo; i <= hi; i++) {
      // getFloatFrequencyData gives dBFS; -Infinity shows up on silent bins.
      const v = db[i];
      const mag = v > -160 ? Math.pow(10, v / 20) : 0;
      bandMag += mag;
      const d = mag - prev[i];
      if (d > 0) flux += d;
      prev[i] = mag;
    }

    this.flux = flux;
    this.bandMag = bandMag;

    if (!this.hasPrev) {
      // First frame after a discontinuity: the diff above is meaningless.
      this.hasPrev = true;
      this.threshold = Infinity;
      this.ratio = 0;
      return false;
    }

    // Slow EMA (~3 s) of ambient band energy, used for the relative floor.
    const a = 0.006;
    this.bandMagEma = this.bandMagEma === 0 ? bandMag
                    : this.bandMagEma + a * (bandMag - this.bandMagEma);

    const floor = this._noiseFloor();
    const threshold = Math.max(floor * this.k, this.bandMagEma * this.relFloor);
    this.threshold = threshold;
    this.ratio = threshold > 0 ? flux / threshold : 0;

    // Feed the noise-floor estimate *after* thresholding, so a burst of pops
    // raises the floor only gradually.
    this.history[this.historyIdx] = flux;
    this.historyIdx = (this.historyIdx + 1) % FLOOR_FRAMES;
    if (this.historyLen < FLOOR_FRAMES) this.historyLen++;

    const rising = flux > this.prevFlux;
    this.prevFlux = flux;

    if (this.historyLen < 30) return false;                 // still settling
    if (nowMs - this.lastPopAt < REFRACTORY_MS) return false;
    if (!rising) return false;
    if (flux <= threshold) return false;

    this.lastPopAt = nowMs;
    return true;
  }

  _noiseFloor() {
    const n = this.historyLen;
    if (n === 0) return 0;
    const s = this.scratch.subarray(0, n);
    s.set(this.history.subarray(0, n));
    // Small n, runs once per frame — a plain sort is cheap enough.
    Array.prototype.sort.call(s, (x, y) => x - y);
    return s[Math.min(n - 1, Math.floor(FLOOR_PERCENTILE * n))];
  }
}

/* ---------------------------------------------------------------------------
 * PopSession — decides *when to shout*.
 *
 * The rule everyone repeats ("stop when pops are 2 seconds apart") is a decent
 * baseline, but on its own it is wrong in two ways.
 *
 * First, it ignores how vigorous the bag was: a bag that peaked at 15 pops per
 * second and has dropped to 1 is done, while a bag that never got above 2 is
 * still going. So we compare the current rate against the peak rate, not
 * against a fixed number.
 *
 * Second, and worse: pops are a random process, so at 1.5 pops/second a
 * 2-second silence happens *by chance*, several times, in the middle of a bag
 * that is nowhere near finished. That is how you end up with a third of the bag
 * unpopped. The fix is to judge the stop on a deliberately long window (8 s) so
 * a chance lull cannot empty it, and to require both a quiet window *and* a
 * current gap before calling it. The short window is kept only for the display,
 * where responsiveness matters and a mistake costs nothing.
 *
 * `patience` (0..1) slides the thresholds together. It is nudged by the user's
 * "too early / too late" feedback after each bag.
 * ------------------------------------------------------------------------- */

const FAST_WINDOW_MS = 2500;  // display
const SLOW_WINDOW_MS = 8000;  // decisions
const MIN_POPS_BEFORE_STOP = 10;
const MIN_PEAK_RATE = 0.8;
const MIN_SECONDS_AFTER_FIRST_POP = 15;
const NO_POPCORN_TIMEOUT_MS = 210000; // 3:30 with nothing happening
const HARD_STOP_MS = 360000;          // 6:00 — something is wrong, speak anyway

class PopSession {
  constructor(patience = 0.5) {
    this.setPatience(patience);
    this.reset();
  }

  setPatience(p) {
    this.patience = Math.min(1, Math.max(0, p));
    this.maxGap = 1.4 + this.patience * 1.6;        // 1.4 s .. 3.0 s
    this.stopRatio = 0.22 - this.patience * 0.16;   // 0.22 .. 0.06
    // However fast the bag peaked, this many pops per second still counts as
    // "still going" — it stops a very vigorous bag being called while a couple
    // of kernels a second are still going off.
    this.stopAbsRate = 1.3 - this.patience * 0.8;   // 1.3 .. 0.5 pops/s
    this.warnRatio = Math.min(0.65, this.stopRatio * 3);
  }

  reset() {
    this.startedAt = 0;
    this.pops = [];        // timestamps, trimmed to the slow window
    this.totalPops = 0;
    this.firstPopAt = 0;
    this.lastPopAt = 0;
    this.rate = 0;         // fast window, for display
    this.slowRate = 0;     // slow window, for decisions
    this.peakRate = 0;
    this.pastPeak = false;
    this.warned = false;
    this.phase = 'warmup';  // warmup | waiting | popping | fading | done
    this.rateTrack = [];    // {t, rate} for the graph
    this._lastTrackAt = 0;
  }

  start(now) {
    this.reset();
    this.startedAt = now;
  }

  addPop(now) {
    if (this.phase === 'done') return;
    this.totalPops++;
    this.pops.push(now);
    if (!this.firstPopAt) this.firstPopAt = now;
    this.lastPopAt = now;
  }

  /* Called every frame. Returns null, or an event object describing what the
     app should announce. */
  update(now) {
    while (this.pops.length && this.pops[0] < now - SLOW_WINDOW_MS) this.pops.shift();
    this.slowRate = this.pops.length / (SLOW_WINDOW_MS / 1000);

    const fastCutoff = now - FAST_WINDOW_MS;
    let fastCount = 0;
    for (let i = this.pops.length - 1; i >= 0 && this.pops[i] >= fastCutoff; i--) fastCount++;
    this.rate = fastCount / (FAST_WINDOW_MS / 1000);

    // Peak is tracked on the slow window so it is compared like with like.
    if (this.totalPops >= 5 && this.slowRate > this.peakRate) this.peakRate = this.slowRate;
    if (this.peakRate >= MIN_PEAK_RATE && this.slowRate <= this.peakRate * 0.5) {
      this.pastPeak = true;
    }

    if (now - this._lastTrackAt >= 500) {
      this._lastTrackAt = now;
      this.rateTrack.push({ t: now - this.startedAt, rate: this.slowRate });
      if (this.rateTrack.length > 720) this.rateTrack.shift(); // 6 min
    }

    if (this.phase === 'done') return null;

    const elapsed = now - this.startedAt;
    const gap = this.lastPopAt ? (now - this.lastPopAt) / 1000 : 0;

    if (this.phase === 'warmup' && elapsed > 1500) this.phase = 'waiting';

    if (this.phase === 'waiting') {
      if (this.rate >= 1.0 && this.totalPops >= 5) {
        this.phase = 'popping';
        return { type: 'started' };
      }
      if (elapsed > NO_POPCORN_TIMEOUT_MS) {
        this.phase = 'done';
        return { type: 'nothing-heard' };
      }
      return null;
    }

    if (elapsed > HARD_STOP_MS) {
      this.phase = 'done';
      return { type: 'hard-stop' };
    }

    // Gates that stop us reacting to an early lull during the ramp-up.
    const eligible =
      this.pastPeak &&
      this.totalPops >= MIN_POPS_BEFORE_STOP &&
      this.peakRate >= MIN_PEAK_RATE &&
      this.firstPopAt &&
      (now - this.firstPopAt) / 1000 >= MIN_SECONDS_AFTER_FIRST_POP;

    if (!eligible) return null;

    const relRate = this.peakRate > 0 ? this.slowRate / this.peakRate : 1;
    const quiet = relRate <= this.stopRatio && this.slowRate <= this.stopAbsRate;

    // Both conditions, never either/or: the slow window says the bag as a whole
    // has wound down, the gap says it is not mid-flurry right this second.
    if (quiet && gap >= this.maxGap) {
      this.phase = 'done';
      return { type: 'stop', gap, relRate };
    }

    if (relRate <= this.warnRatio) {
      if (!this.warned) {
        this.warned = true;
        this.phase = 'fading';
        return { type: 'warning' };
      }
    } else if (this.warned && relRate > this.warnRatio * 1.6) {
      // It was only a lull — the bag picked back up. Re-arm so the user gets a
      // fresh heads-up when it really does wind down.
      this.warned = false;
      this.phase = 'popping';
      return { type: 'resumed' };
    }

    return null;
  }
}

window.PopDetector = PopDetector;
window.PopSession = PopSession;
