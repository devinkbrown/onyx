// Headless-Chromium screenshot helper for Ruri dev verification.
// Usage: node tools/shot.mjs <url> <widths csv> <tag>
//   node tools/shot.mjs http://localhost:4173/ 1440,768,390 landing
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4173/';
const widths = (process.argv[3] ?? '1440,768,390').split(',').map(Number);
const tag = process.argv[4] ?? 'ruri';

const browser = await chromium.launch();
try {
  for (const w of widths) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: Math.round(w * 0.7) },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(700);
    const fold = `/tmp/${tag}-${w}-fold.png`;
    await page.screenshot({ path: fold, fullPage: false });
    const out = `/tmp/${tag}-${w}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log(`shot ${out} + ${fold} ${errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
