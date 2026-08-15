/* End-to-end test: runs the real page in Chromium with a synthesised microwave
   recording piped in as the microphone, and checks that the alert fires when
   the popping actually stops.
 *
 * The offline test (test-detector.mjs) covers the algorithm; this covers the
 * wiring — getUserMedia constraints, AnalyserNode, the rAF loop, the screens.
 *
 * Run: node tools/test-browser.mjs
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { synth, toWav } from './synth-audio.mjs';

// Playwright may only be installed globally in this environment.
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(join(globalRoot, 'playwright'));
}
const { chromium } = loadPlaywright();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.testtmp');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};

function serve(dir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(dir, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'content-type': MIME[extname(file)] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const DURATION = 70;

console.log('generating fake microphone audio…');
await mkdir(TMP, { recursive: true });
const { audio, popTimes } = synth({ durationSec: DURATION });
const wav = join(TMP, 'popcorn.wav');
await writeFile(wav, toWav(audio));
const lastPop = popTimes[popTimes.length - 1];
console.log(`  ${popTimes.length} pops, last one at ${lastPop.toFixed(1)}s`);

const server = await serve(ROOT);
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },   // iPhone-ish
  permissions: ['microphone'],
});

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log(`running the page for up to ${DURATION}s…`);
await page.goto(url);

await page.click('#btn-start');
await page.waitForSelector('#screen-listen.is-active', { timeout: 10000 });
const startedAt = Date.now();

// Sanity-check partway through that it is actually hearing the popping.
await page.waitForFunction(
  () => document.getElementById('phase').textContent.trim() === 'Popping',
  { timeout: 30000 }
);
const popsMidway = parseInt(await page.textContent('#total-pops'), 10);
console.log(`   ${((Date.now() - startedAt) / 1000).toFixed(1)}s: popping detected, ${popsMidway} pops so far`);

let alertAt = null;
try {
  await page.waitForSelector('#screen-alert.is-active', { timeout: (DURATION + 10) * 1000 });
  alertAt = (Date.now() - startedAt) / 1000;
} catch {}

const totalPops = parseInt(await page.textContent('#total-pops'), 10) || 0;
const alertTitle = alertAt ? (await page.textContent('#alert-title')).trim() : '';

console.log('\n── checks');
check('alert fired', alertAt !== null);
if (alertAt !== null) {
  console.log(`   (alert at ${alertAt.toFixed(1)}s; popping really ended at ${lastPop.toFixed(1)}s)`);
  check('alert says to stop the microwave', alertTitle === 'Stop the microwave', alertTitle);
  check('alert is not early', alertAt > lastPop - 4, `${(alertAt - lastPop).toFixed(1)}s vs last pop`);
  check('alert is not late', alertAt < lastPop + 8, `${(alertAt - lastPop).toFixed(1)}s vs last pop`);
}
check('counted a realistic number of pops', totalPops > 60, `${totalPops} counted of ${popTimes.length} real`);

// The dismiss → feedback path, since that is what tunes the next run.
if (alertAt !== null) {
  await page.click('#btn-got-it');
  await page.waitForSelector('#screen-done.is-active', { timeout: 5000 });
  await page.click('[data-verdict="early"]');
  await page.waitForSelector('#screen-setup.is-active', { timeout: 5000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('popcorn-ear') || '{}'));
  check('“too many unpopped” makes it wait longer next time',
    saved.patience > 0.5, `patience now ${saved.patience}`);
}

check('no console or page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
await rm(TMP, { recursive: true, force: true });

console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
