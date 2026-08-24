// app.js: wires the simulator to the page.
import { AndurilSim, World, defaultEnvironment, describeEvent } from './sim.js';

const $ = (id) => document.getElementById(id);
const asset = (path) => new URL(path, import.meta.url).href;
const els = {
  status: $('status'), version: $('version'), aux: $('aux'), btn: $('btn'),
  therm: $('therm'), speed: $('speed'), eswitch: $('eswitch'),
  eswitchLed: $('eswitchLed'), emitter: $('emitter'), auxring: $('auxring'),
  lampGlow: $('lampGlow'), lumens: $('lumens'), levelReadout: $('levelReadout'),
  reconnect: $('reconnect'), wipe: $('wipe'), clearLog: $('clearLog'),
  logList: $('logList'), envControls: $('envControls'), envHint: $('envHint'),
  loadSource: $('loadSource'), sourceView: $('sourceView'),
  sourceLink: $('sourceLink'), sourceWhere: $('sourceWhere'),
  r: {
    state: $('rState'), stack: $('rStack'), event: $('rEvent'),
    level: $('rLevel'), channel: $('rChannel'), pwm: $('rPwm'),
    aux: $('rAux'), battery: $('rBattery'), heat: $('rHeat'),
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
};

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
  buttonDown: false,
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
  { key: 'capacityMah', label: 'Cell capacity (0 = never runs down)', min: 0, max: 5000, step: 100, unit: 'mAh' },
  { key: 'maxLumens', label: 'Output at turbo', min: 100, max: 6000, step: 50, unit: 'lm' },
  { key: 'ch2Amps', label: 'Current at turbo', min: 0.5, max: 12, step: 0.1, unit: 'A' },
];

