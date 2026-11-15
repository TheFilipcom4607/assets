// app.js: wires the simulator to the page.
import { AndurilSim, World, defaultEnvironment, describeEvent } from './sim.js';

const $ = (id) => document.getElementById(id);
const asset = (path) => new URL(path, import.meta.url).href;
const els = {
  status: $('status'), preset: $('preset'), presetNote: $('presetNote'), presetAbout: $('presetAbout'),
  version: $('version'), aux: $('aux'), btn: $('btn'),
  therm: $('therm'), rgbpwm: $('rgbpwm'), usb: $('usb'), speed: $('speed'),
  eswitch: $('eswitch'),
  eswitchLed: $('eswitchLed'), emitter: $('emitter'), auxring: $('auxring'),
  lampGlow: $('lampGlow'), lumens: $('lumens'), levelReadout: $('levelReadout'),
  reconnect: $('reconnect'), wipe: $('wipe'), clearLog: $('clearLog'),
  logList: $('logList'), envControls: $('envControls'), envHint: $('envHint'),
  loadSource: $('loadSource'), sourceView: $('sourceView'),
  sourceLink: $('sourceLink'), sourceWhere: $('sourceWhere'),
  usbPanel: $('usbPanel'), usbStatus: $('usbStatus'), usbHint: $('usbHint'),
  r: {
    state: $('rState'), stack: $('rStack'), event: $('rEvent'),
    level: $('rLevel'), channel: $('rChannel'), pwm: $('rPwm'),
    aux: $('rAux'), battery: $('rBattery'), usb: $('rUsb'), heat: $('rHeat'),
    mcu: $('rMcu'), uptime: $('rUptime'),
  },
};

// aux LEDs x button LED -> the build that has that hardware
const BUILD_FOR = {
  'none|none': 'plain',
  'none|single': 'btn',
  'none|rgb': 'rgbbtn',
  'single|none': 'aux',
  'single|rgb': 'rgbbtn-aux',
  'rgb|none': 'auxrgb',
  'rgb|single': 'btn-auxrgb',
  // Hank's "RGB button" option wires the button LED in parallel with the RGB
  // aux, so it is the same firmware as RGB aux alone; the button just mirrors it
  'rgb|rgb': 'auxrgb',
};

const PICKERS = ['version', 'aux', 'btn', 'therm', 'rgbpwm', 'usb'];

// Lights people actually buy, as far as this simulator can describe them: the
// aux/button LED layout, whether the RGB group can dim smoothly, what the
// USB-C port does, and roughly how much light and heat comes out.  `version`
// is 'latest' unless the light ships something older.
const PRESETS = [
  { id: 'emisar-d4kc', label: 'Emisar D4KC (40 W boost, smooth RGB aux, powerbank)',
    emitters: 4,
    hw: { aux: 'rgb', btn: 'single', rgbpwm: '1', usb: 'auto' },
    env: { maxLumens: 3200, ch2Amps: 11, capacityMah: 4500, batteryV: 4.0, maxRiseC: 85, timeConstantS: 40 },
    note: 'Quad-emitter 21700 light on the Lume X1-C boost driver. The RGB aux dim smoothly: '
      + 'a blended voltage colour after turning off, Batt Color mode, and an "any colour" '
      + 'channel. Cool white switch backlight (set Button LED to RGB if you ordered that). '
      + 'USB-C charges at 5 V 2 A and powers a phone at 5 V 1.5 A. Not simulated: the '
      + 'charge chip\'s red/green LEDs, aux brightness (8H) and the breathing patterns.' },
  { id: 'emisar-d4v2', label: 'Emisar D4V2 (RGB aux, button LED)',
    emitters: 4,
    hw: { aux: 'rgb', btn: 'single', rgbpwm: '0', usb: 'none' },
    env: { maxLumens: 4500, ch2Amps: 12, capacityMah: 3000, batteryV: 4.0, maxRiseC: 85, timeConstantS: 35 },
    note: 'The classic hot-rod: FET turbo, RGB aux, a single-colour button LED, no charging port.' },
  { id: 'hank-lume-x1', label: 'Emisar / Noctigon Lume X1 (smooth RGB aux)',
    hw: { aux: 'rgb', btn: 'single', rgbpwm: '1', usb: 'auto' },
    env: { maxLumens: 3000, ch2Amps: 9, capacityMah: 5000, batteryV: 4.0, maxRiseC: 70, timeConstantS: 60 },
    note: 'The RGB aux sit on timer pins, so the colours dim smoothly: voltage is shown as a '
      + 'blended colour after turning off, and there is an extra "any colour" channel mode (3H to change hue).' },
  { id: 'fireflies-lume10', label: 'Fireflies with Lume10 / Lume X1 (powerbank host mode)',
    hw: { aux: 'rgb', btn: 'single', rgbpwm: '1', usb: 'host' },
    env: { maxLumens: 4000, ch2Amps: 10, capacityMah: 5000, batteryV: 4.0, maxRiseC: 75, timeConstantS: 60 },
    note: 'Smooth RGB aux, and the firmware decides which way the USB-C port runs. To charge '
      + 'a phone: Batt Check, then 2H. Leaving Batt Check turns host mode off again.' },
  { id: 'wurkkos-ts25', label: 'Wurkkos TS25 (RGB aux, USB-C charging)',
    hw: { aux: 'rgb', btn: 'none', rgbpwm: '0', usb: 'charge' },
    env: { maxLumens: 2400, ch2Amps: 7, capacityMah: 5000, batteryV: 4.0, maxRiseC: 70, timeConstantS: 50 },
    note: 'RGB aux, no button LED, and a USB-C port that only charges the light.' },
  { id: 'wurkkos-ts10', label: 'Wurkkos TS10 (single-colour aux)',
    hw: { aux: 'single', btn: 'none', rgbpwm: '0', usb: 'none' },
    env: { maxLumens: 1400, ch2Amps: 6, capacityMah: 1000, batteryV: 4.0, maxRiseC: 90, timeConstantS: 20 },
    note: 'A small 14500 light. The ramp tables here are the TS10\'s own. It gets hot fast, '
      + 'so watch thermal regulation kick in on turbo.' },
  { id: 'sofirn-sc31pro', label: 'Sofirn SC31 Pro (no aux, USB-C charging)',
    hw: { aux: 'none', btn: 'none', rgbpwm: '0', usb: 'charge' },
    env: { maxLumens: 2000, ch2Amps: 6, capacityMah: 3000, batteryV: 4.0, maxRiseC: 75, timeConstantS: 30 },
    note: 'No aux LEDs, no button LED, and USB-C charging built in.' },
  { id: 'convoy-a1', label: 'Convoy (Anduril 1)', version: 'r2020-04-27',
    hw: { aux: 'none', btn: 'none', rgbpwm: '0', usb: 'none' },
    env: { maxLumens: 2400, ch2Amps: 8, capacityMah: 5000, batteryV: 4.0, maxRiseC: 70, timeConstantS: 50 },
    note: 'Convoy still ships Anduril 1: muggle mode instead of Simple UI, and 2C goes straight to turbo.' },
];

