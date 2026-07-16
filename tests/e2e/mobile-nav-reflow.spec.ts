import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('contains enlarged mobile navigation in a safe-area-aware horizontal rail', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 0,
      topMax: 0,
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

  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();

  const openingGeometry = await nav.evaluate((element) => {
    const style = getComputedStyle(element);
    const navRect = element.getBoundingClientRect();
    const shellRect = document.querySelector<HTMLElement>('.shell')!.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button'), (button) => {
      const rect = button.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        clientHeight: button.clientHeight,
        scrollHeight: button.scrollHeight,
      };
    });
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      navTop: navRect.top,
      navBottom: navRect.bottom,
      navClientWidth: element.clientWidth,
      navScrollWidth: element.scrollWidth,
      navClientHeight: element.clientHeight,
      navScrollHeight: element.scrollHeight,
      overflowX: style.overflowX,
      paddingBottom: Number.parseFloat(style.paddingBottom),
      shellBottom: shellRect.bottom,
      buttons,
    };
  });

  expect(openingGeometry.documentScrollWidth).toBe(openingGeometry.documentClientWidth);
  expect(openingGeometry.overflowX).toBe('auto');
  expect(openingGeometry.navScrollWidth).toBeGreaterThan(openingGeometry.navClientWidth);
  expect(openingGeometry.navScrollHeight).toBe(openingGeometry.navClientHeight);
  expect(openingGeometry.shellBottom).toBeLessThanOrEqual(openingGeometry.navTop + 1);
  for (const button of openingGeometry.buttons) {
    expect(button.top).toBeGreaterThanOrEqual(openingGeometry.navTop);
    expect(button.bottom).toBeLessThanOrEqual(
      openingGeometry.navBottom - openingGeometry.paddingBottom + 1,
    );
    expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight);
  }

  const disconnect = page.getByRole('button', { name: 'Disconnect from network' });
  await disconnect.focus();
  await expect(disconnect).toBeFocused();
  const focusedGeometry = await nav.evaluate((element) => {
    const last = element.querySelector<HTMLButtonElement>('button:last-child')!;
    const navRect = element.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      scrollLeft: element.scrollLeft,
      safeLeft: navRect.left + Number.parseFloat(style.paddingLeft),
      safeRight: navRect.right - Number.parseFloat(style.paddingRight),
      lastLeft: lastRect.left,
      lastRight: lastRect.right,
    };
  });

  expect(focusedGeometry.scrollLeft).toBeGreaterThan(0);
  expect(focusedGeometry.lastLeft).toBeGreaterThanOrEqual(focusedGeometry.safeLeft - 1);
  expect(focusedGeometry.lastRight).toBeLessThanOrEqual(focusedGeometry.safeRight + 1);
});
