'use strict';

/* Popcorn Ear — listens to the microwave and says out loud when to stop it.
   Everything is local: the mic stream never leaves the AudioContext.

   ── The one rule that shapes this whole file ──────────────────────────────
   iOS will not let a page capture and play at the same time. The moment any
   sound comes out of the speaker — a chime, a spoken phrase, anything — the
   MediaStreamAudioSourceNode feeding the analyser goes silent, permanently,
   and no pop is ever heard again. Nothing in the API reports this: the track
   still says "live", the AudioContext still says "running", the analyser just
   returns silence forever.

   So: the app makes no sound at all while it is listening, and it releases the
   microphone *before* it speaks. Everything that used to be announced during
   the run is now shown on screen instead. There is also a watchdog, because
   iOS can kill capture on its own (a notification, Siri, a route change), and
   a silent detector looks exactly like a bag that stopped popping.  */

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
  speakWarning: $('speak-warning'),
  testVoice: $('btn-test-voice'),

  phase: $('phase'),
  phaseSub: $('phase-sub'),
  rateBig: $('rate-big'),
  graph: $('graph'),
  totalPops: $('total-pops'),
  elapsed: $('elapsed'),
  gap: $('gap'),
  meterFill: $('meter-fill'),
  listenWarning: $('listen-warning'),
  cancel: $('btn-cancel'),

  alertTitle: $('alert-title'),
  alertSub: $('alert-sub'),
  gotIt: $('btn-got-it'),

  again: $('btn-again'),
  doneSummary: $('done-summary'),
};

const settings = loadSettings();
let session = new PopSession(settings.patience);

// Capture side.
let capCtx = null;
let stream = null;
let analyser = null;
let freqData = null;
let detector = null;
let capturing = false;
let recovering = false;
let recoveries = 0;
const MAX_RECOVERIES = 3;

let rafId = 0;
let lastFrameAt = 0;
let silentSince = 0;
let stallReported = false;

let alertTimer = 0;
let alertRepeats = 0;
let outcome = null;

/* Visible in the console, so a problem on a real phone can be reported without
   guessing. `audioWhileCapturing` must stay at 0 — anything else means we broke
   the rule above. */
const debug = { audioWhileCapturing: 0, micStalls: 0, recoveries: 0, spoke: 0, ttsFallbacks: 0 };
Object.defineProperty(debug, 'capturing', { get: () => capturing });
window.popcornDebug = debug;

/* ── Settings ─────────────────────────────────────────────────────────────── */

function loadSettings() {
  const defaults = { patience: 0.5, sensitivity: 0.5, chime: true, speakWarning: false };
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
el.speakWarning.checked = settings.speakWarning;
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
el.speakWarning.addEventListener('change', () => {
  settings.speakWarning = el.speakWarning.checked;
  saveSettings();
});

/* ── Screens ──────────────────────────────────────────────────────────────── */

function show(name) {
  for (const [key, node] of Object.entries(el.screens)) {
    node.classList.toggle('is-active', key === name);
  }
  window.scrollTo(0, 0);
}

/* ── Sound out ────────────────────────────────────────────────────────────── */

/* Output gets its own AudioContext, entirely separate from the capture one, and
   is only ever used while capture is stopped. */
let outCtx = null;

function outputContext() {
  try {
    if (!outCtx || outCtx.state === 'closed') {
      outCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (outCtx.state === 'suspended') outCtx.resume().catch(() => {});
    return outCtx;
  } catch {
    return null;
  }
}

function tone(freqs, step, gainValue) {
  if (capturing) { debug.audioWhileCapturing++; return; }
  const ctx = outputContext();
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
  } catch {}
}

function chime() {
  if (!settings.chime) return;
  tone([880, 1320], 0.16, 0.4);
}

/* Backup for when speech synthesis silently refuses — which is exactly what
   happens in an iOS Home Screen web app. */
function alarmTone() {
  debug.ttsFallbacks++;
  tone([784, 1046, 784, 1046, 784, 1046], 0.22, 0.6);
}

function speak(text) {
  if (capturing) { debug.audioWhileCapturing++; return; }
  const synth = window.speechSynthesis;
  if (!synth) { alarmTone(); return; }

  let started = false;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.lang = 'en-US';
    u.onstart = () => { started = true; debug.spoke++; };
    u.onerror = () => { if (!started) alarmTone(); };
    synth.resume();
    synth.speak(u);
  } catch {
    alarmTone();
    return;
  }

  // iOS home-screen web apps will accept an utterance and then never speak it,
  // without firing onerror. If nothing has started by now, make a noise instead.
  setTimeout(() => { if (!started) alarmTone(); }, 900);
}