const state = {
  manifest: null,
  layout: null,
  sim: null,
  world: null,
  env: null,
  version: null,
  buildId: null,
  running: false,
  lastFrame: 0,
  prev: {},
  logCount: 0,
  eepromTimer: 0,
  sourceCache: new Map(),
  rampLog: null,
  hw: null,
  mirrorButton: false,
  buttonDown: false,
  plugged: 'none',
  envInputs: {},
  envSaveAt: 0,
};

// ---- status -----------------------------------------------------------------

function say(message, isError = false) {
  els.status.textContent = message || '';
  els.status.classList.toggle('error', !!isError);
}

// ---- environment panel ------------------------------------------------------

const ENV_SPEC = [
  { key: 'ambientC', label: 'Ambient temperature', min: -20, max: 45, step: 1, unit: '°C', primary: true },
  { key: 'sensorErrorC', label: 'Temperature sensor error', min: -10, max: 10, step: 0.5, unit: '°C', primary: true,
    hint: 'How far the sensor reads from the truth. The firmware believes the sensor.' },
  { key: 'batteryV', label: 'Battery (open circuit)', min: 2.5, max: 4.35, step: 0.01, unit: 'V', primary: true },
  { key: 'maxRiseC', label: 'Heating at full power', min: 10, max: 120, step: 1, unit: '°C rise', primary: true },
  { key: 'timeConstantS', label: 'Thermal time constant', min: 5, max: 240, step: 5, unit: 's' },
  { key: 'internalR', label: 'Cell + spring resistance', min: 0, max: 0.6, step: 0.01, unit: 'Ω' },
  { key: 'diodeDropV', label: 'Drop before the MCU', min: 0, max: 0.6, step: 0.01, unit: 'V' },
  { key: 'capacityMah', label: 'Cell capacity (0 = never runs down or charges)', min: 0, max: 6000, step: 100, unit: 'mAh' },
  { key: 'maxLumens', label: 'Output at turbo', min: 100, max: 6000, step: 50, unit: 'lm' },
  { key: 'ch2Amps', label: 'Current at turbo', min: 0.5, max: 15, step: 0.1, unit: 'A' },
];

function formatEnv(spec, value) {
  const digits = (String(spec.step).split('.')[1] || '').length;
  return `${Number(value).toFixed(digits)} ${spec.unit}`;
}

