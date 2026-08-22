// Live production smoke — exercises every major surface against eshmaki.me.
// Uses a throwaway channel (never #root) for message-flow checks.
import { chromium } from '@playwright/test';

const SHOTS = '/tmp/claude-1000/-home-kain/ffc683ba-855e-4799-99d5-312b3890a1db/scratchpad/shots';
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera'] });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

// ── 1. Community site ──
for (const [path, needle] of [['/', 'A room for your people.'], ['/guides/', 'Getting started'], ['/community/', 'Getting started']]) {
  const res = await page.goto(`https://eshmaki.me${path}`, { waitUntil: 'domcontentloaded' });
  const body = await page.textContent('body');
  check(`site ${path}`, res.status() === 200 && body.includes(needle));
}
const stats = await page.goto('https://eshmaki.me/stats/', { waitUntil: 'networkidle' });
check('stats SPA', stats.status() === 200 && (await page.textContent('body')).includes('The rooms'));
const data = await (await page.request.get('https://eshmaki.me/stats/data/index.json')).json();
check('live stats data', Array.isArray(data.channels));

// ── 2. App: guest connect ──
const probe = 'smk' + Math.floor(Math.random() * 9999);
const chan = '#probe-' + Math.floor(Math.random() * 99999);
await page.goto('https://eshmaki.me/app', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
await page.locator('input').first().fill(probe);
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
check('guest connect → shell', await page.locator('[data-testid="app-shell"]').isVisible().catch(() => false));
check('no autojoin → Home view', await page.locator('.home').isVisible().catch(() => false));
await page.getByTestId('ribbon-more').click();
check('ribbon guest action', (await page.getByTestId('ribbon-account-chip').textContent()).includes('Guest'));
await page.keyboard.press('Escape');

// ── 3. Panels ──
await page.getByTestId('ribbon-bell').click();
check('inbox opens', await page.getByTestId('notification-center').isVisible().catch(() => false));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
const spotlightOpen = await page.locator('.onyx-spotlight').waitFor({
  state: 'attached',
  timeout: 5000,
}).then(() => true).catch(() => false);
check('⌘K spotlight', spotlightOpen);
if (spotlightOpen) {
  await page.keyboard.type('Browse channels');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const rows = await page.locator('.chb-row').count();
  check('channel browser + LIST rows', rows >= 1, `${rows} rows`);
  await page.keyboard.press('Escape');
} else {
  await page.keyboard.press('Escape');
}
await page.getByTestId('ribbon-more').click();
await page.getByTestId('ribbon-account-chip').click();
await page.waitForTimeout(700);
check('account panel (guest)', await page.getByTestId('account-guest').isVisible().catch(() => false));
await page.keyboard.press('Escape');

// ── 4. Message flows in a throwaway channel ──
await page.locator('input[placeholder*="join"], input[placeholder*="#channel"]').first().fill(chan);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
check('joined throwaway channel', (await page.textContent('body')).includes(chan.slice(1)));
check('nicklist populated after join', (await page.locator('.shell-member-row').count()) >= 1);
check('channel intro (fresh channel)', await page.getByTestId('channel-intro').isVisible().catch(() => false));

const composer = page.locator('.shell-composer-textarea');
await composer.fill('hello from the smoke test');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
check('message echo renders', (await page.textContent('body')).includes('hello from the smoke test'));
check('day divider present', await page.locator('.shell-day-divider').first().isVisible().catch(() => false));

await composer.click();
await page.keyboard.type('multiline line one');
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('multiline line two');
await page.keyboard.press('Enter');
await page.waitForTimeout(1800);
const bodyText = await page.textContent('body');
check('multiline renders both lines', bodyText.includes('multiline line one') && bodyText.includes('multiline line two'));

await composer.fill('repo: https://github.com/devinkbrown/onyx-server');
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
check('link preview card', await page.locator('.shell-msg-preview').first().isVisible().catch(() => false));

// server search
await page.keyboard.press('Control+f');
await page.waitForTimeout(500);
await page.keyboard.type('smoke');
await page.waitForTimeout(400);
const deepBtn = page.locator('.onyx-message-search__deep');
if (await deepBtn.isVisible().catch(() => false)) {
  await page.keyboard.press('Control+Enter'); // the deep-search shortcut
  await page.waitForTimeout(2500);
  const count = await page.locator('.onyx-message-search__server-count, .onyx-message-search__server-error').first().textContent().catch(() => '');
  check('server search answers', count.length > 0, count.trim());
} else check('server search answers', false, 'deep button missing');
await page.keyboard.press('Escape');

// ── 5. Voice (fake media) ──
await page.getByRole('button', { name: /join voice/i }).click().catch(() => {});
await page.waitForTimeout(4000);
const inCall = await page.locator('[class*="voice-bar"], [class*="voice-stage"]').first().isVisible().catch(() => false);
check('voice join (fake media)', inCall);
await page.screenshot({ path: `${SHOTS}/smoke-final.png` });

// ── 6. Deep link ──
const page2 = await ctx.newPage();
await page2.goto(`https://eshmaki.me/app?join=%23probe-deeplink`, { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(2000);
check('deeplink hint on connect', await page2.getByTestId('pulse-deeplink').isVisible().catch(() => false));
await page2.locator('input').first().fill(probe + 'b');
await page2.keyboard.press('Enter');
await page2.waitForTimeout(9000);
check('deeplink lands in channel', (await page2.textContent('body')).includes('probe-deeplink'));
await page2.close();

console.log('\npage errors:', pageErrors.length ? pageErrors : 'none');
const fails = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - fails.length}/${results.length} passed ===`);
await browser.close();
process.exit(fails.length ? 1 : 0);