function buildEnvControls() {
  els.envControls.textContent = '';
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
    const input = wrap.querySelector('input');
    const out = wrap.querySelector('output');
    const show = () => { out.textContent = `${state.env[spec.key]} ${spec.unit}`; };
    input.value = state.env[spec.key];
    show();
    input.addEventListener('input', () => {
      state.env[spec.key] = Number(input.value);
      show();
      saveEnv();
    });
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

function saveEnv() {
  try { localStorage.setItem('anduril-sim-env', JSON.stringify(state.env)); } catch {}
}

function loadEnv() {
  const env = defaultEnvironment();
  try {
    const saved = JSON.parse(localStorage.getItem('anduril-sim-env') || '{}');
    for (const k of Object.keys(env)) if (typeof saved[k] === 'number') env[k] = saved[k];
  } catch {}
  return env;
}

// ---- hardware pickers -------------------------------------------------------

function currentBuildId() {
  return BUILD_FOR[`${els.aux.value}|${els.btn.value}`];
}

// A single-colour group and an RGB group can coexist, but Anduril only ever
// drives one of each, so two of the same kind is not a light that can exist.
function refreshPickerAvailability() {
  const version = state.manifest.versions.find((v) => v.tag === els.version.value);
  const therm = els.therm.value === '1' ? 'therm' : 'notherm';
  for (const sel of [els.aux, els.btn]) {
    for (const opt of sel.options) {
      const other = sel === els.aux ? els.btn.value : els.aux.value;
      const key = sel === els.aux ? `${opt.value}|${other}` : `${other}|${opt.value}`;
      const id = BUILD_FOR[key];
      opt.disabled = !id || !version?.builds[`${id}-${therm}`];
    }
  }
}

// ---- loading a build --------------------------------------------------------

async function loadBuild() {
  const version = state.manifest.versions.find((v) => v.tag === els.version.value);
  const id = currentBuildId();
  const therm = els.therm.value === '1' ? 'therm' : 'notherm';
  const key = `${id}-${therm}`;
  const build = version?.builds[key];

  if (!build) {
    say('That combination of aux LEDs and button LED is not something Anduril '
      + 'can drive: it has one single-colour group and one RGB group, not two of either.', true);
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

  sim.eeprom = loadEeprom(version.tag, key);
  if (sim.eeprom) sim.boot();
  sim.onReboot = () => addLog('firmware rebooted', 'warn');

  state.sim = sim;
  state.version = version;
  state.buildId = key;
  state.world = new World(state.env);
  state.prev = {};
  state.lastFrame = performance.now();
  state.running = true;

  const hw = state.manifest.hardware.find((h) => h.id === id) || {};
  state.hw = hw;
  const frontAux = (hw.aux1 && !hw.aux1btn) || (hw.auxrgb && !hw.rgbbtn);
  const buttonLed = (hw.aux1 && hw.aux1btn) || (hw.auxrgb && hw.rgbbtn);
  els.auxring.hidden = !frontAux;
  els.eswitchLed.classList.toggle('absent', !buttonLed);

  els.sourceView.hidden = true;
  els.sourceLink.hidden = true;
  say(`${version.tag} (${version.date}), ${(build.bytes / 1024).toFixed(0)} KB of `
    + `firmware compiled from commit ${version.commit.slice(0, 8)}.`);
  els.envHint.textContent = sim.capabilities & 1
    ? 'The firmware reads the sensor and regulates against it. Try setting the sensor error and watching it regulate to the wrong temperature.'
    : 'This build has no temperature sensor, so nothing here throttles the output.';

  addLog(`power connected — ${version.tag}, ${key}`, 'state');
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
  const sim = state.sim;
  if (!sim) return;
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
  if (last && now - last.at < 400 && last.node.isConnected
      && Math.sign(to - last.to) === Math.sign(last.to - last.from)) {
    last.to = to;
    last.at = now;
    last.node.textContent = `level ${last.from} → ${to}${note}`;
    return;
  }
  const node = addLog(`level ${from} → ${to}${note}`, note ? 'warn' : '');
  state.rampLog = { from, to, at: now, node };
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
  if (++state.logCount > 200) {
    while (els.logList.children.length > 200) els.logList.lastChild.remove();
  }
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

function ledColor(sim) {
  // returns [r,g,b] 0..1 for whichever group is fitted where
  const hw = state.hw || {};
  const out = { front: null, button: null };
  if (hw.auxrgb) {
    const c = rgbFromAux(sim.get('auxrgb'));
    if (hw.rgbbtn) out.button = c; else out.front = c;
  }
  if (hw.aux1) {
    const lvl = LED_STEPS[sim.get('aux1')] ?? 0;
    const c = [lvl * 0.74, lvl * 0.84, lvl];   // aux LEDs are usually cool white
    if (hw.aux1btn) out.button = c; else out.front = c;
  }
  return out;
}

function css([r, g, b], gain = 255) {
  return `rgb(${Math.round(r * gain)}, ${Math.round(g * gain)}, ${Math.round(b * gain)})`;
}

function render(physics) {
  const sim = state.sim;
  const lm = physics.lumens;
  const rel = Math.min(1, lm / Math.max(1, state.env.maxLumens));
  const v = Math.pow(rel, 0.42);                     // eyes are not linear

  // even a couple of lumens is a visibly lit emitter, so lift the bottom end
  const lit = lm > 0 ? 0.16 + 0.84 * v : 0;
  const mix = (a, b) => Math.round(a + (b - a) * lit);
  els.emitter.style.background = lm > 0
    ? `rgb(${mix(0x28, 0xff)}, ${mix(0x2b, 0xf6)}, ${mix(0x33, 0xe4)})` : '#232730';
  els.emitter.style.boxShadow = lm > 0
    ? `0 0 ${10 + 110 * v}px ${2 + 34 * v}px rgba(255, 216, 160, ${0.12 + 0.55 * v})`
    : 'none';

  const leds = ledColor(sim);
  if (!els.auxring.hidden) {
    const c = leds.front || [0, 0, 0];
    const on = c[0] + c[1] + c[2] > 0.01;
    els.auxring.style.borderColor = on ? css(c) : 'rgba(255,255,255,0.05)';
    els.auxring.style.boxShadow = on ? `0 0 18px 1px ${css(c, 190)}` : 'none';
  }
  const bc = leds.button;
  if (bc) {
    const on = bc[0] + bc[1] + bc[2] > 0.01;
    els.eswitchLed.style.background = on ? css(bc) : '#23262c';
    els.eswitchLed.style.boxShadow = on ? `0 0 12px 1px ${css(bc, 200)}` : 'none';
  }

  els.lampGlow.style.opacity = (lm > 0 ? 0.10 + 0.5 * v : 0).toFixed(3);
  els.lumens.textContent = lm >= 1 ? Math.round(lm).toLocaleString() : (lm > 0 ? '<1' : '0');
  const level = sim.get('fw_actual_level');
  els.levelReadout.textContent = level
    ? `level ${level} / ${sim.get('fw_ramp_size')}` : 'off';
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
  const names = ['off', 'low', 'high'];
  if (hw.aux1) {
    aux.push(`${hw.aux1btn ? 'button' : 'aux'} ${names[sim.get('aux1')] ?? '?'}`);
  }
  if (hw.auxrgb) {
    const v = sim.get('auxrgb');
    aux.push(`${hw.rgbbtn ? 'button' : 'aux'} R:${names[v & 3]} G:${names[(v >> 2) & 3]} B:${names[(v >> 4) & 3]}`);
  }
  r.aux.textContent = aux.join('  ·  ') || 'none fitted';

  const scale = sim.get('fw_voltage_scale') || 50;
  const fwVolts = sim.get('fw_voltage') / scale;
  r.battery.textContent = `${physics.openV.toFixed(2)} V cell`
    + `  ·  firmware reads ${fwVolts.toFixed(2)} V`
    + (physics.drained > 0 ? `  ·  ${Math.round(physics.drained * 100)}% used` : '');

  const temp = sim.get('fw_temperature') | 0;
  if (!(sim.capabilities & 1)) {
    r.heat.textContent = `${physics.dieC.toFixed(1)} °C, but nothing measures it`;
  } else if (temp === 0) {
    r.heat.textContent = `${physics.dieC.toFixed(1)} °C  ·  not measured while asleep`;
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

  const ev = sim.get('fw_current_event');
  if (ev !== p.event) {
    const text = describeEvent(ev);
    if (text && (ev & 0b10000000)) addLog(text, 'button');
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

  const volts = sim.get('fw_voltage');
  if (p.lowBatt !== undefined && volts && volts < 29 * (sim.get('fw_voltage_scale') / 10 || 5)
      && !p.lowBatt) {
    addLog('battery reads low', 'warn');
    p.lowBatt = true;
  } else if (volts > 31 * (sim.get('fw_voltage_scale') / 10 || 5)) {
    p.lowBatt = false;
  }
  if (p.lowBatt === undefined) p.lowBatt = false;
}

// ---- source viewer ----------------------------------------------------------

function updateSourceTarget() {
  const sim = state.sim;
  if (!sim) return;
  const info = sim.stateInfo(sim.get('fw_current_state'));
  els.sourceWhere.textContent = info?.file ? `${info.file}:${info.line}` : '';
  if (info?.file) {
    const url = `https://github.com/ToyKeeper/anduril/blob/${state.version.commit}/${info.file}#L${info.line}`;
    els.sourceLink.href = url;
    els.sourceLink.hidden = false;
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
  if (!state.running || !state.sim) return;

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

  if (state.sim.get('eeprom_dirty')) {
    state.sim.set('eeprom_dirty', 0);
    clearTimeout(state.eepromTimer);
    state.eepromTimer = setTimeout(saveEeprom, 400);
  }
}

// ---- input ------------------------------------------------------------------

function pressButton(down) {
  state.buttonDown = down;
  if (!state.sim) return;
  state.sim.set('button_down', down ? 1 : 0);
  els.eswitch.classList.toggle('down', down);
}

function wireInput() {
  const down = (e) => { e.preventDefault(); pressButton(true); };
  const up = (e) => { e.preventDefault(); pressButton(false); };
  els.eswitch.addEventListener('pointerdown', (e) => {
    els.eswitch.setPointerCapture(e.pointerId);
    down(e);
  });
  els.eswitch.addEventListener('pointerup', up);
  els.eswitch.addEventListener('pointercancel', up);
  els.eswitch.addEventListener('contextmenu', (e) => e.preventDefault());

  addEventListener('keydown', (e) => {
    if (e.repeat || (e.code !== 'Space' && e.code !== 'Enter')) return;
    if (document.activeElement?.tagName === 'SELECT') return;
    e.preventDefault();
    pressButton(true);
  });
  addEventListener('keyup', (e) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    e.preventDefault();
    pressButton(false);
  });
  addEventListener('blur', () => pressButton(false));
}

// ---- start ------------------------------------------------------------------

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

  els.aux.value = 'rgb';
  els.btn.value = 'single';
  refreshPickerAvailability();

  for (const el of [els.version, els.aux, els.btn, els.therm]) {
    el.addEventListener('change', async () => {
      refreshPickerAvailability();
      await loadBuild();
    });
  }
  els.reconnect.addEventListener('click', () => {
    if (!state.sim) return;
    state.sim.eeprom = state.sim.readEeprom();
    state.sim.boot();
    state.prev = {};
    addLog('battery reconnected', 'state');
  });
  els.wipe.addEventListener('click', () => {
    if (!state.sim) return;
    try { localStorage.removeItem(eepromKey(state.version.tag, state.buildId)); } catch {}
    state.sim.wipeEeprom();
    state.sim.eeprom = null;
    state.sim.boot();
    state.prev = {};
    addLog('memory wiped, booting as a new light', 'warn');
  });
  els.clearLog.addEventListener('click', () => { els.logList.textContent = ''; });
  els.loadSource.addEventListener('click', showSource);

  await loadBuild();
  requestAnimationFrame(frame);
}

main();