function buildEnvControls() {
  els.envControls.textContent = '';
  state.envInputs = {};
  const primary = document.createDocumentFragment();
  const more = document.createElement('div');
  more.className = 'controls';

  for (const spec of ENV_SPEC) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const id = `env-${spec.key}`;
    wrap.innerHTML = `
      <label for="${id}">${spec.label}</label>
      <output id="${id}-out"></output>
      <input type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
    if (spec.hint) wrap.title = spec.hint;
    const input = wrap.querySelector('input');
    const out = wrap.querySelector('output');
    const show = () => { out.textContent = formatEnv(spec, state.env[spec.key]); };
    input.value = state.env[spec.key];
    show();
    input.addEventListener('input', () => {
      state.env[spec.key] = Number(input.value);
      show();
      saveEnv();
    });
    state.envInputs[spec.key] = { input, show, spec };
    (spec.primary ? primary : more).appendChild(wrap);
  }

  els.envControls.appendChild(primary);
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'More about the light and cell';
  summary.className = 'hint';
  details.append(summary, more);
  els.envControls.appendChild(details);
}

// The world changes some of these on its own (a cell running down or being
// charged), so keep the sliders honest.
function syncEnvControls() {
  for (const { input, show, spec } of Object.values(state.envInputs)) {
    const v = state.env[spec.key];
    if (Math.abs(Number(input.value) - v) >= spec.step / 2) {
      input.value = v;
      show();
    }
  }
}

function saveEnv() {
  try { localStorage.setItem('anduril-sim-env', JSON.stringify(state.env)); } catch {}
}

function loadEnv() {
  const env = defaultEnvironment();
  try {
    const saved = JSON.parse(localStorage.getItem('anduril-sim-env') || '{}');
    for (const k of Object.keys(env)) if (Number.isFinite(saved[k])) env[k] = saved[k];
  } catch {}
  return env;
}

// ---- hardware pickers -------------------------------------------------------

function readPickers() {
  const o = {};
  for (const k of PICKERS) o[k] = els[k].value;
  return o;
}

function versionFor(tag) {
  return state.manifest.versions.find((v) => v.tag === tag);
}

// The manifest key of the build that has this hardware, or null if there is
// no such build.
function buildKey(o = readPickers()) {
  const id = BUILD_FOR[`${o.aux}|${o.btn}`];
  if (!id) return null;
  const pwm = o.rgbpwm === '1' ? '-pwm' : '';
  const pb = o.usb === 'host' ? '-pb' : '';
  const key = `${id}${pwm}${pb}-${o.therm === '1' ? 'therm' : 'notherm'}`;
  return versionFor(o.version)?.builds[key] ? key : null;
}

// Grey out each option that would lead to a build that does not exist.  A
// single-colour group and an RGB group can coexist, but Anduril only drives
// one of each; smooth RGB and powerbank host mode only exist in new releases.
function refreshPickerAvailability() {
  const cur = readPickers();
  for (const k of PICKERS) {
    if (k === 'version') continue;
    for (const opt of els[k].options) {
      opt.disabled = !buildKey({ ...cur, [k]: opt.value });
    }
  }
}

// After the firmware changes, the old hardware may not exist for it.  Back
// off the newest features first, so as much of the choice survives as possible.
function repairSelection() {
  if (buildKey()) return;
  const fallbacks = [
    ['rgbpwm', '0'], ['usb', 'auto'], ['therm', '1'], ['btn', 'single'], ['aux', 'rgb'],
    ['btn', 'none'], ['aux', 'none'],
  ];
  for (const [k, v] of fallbacks) {
    els[k].value = v;
    if (buildKey()) return;
  }
}

function savePickers() {
  try {
    localStorage.setItem('anduril-sim-hw',
      JSON.stringify({ preset: els.preset.value, ...readPickers() }));
  } catch {}
}

function restorePickers() {
  try {
    const saved = JSON.parse(localStorage.getItem('anduril-sim-hw') || 'null');
    if (!saved) return false;
    for (const k of ['preset', ...PICKERS]) {
      if (saved[k] && [...els[k].options].some((o) => o.value === saved[k])) els[k].value = saved[k];
    }
    return true;
  } catch { return false; }
}

function applyPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  els.version.value = p.version && versionFor(p.version) ? p.version : state.manifest.versions[0].tag;
  els.therm.value = '1';
  for (const [k, v] of Object.entries(p.hw)) els[k].value = v;
  const defaults = defaultEnvironment();
  // keep the room and the sensor as the user left them; the light is new
  for (const k of Object.keys(defaults)) {
    if (k !== 'ambientC' && k !== 'sensorErrorC') state.env[k] = defaults[k];
  }
  Object.assign(state.env, p.env);
  saveEnv();
  buildEnvControls();
  repairSelection();
}

function showPresetNote() {
  const p = PRESETS.find((x) => x.id === els.preset.value);
  els.presetNote.textContent = p ? p.note : '';
  els.presetAbout.hidden = !p;
}

// ---- loading a build --------------------------------------------------------

async function loadBuild() {
  // settings changed in the last moment would otherwise be lost, or saved
  // under the next build's name
  if (state.eepromTimer) {
    clearTimeout(state.eepromTimer);
    state.eepromTimer = 0;
    saveEeprom();
  }

  const picks = readPickers();
  const version = versionFor(picks.version);
  const key = buildKey(picks);
  const build = key && version?.builds[key];

  if (!build) {
    say('That combination is not something Anduril can drive. It has one single-colour '
      + 'group and one RGB group, not two of either, and smooth RGB and powerbank host '
      + 'mode only exist in the newest release.', true);
    state.running = false;
    return;
  }

  state.running = false;
  say(`Loading ${version.tag} — ${key}…`);

  const sim = new AndurilSim();
  try {
    await sim.load({
      wasmUrl: asset(`builds/${build.wasm}`),
      statesUrl: asset(`builds/${build.states}`),
      layout: state.layout,
    });
  } catch (err) {
    say(`Could not start that build: ${err.message}`, true);
    return;
  }
  // a newer change started another load while this one was fetching
  if (key !== buildKey()) return;

  sim.eeprom = loadEeprom(version.tag, key);
  if (sim.eeprom) sim.boot();
  sim.onReboot = () => addLog('firmware rebooted', 'warn');
  if (state.buttonDown) sim.set('button_down', 1);

  state.sim = sim;
  state.version = version;
  state.buildId = key;
  state.world = new World(state.env);
  state.world.port = picks.usb;
  state.world.plugged = picks.usb === 'none' ? 'none' : state.plugged;
  state.prev = {};
  state.rampLog = null;
  state.lastFrame = performance.now();
  state.running = true;

  const id = BUILD_FOR[`${picks.aux}|${picks.btn}`];
  const hw = state.manifest.hardware.find((h) => h.id === id) || {};
  state.hw = hw;
  state.mirrorButton = picks.aux === 'rgb' && picks.btn === 'rgb';
  const frontAux = (hw.aux1 && !hw.aux1btn) || (hw.auxrgb && !hw.rgbbtn);
  const buttonLed = (hw.aux1 && hw.aux1btn) || (hw.auxrgb && hw.rgbbtn) || state.mirrorButton;
  els.auxring.hidden = !frontAux;
  els.eswitchLed.classList.toggle('absent', !buttonLed);
  paintLed(els.eswitchLed, null);
  paintLed(els.auxring, null);
  const preset = PRESETS.find((x) => x.id === els.preset.value);
  els.emitter.classList.toggle('quad', (preset?.emitters || 1) === 4);

  refreshUsbPanel();

  els.sourceView.hidden = true;
  els.sourceLink.hidden = true;
  say(`${version.tag} (${version.date}), ${(build.bytes / 1024).toFixed(0)} KB of `
    + `firmware compiled from commit ${version.commit.slice(0, 8)}.`);
  els.envHint.textContent = sim.capabilities & 1
    ? 'The firmware reads the sensor and regulates against it. Try setting the sensor error and watching it regulate to the wrong temperature.'
    : 'This build has no temperature sensor, so nothing here throttles the output.';

  addLog(`power connected — ${version.tag}, ${key}`, 'state');
}

// ---- USB-C ------------------------------------------------------------------

const USB_HINTS = {
  charge: 'Charges the cell. Set a cell capacity to watch the voltage climb.',
  auto: 'The charge chip decides the direction itself: plug in a charger and it charges, '
    + 'plug in a phone and it powers it.',
  host: 'The firmware decides the direction. To power a phone: Batt Check (3C from off), '
    + 'then 2H. In Simple UI, Batt Check ends after one readout and takes host mode with '
    + 'it, so do 1H first (Batt Color) to keep it running. Leaving Batt Check turns host '
    + 'mode off.',
};

function refreshUsbPanel() {
  const port = els.usb.value;
  els.usbPanel.hidden = port === 'none';
  els.usbHint.textContent = USB_HINTS[port] || '';
  for (const b of els.usbPanel.querySelectorAll('[data-plug]')) {
    b.classList.toggle('on', b.dataset.plug === (port === 'none' ? 'none' : state.plugged));
    b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
  }
}

function plug(what) {
  state.plugged = what;
  if (state.world) state.world.plugged = what;
  refreshUsbPanel();
  addLog(what === 'none' ? 'USB-C unplugged'
    : what === 'charger' ? 'USB-C charger plugged in' : 'phone plugged into USB-C', 'state');
}

// ---- saved settings ---------------------------------------------------------

const eepromKey = (tag, build) => `anduril-sim-eeprom:${tag}:${build}`;

function loadEeprom(tag, build) {
  try {
    const raw = localStorage.getItem(eepromKey(tag, build));
    if (!raw) return null;
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    return bytes.length ? bytes : null;
  } catch { return null; }
}

function saveEeprom() {
  state.eepromTimer = 0;
  const sim = state.sim;
  if (!sim || !state.version) return;
  try {
    const bytes = sim.readEeprom();
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    localStorage.setItem(eepromKey(state.version.tag, state.buildId), btoa(s));
  } catch {}
}

// ---- the log ----------------------------------------------------------------

// A smooth ramp changes the level many times a second; show it as one entry
// that keeps updating instead of a hundred.
function addRampLog(from, to, note) {
  const now = performance.now();
  const last = state.rampLog;
  if (last && now - last.at < 400 && last.node.isConnected && last.note === note
      && Math.sign(to - last.to) === Math.sign(last.to - last.from)) {
    last.to = to;
    last.at = now;
    last.node.textContent = `level ${last.from} → ${to}${note}`;
    return;
  }
  const node = addLog(`level ${from} → ${to}${note}`, note ? 'warn' : '');
  state.rampLog = { from, to, at: now, node, note };
}

function addLog(text, kind = '') {
  const li = document.createElement('li');
  const t = document.createElement('time');
  t.textContent = state.sim ? `${state.sim.seconds().toFixed(2)}s` : '';
  const span = document.createElement('span');
  span.textContent = text;
  if (kind) span.className = `k-${kind}`;
  li.append(t, span);
  els.logList.prepend(li);
  while (els.logList.children.length > 200) els.logList.lastChild.remove();
  return span;
}

// ---- rendering --------------------------------------------------------------

const LED_STEPS = [0, 0.3, 1];

function rgbFromAux(value) {
  const r = LED_STEPS[(value >> 0) & 3] ?? 0;
  const g = LED_STEPS[(value >> 2) & 3] ?? 0;
  const b = LED_STEPS[(value >> 4) & 3] ?? 0;
  return [r, g, b];
}

// PWM duty is linear in light; eyes are not
const rgbFromPwm = (sim) => [0, 1, 2].map((i) => Math.pow(Math.min(255, sim.get('rgb_pwm', i)) / 255, 0.5));

function ledColor(sim) {
  // returns [r,g,b] 0..1 for whichever group is fitted where
  const hw = state.hw || {};
  const out = { front: null, button: null };
  if (hw.auxrgb) {
    const c = sim.get('rgb_pwm_on') ? rgbFromPwm(sim) : rgbFromAux(sim.get('auxrgb'));
    if (hw.rgbbtn) out.button = c;
    else {
      out.front = c;
      if (state.mirrorButton) out.button = c;
    }
  }
  if (hw.aux1) {
    const lvl = LED_STEPS[sim.get('aux1')] ?? 0;
    const c = [lvl * 0.74, lvl * 0.84, lvl];   // aux LEDs are usually cool white
    if (hw.aux1btn) out.button = c; else out.front = c;
  }
  return out;
}

// An LED is drawn as its colour at full saturation, made more or less
// opaque by how bright it is, so a "low" aux LED still reads as its colour.
function paintLed(el, c) {
  const m = c ? Math.max(c[0], c[1], c[2]) : 0;
  if (m < 0.01) { el.style.setProperty('--a', '0'); return; }
  const ch = (x) => Math.round((x / m) * 255);
  el.style.setProperty('--led', `${ch(c[0])} ${ch(c[1])} ${ch(c[2])}`);
  el.style.setProperty('--a', (0.35 + 0.65 * m).toFixed(3));
}

function render(physics) {
  const sim = state.sim;
  const lm = physics.lumens;
  const rel = Math.min(1, lm / Math.max(1, state.env.maxLumens));
  const v = Math.pow(rel, 0.42);                     // eyes are not linear

  // even a couple of lumens is a visibly lit emitter, so lift the bottom end
  const lit = lm > 0 ? 0.16 + 0.84 * v : 0;
  const mix = (a, b) => Math.round(a + (b - a) * lit);
  const em = els.emitter.style;
  if (lm > 0) {
    em.setProperty('--die', `rgb(${mix(0x30, 0xff)}, ${mix(0x33, 0xf6)}, ${mix(0x3b, 0xe4)})`);
    em.setProperty('--lit', lit.toFixed(3));
    em.boxShadow = `0 0 ${10 + 110 * v}px ${2 + 34 * v}px rgba(255, 216, 160, ${0.12 + 0.55 * v})`;
  } else {
    em.removeProperty('--die');
    em.setProperty('--lit', '0');
    em.boxShadow = '';
  }

  const leds = ledColor(sim);
  if (!els.auxring.hidden) paintLed(els.auxring, leds.front);
  if (leds.button) paintLed(els.eswitchLed, leds.button);

  els.lampGlow.style.opacity = (lm > 0 ? 0.10 + 0.5 * v : 0).toFixed(3);
  els.lumens.textContent = lm >= 1 ? Math.round(lm).toLocaleString() : (lm > 0 ? '<1' : '0');
  const level = sim.get('fw_actual_level');
  const mode = sim.get('fw_channel_mode');
  els.levelReadout.textContent = level
    ? `level ${level} / ${sim.get('fw_ramp_size')}${mode ? ' · aux channel' : ''}` : 'off';
}

function renderReadouts(physics) {
  const sim = state.sim;
  const r = els.r;
  const statePtr = sim.get('fw_current_state');
  r.state.textContent = sim.stateName(statePtr);

  const depth = sim.get('fw_state_depth');
  const stack = [];
  for (let i = 0; i < depth; i++) stack.push(sim.stateName(sim.get('fw_state_stack', i)));
  r.stack.textContent = stack.join(' → ') || '-';

  const ev = sim.get('fw_current_event');
  r.event.textContent = describeEvent(ev) || 'idle';

  const level = sim.get('fw_actual_level');
  r.level.textContent = `${level} / ${sim.get('fw_ramp_size')}`;
  r.channel.textContent = `mode ${sim.get('fw_channel_mode')} of ${sim.get('fw_num_channel_modes')}`;

  const top = sim.get('pwm_top');
  const parts = [];
  for (let i = 0; i < sim.get('pwm_channels'); i++) {
    parts.push(`${sim.get('pwm', i)}/${top}`);
  }
  r.pwm.textContent = `${parts.join('  ')}  (${(physics.duties[0] * 100).toFixed(0)}%`
    + (physics.duties.length > 1 ? ` / ${(physics.duties[1] * 100).toFixed(0)}%)` : ')');

  const hw = state.hw || {};
  const aux = [];
  const names = ['off', 'low', 'high', 'high'];
  if (hw.aux1) {
    aux.push(`${hw.aux1btn ? 'button' : 'aux'} ${names[sim.get('aux1')] ?? '?'}`);
  }
  if (hw.auxrgb) {
    const where = hw.rgbbtn ? 'button' : (state.mirrorButton ? 'aux + button' : 'aux');
    if (sim.get('rgb_pwm_on')) {
      aux.push(`${where} PWM R:${sim.get('rgb_pwm', 0)} G:${sim.get('rgb_pwm', 1)} B:${sim.get('rgb_pwm', 2)}`);
    } else {
      const v = sim.get('auxrgb');
      aux.push(`${where} R:${names[v & 3]} G:${names[(v >> 2) & 3]} B:${names[(v >> 4) & 3]}`);
    }
  }
  r.aux.textContent = aux.join('  ·  ') || 'none fitted';

  const scale = sim.get('fw_voltage_scale') || 50;
  const raw = sim.get('fw_voltage');
  const fwVolts = raw / scale;
  r.battery.textContent = `${physics.openV.toFixed(2)} V cell`
    + (Math.abs(physics.loadedV - physics.openV) >= 0.01 ? ` (${physics.loadedV.toFixed(2)} V loaded)` : '')
    + (raw ? `  ·  firmware reads ${fwVolts.toFixed(scale > 100 ? 3 : 2)} V` : '');

  const usb = physics.usb;
  r.usb.textContent = usb.state === 'absent' ? 'no port'
    : usb.text + (usb.host ? '  ·  host mode' : '');
  els.usbStatus.textContent = usb.text;

  const temp = sim.get('fw_temperature') | 0;
  if (!(sim.capabilities & 1)) {
    r.heat.textContent = `${physics.dieC.toFixed(1)} °C, but nothing measures it`;
  } else if (temp === 0 || temp < -40 || temp > 150) {
    // asleep, or the firmware has not taken its first reading since boot
    r.heat.textContent = `${physics.dieC.toFixed(1)} °C  ·  not measured right now`;
  } else {
    const err = state.env.sensorErrorC;
    r.heat.textContent = `${physics.dieC.toFixed(1)} °C  ·  firmware reads ${temp} °C`
      + (err ? `  (sensor off by ${err > 0 ? '+' : ''}${err})` : '');
  }

  r.mcu.textContent = (sim.get('sleeping')
    ? ['idle', 'adc', 'standby', '', 'power-down'][sim.get('sleep_mode')] || 'asleep'
    : 'running')
    + `  ·  ${sim.get('wdt_period_ms')}ms tick`
    + (sim.get('fw_go_to_standby') ? '  ·  going to standby' : '');

  r.uptime.textContent = `${sim.seconds().toFixed(1)}s  ·  ${sim.get('n_ticks')} ticks`;
}

// ---- transitions worth logging ----------------------------------------------

function logTransitions(physics) {
  const sim = state.sim;
  const p = state.prev;

  // only finished gestures (nC) and holds (nH); every press and release
  // would bury them
  const ev = sim.get('fw_current_event');
  if (ev !== p.event) {
    if ((ev & 0b10000000) && (ev & 0b01100000)) addLog(describeEvent(ev), 'button');
    p.event = ev;
  }

  const st = sim.get('fw_current_state');
  if (st !== p.state) {
    if (p.state !== undefined) addLog(`→ ${sim.stateName(st)}`, 'state');
    state.rampLog = null;
    p.state = st;
    updateSourceTarget();
  }

  const level = sim.get('fw_actual_level');
  if (level !== p.level) {
    if (p.level !== undefined) {
      const hot = (sim.capabilities & 1) && level < p.level && level > 0
        && (sim.get('fw_temperature') | 0) > 45;
      addRampLog(p.level, level, hot ? '  (thermal regulation)' : '');
    }
    p.level = level;
  }

  // the firmware's own low-voltage threshold is 2.9 V
  const scale = sim.get('fw_voltage_scale') || 50;
  const volts = sim.get('fw_voltage') / scale;
  if (volts && volts < 2.9 && p.lowBatt === false) {
    addLog('battery reads low', 'warn');
    p.lowBatt = true;
  } else if (!volts || volts > 3.1) {
    p.lowBatt = false;
  }

  const host = !!sim.get('powerbank_host');
  if (p.host !== undefined && host !== p.host) {
    addLog(host ? 'powerbank host mode on' : 'powerbank host mode off', 'state');
  }
  p.host = host;

  if (p.usb !== undefined && physics.usb.state !== p.usb && physics.usb.text) {
    addLog(`USB-C: ${physics.usb.text}`, physics.usb.state === 'blocked' ? 'warn' : '');
  }
  p.usb = physics.usb.state;
}

// ---- source viewer ----------------------------------------------------------

function updateSourceTarget() {
  const sim = state.sim;
  if (!sim) return;
  const info = sim.stateInfo(sim.get('fw_current_state'));
  els.sourceWhere.textContent = info?.file ? `${info.file}:${info.line}` : '';
  els.sourceLink.hidden = !info?.file;
  if (info?.file) {
    els.sourceLink.href =
      `https://github.com/ToyKeeper/anduril/blob/${state.version.commit}/${info.file}#L${info.line}`;
  }
}

