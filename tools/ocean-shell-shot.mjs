// Drive a REAL connect against the live network and screenshot the Ocean chat shell.
import { chromium } from '@playwright/test';
const BASE = process.argv[2] || 'http://localhost:4179';
const b = await chromium.launch();
for (const z of [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
  const ctx = await b.newContext({ viewport: { width: z.w, height: z.h } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE + '/app', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const nick = 'ocean' + (Date.now() % 9999);
  await p.fill('#conn-nick', nick).catch(() => {});
  await p.click('[data-testid="conn-submit"]').catch(() => {});
  // wait for the connect screen to detach (connected → shell renders)
  const connected = await p.waitForSelector('[data-testid="connect-screen"]', { state: 'detached', timeout: 18000 })
    .then(() => true).catch(() => false);
  await p.waitForTimeout(2500); // let CHATHISTORY / #root paint
  const out = `/tmp/ocean-shell-${z.tag}.png`;
  await p.screenshot({ path: out });
  console.log(`${z.tag}: connected=${connected} nick=${nick} -> ${out}` + (errs.length ? `  [console errs: ${errs.slice(-1)}]` : ''));
  await ctx.close();
}
await b.close();
