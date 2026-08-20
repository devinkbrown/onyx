import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps a production ModalShell usable at 400% short reflow', async ({ page, browserName }) => {
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
      showAccount: true,
    });
  });

  const dialog = page.getByRole('dialog', { name: 'You' });
  const close = page.getByRole('button', { name: 'Close account panel' });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();

  const openingGeometry = await dialog.evaluate((element) => {
    const dialogRect = element.getBoundingClientRect();
    const header = element.querySelector<HTMLElement>('.onyx-modal__header')!;
    const headerRect = header.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>('.onyx-modal__body')!;
    const bodyRect = body.getBoundingClientRect();
    const closeRect = element.querySelector<HTMLElement>('.onyx-modal__close')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogScrollTop: element.scrollTop,
      dialogClientHeight: element.clientHeight,
      dialogScrollHeight: element.scrollHeight,
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
      dialogTop: dialogRect.top,
      dialogBottom: dialogRect.bottom,
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
      closeRight: closeRect.right,
    };
  });

  expect(openingGeometry.documentScrollWidth).toBe(openingGeometry.documentClientWidth);
  expect(openingGeometry.dialogScrollTop).toBe(0);
  expect(openingGeometry.dialogScrollHeight).toBe(openingGeometry.dialogClientHeight);
  expect(openingGeometry.dialogLeft).toBeGreaterThanOrEqual(8);
  expect(openingGeometry.dialogRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.dialogTop).toBeGreaterThanOrEqual(12);
  expect(openingGeometry.dialogBottom).toBeLessThanOrEqual(256 - 20);
  expect(openingGeometry.headerOverflowY).toBe('auto');
  expect(openingGeometry.headerClientHeight).toBeLessThanOrEqual(Math.ceil(256 * 0.6));
  expect(openingGeometry.headerScrollHeight).toBeGreaterThanOrEqual(openingGeometry.headerClientHeight);
  expect(openingGeometry.closeTop).toBeGreaterThanOrEqual(openingGeometry.dialogTop);
  expect(openingGeometry.closeBottom).toBeLessThanOrEqual(openingGeometry.dialogBottom);
  expect(openingGeometry.closeRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.bodyTop).toBeGreaterThanOrEqual(openingGeometry.headerBottom - 1);
  expect(openingGeometry.bodyBottom).toBeLessThanOrEqual(openingGeometry.dialogBottom + 1);
  expect(openingGeometry.bodyClientHeight).toBeGreaterThan(0);
  expect(openingGeometry.bodyScrollHeight).toBeGreaterThan(openingGeometry.bodyClientHeight);

  await page.keyboard.press('Tab');
  const focusedBodyControl = await dialog.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.onyx-modal__body')!;
    const bodyRect = body.getBoundingClientRect();
    const focused = document.activeElement as HTMLElement | null;
    const focusedRect = focused?.getBoundingClientRect();
    return {
      dialogScrollTop: element.scrollTop,
      focusedInsideBody: focused ? body.contains(focused) : false,
      focusedTop: focusedRect?.top ?? -1,
      focusedBottom: focusedRect?.bottom ?? -1,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
    };
  });

  expect(focusedBodyControl.dialogScrollTop).toBe(0);
  expect(focusedBodyControl.focusedInsideBody).toBe(true);
  expect(focusedBodyControl.focusedBottom).toBeGreaterThan(focusedBodyControl.bodyTop);
  expect(focusedBodyControl.focusedTop).toBeLessThan(focusedBodyControl.bodyBottom);
});