function announce(text) {
  chime();
  setTimeout(() => speak(text), settings.chime ? 380 : 0);
}

el.testVoice.addEventListener('click', () => {
  outputContext();
  announce('This is how loud I will be.');
});

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
  if (!capturing) return;
  acquireWakeLock();
  if (capCtx && capCtx.state === 'suspended') capCtx.resume().catch(() => {});
  if (detector) detector.resetContinuity();
});

/* ── Microphone ───────────────────────────────────────────────────────────── */

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

async function openCapture() {
  stream = await getMic();
  capCtx = new (window.AudioContext || window.webkitAudioContext)();
  await capCtx.resume();

  const source = capCtx.createMediaStreamSource(stream);
  analyser = capCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0; // smoothing would erase the transients
  source.connect(analyser);           // never connected to destination

  freqData = new Float32Array(analyser.frequencyBinCount);
  detector = new PopDetector(capCtx.sampleRate, analyser.fftSize);
  detector.setSensitivity(settings.sensitivity);

  capturing = true;
  silentSince = 0;

  const track = stream.getAudioTracks()[0];
  if (track) {
    track.addEventListener('ended', () => { if (capturing) recoverMic(); });
  }
}

function closeCapture() {
  capturing = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (capCtx) { capCtx.close().catch(() => {}); capCtx = null; }
  analyser = null;
  detector = null;
  freqData = null;
}

/* iOS kills capture for reasons of its own. A dead analyser returns digital
   silence — indistinguishable from a bag that finished — so rebuild rather than
   quietly mis-decide. */
async function recoverMic() {
  if (!capturing || recovering) return;
  recovering = true;
  debug.micStalls++;

  // If we genuinely cannot hear any more, say so rather than sitting there
  // silently — a deaf detector and a finished bag look identical from here.
  if (recoveries >= MAX_RECOVERIES) {
    recovering = false;
    outcome = 'mic-lost';
    triggerAlert('Lost the microphone', 'I can no longer hear the microwave — go and check it.');
    return;
  }
  recoveries++;

  closeCapture();
  try {
    await openCapture();
    debug.recoveries++;
    // The window now has a hole in it; do not judge the bag until it refills.
    session.suspendDecisions(performance.now(), PopSession.SLOW_WINDOW_MS);
    silentSince = 0;
    lastFrameAt = performance.now();
    warn('The microphone dropped out for a moment — restarted it, still listening.');
  } catch (err) {
    warn(micErrorMessage(err));
  }
  recovering = false;
}

/* ── Start / stop ─────────────────────────────────────────────────────────── */

el.start.addEventListener('click', async () => {
  el.setupError.hidden = true;
  el.start.disabled = true;
  el.start.textContent = 'Starting…';

  // Unlock audio output inside the tap, which is the only time iOS allows it —
  // and get the priming utterance over with *before* the mic opens, so the two
  // never overlap.
  outputContext();
  await primeSpeech();

  try {
    await openCapture();
  } catch (err) {
    el.setupError.textContent = micErrorMessage(err);
    el.setupError.hidden = false;
    el.start.disabled = false;
    el.start.textContent = 'Start listening';
    closeCapture();
    return;
  }

  session.setPatience(settings.patience);
  session.start(performance.now());

  recoveries = 0;
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
});

