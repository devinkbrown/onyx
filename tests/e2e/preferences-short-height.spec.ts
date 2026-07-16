import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps the Preferences close action and body usable at 400% short reflow', async ({ page, browserName }) => {
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

  const openPreferences = page.getByRole('button', { name: 'Open preferences' });
  await expect(openPreferences).toBeVisible();
  await openPreferences.click();

  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  const close = page.getByRole('button', { name: 'Close preferences' });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();

  const openingGeometry = await dialog.evaluate((panel) => {
    const header = panel.querySelector<HTMLElement>('.onyx-sheet__header')!;
    const body = panel.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const closeButton = panel.querySelector<HTMLElement>('.onyx-sheet__close')!;
    const tabs = panel.querySelector<HTMLElement>('.pref-category-tabs')!;
    const panelRect = panel.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const closeRect = closeButton.getBoundingClientRect();
    return {
      panelScrollTop: panel.scrollTop,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      headerBottom: headerRect.bottom,
      headerClientHeight: header.clientHeight,
      headerScrollHeight: header.scrollHeight,
      headerOverflowY: getComputedStyle(header).overflowY,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      closeTop: closeRect.top,
      closeBottom: closeRect.bottom,
      tabsClientWidth: tabs.clientWidth,
      tabsScrollWidth: tabs.scrollWidth,
    };
  });

  expect(openingGeometry.panelScrollTop).toBe(0);
  expect(openingGeometry.headerOverflowY).toBe('auto');
  expect(openingGeometry.headerClientHeight).toBeLessThanOrEqual(Math.ceil(256 * 0.6));
  expect(openingGeometry.headerScrollHeight).toBeGreaterThan(openingGeometry.headerClientHeight);
  expect(openingGeometry.closeTop).toBeGreaterThanOrEqual(openingGeometry.panelTop);
  expect(openingGeometry.closeBottom).toBeLessThanOrEqual(openingGeometry.panelBottom);
  expect(openingGeometry.bodyTop).toBeGreaterThanOrEqual(openingGeometry.headerBottom - 1);
  expect(openingGeometry.bodyBottom).toBeLessThanOrEqual(openingGeometry.panelBottom + 1);
  expect(openingGeometry.bodyClientHeight).toBeGreaterThan(0);
  expect(openingGeometry.bodyScrollHeight).toBeGreaterThan(openingGeometry.bodyClientHeight);
  expect(openingGeometry.tabsScrollWidth).toBeGreaterThan(openingGeometry.tabsClientWidth);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: /^Display/ })).toBeFocused();
  await page.keyboard.press('End');
  const accessibility = page.getByRole('tab', { name: /^Accessibility/ });
  await expect(accessibility).toBeFocused();

  const navigationGeometry = await dialog.evaluate((panel) => {
    const body = panel.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const selected = panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    const bodyRect = body.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return {
      panelScrollTop: panel.scrollTop,
      selectedTop: selectedRect.top,
      selectedBottom: selectedRect.bottom,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
    };
  });

  expect(navigationGeometry.panelScrollTop).toBeLessThanOrEqual(1);
  expect(navigationGeometry.selectedBottom).toBeGreaterThan(navigationGeometry.bodyTop);
  expect(navigationGeometry.selectedTop).toBeLessThan(navigationGeometry.bodyBottom);
});
