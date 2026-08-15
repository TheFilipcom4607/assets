'use strict';

/* Popcorn Ear — listens to the microwave and says out loud when to stop it.
   Everything is local: the mic stream never leaves the AudioContext. */

const $ = (id) => document.getElementById(id);

const el = {
  screens: {
    setup: $('screen-setup'),
    listen: $('screen-listen'),
    alert: $('screen-alert'),
    done: $('screen-done'),
  },
  start: $('btn-start'),
  setupError: $('setup-error'),
  patience: $('patience'),
  patienceHint: $('patience-hint'),
  sensitivity: $('sensitivity'),
  chime: $('chime'),

  phase: $('phase'),
  phaseSub: $('phase-sub'),
  rateBig: $('rate-big'),
  graph: $('graph'),
  totalPops: $('total-pops'),
  elapsed: $('elapsed'),
  gap: $('gap'),
  meterFill: $('meter-fill'),
  listenWarning: $('listen-warning'),
  testVoice: $('btn-test-voice'),
  cancel: $('btn-cancel'),

  alertTitle: $('alert-title'),
  alertSub: $('alert-sub'),
  gotIt: $('btn-got-it'),

  again: $('btn-again'),
  doneSummary: $('done-summary'),
};

const settings = loadSettings();
let ctx = null;
let stream = null;
let analyser = null;
let freqData = null;
let detector = null;
let session = new PopSession(settings.patience);
let rafId = 0;
let running = false;
let lastFrameAt = 0;
let stallReported = false;
let alertTimer = 0;
let alertRepeats = 0;
let outcome = null;

/* ── Settings ─────────────────────────────────────────────────────────────── */

function loadSettings() {
  const defaults = { patience: 0.5, sensitivity: 0.5, chime: true };
  try {
    return Object.assign(defaults, JSON.parse(localStorage.getItem('popcorn-ear') || '{}'));
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try { localStorage.setItem('popcorn-ear', JSON.stringify(settings)); } catch {}
}

function describePatience() {
  const s = new PopSession(settings.patience);
  el.patienceHint.textContent =
    `Stops after a ${s.maxGap.toFixed(1)}-second gap between pops, or when popping ` +
    `falls to ${Math.round(s.stopRatio * 100)}% of its peak.`;
}

el.patience.value = settings.patience;
el.sensitivity.value = settings.sensitivity;
el.chime.checked = settings.chime;
describePatience();

el.patience.addEventListener('input', () => {
  settings.patience = parseFloat(el.patience.value);
  session.setPatience(settings.patience);
  describePatience();
  saveSettings();
});
el.sensitivity.addEventListener('input', () => {
  settings.sensitivity = parseFloat(el.sensitivity.value);
  if (detector) detector.setSensitivity(settings.sensitivity);
  saveSettings();
});
el.chime.addEventListener('change', () => {
  settings.chime = el.chime.checked;
  saveSettings();
});

/* ── Screens ──────────────────────────────────────────────────────────────── */

function show(name) {
  for (const [key, node] of Object.entries(el.screens)) {
    node.classList.toggle('is-active', key === name);
  }
  window.scrollTo(0, 0);
}

/* ── Voice ────────────────────────────────────────────────────────────────── */

/* The phone's own speaker is right next to the mic, so anything we say lands
   back in the detector as a fake pop. We hold detection off while talking. */
let speaking = false;
let speakingClearTimer = 0;

function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth) { fallbackTone(); return; }

  // Rough guess at how long the phrase takes, so detection resumes even if the
  // utterance callbacks never fire (they occasionally don't on iOS).
  const estimateMs = Math.max(1800, text.length * 90);
  holdDetection(estimateMs);

  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.lang = 'en-US';
    u.onstart = () => holdDetection(estimateMs);
    u.onend = () => holdDetection(400);
    u.onerror = () => { holdDetection(300); fallbackTone(); };
    synth.resume();
    synth.speak(u);
  } catch {
    fallbackTone();
  }
}

function holdDetection(ms) {
  speaking = true;
  clearTimeout(speakingClearTimer);
  speakingClearTimer = setTimeout(() => {
    speaking = false;
    if (detector) detector.resetContinuity();
  }, ms);
}

/* Short attention chime, so the first syllable of the voice isn't lost under a
   running microwave. Also the fallback if speech synthesis is missing. */
function chime() {
  if (!settings.chime) return;
  tone([880, 1320], 0.16, 0.35);
}

function fallbackTone() {
  tone([880, 1200, 880, 1200], 0.18, 0.5);
}

function tone(freqs, step, gainValue) {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.02;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const start = t0 + i * step;
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + step * 0.9);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + step);
    });
    holdDetection(freqs.length * step * 1000 + 500);
  } catch {}
}

