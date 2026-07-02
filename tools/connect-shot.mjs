import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 800, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/stats/data/index.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    generated_at: now - 14, network: 'IRCXNet', node: 'eshmaki.me',
    channels: [
      { channel: '#root', messages: 4821, active_users: 12, last_active: now - 60, topic: 'the network’s living room — welcome home', spark: [] },
      { channel: '#zig', messages: 1932, active_users: 6, last_active: now - 500, topic: 'comptime enjoyers anonymous', spark: [] },
      { channel: '#music', messages: 740, active_users: 3, last_active: now - 4000, topic: '', spark: [] },
    ],
  }) }));
  await page.goto('http://localhost:3000/app?join=%23zig', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/connect-${name}.png` });
  await ctx.close();
}
console.log('done');
await browser.close();
