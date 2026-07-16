import { chromium } from '@playwright/test';

const origin = process.env.ONYX_ORIGIN ?? 'https://eshmaki.me';
const suffix = Math.floor(Math.random() * 100_000);
const nicks = [`nlprobeA${suffix}`, `nlprobeB${suffix}`];
const channel = process.env.ONYX_ROSTER_CHANNEL ?? `#nlprobe${suffix}`;
const durationMs = Number.parseInt(process.env.ONYX_ROSTER_PROBE_MS ?? '70000', 10);
const sampleMs = 1_000;
const browser = await chromium.launch();
const errs = [];
const probes = [];

for (const nick of nicks) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    // This is a roster/state probe, not a motion test. Honor the product's
    // reduced-motion path so its infinite water/scene animations cannot starve
    // Playwright action frames when multiple browser probes share the host.
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  probes.push({ context, nick, page });
  page.on('pageerror', (error) => errs.push({ nick, error: String(error).slice(0, 200) }));
  await page.goto(`${origin}/app/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('connect-screen').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByPlaceholder('your-nick').fill(nick);
  await page.getByPlaceholder('#root').fill(channel);
  await page.getByRole('button', { name: 'Connect to Onyx as a guest' }).click();
  console.log(`${nick} connect submitted with an ordinary click`);
}

try {
  await Promise.all(probes.flatMap(({ page }) => nicks.map((expectedNick) => (
    page.locator('.shell-member-nick', { hasText: expectedNick }).waitFor({ state: 'visible', timeout: 45_000 })
  ))));
} catch (error) {
  console.error('nicklist probe timed out:', String(error));
  for (const { nick, page } of probes) {
    console.error(`${nick} page state:`, (await page.locator('body').innerText()).slice(0, 1_200));
  }
  await browser.close();
  process.exitCode = 1;
  process.exit();
}

const failures = [];
const finalMembers = new Map();
const previousSignatures = new Map();
for (let elapsedMs = 0; elapsedMs <= durationMs; elapsedMs += sampleMs) {
  for (const { nick, page } of probes) {
    const sample = await page.evaluate(() => ({
      shellMounted: document.querySelector('[data-testid="app-shell"]') !== null,
      panelVisible: document.querySelector('.shell-members:not(.shell-members--hidden)') !== null,
      members: [...document.querySelectorAll('.shell-member-row')]
        .map((row) => row.querySelector('.shell-member-nick')?.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 20),
    }));
    const normalized = new Set(sample.members.map((member) => member.toLowerCase()));
    const missing = nicks.filter((expected) => !normalized.has(expected.toLowerCase()));
    const signature = `${sample.shellMounted}:${sample.panelVisible}:${sample.members.join(',')}`;
    if (signature !== previousSignatures.get(nick)) {
      console.log(`${nick} roster at +${String(elapsedMs / 1000).padStart(2, '0')}s:`, signature);
      previousSignatures.set(nick, signature);
    }
    finalMembers.set(nick, sample.members);
    if (!sample.shellMounted || !sample.panelVisible || missing.length > 0) {
      failures.push({ elapsedMs, observer: nick, missing, ...sample });
    }
  }
  if (elapsedMs < durationMs) await probes[0].page.waitForTimeout(sampleMs);
}

console.log('final member rows:', JSON.stringify(Object.fromEntries(finalMembers), null, 1));
console.log('errors:', errs.length ? errs : 'none');
console.log('transient roster failures:', failures.length ? failures : 'none');
await browser.close();

if (failures.length > 0 || errs.length > 0) process.exitCode = 1;
