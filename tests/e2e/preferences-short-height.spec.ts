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

  await page.getByRole('button', { name: 'Open Menu' }).click();
  await page.getByRole('button', { name: 'You — account, appearance, and preferences' }).click();
  await page.getByRole('dialog', { name: 'You' }).getByRole('button', { name: 'Preferences', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  const close = page.getByRole('button', { name: 'Close preferences' });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();

  const openingGeometry = await dialog.evaluate((panel) => {
    const header = panel.querySelector<HTMLElement>('.onyx-sheet__header')!;
    const body = panel.querySelector<HTMLElement>('.onyx-sheet__body')!;
    const closeButton = panel.querySelector<HTMLElement>('.onyx-sheet__close')!;
    const categoryNav = panel.querySelector<HTMLElement>('.pref-category-nav')!;
    const tabs = panel.querySelector<HTMLElement>('.pref-category-tabs')!;
    const tabButtons = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'));
    const reset = panel.querySelector<HTMLElement>('.pref-reset-all')!;
    const content = panel.querySelector<HTMLElement>('.pref-category-content')!;
    const panelRect = panel.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const closeRect = closeButton.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
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
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyOverflowX: getComputedStyle(body).overflowX,
      closeTop: closeRect.top,
      closeBottom: closeRect.bottom,
      closeHeight: closeRect.height,
      categoryNavHeight: categoryNav.getBoundingClientRect().height,
      categoryNavPosition: getComputedStyle(categoryNav).position,
      tabsClientWidth: tabs.clientWidth,
      tabsScrollWidth: tabs.scrollWidth,
      tabHeights: tabButtons.map((tab) => tab.getBoundingClientRect().height),
      tabFontSizes: tabButtons.map((tab) => Number.parseFloat(getComputedStyle(tab).fontSize)),
      resetHeight: reset.getBoundingClientRect().height,
      resetFontSize: Number.parseFloat(getComputedStyle(reset).fontSize),
      contentTop: contentRect.top,
      contentBottom: contentRect.bottom,
    };
  });

  expect(openingGeometry.panelScrollTop).toBe(0);
  expect(openingGeometry.headerOverflowY).not.toBe('auto');
  expect(openingGeometry.headerClientHeight).toBeLessThanOrEqual(64);
  expect(openingGeometry.headerScrollHeight).toBe(openingGeometry.headerClientHeight);
  expect(openingGeometry.closeTop).toBeGreaterThanOrEqual(openingGeometry.panelTop);
  expect(openingGeometry.closeBottom).toBeLessThanOrEqual(openingGeometry.panelBottom);
  expect(openingGeometry.closeHeight).toBeGreaterThanOrEqual(44);
  expect(openingGeometry.bodyTop).toBeGreaterThanOrEqual(openingGeometry.headerBottom - 1);
  expect(openingGeometry.bodyBottom).toBeLessThanOrEqual(openingGeometry.panelBottom + 1);
  expect(openingGeometry.bodyClientHeight).toBeGreaterThanOrEqual(192);
  expect(openingGeometry.bodyScrollHeight).toBeGreaterThan(openingGeometry.bodyClientHeight);
  expect(openingGeometry.bodyScrollWidth).toBeGreaterThanOrEqual(openingGeometry.bodyClientWidth);
  expect(openingGeometry.bodyOverflowX).toBe('hidden');
  expect(openingGeometry.categoryNavPosition).toBe('sticky');
  expect(openingGeometry.categoryNavHeight).toBeLessThanOrEqual(56);
  expect(openingGeometry.tabsScrollWidth).toBeGreaterThan(openingGeometry.tabsClientWidth);
  for (const height of openingGeometry.tabHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(48);
  }
  for (const fontSize of openingGeometry.tabFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(16);
  }
  expect(openingGeometry.resetHeight).toBeGreaterThanOrEqual(44);
  expect(openingGeometry.resetHeight).toBeLessThanOrEqual(48);
  expect(openingGeometry.resetFontSize).toBeGreaterThanOrEqual(12);
  expect(openingGeometry.resetFontSize).toBeLessThanOrEqual(14);
  expect(openingGeometry.contentTop).toBeLessThan(openingGeometry.bodyBottom);
  expect(openingGeometry.contentBottom).toBeGreaterThan(openingGeometry.bodyTop);

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
