import { chromium } from '@playwright/test';
const shots = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
await page.goto('https://eshmaki.me/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/mobile-hero.png` });
console.log('done');
await browser.close();