function announce(text) {
  chime();
  // Let the chime clear before the voice starts.
  setTimeout(() => speak(text), settings.chime ? 380 : 0);
}

/* ── Wake lock ────────────────────────────────────────────────────────────── */

let wakeLock = null;

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {}
}

function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch {}
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!running) return;
  acquireWakeLock();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (detector) detector.resetContinuity();
});

/* ── Start / stop ─────────────────────────────────────────────────────────── */

el.start.addEventListener('click', async () => {
  el.setupError.hidden = true;
  el.start.disabled = true;
  el.start.textContent = 'Starting…';

  // Both of these must be kicked off inside the tap handler: iOS only unlocks
  // audio output and speech synthesis from a real user gesture.
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
  } catch (err) {
    fail('Could not start audio on this browser.');
    return;
  }
  speak('Listening for pops.');

  try {
    stream = await getMic();
  } catch (err) {
    fail(micErrorMessage(err));
    return;
  }

  const source = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0; // smoothing would erase the transients
  source.connect(analyser);           // deliberately not connected to output

  freqData = new Float32Array(analyser.frequencyBinCount);
  detector = new PopDetector(ctx.sampleRate, analyser.fftSize);
  detector.setSensitivity(settings.sensitivity);

  session.setPatience(settings.patience);
  session.start(performance.now());

  const track = stream.getAudioTracks()[0];
  if (track) track.addEventListener('ended', () => {
    if (running) warn('The microphone was disconnected. Tap “Stop listening” and start again.');
  });

  running = true;
  stallReported = false;
  lastFrameAt = performance.now();
  el.listenWarning.hidden = true;
  el.start.disabled = false;
  el.start.textContent = 'Start listening';
  setPhase('Warming up…', 'Start the microwave now.');
  show('listen');
  acquireWakeLock();
  sizeGraph();
  rafId = requestAnimationFrame(loop);

  function fail(msg) {
    el.setupError.textContent = msg;
    el.setupError.hidden = false;
    el.start.disabled = false;
    el.start.textContent = 'Start listening';
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  }
});

async function getMic() {
  // Safari applies its own noise suppression and gain control by default, both
  // of which chew up short transients. Ask for them off, fall back if refused.
  const ideal = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(ideal);
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function micErrorMessage(err) {
  const name = err && err.name;
  if (!navigator.mediaDevices) {
    return 'This browser will not share the microphone. On iPhone, open the page in Safari over https.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was denied. On iPhone: tap “aA” in the address bar → Website Settings → Microphone → Allow, then reload.';
  }
  if (name === 'NotFoundError') return 'No microphone was found on this device.';
  return 'Could not open the microphone' + (name ? ' (' + name + ').' : '.');
}

function stopListening() {
  running = false;
  cancelAnimationFrame(rafId);
  clearInterval(alertTimer);
  releaseWakeLock();
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
  analyser = null;
  detector = null;
}

el.cancel.addEventListener('click', () => {
  stopListening();
  show('setup');
});

el.testVoice.addEventListener('click', () => {
  announce('This is how loud I will be.');
});

/* ── Main loop ────────────────────────────────────────────────────────────── */

function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  const now = performance.now();
  const dt = now - lastFrameAt;
  lastFrameAt = now;

  // A long stall means iOS throttled us — the detector missed pops in the gap.
  if (dt > 600 && !stallReported && session.phase !== 'warmup') {
    stallReported = true;
    warn('The screen went to sleep for a moment, so I may have missed some pops. Keep this screen open and awake.');
    detector.resetContinuity();
  }

  analyser.getFloatFrequencyData(freqData);

  if (!speaking && detector.process(freqData, now)) {
    session.addPop(now);
  }

  const event = session.update(now);
  if (event) handleEvent(event);

  render(now);
}

function handleEvent(event) {
  switch (event.type) {
    case 'started':
      setPhase('Popping', 'I will tell you when to stop.');
      announce('Popping has started.');
      break;

    case 'warning':
      setPhase('Slowing down', 'Head to the microwave.');
      announce('Almost done. Head to the microwave.');
      break;

    case 'resumed':
      // It was only a lull. Say nothing — the screen is enough, and a second
      // announcement here would just be noise.
      setPhase('Popping', 'Picked back up. I will tell you when to stop.');
      break;

    case 'stop':
      outcome = 'stop';
      triggerAlert('Stop the microwave', 'Popping has died down — this is the moment.');
      break;

    case 'nothing-heard':
      outcome = 'nothing';
      triggerAlert('No popping heard', 'Three and a half minutes with no pops. Go check the microwave.');
      break;

    case 'hard-stop':
      outcome = 'hard-stop';
      triggerAlert('Check the microwave', 'Six minutes have passed. Something is off — check on it now.');
      break;
  }
}

