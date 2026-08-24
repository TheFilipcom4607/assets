// sim.js: drives a compiled Anduril firmware build in the browser.
//
// The wasm module is the real firmware, compiled from ToyKeeper's C sources.
// Everything here is the hardware around it: a clock, an e-switch, a battery,
// an LED that heats up, and a temperature sensor that may be a little wrong.

const F_CPU = 10_000_000;          // the simulated MCU runs at 10 MHz
const ASYNCIFY_HEADER = 8;         // {current, end} at the top of the buffer

export class AndurilSim {
  constructor() {
    this.layout = null;
    this.module = null;
    this.states = {};
    this.capabilities = 0;
    this.instance = null;
    this.io = 0;
    this.u32 = null;
    this.unwinding = false;
    this.started = false;
    this.eeprom = null;            // Uint8Array kept across reboots
    this.onReboot = null;
  }

  async load({ wasmUrl, statesUrl, layout }) {
    this.layout = layout;
    const [wasmBytes, states] = await Promise.all([
      fetch(wasmUrl).then((r) => {
        if (!r.ok) throw new Error(`could not load firmware (${r.status})`);
        return r.arrayBuffer();
      }),
      fetch(statesUrl).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    this.module = await WebAssembly.compile(wasmBytes);
    this.states = states;
    this.boot();
  }

  // Power-up.  Keeps the EEPROM contents, exactly like putting the same cells
  // back into the same light.
  boot() {
    const imports = { env: {
      sim_host_trace: () => {},
      sim_host_yield: () => {
        if (!this.unwinding) {
          this.instance.exports.asyncify_start_unwind(this.asyncifyData);
          this.unwinding = true;
        } else {
          this.instance.exports.asyncify_stop_rewind();
          this.unwinding = false;
        }
      },
    } };
    this.instance = new WebAssembly.Instance(this.module, imports);
    const ex = this.instance.exports;
    this.u32 = new Uint32Array(ex.memory.buffer);
    this.u8 = new Uint8Array(ex.memory.buffer);
    ex.sim_init();
    this.io = ex.sim_io_ptr();
    this.capabilities = ex.sim_capabilities();

    this.asyncifyData = ex.sim_asyncify_stack_ptr();
    this.u32[this.asyncifyData >> 2] = this.asyncifyData + ASYNCIFY_HEADER;
    this.u32[(this.asyncifyData >> 2) + 1] =
      this.asyncifyData + ex.sim_asyncify_stack_size();

    // restore saved settings into the EEPROM before the firmware reads it
    this.eepromPtr = ex.sim_eeprom_ptr();
    this.eepromSize = ex.sim_eeprom_size();
    if (this.eeprom && this.eeprom.length === this.eepromSize) {
      this.u8.set(this.eeprom, this.eepromPtr);
    }

    this.unwinding = false;
    this.started = false;
    this.set('button_down', 0);
  }

  get(field, index = 0) { return this.u32[(this.io + this.layout[field]) / 4 + index]; }
  set(field, value, index = 0) { this.u32[(this.io + this.layout[field]) / 4 + index] = value >>> 0; }

  readEeprom() { return this.u8.slice(this.eepromPtr, this.eepromPtr + this.eepromSize); }

  wipeEeprom() {
    this.eeprom = null;
    this.u8.fill(0xFF, this.eepromPtr, this.eepromPtr + this.eepromSize);
  }

  // Run the firmware for `ms` of simulated time.
  run(ms) {
    if (!this.instance) return;
    this.set('budget_cycles', Math.round(F_CPU * ms / 1000));
    const ex = this.instance.exports;
    let guard = 0;
    while (this.get('budget_cycles') > 0 && guard++ < 4000) {
      if (!this.started) { this.started = true; ex.sim_main(); }
      else { ex.asyncify_start_rewind(this.asyncifyData); ex.sim_main(); }
      ex.asyncify_stop_unwind();
      if (this.get('reboot_requested')) {
        this.eeprom = this.readEeprom();
        this.boot();
        if (this.onReboot) this.onReboot();
        return;
      }
    }
  }

  stateName(ptr) {
    const s = this.states[ptr];
    return s ? s.name : (ptr ? `fn#${ptr}` : '-');
  }

  stateInfo(ptr) { return this.states[ptr] || null; }

  seconds() { return (this.get('cycles_lo') + this.get('cycles_hi') * 2 ** 32) / F_CPU; }
}

// ---- the world the light sits in -------------------------------------------

export const defaultEnvironment = () => ({
  ambientC: 23,          // room temperature
  sensorErrorC: 0,       // how far off the temperature sensor reads
  maxRiseC: 72,          // how hot the light gets above ambient at full power
  timeConstantS: 45,     // how quickly it gets there
  batteryV: 3.9,         // cell voltage with no load
  internalR: 0.15,       // cell + spring resistance, ohms
  diodeDropV: 0.20,      // drop between the cell and the MCU
  capacityMah: 0,        // 0 = the cell never runs down
  maxLumens: 1500,
  ch1Amps: 0.35,         // the regulated 7135 channel at full
  ch2Amps: 5.0,          // the direct-drive FET at full
  ch1Lumens: 130,
});

export class World {
  constructor(env) {
    this.env = env;
    this.dieC = env.ambientC;
    this.usedMah = 0;
  }

  // duty cycle of each PWM channel, 0..1
  duties(sim) {
    const top = Math.max(1, sim.get('pwm_top'));
    const n = Math.max(1, sim.get('pwm_channels'));
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.min(1, sim.get('pwm', i) / top));
    return out;
  }

  lumens(duties) {
    const e = this.env;
    const ch1 = (duties[0] ?? 0) * e.ch1Lumens;
    const ch2 = (duties[1] ?? 0) * (e.maxLumens - e.ch1Lumens);
    return Math.max(0, ch1 + ch2);
  }

  amps(duties) {
    const e = this.env;
    return (duties[0] ?? 0) * e.ch1Amps + (duties[1] ?? 0) * e.ch2Amps;
  }

  // Advance the physical world by dt seconds, then hand the firmware what its
  // sensors would report.
  step(sim, dt) {
    const e = this.env;
    const duties = this.duties(sim);
    const power = Math.min(1, this.amps(duties) / Math.max(0.01, e.ch2Amps + e.ch1Amps));

    // first-order thermal lag toward the temperature this output would settle at
    const target = e.ambientC + power * e.maxRiseC;
    const tau = Math.max(1, e.timeConstantS);
    this.dieC += (target - this.dieC) * (1 - Math.exp(-dt / tau));

    // battery: sag under load, and optionally run down over time
    const amps = this.amps(duties);
    if (e.capacityMah > 0) this.usedMah += amps * dt / 3.6;
    const sag = amps * e.internalR;
    const drained = e.capacityMah > 0
      ? Math.min(1, this.usedMah / e.capacityMah) : 0;
    const openV = e.batteryV - drained * 1.0;  // rough discharge curve
    const atMcu = Math.max(0.5, openV - sag - e.diodeDropV);

    sim.set('env_millivolts', Math.round(atMcu * 1000));
    // the sensor reports in the firmware's own units: Celsius + 275, x10
    const reported = this.dieC + e.sensorErrorC;
    sim.set('env_decikelvin', Math.max(0, Math.round((reported + 275) * 10)));

    return { duties, lumens: this.lumens(duties), amps, atMcu, openV: openV - sag,
             dieC: this.dieC, reportedC: reported, drained };
  }
}

// ---- turning Anduril's event bytes back into words --------------------------

const B_CLICK = 0b10000000, B_TIMEOUT = 0b01000000,
      B_HOLD = 0b00100000, B_PRESS = 0b00010000, B_COUNT = 0b00001111;

export function describeEvent(ev) {
  if (!ev) return null;
  if (!(ev & B_CLICK)) {
    switch (ev) {
      case 0x08: return 'enter state';
      case 0x09: return 'leave state';
      case 0x0a: return 're-enter state';
      case 0x01: return 'tick';
      case 0x03: return 'sleep tick';
      case 0x04: return 'battery low';
      case 0x05: return 'too hot';
      case 0x06: return 'too cold';
      case 0x07: return 'temperature ok';
      default: return `system 0x${ev.toString(16)}`;
    }
  }
  const n = ev & B_COUNT;
  const clicks = n === 1 ? '1 click' : `${n} clicks`;
  if (ev & B_HOLD) return `${clicks}, holding`;
  if (ev & B_TIMEOUT) return `${clicks}`;
  if (ev & B_PRESS) return `${clicks} (button down)`;
  return n ? `${clicks} (released)` : 'released';
}
