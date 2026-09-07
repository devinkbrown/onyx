import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps the high-zoom channel drawer aligned and keyboard reachable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 0,
      topMax: 0,
      right: 0,
      rightMax: 0,
      bottom: 20,
      bottomMax: 20,
      left: 24,
      leftMax: 24,
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

  const toggle = page.getByRole('button', { name: 'Open Rooms', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const dialog = page.getByRole('dialog', { name: 'Room switcher' });
  const drawer = page.locator('.shell-sidebar');
  await expect(dialog).toBeVisible();
  await expect(drawer).toBeVisible();

  const openingGeometry = await drawer.evaluate((element) => {
    const drawerRect = element.getBoundingClientRect();
    const header = element.querySelector<HTMLElement>('.shell-sidebar-head')!;
    const headerRect = header.getBoundingClientRect();
    const list = element.querySelector<HTMLElement>('.shell-sidebar-scroll')!;
    const listRect = list.getBoundingClientRect();
    const focused = document.activeElement as HTMLElement | null;
    const focusedRect = focused?.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      drawerLeft: drawerRect.left,
      drawerRight: drawerRect.right,
      drawerBottom: drawerRect.bottom,
      drawerScrollLeft: element.scrollLeft,
      drawerScrollTop: element.scrollTop,
      headerLeft: headerRect.left,
      headerRight: headerRect.right,
      headerClientWidth: header.clientWidth,
      headerScrollWidth: header.scrollWidth,
      headerOverflowX: getComputedStyle(header).overflowX,
      headerButtonCount: header.querySelectorAll('button').length,
      listLeft: listRect.left,
      listRight: listRect.right,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      listClientHeight: list.clientHeight,
      focusedInsideDialog: focused ? element.closest('[role="dialog"]')?.contains(focused) === true : false,
      focusedLeft: focusedRect?.left ?? -1,
      focusedRight: focusedRect?.right ?? -1,
    };
  });

  expect(openingGeometry.drawerScrollLeft).toBe(0);
  expect(openingGeometry.drawerScrollTop).toBe(0);
  expect(openingGeometry.documentScrollWidth).toBe(openingGeometry.documentClientWidth);
  expect(['visible', 'auto', 'hidden', 'clip'], openingGeometry.headerOverflowX).toContain(
    openingGeometry.headerOverflowX,
  );
  expect(openingGeometry.headerScrollWidth).toBeLessThanOrEqual(openingGeometry.headerClientWidth);
  expect(openingGeometry.headerLeft).toBeGreaterThanOrEqual(24);
  expect(openingGeometry.headerRight).toBeLessThanOrEqual(openingGeometry.drawerRight + 1);
  expect(openingGeometry.listLeft).toBeGreaterThanOrEqual(24);
  expect(openingGeometry.listRight).toBeLessThanOrEqual(openingGeometry.drawerRight + 1);
  expect(openingGeometry.listBottom).toBeLessThanOrEqual(openingGeometry.drawerBottom + 1);
  expect(openingGeometry.listClientHeight).toBeGreaterThan(0);
  expect(openingGeometry.focusedInsideDialog).toBe(true);
  expect(openingGeometry.focusedLeft).toBeGreaterThanOrEqual(24);
  expect(openingGeometry.focusedRight).toBeLessThanOrEqual(openingGeometry.drawerRight + 1);

  for (let index = 0; index < openingGeometry.headerButtonCount + 4; index += 1) {
    await page.keyboard.press('Tab');
    const reachedList = await drawer.evaluate((element) => {
      const list = element.querySelector<HTMLElement>('.shell-sidebar-scroll');
      return document.activeElement !== null && list?.contains(document.activeElement) === true;
    });
    if (reachedList) break;
  }
  const focusedGeometry = await drawer.evaluate((element) => {
    const list = element.querySelector<HTMLElement>('.shell-sidebar-scroll')!;
    const listRect = list.getBoundingClientRect();
    const focused = document.activeElement as HTMLElement | null;
    const focusedRect = focused?.getBoundingClientRect();
    return {
      drawerScrollLeft: element.scrollLeft,
      drawerScrollTop: element.scrollTop,
      focusedInsideList: focused ? list.contains(focused) : false,
      focusedTop: focusedRect?.top ?? -1,
      focusedBottom: focusedRect?.bottom ?? -1,
      listTop: listRect.top,
      listBottom: listRect.bottom,
    };
  });

  expect(focusedGeometry.drawerScrollLeft).toBe(0);
  expect(focusedGeometry.drawerScrollTop).toBe(0);
  expect(focusedGeometry.focusedInsideList).toBe(true);
  expect(focusedGeometry.focusedBottom).toBeGreaterThan(focusedGeometry.listTop);
  expect(focusedGeometry.focusedTop).toBeLessThan(focusedGeometry.listBottom);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
});
