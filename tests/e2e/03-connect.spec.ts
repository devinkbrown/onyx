import { test, expect } from '@playwright/test';

// Real end-to-end against the LIVE deployment (the Orochi WS only accepts its
// own origin, so this cannot run from localhost). Verifies auth + WebSocket
// connect + auto-join of the default channel actually work — i.e. the fixes did
// not break the core connection flow. Does not send messages.
test('live: login connects and auto-joins the default channel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('https://eshmaki.me/login/');
  await expect(page.locator('#login-nick')).toBeVisible();
  await page.fill('#login-nick', 'qa' + Math.floor(Math.random() * 1e5));
  await page.locator('.login-submit').click();

  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30000 });
  // #root only appears once the WS connected, SASL/registration completed, and
  // the default channel was joined — so this presence proves the whole chain.
  await expect(page.getByText(/#root/i).first()).toBeVisible({ timeout: 30000 });

  const fatal = errors.filter((e) => !/websocket|ws:|wss:|hydrat|ResizeObserver/i.test(e));
  expect(fatal, `page errors:\n${fatal.join('\n')}`).toHaveLength(0);
});
