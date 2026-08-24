// build.mjs: compile the real Anduril sources into wasm, once per
// (version x hardware x thermal-sensor) combination, and write the manifest
// the web app loads.
//
//   node sim/tools/build.mjs [--versions r2026-08-12,...] [--quick]
//
// Every artifact is instantiated and booted before it is accepted, so a build
// that cannot run never reaches the manifest.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tableNames } from './wasm-names.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const UPSTREAM = path.join(ROOT, '.upstream');
const SRCDIR = path.join(ROOT, '.build', 'src');
const OUT = path.join(ROOT, 'builds');
const WASM_OPT = path.join(ROOT, '.tools/node_modules/binaryen/bin/wasm-opt');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sim/build-config.json'), 'utf8'));
const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--versions=')) || '').split('=')[1];
const quick = args.includes('--quick');

const versions = cfg.versions.filter(v => !only || only.split(',').includes(v.tag));
const hardware = quick ? cfg.hardware.slice(0, 2) : cfg.hardware;
const thermal = quick ? cfg.thermal.slice(0, 1) : cfg.thermal;

const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function checkout(tag) {
  const dir = path.join(SRCDIR, tag);
  if (fs.existsSync(path.join(dir, 'ui'))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  // a plain export of the tag: no worktree metadata to keep in sync
  const tar = sh('git', ['-C', UPSTREAM, 'archive', '--format=tar', tag], { maxBuffer: 1 << 28 });
  const tmp = path.join(SRCDIR, `${tag}.tar`);
  fs.writeFileSync(tmp, tar);
  sh('tar', ['-xf', tmp, '-C', dir]);
  fs.unlinkSync(tmp);
  return dir;
}

// Which aux-LED vocabulary does this checkout speak?  r2026 moved the drivers
// into the arch layer; before that the firmware poked port registers itself.
function ledApi(src) {
  const f = path.join(src, 'fsm/chan-aux.c');
  const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  return txt.includes('set_aux1_power') ? 1 : 0;
}

// Find where each UI state is defined, so the app can show the source file
// that is running right now.  States are plain functions:
//     uint8_t off_state(Event event, uint16_t arg) {
function stateSources(src) {
  const out = {};
  for (const dir of ['ui/anduril', 'fsm']) {
    const abs = path.join(src, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.c')) continue;
      const lines = fs.readFileSync(path.join(abs, name), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/^\s*uint8_t\s+(\w+)\s*\(\s*Event\s/);
        if (m) out[m[1]] = { file: `${dir}/${name}`, line: i + 1 };
      });
    }
  }
  return out;
}

// Anduril counted voltage in 1/40 V before r2024 and 1/50 V after.
function voltScale(src) {
  const f = path.join(src, 'fsm/adc.h');
  const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const m = txt.match(/#define\s+dV\s+(\d+)/);
  return m ? Number(m[1]) * 10 : 40;
}

function compile(src, outFile, defines) {
  const cc = [
    '--target=wasm32', '-Os', '-std=gnu99', '-fgnu89-inline', '-fshort-enums',
    '-fno-strict-aliasing', '-fwrapv',
    '-Wno-int-to-pointer-cast', '-Wno-parentheses-equality', '-Wno-static-in-inline',
    '-nostdlib', '-Wl,--no-entry', '-Wl,--allow-undefined', '-Wl,--export-dynamic',
    '-DMCUNAME=sim', '-DMCU=0x1616', '-DCFG_H=sim/anduril.h', '-DMODEL_NUMBER="0000"',
    ...defines,
    '-I', 'sim/include', '-I', 'sim/hw',
    '-I', path.join(src, 'ui'), '-I', path.join(src, 'hw'), '-I', src,
    '-o', outFile, 'sim/sim_main.c',
  ];
  sh('clang', cc);
  sh(WASM_OPT, [
    '--asyncify', '--pass-arg=asyncify-imports@env.sim_host_yield',
    '-Os', '-g', '-o', outFile, outFile,
  ]);
}

// Boot a build for a couple of virtual seconds and press the button once, so a
// broken artifact is caught here instead of in the browser.
function verify(file, layout) {
  const bytes = fs.readFileSync(file);
  let inst, unwinding = false;
  const imports = { env: {
    sim_host_trace() {},
    sim_host_yield() {
      if (!unwinding) { inst.exports.asyncify_start_unwind(DATA); unwinding = true; }
      else { inst.exports.asyncify_stop_rewind(); unwinding = false; }
    },
  } };
  inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
  const u32 = new Uint32Array(inst.exports.memory.buffer);
  inst.exports.sim_init();
  const io = inst.exports.sim_io_ptr();
  const DATA = inst.exports.sim_asyncify_stack_ptr();
  u32[DATA >> 2] = DATA + 8;
  u32[(DATA >> 2) + 1] = DATA + inst.exports.sim_asyncify_stack_size();
  const g = (f) => u32[(io + layout[f]) / 4];
  const s = (f, v) => { u32[(io + layout[f]) / 4] = v; };
  s('env_millivolts', 3900);
  s('env_decikelvin', (23 + 275) * 10);
  let started = false;
  const run = (ms) => {
    s('budget_cycles', Math.round(10000000 * ms / 1000));
    let n = 0;
    while (g('budget_cycles') > 0 && n++ < 20000) {
      if (!started) { started = true; inst.exports.sim_main(); }
      else { inst.exports.asyncify_start_rewind(DATA); inst.exports.sim_main(); }
      inst.exports.asyncify_stop_unwind();
    }
    if (n >= 20000) throw new Error('simulation did not consume its budget');
  };
  run(1200);
  if (!g('booted')) throw new Error('firmware never reached its main loop');
  s('button_down', 1); run(60); s('button_down', 0); run(500);
  const level = g('fw_actual_level');
  if (!level) throw new Error('one click did not turn the light on');
  return { capabilities: inst.exports.sim_capabilities(), bootLevel: level,
           rampSize: g('fw_ramp_size') };
}

// ---- main ----

fs.mkdirSync(SRCDIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
sh('gcc', ['-I', 'sim/include', '-o', '.build/gen-layout', 'sim/tools/gen-layout.c']);
const layout = JSON.parse(sh('.build/gen-layout', []).toString());
fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 1));

