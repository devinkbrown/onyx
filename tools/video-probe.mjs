import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
// Guest connect
const nickInput = page.locator('input').first();
await nickInput.fill('vidprobe' + Math.floor(Math.random() * 999));
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);
// Should be connected + autojoined #root
const state1 = await page.evaluate(() => {
  const w = window;
  return { hasOnyx: !!w.__onyx, url: location.href };
});
console.log('state:', JSON.stringify(state1));
// Find Join video button
const joinVideo = page.getByRole('button', { name: /join video/i });
const visible = await joinVideo.isVisible().catch(() => false);
console.log('join-video visible:', visible);
if (visible) {
  await joinVideo.click();
  await page.waitForTimeout(5000);
  const shot = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots/video-probe.png';
  await page.screenshot({ path: shot });
  const post = await page.evaluate(() => {
    const stage = document.querySelector('[class*="voice-stage"], [class*="shell-voice-stage"]');
    return { stagePresent: !!stage, toasts: [...document.querySelectorAll('[class*="toast"]')].map(t => t.textContent?.slice(0, 80)) };
  });
  console.log('post-click:', JSON.stringify(post));
}
console.log('--- console logs:');
for (const l of logs.slice(-25)) console.log(l);
await browser.close();