async function showSource() {
  const sim = state.sim;
  const info = sim && sim.stateInfo(sim.get('fw_current_state'));
  if (!info?.file) { say('No source is recorded for this state.', true); return; }
  const url = `${state.manifest.rawBase}/${state.version.commit}/${info.file}`;
  els.sourceView.hidden = false;
  els.sourceView.textContent = 'Fetching from GitHub…';
  try {
    let text = state.sourceCache.get(url);
    if (!text) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GitHub said ${res.status}`);
      text = await res.text();
      state.sourceCache.set(url, text);
    }
    els.sourceView.textContent = '';
    const lines = text.split('\n');
    const pad = String(lines.length).length;
    for (let i = 0; i < lines.length; i++) {
      const row = document.createElement('span');
      row.textContent = `${String(i + 1).padStart(pad, ' ')}  ${lines[i]}\n`;
      if (i + 1 === info.line) row.className = 'cur';
      els.sourceView.appendChild(row);
    }
    const target = els.sourceView.querySelector('.cur');
    if (target) els.sourceView.scrollTop = target.offsetTop - els.sourceView.clientHeight / 3;
  } catch (err) {
    els.sourceView.textContent =
      `Could not fetch the source from GitHub (${err.message}).\n`
      + 'Check your connection, or use "Open on GitHub" instead.\n\n'
      + url;
  }
}

// ---- main loop --------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  if (!state.running || !state.sim) { state.lastFrame = now; return; }

  // Fast-forward is for skipping the waiting, not for the clicking.  While a
  // button sequence is in progress -- held down, or still inside Anduril's
  // multi-click window -- run at real speed so the timing still means something.
  const busy = state.buttonDown || state.sim.get('fw_current_event') !== 0;
  const speed = busy ? 1 : (Number(els.speed.value) || 1);
  let dtMs = Math.min(60, now - state.lastFrame);
  state.lastFrame = now;
  if (dtMs <= 0) return;
  dtMs *= speed;

  const physics = state.world.step(state.sim, dtMs / 1000);
  state.sim.run(dtMs);

  render(physics);
  renderReadouts(physics);
  logTransitions(physics);

  // a charging or draining cell moves the battery slider; persist it now and then
  if (now - state.envSaveAt > 2000) {
    state.envSaveAt = now;
    syncEnvControls();
    if (state.env.capacityMah > 0) saveEnv();
  }

  if (state.sim.get('eeprom_dirty')) {
    state.sim.set('eeprom_dirty', 0);
    clearTimeout(state.eepromTimer);
    state.eepromTimer = setTimeout(saveEeprom, 400);
  }
}

// ---- input ------------------------------------------------------------------

function pressButton(down) {
  state.buttonDown = down;
  els.eswitch.classList.toggle('down', down);
  if (!state.sim) return;
  state.sim.set('button_down', down ? 1 : 0);
}

// Space and Enter work the e-switch, except where they already mean something
// (a focused button, link, picker or slider).
function keyOwnedByFocus() {
  const el = document.activeElement;
  if (!el || el === els.eswitch || el === document.body) return false;
  return ['SELECT', 'INPUT', 'BUTTON', 'A', 'SUMMARY', 'TEXTAREA'].includes(el.tagName);
}

function wireInput() {
  const down = (e) => { e.preventDefault(); pressButton(true); };
  const up = (e) => { e.preventDefault(); pressButton(false); };
  els.eswitch.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    els.eswitch.setPointerCapture(e.pointerId);
    down(e);
  });
  els.eswitch.addEventListener('pointerup', up);
  els.eswitch.addEventListener('pointercancel', up);
  els.eswitch.addEventListener('lostpointercapture', () => { if (state.buttonDown) pressButton(false); });
  els.eswitch.addEventListener('contextmenu', (e) => e.preventDefault());

  addEventListener('keydown', (e) => {
    if (e.repeat || (e.code !== 'Space' && e.code !== 'Enter')) return;
    if (keyOwnedByFocus()) return;
    e.preventDefault();
    pressButton(true);
  });
  addEventListener('keyup', (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if (!state.buttonDown) return;
    e.preventDefault();
    pressButton(false);
  });
  addEventListener('blur', () => { if (state.buttonDown) pressButton(false); });
}

// ---- start ------------------------------------------------------------------

function powerCycle(message, kind) {
  if (!state.sim) return;
  state.sim.boot();
  if (state.buttonDown) state.sim.set('button_down', 1);
  state.prev = {};
  state.rampLog = null;
  addLog(message, kind);
}

async function main() {
  state.env = loadEnv();
  buildEnvControls();
  wireInput();

  try {
    // resolved against this module's own URL, so the page works from any path
    const [manifest, layout] = await Promise.all([
      fetch(asset('builds/manifest.json')).then((r) => r.json()),
      fetch(asset('builds/layout.json')).then((r) => r.json()),
    ]);
    state.manifest = manifest;
    state.layout = layout;
  } catch (err) {
    say(`Could not load the firmware index: ${err.message}`, true);
    return;
  }

  for (const v of state.manifest.versions) {
    const opt = document.createElement('option');
    opt.value = v.tag;
    opt.textContent = `${v.label}${v.note ? ` — ${v.note}` : ''}`;
    els.version.appendChild(opt);
  }
  for (const p of PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    els.preset.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom — pick the parts yourself';
  els.preset.appendChild(custom);

  if (!restorePickers()) {
    els.preset.value = 'emisar-d4kc';
    applyPreset('emisar-d4kc');
  }
  repairSelection();
  refreshPickerAvailability();
  showPresetNote();

  els.preset.addEventListener('change', async () => {
    applyPreset(els.preset.value);
    refreshPickerAvailability();
    showPresetNote();
    savePickers();
    await loadBuild();
  });
  for (const k of PICKERS) {
    els[k].addEventListener('change', async () => {
      // the light is not that model any more
      els.preset.value = 'custom';
      showPresetNote();
      if (k === 'version') repairSelection();
      refreshPickerAvailability();
      savePickers();
      await loadBuild();
    });
  }
  for (const b of els.usbPanel.querySelectorAll('[data-plug]')) {
    b.addEventListener('click', () => plug(b.dataset.plug));
  }
  els.reconnect.addEventListener('click', () => {
    if (!state.sim) return;
    state.sim.eeprom = state.sim.readEeprom();
    powerCycle('battery reconnected', 'state');
  });
  els.wipe.addEventListener('click', () => {
    if (!state.sim) return;
    clearTimeout(state.eepromTimer);
    state.eepromTimer = 0;
    try { localStorage.removeItem(eepromKey(state.version.tag, state.buildId)); } catch {}
    state.sim.wipeEeprom();
    powerCycle('memory wiped, booting as a new light', 'warn');
  });
  els.clearLog.addEventListener('click', () => {
    els.logList.textContent = '';
    state.rampLog = null;
  });
  els.loadSource.addEventListener('click', showSource);

  await loadBuild();
  requestAnimationFrame(frame);
}

main();
