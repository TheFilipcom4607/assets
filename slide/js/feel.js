/*
 * Super Slide — the "feel" layer.
 *
 * Two jobs: synthesised sound (no audio files to download) and haptics.
 *
 * Haptics reality check:
 *   - Android / Chrome  -> navigator.vibrate() works, including installed PWAs.
 *   - iOS / Safari      -> no Vibration API, in a PWA or otherwise. Since
 *     iOS 17.4 a <input type="checkbox" switch> plays a system haptic when it
 *     is toggled, and clicking one from inside a user gesture fires it. That
 *     is an undocumented side effect, so it is used strictly as a bonus layer:
 *     everything still reads correctly through sound and motion without it.
 */
(function (root, factory) {
  root.SlideFeel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ctx = null;
  var master = null;
  var enabledSound = true;
  var enabledHaptics = true;
  var lastTick = 0;

  /* ---------------------------------------------------------------- audio */

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch (err) {
      ctx = null;
    }
    return ctx;
  }

  var noiseBuffer = null;
  function getNoise() {
    if (noiseBuffer) return noiseBuffer;
    var len = Math.floor(ctx.sampleRate * 0.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return noiseBuffer;
  }

  function tone(opts) {
    if (!enabledSound || !ensureContext()) return;
    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + opts.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t0 + (opts.attack || 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  function noise(opts) {
    if (!enabledSound || !ensureContext()) return;
    var t0 = ctx.currentTime + (opts.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = getNoise();
    var filter = ctx.createBiquadFilter();
    filter.type = opts.filter || 'bandpass';
    filter.frequency.setValueAtTime(opts.freq, t0);
    filter.Q.value = opts.q || 1.2;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  /* -------------------------------------------------------------- haptics */

  var vibrateSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  var switchEl = null;
  var switchSupported = false;

  function setupSwitchHaptics() {
    if (vibrateSupported) return;
    try {
      if (!('switch' in HTMLInputElement.prototype)) return;
      switchEl = document.createElement('input');
      switchEl.type = 'checkbox';
      switchEl.setAttribute('switch', '');
      switchEl.setAttribute('aria-hidden', 'true');
      switchEl.tabIndex = -1;
      switchEl.className = 'haptic-probe';
      document.body.appendChild(switchEl);
      switchSupported = true;
    } catch (err) {
      switchSupported = false;
    }
  }

  // Strengths are expressed as vibration patterns; the iOS path can only ever
  // produce one flavour of tap, so it fires once per request and no more.
  var PATTERNS = {
    tick: [9],
    light: [6],
    medium: [16],
    heavy: [26],
    bump: [12, 26, 12],
    success: [14, 40, 14, 40, 30]
  };

  function haptic(kind) {
    if (!enabledHaptics) return;
    var pattern = PATTERNS[kind] || PATTERNS.light;
    if (vibrateSupported) {
      try { navigator.vibrate(pattern); } catch (err) { /* ignore */ }
      return;
    }
    if (switchSupported && switchEl) {
      var now = performance.now();
      if (now - lastTick < 35) return;
      lastTick = now;
      try {
        switchEl.checked = !switchEl.checked;
        switchEl.click();
      } catch (err) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------- gestures */

  var SOUNDS = {
    // Picking a piece up: soft, low, short.
    grab: function () {
      tone({ type: 'sine', freq: 190, slideTo: 150, dur: 0.09, gain: 0.06 });
      noise({ freq: 900, dur: 0.05, gain: 0.02, q: 0.8 });
    },
    // Crossing a cell boundary — the detent. Bigger pieces thunk lower.
    tick: function (size) {
      var f = size >= 4 ? 190 : size >= 2 ? 260 : 330;
      tone({ type: 'triangle', freq: f, slideTo: f * 0.72, dur: 0.05, gain: 0.075 });
      noise({ freq: 2100, dur: 0.028, gain: 0.05, q: 1.6 });
    },
    // Shoving a piece into something solid.
    bump: function () {
      tone({ type: 'sine', freq: 96, slideTo: 62, dur: 0.13, gain: 0.1 });
      noise({ freq: 320, dur: 0.07, gain: 0.045, filter: 'lowpass', q: 0.7 });
    },
    // Letting go and the piece settling into its slot.
    place: function (size) {
      var f = size >= 4 ? 150 : 210;
      tone({ type: 'sine', freq: f, slideTo: f * 0.66, dur: 0.13, gain: 0.08 });
      noise({ freq: 1500, dur: 0.04, gain: 0.035, q: 1.1 });
    },
    undo: function () {
      tone({ type: 'triangle', freq: 300, slideTo: 420, dur: 0.11, gain: 0.05 });
    },
    reset: function () {
      tone({ type: 'triangle', freq: 420, slideTo: 190, dur: 0.2, gain: 0.05 });
    },
    hint: function () {
      tone({ type: 'sine', freq: 660, dur: 0.08, gain: 0.05 });
      tone({ type: 'sine', freq: 990, dur: 0.12, gain: 0.04, delay: 0.07 });
    },
    tap: function () {
      tone({ type: 'sine', freq: 520, dur: 0.045, gain: 0.035 });
    },
    win: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone({ type: 'triangle', freq: f, dur: 0.42, gain: 0.09, delay: i * 0.085 });
      });
      tone({ type: 'sine', freq: 130.8, dur: 0.7, gain: 0.07, delay: 0.1 });
    },
    escape: function () {
      tone({ type: 'sine', freq: 420, slideTo: 120, dur: 0.5, gain: 0.07 });
      noise({ freq: 700, dur: 0.42, gain: 0.03, filter: 'lowpass', q: 0.6 });
    }
  };

  var HAPTIC_FOR = {
    grab: 'light', tick: 'tick', bump: 'bump', place: 'medium',
    undo: 'light', reset: 'medium', hint: 'light', tap: 'light',
    win: 'success', escape: 'heavy'
  };

  /** Fire a named event: sound and matching haptic together. */
  function play(name, detail) {
    var fn = SOUNDS[name];
    if (fn) {
      try { fn(detail); } catch (err) { /* audio is never fatal */ }
    }
    var h = HAPTIC_FOR[name];
    if (h) haptic(h);
  }

  function init(settings) {
    enabledSound = settings.sound !== false;
    enabledHaptics = settings.haptics !== false;
    setupSwitchHaptics();
    // Unlock audio on the first real interaction, as mobile browsers require.
    var unlock = function () { ensureContext(); };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && ctx && ctx.state === 'suspended') ctx.resume();
    });
  }

  return {
    init: init,
    play: play,
    haptic: haptic,
    setSound: function (on) { enabledSound = !!on; if (on) ensureContext(); },
    setHaptics: function (on) { enabledHaptics = !!on; },
    // Reported in settings so the player knows what their device can do.
    capability: function () {
      if (vibrateSupported) return 'full';
      if (switchSupported) return 'ios';
      return 'none';
    }
  };
});
