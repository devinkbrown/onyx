import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps guest claim and Home as separate short-height scrollers', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 12,
      topMax: 12,
      right: 24,
      rightMax: 24,
      bottom: 20,
      bottomMax: 20,
      left: 0,
      leftMax: 0,
    },
  });

  await page.goto('/app/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => (
    /\/assets\/runtime-[^/]+\.js$/.test(new URL(entry.name).pathname)
  )));
  await page.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find((candidate) => (
      /\/assets\/runtime-[^/]+\.js$/.test(new URL(candidate.name).pathname)
    ));
    if (!entry) throw new Error('Runtime store bundle was not loaded.');
    const runtime = await import(entry.name) as Record<string, unknown>;
    const store = Object.values(runtime).find((value): value is RuntimeStore => (
      typeof value === 'object'
      && value !== null
      && typeof (value as RuntimeStore).getState === 'function'
      && typeof (value as RuntimeStore).setState === 'function'
    ));
    if (!store) throw new Error('Runtime store export was not found.');

    document.documentElement.style.fontSize = '64px';
    store.setState({
      connectionStatus: 'connected',
      ourNick: 'ui-qa',
      activeView: { kind: 'home' },
    });
  });

  const guest = page.getByRole('region', { name: 'Guest account' });
  const home = page.locator('.home');
  const searchAction = page.getByRole('button', { name: 'Search device memory' });
  await expect(guest).toBeVisible();
  await expect(home).toBeVisible();

  const collapsedGeometry = await guest.evaluate((element) => {
    const guestRect = element.getBoundingClientRect();
    const home = document.querySelector<HTMLElement>('.home')!;
    const homeRect = home.getBoundingClientRect();
    const dismissRect = element.querySelector<HTMLElement>('.guest-claim__dismiss')!
      .getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      guestClientWidth: element.clientWidth,
      guestScrollWidth: element.scrollWidth,
      guestTop: guestRect.top,
      guestRight: guestRect.right,
      guestBottom: guestRect.bottom,
      guestOverflowY: getComputedStyle(element).overflowY,
      homeTop: homeRect.top,
      homeBottom: homeRect.bottom,
      homeClientHeight: home.clientHeight,
      homeOverflowY: getComputedStyle(home).overflowY,
      dismissTop: dismissRect.top,
      dismissBottom: dismissRect.bottom,
      dismissRight: dismissRect.right,
      dismissWidth: dismissRect.width,
      dismissHeight: dismissRect.height,
    };
  });

  expect(collapsedGeometry.documentScrollWidth).toBe(collapsedGeometry.documentClientWidth);
  expect(collapsedGeometry.guestScrollWidth).toBe(collapsedGeometry.guestClientWidth);
  expect(collapsedGeometry.guestTop).toBeGreaterThanOrEqual(12);
  expect(collapsedGeometry.guestRight).toBeLessThanOrEqual(320 - 24);
  expect(collapsedGeometry.guestOverflowY).toBe('auto');
  expect(collapsedGeometry.homeTop).toBeGreaterThanOrEqual(collapsedGeometry.guestBottom);
  expect(collapsedGeometry.homeBottom).toBeLessThanOrEqual(256);
  expect(collapsedGeometry.homeClientHeight).toBeGreaterThan(0);
  expect(collapsedGeometry.homeOverflowY).toBe('auto');
  expect(collapsedGeometry.dismissTop).toBeGreaterThanOrEqual(collapsedGeometry.guestTop);
  expect(collapsedGeometry.dismissBottom).toBeLessThanOrEqual(collapsedGeometry.guestBottom);
  expect(collapsedGeometry.dismissRight).toBeLessThanOrEqual(320 - 24);
  expect(collapsedGeometry.dismissWidth).toBeGreaterThanOrEqual(44);
  expect(collapsedGeometry.dismissHeight).toBeGreaterThanOrEqual(44);

  await searchAction.click();
  await expect(page.getByRole('searchbox', { name: 'Search messages' })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search messages' }).press('Escape');

  await page.getByRole('button', { name: 'Claim your nick' }).click();
  const email = page.getByRole('textbox', { name: 'Recovery email (optional)' });
  await expect(email).toBeVisible();
  await email.focus();

  const expandedGeometry = await guest.evaluate((element) => {
    const guestRect = element.getBoundingClientRect();
    const dismissRect = element.querySelector<HTMLElement>('.guest-claim__dismiss')!
      .getBoundingClientRect();
    const emailRect = element.querySelector<HTMLElement>('#guest-claim-email')!
      .getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      dismissTop: dismissRect.top,
      dismissBottom: dismissRect.bottom,
      emailTop: emailRect.top,
      emailBottom: emailRect.bottom,
      guestTop: guestRect.top,
      guestBottom: guestRect.bottom,
    };
  });

  expect(expandedGeometry.scrollHeight).toBeGreaterThan(expandedGeometry.clientHeight);
  expect(expandedGeometry.scrollTop).toBeGreaterThan(0);
  expect(expandedGeometry.emailBottom).toBeGreaterThan(expandedGeometry.guestTop);
  expect(expandedGeometry.emailTop).toBeLessThan(expandedGeometry.guestBottom);
  expect(expandedGeometry.dismissTop).toBeGreaterThanOrEqual(expandedGeometry.guestTop);
  expect(expandedGeometry.dismissBottom).toBeLessThanOrEqual(expandedGeometry.guestBottom);
});