function triggerAlert(title, sub) {
  el.alertTitle.textContent = title;
  el.alertSub.textContent = sub;
  show('alert');

  const line = outcome === 'stop'
    ? 'Stop the microwave now.'
    : 'Check the microwave now.';

  alertRepeats = 0;
  announce(line);
  clearInterval(alertTimer);
  alertTimer = setInterval(() => {
    if (++alertRepeats >= 10) { clearInterval(alertTimer); return; }
    announce(line);
  }, 3800);
}

el.gotIt.addEventListener('click', () => {
  clearInterval(alertTimer);
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  const secs = Math.round((session.lastPopAt - session.startedAt) / 1000);
  el.doneSummary.textContent =
    `${session.totalPops} pops counted · peak ${session.peakRate.toFixed(1)}/s · ` +
    `last pop at ${fmtTime(Math.max(0, secs))}.`;
  stopListening();
  show(outcome === 'stop' ? 'done' : 'setup');
});

/* ── Feedback tuning ──────────────────────────────────────────────────────── */

for (const btn of document.querySelectorAll('[data-verdict]')) {
  btn.addEventListener('click', () => {
    const verdict = btn.dataset.verdict;
    if (verdict === 'early') settings.patience = Math.min(1, settings.patience + 0.18);
    if (verdict === 'late') settings.patience = Math.max(0, settings.patience - 0.18);
    saveSettings();
    el.patience.value = settings.patience;
    session.setPatience(settings.patience);
    describePatience();
    show('setup');
  });
}

el.again.addEventListener('click', () => show('setup'));

/* ── Rendering ────────────────────────────────────────────────────────────── */

function setPhase(main, sub) {
  el.phase.textContent = main;
  el.phaseSub.textContent = sub;
}

function warn(text) {
  el.listenWarning.textContent = text;
  el.listenWarning.hidden = false;
}

function fmtTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function render(now) {
  el.rateBig.textContent = session.rate.toFixed(1);
  el.totalPops.textContent = session.totalPops;
  el.elapsed.textContent = fmtTime(Math.floor((now - session.startedAt) / 1000));
  el.gap.textContent = session.lastPopAt
    ? ((now - session.lastPopAt) / 1000).toFixed(1) + 's'
    : '—';

  // Centre of the meter is the detection threshold.
  const meter = Math.min(1, detector.ratio / 2);
  el.meterFill.style.width = (meter * 100).toFixed(1) + '%';

  drawGraph(now);
}

let graphW = 0;
let graphH = 0;

function sizeGraph() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = el.graph.getBoundingClientRect();
  graphW = Math.max(1, Math.round(rect.width));
  graphH = Math.max(1, Math.round(rect.height));
  el.graph.width = graphW * dpr;
  el.graph.height = graphH * dpr;
  const g = el.graph.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', () => { if (running) sizeGraph(); });

function drawGraph(now) {
  const g = el.graph.getContext('2d');
  const w = graphW;
  const h = graphH;
  g.clearRect(0, 0, w, h);

  const track = session.rateTrack;
  const spanMs = Math.max(90000, now - session.startedAt);
  const yMax = Math.max(1, session.peakRate * 1.15);
  const x = (t) => (t / spanMs) * w;
  const y = (r) => h - 6 - (r / yMax) * (h - 16);

  // The level popping has to fall to before we call it.
  if (session.peakRate > 0) {
    const yStop = y(session.peakRate * session.stopRatio);
    g.strokeStyle = 'rgba(70, 209, 127, 0.55)';
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, yStop);
    g.lineTo(w, yStop);
    g.stroke();
    g.setLineDash([]);
  }

  if (track.length < 2) return;

  g.beginPath();
  g.moveTo(x(track[0].t), h);
  for (const p of track) g.lineTo(x(p.t), y(p.rate));
  g.lineTo(x(track[track.length - 1].t), h);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(245, 182, 66, 0.45)');
  grad.addColorStop(1, 'rgba(245, 182, 66, 0.02)');
  g.fillStyle = grad;
  g.fill();

  g.beginPath();
  for (let i = 0; i < track.length; i++) {
    const px = x(track[i].t);
    const py = y(track[i].rate);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.strokeStyle = '#f5b642';
  g.lineWidth = 2;
  g.stroke();
}

/* ── Install hint (iOS only shows the mic prompt reliably in Safari) ──────── */

(function installHint() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (!isIOS || standalone) return;

  const p = document.createElement('p');
  p.className = 'footnote';
  p.innerHTML = 'Tip: Share → <strong>Add to Home Screen</strong> to run it full screen.';
  el.screens.setup.appendChild(p);
})();

/* ── Service worker ───────────────────────────────────────────────────────── */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