/* Speech synthesis has to be woken by a real user gesture or it stays mute for
   the rest of the page's life. Wait for it to finish before opening the mic. */
function primeSpeech() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { resolve(); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance('Listening.');
      u.lang = 'en-US';
      u.volume = 1.0;
      u.onstart = () => { debug.spoke++; };
      u.onend = finish;
      u.onerror = finish;
      synth.resume();
      synth.speak(u);
    } catch {
      finish();
    }
    setTimeout(finish, 1600);
  });
}

function endSession() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  clearInterval(alertTimer);
  alertTimer = 0;
  releaseWakeLock();
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  closeCapture();
}

el.cancel.addEventListener('click', () => {
  endSession();
  show('setup');
});

/* ── Main loop ────────────────────────────────────────────────────────────── */

function loop() {
  if (!capturing && !recovering) { rafId = 0; return; }
  rafId = requestAnimationFrame(loop);
  if (!analyser || !detector) return; // mid-rebuild

  const now = performance.now();
  const dt = now - lastFrameAt;
  lastFrameAt = now;

  if (dt > 600 && !stallReported && session.phase !== 'warmup') {
    stallReported = true;
    warn('The screen went to sleep for a moment, so I may have missed some pops. Keep this screen open and awake.');
    detector.resetContinuity();
    session.suspendDecisions(now, PopSession.SLOW_WINDOW_MS);
  }

  analyser.getFloatFrequencyData(freqData);
  if (detector.process(freqData, now)) session.addPop(now);

  // Digital silence means the capture graph died; a real room is never exactly
  // zero across the whole band.
  if (detector.bandMag > 0) {
    silentSince = 0;
  } else {
    if (!silentSince) silentSince = now;
    if (now - silentSince > 2000) { silentSince = 0; recoverMic(); }
  }

  const event = session.update(now);
  if (event) handleEvent(event);

  render(now);
}

function handleEvent(event) {
  switch (event.type) {
    case 'started':
      // Silent on purpose: speaking here would kill the microphone.
      setPhase('Popping', 'Listening. I will call out when to stop.');
      break;

    case 'warning':
      setPhase('Slowing down', 'Nearly there — head to the microwave.');
      if (settings.speakWarning) speakWhileListening('Almost done. Head to the microwave.');
      break;

    case 'resumed':
      setPhase('Popping', 'Picked back up. I will call out when to stop.');
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

/* Opt-in only. Speaking mid-run costs us the microphone, so we hand it back
   deliberately, say the line, and rebuild — which is why the stop decision is
   then held until the window has refilled. */
async function speakWhileListening(text) {
  closeCapture();
  announce(text);
  setTimeout(async () => {
    if (session.phase === 'done') return;
    try {
      await openCapture();
      session.suspendDecisions(performance.now(), PopSession.SLOW_WINDOW_MS);
      lastFrameAt = performance.now();
      if (!rafId) rafId = requestAnimationFrame(loop);
    } catch {
      warn('Could not restart the microphone after speaking.');
    }
  }, 3000);
}

function triggerAlert(title, sub) {
  // Hand the microphone back before making any sound, or iOS routes the voice
  // into the earpiece and half-swallows it.
  cancelAnimationFrame(rafId);
  rafId = 0;
  closeCapture();

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
  const secs = Math.round((session.lastPopAt - session.startedAt) / 1000);
  el.doneSummary.textContent =
    `${session.totalPops} pops counted · peak ${session.peakRate.toFixed(1)}/s · ` +
    `last pop at ${fmtTime(Math.max(0, secs))}.`;
  endSession();
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
  const meter = detector ? Math.min(1, detector.ratio / 2) : 0;
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
  el.graph.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', () => { if (capturing) sizeGraph(); });

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

/* ── Install hint ─────────────────────────────────────────────────────────── */

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
    navigator.serviceWorker.register('/popcorn/sw.js', { scope: '/popcorn/' })
      .catch(() => {});
  });
}
