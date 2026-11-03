// QA screenshots: node shot.mjs out.png "crush=0.4&rot=0.5" [width] [height]
import { chromium } from '/Users/pratikaman/.claude-sidekick/skills/gstack/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [out = 'shot.png', query = '', w = '1440', h = '900'] = process.argv.slice(2);
const kill = setTimeout(() => { console.error('watchdog: timeout'); process.exit(2); }, 60000);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Users/pratikaman/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const url = pathToFileURL(resolve('index.html')).href + '?shot=1&still=1&' + query;
await page.goto(url);
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 }).catch(() => logs.push('never ready'));
await page.waitForTimeout(+(process.env.WAIT || 900));
if (process.env.EVAL) console.log(await page.evaluate(process.env.EVAL));
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 20).join('\n'));
await browser.close();
clearTimeout(kill);
