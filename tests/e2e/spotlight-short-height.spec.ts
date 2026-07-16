import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps Spotlight usable at 400% short reflow', async ({ page, browserName }) => {
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

  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const input = page.getByRole('combobox', { name: 'Command search' });
  const close = page.getByRole('button', { name: 'Close spotlight' });
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();

  const openingGeometry = await dialog.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const search = element.querySelector<HTMLElement>('.onyx-spotlight__search')!;
    const searchRect = search.getBoundingClientRect();
    const grammar = element.querySelector<HTMLElement>('.onyx-spotlight__grammar')!;
    const results = element.querySelector<HTMLElement>('.onyx-spotlight__results')!;
    const resultsRect = results.getBoundingClientRect();
    const inputRect = element.querySelector<HTMLElement>('.onyx-spotlight__input')!.getBoundingClientRect();
    const closeRect = element.querySelector<HTMLElement>('.onyx-spotlight__close')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelClientHeight: element.clientHeight,
      panelScrollHeight: element.scrollHeight,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      searchTop: searchRect.top,
      searchBottom: searchRect.bottom,
      grammarTop: grammar.getBoundingClientRect().top,
      grammarBottom: grammar.getBoundingClientRect().bottom,
      grammarExamplesDisplay: getComputedStyle(
        element.querySelector<HTMLElement>('.onyx-spotlight__grammar-examples')!,
      ).display,
      resultsTop: resultsRect.top,
      resultsBottom: resultsRect.bottom,
      resultsClientHeight: results.clientHeight,
      resultsScrollHeight: results.scrollHeight,
      inputTop: inputRect.top,
      inputBottom: inputRect.bottom,
      closeTop: closeRect.top,
      closeBottom: closeRect.bottom,
      closeRight: closeRect.right,
    };
  });

  expect(openingGeometry.documentScrollWidth).toBe(openingGeometry.documentClientWidth);
  expect(openingGeometry.panelScrollHeight).toBe(openingGeometry.panelClientHeight);
  expect(openingGeometry.panelLeft).toBeGreaterThanOrEqual(8);
  expect(openingGeometry.panelRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.panelTop).toBeGreaterThanOrEqual(12);
  expect(openingGeometry.panelBottom).toBeLessThanOrEqual(256 - 20);
  expect(openingGeometry.searchTop).toBeGreaterThanOrEqual(openingGeometry.panelTop);
  expect(openingGeometry.searchBottom).toBeLessThanOrEqual(openingGeometry.panelBottom);
  expect(openingGeometry.inputTop).toBeGreaterThanOrEqual(openingGeometry.searchTop);
  expect(openingGeometry.inputBottom).toBeLessThanOrEqual(openingGeometry.searchBottom);
  expect(openingGeometry.closeTop).toBeGreaterThanOrEqual(openingGeometry.searchTop);
  expect(openingGeometry.closeBottom).toBeLessThanOrEqual(openingGeometry.searchBottom);
  expect(openingGeometry.closeRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.grammarTop).toBeGreaterThanOrEqual(openingGeometry.searchBottom - 1);
  expect(openingGeometry.grammarBottom).toBeLessThanOrEqual(openingGeometry.panelBottom);
  expect(openingGeometry.grammarExamplesDisplay).toBe('none');
  expect(openingGeometry.resultsTop).toBeGreaterThanOrEqual(openingGeometry.grammarBottom - 1);
  expect(openingGeometry.resultsBottom).toBeLessThanOrEqual(openingGeometry.panelBottom + 1);
  expect(openingGeometry.resultsClientHeight).toBeGreaterThan(0);
  expect(openingGeometry.resultsScrollHeight).toBeGreaterThan(openingGeometry.resultsClientHeight);

  await input.press('ArrowDown');
  const activeOption = dialog.locator('[role="option"][aria-selected="true"]');
  await expect(activeOption).toBeInViewport();
  await input.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
});
