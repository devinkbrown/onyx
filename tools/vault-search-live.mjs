// Vault global-search live check — send a distinctive message in channel A,
// move to channel B, open the in-conversation search (Ctrl+F) and verify the
// "Saved on this device" section surfaces the hit from A; click it and
// confirm navigation back to A.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

const nick = 'vgs' + Math.floor(Math.random() * 9999);
const chanA = '#vgs-a-' + Math.floor(Math.random() * 99999);
const chanB = '#vgs-b-' + Math.floor(Math.random() * 99999);
const needle = 'moonlight-' + Math.floor(Math.random() * 99999);

await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('input').first().fill(nick);
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);

const joinField = page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first();
await joinField.fill(chanA);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);

const composer = page.locator('.shell-composer-textarea');
await composer.fill(`the ${needle} shines here`);
await page.keyboard.press('Enter');
await page.waitForTimeout(2600); // > vault flush debounce

await joinField.fill(chanB);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);

// Open the conversation search and type the needle.
await page.keyboard.press('Control+f');
await page.waitForTimeout(400);
await page.locator('#onyx-message-search-input').fill(needle);
await page.waitForTimeout(900); // vault debounce (200ms) + IDB

const vaultSection = page.getByTestId('vault-search');
const visible = await vaultSection.isVisible().catch(() => false);
const rowText = visible ? await vaultSection.textContent() : '';
console.log('vault section visible:', visible);
console.log('row mentions channel A:', rowText.includes(chanA));

let landed = false;
if (visible) {
  await vaultSection.locator('button.onyx-message-search__server-row').first().click();
  await page.waitForTimeout(1500);
  const ribbon = await page.textContent('body');
  landed = ribbon.includes(chanA.slice(1));
}
console.log('navigated back to A:', landed);
console.log('page errors:', errs.length ? errs : 'none');

const pass = visible && rowText.includes(chanA) && landed && errs.length === 0;
console.log(pass ? 'VAULT GLOBAL SEARCH LIVE: PASS' : 'VAULT GLOBAL SEARCH LIVE: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
