// Drives the real input path: mouse press → (no force in Chromium → hold fallback),
// then synthetic Safari Force Touch events with a rising webkitForce.
// node test-press.mjs <outdir>
// set PLAYWRIGHT to a playwright/index.mjs path, or `npm i -D playwright`; CHROME to a browser binary (optional)
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const outDir = process.argv[2] || '.';
const kill = setTimeout(() => { console.error('watchdog: timeout'); process.exit(2); }, 90000);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL(resolve('index.html')).href + '?shot=1&still=1&seed=11');
await page.waitForFunction(() => document.body.classList.contains('ready'));
await page.waitForTimeout(400);

const hud = () => page.evaluate(() => ({
  src: document.getElementById('src').textContent,
  force: document.getElementById('forceVal').textContent,
  crushed: document.getElementById('crushVal').textContent,
  plateGap: +(window.__can.st.plateY - window.__can.body.topY).toFixed(2),
}));

// perf: deformation cost per update
const perf = await page.evaluate(() => {
  const b = window.__can.body;
  const t0 = performance.now();
  for (let k = 0; k < 60; k++) b.update(b.Dmax * (k / 59));
  const ms = (performance.now() - t0) / 60;
  b.update(0); b.D = -1; b.update(0);
  return ms.toFixed(2);
});
console.log('deform ms/update:', perf);

// 1) plain mouse hold (Chromium has no force data → hold ramp)
await page.mouse.move(640, 420);
await page.mouse.down();
await page.waitForTimeout(700);
console.log('hold 0.7s:', await hud());
await page.mouse.up();
await page.waitForTimeout(500);
console.log('released:', await hud());

// 2) reset and simulate Safari Force Touch
await page.keyboard.press('KeyR');
await page.waitForTimeout(1100);
console.log('fresh can:', await hud());
const force = (f) => page.evaluate((f) => {
  const st = document.getElementById('stage');
  const e = new MouseEvent('webkitmouseforcechanged', { bubbles: true });
  Object.defineProperty(e, 'webkitForce', { value: f });
  st.dispatchEvent(e);
}, f);
await page.mouse.down();
await force(1.0);
await page.waitForTimeout(250);
console.log('force 1.0:', await hud());
for (let f = 1.0; f <= 1.6; f += 0.05) { await force(f); await page.waitForTimeout(30); }
await page.waitForTimeout(300);
console.log('force 1.6:', await hud());
await page.screenshot({ path: `${outDir}/press-mid.png` });
for (let f = 1.6; f <= 2.26; f += 0.05) { await force(f); await page.waitForTimeout(30); }
await page.waitForTimeout(400);
console.log('force 2.25:', await hud());
await page.screenshot({ path: `${outDir}/press-full.png` });
await page.mouse.up();
await page.waitForTimeout(800);
console.log('released (permanent):', await hud());

// 3) springs-back mode
await page.click('[data-mode="live"]');
await page.keyboard.press('KeyR');
await page.waitForTimeout(1100);
await page.mouse.move(640, 420);
await page.mouse.down();
await force(2.2);
await page.waitForTimeout(500);
console.log('live @2.2:', await hud());
await force(1.2);
await page.waitForTimeout(500);
console.log('live eased to 1.2:', await hud());
await page.mouse.up();
await page.waitForTimeout(600);
console.log('live released:', await hud());

// fps estimate while spinning
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
console.log('rAF/s idle:', fps);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
clearTimeout(kill);
