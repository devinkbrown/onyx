import { chromium } from '@playwright/test';

const origin = process.env.ONYX_ORIGIN ?? 'https://eshmaki.me';
const nick = `nlprobe${Math.floor(Math.random() * 100_000)}`;
const browser = await chromium.launch();
const page = await (await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
})).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto(`${origin}/app/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByPlaceholder('your-nick').fill(nick);
await page.getByPlaceholder('#root').fill('#root');
await page.getByRole('button', { name: 'Connect to Onyx as a guest' }).click();
try {
  await page.locator('.shell-member-row').first().waitFor({ state: 'visible', timeout: 45_000 });
} catch (error) {
  console.error('nicklist probe timed out:', String(error));
  console.error('page state:', (await page.locator('body').innerText()).slice(0, 1_200));
  await browser.close();
  process.exitCode = 1;
  process.exit();
}
const members = await page.evaluate(() =>
  [...document.querySelectorAll('.shell-member-row')]
    .map((row) => row.querySelector('.shell-member-nick')?.textContent?.trim() ?? '')
    .filter(Boolean)
    .slice(0, 20)
);
console.log('member rows:', JSON.stringify(members, null, 1));
const memberPanelText = await page.evaluate(() => document.querySelector('.shell-members')?.textContent?.slice(0, 400));
console.log('panel text:', memberPanelText);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();

if (members.length === 0 || errs.length > 0) process.exitCode = 1;
