// smoke.mjs: drive a compiled firmware build outside the browser, so builds
// can be sanity-checked from the command line.
//   node sim/tools/smoke.mjs .build/test.async.wasm .build/layout.json
import fs from 'node:fs';

const wasmPath = process.argv[2] ?? '.build/test.async.wasm';
const layout = JSON.parse(fs.readFileSync(process.argv[3] ?? '.build/layout.json', 'utf8'));

let inst, mem, u32, io, DATA, unwinding = false;

const imports = { env: { sim_host_trace() {}, sim_host_yield() {
  if (!unwinding) { inst.exports.asyncify_start_unwind(DATA); unwinding = true; }
  else { inst.exports.asyncify_stop_rewind(); unwinding = false; }
} } };

const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
inst = new WebAssembly.Instance(mod, imports);
mem = inst.exports.memory;
u32 = new Uint32Array(mem.buffer);

inst.exports.sim_init();
io = inst.exports.sim_io_ptr();
DATA = inst.exports.sim_asyncify_stack_ptr();
const DSIZE = inst.exports.sim_asyncify_stack_size();
u32[DATA >> 2] = DATA + 8;
u32[(DATA >> 2) + 1] = DATA + DSIZE;

const get = (f, i = 0) => u32[(io + layout[f]) / 4 + i];
const set = (f, v, i = 0) => { u32[(io + layout[f]) / 4 + i] = v; };

const F_CPU = 10000000;
set('env_millivolts', 3900);
set('env_decikelvin', (23 + 275) * 10);   // 23 C ambient
set('button_down', 0);

let started = false;
function runMs(ms) {
  set('budget_cycles', Math.round(F_CPU * ms / 1000));
  let guard = 0;
  while (get('budget_cycles') > 0 && guard++ < 5000) {
    if (!started) { started = true; inst.exports.sim_main(); }
    else { inst.exports.asyncify_start_rewind(DATA); inst.exports.sim_main(); }
    inst.exports.asyncify_stop_unwind();
    if (get('reboot_requested')) { console.log('  [firmware requested reboot]'); return; }
  }
  if (guard >= 5000) console.log('  [!] budget did not drain');
}

function snap(tag) {
  const cyc = get('cycles_lo') + get('cycles_hi') * 2 ** 32;
  console.log(
    `${tag.padEnd(26)} t=${(cyc / F_CPU).toFixed(2)}s ` +
    `lvl=${String(get('fw_actual_level')).padStart(3)}/${get('fw_ramp_size')} ` +
    `pwm=[${get('pwm', 0)},${get('pwm', 1)}]/${get('pwm_top')} ` +
    `aux1=${get('aux1')} rgb=0b${get('auxrgb').toString(2).padStart(6, '0')} ` +
    `V=${(get('fw_voltage') / 50).toFixed(2)} T=${(get('fw_temperature') << 0)}C ` +
    `ev=0x${get('fw_current_event').toString(16)} sleep=${get('sleeping')} ` +
    `state=0x${get('fw_current_state').toString(16)} ticks=${get('n_ticks')}`);
}

const click = (downMs = 60, upMs = 400) => {
  set('button_down', 1); runMs(downMs);
  set('button_down', 0); runMs(upMs);
};

console.log('caps = 0b' + inst.exports.sim_capabilities().toString(2));
runMs(2000); snap('after boot (2s)');
click();       snap('1 click');
runMs(1000);   snap('+1s');
click();       snap('another click (off)');
runMs(1000);   snap('+1s');
set('button_down', 1); runMs(1500); snap('holding 1.5s (ramp up)');
set('button_down', 0); runMs(500);  snap('released');
runMs(3000);   snap('+3s');
set('env_decikelvin', (75 + 275) * 10);
runMs(6000);   snap('after heating to 75C');
