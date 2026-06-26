// Visual QA: screenshot the Ocean redesign (landing + connect) at desktop + mobile.
import { chromium } from '@playwright/test';
const BASE = process.argv[2] || 'http://localhost:4178';
const b = await chromium.launch();
const shots = [
  { path: '/', name: 'landing', full: true },
  { path: '/app', name: 'connect', full: false },
];
const sizes = [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }];
for (const s of shots) {
  for (const z of sizes) {
    const ctx = await b.newContext({ viewport: { width: z.w, height: z.h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(BASE + s.path, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(900); // let atmosphere paint
    const out = `/tmp/ocean-${s.name}-${z.tag}.png`;
    await p.screenshot({ path: out, fullPage: s.full && z.tag === 'desktop' });
    console.log('shot', out);
    await ctx.close();
  }
}
await b.close();