const manifest = { generated: new Date().toISOString().slice(0, 10), repo: cfg.repo,
                   rawBase: cfg.rawBase, hardware: cfg.hardware, thermal: cfg.thermal,
                   versions: [] };
let ok = 0, failed = 0;

for (const v of versions) {
  process.stdout.write(`\n=== ${v.tag} ===\n`);
  const src = checkout(v.tag);
  const commit = sh('git', ['-C', UPSTREAM, 'rev-parse', `${v.tag}^{commit}`]).toString().trim();
  const date = sh('git', ['-C', UPSTREAM, 'log', '-1', '--format=%cs', `${v.tag}^{commit}`]).toString().trim();
  const api = ledApi(src);
  const volts = voltScale(src);
  const sources = stateSources(src);
  const entry = { ...v, commit, date, ledApi: api, voltScale: volts, builds: {} };
  fs.mkdirSync(path.join(OUT, v.tag), { recursive: true });

  for (const hw of hardware) {
    for (const th of thermal) {
      const id = `${hw.id}-${th.id}`;
      const file = path.join(OUT, v.tag, `${id}.wasm`);
      try {
        compile(src, file, [
          `-DSIM_LED_API=${api}`, `-DSIM_VOLT_SCALE=${volts}`,
          `-DSIM_AUX1=${hw.aux1}`, `-DSIM_AUXRGB=${hw.auxrgb}`,
          `-DSIM_AUX1_BUTTON=${hw.aux1btn}`, `-DSIM_AUXRGB_BUTTON=${hw.rgbbtn}`,
          `-DSIM_THERM=${th.on}`,
        ]);
        const info = verify(file, layout);
        const { table } = tableNames(fs.readFileSync(file));
        const states = {};
        for (const [slot, name] of Object.entries(table)) {
          states[slot] = { name, ...(sources[name] || {}) };
        }
        fs.writeFileSync(path.join(OUT, v.tag, `${id}.states.json`), JSON.stringify(states));
        entry.builds[id] = {
          wasm: `${v.tag}/${id}.wasm`,
          states: `${v.tag}/${id}.states.json`,
          bytes: fs.statSync(file).size,
          ...info,
        };
        ok++;
        process.stdout.write(`  ok   ${id.padEnd(20)} ${(fs.statSync(file).size / 1024).toFixed(1)} KB\n`);
      } catch (e) {
        failed++;
        const msg = (e.stderr ? e.stderr.toString() : e.message).split('\n').filter(Boolean).slice(-3).join(' | ');
        process.stdout.write(`  FAIL ${id.padEnd(20)} ${msg.slice(0, 300)}\n`);
        try { fs.unlinkSync(file); } catch {}
      }
    }
  }
  if (Object.keys(entry.builds).length) manifest.versions.push(entry);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
process.stdout.write(`\n${ok} built, ${failed} failed -> builds/manifest.json\n`);
if (!ok) process.exit(1);
