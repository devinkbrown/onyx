import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps the desktop primary location visibly distinct in forced colors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Forced-colors computed styles are asserted in Chromium.');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
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

    store.setState({
      connectionStatus: 'connected',
      ourNick: 'ui-qa',
      activeView: { kind: 'home' },
    });
  });

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  const styles = await nav.evaluate((element) => {
    const active = element.querySelector<HTMLElement>('.shell-primary-nav-btn--active');
    const inactive = Array.from(element.querySelectorAll<HTMLElement>('.shell-primary-nav-btn'))
      .find((button) => !button.classList.contains('shell-primary-nav-btn--active'));
    if (!active || !inactive) throw new Error('Primary navigation active/inactive controls were not found.');
    const activeIcon = active.querySelector<HTMLElement>('.shell-primary-nav-icon');
    const inactiveIcon = inactive.querySelector<HTMLElement>('.shell-primary-nav-icon');
    if (!activeIcon || !inactiveIcon) throw new Error('Primary navigation icons were not found.');
    const activeStyle = getComputedStyle(active);
    const inactiveStyle = getComputedStyle(inactive);
    return {
      mediaMatches: window.matchMedia('(forced-colors: active)').matches,
      activeColor: activeStyle.color,
      activeBackground: activeStyle.backgroundColor,
      activeBorder: activeStyle.borderColor,
      activeIconColor: getComputedStyle(activeIcon).color,
      inactiveColor: inactiveStyle.color,
      inactiveBackground: inactiveStyle.backgroundColor,
      inactiveBorder: inactiveStyle.borderColor,
      inactiveIconColor: getComputedStyle(inactiveIcon).color,
    };
  });

  expect(styles.mediaMatches).toBe(true);
  expect(styles.activeColor).not.toBe(styles.inactiveColor);
  expect(styles.activeBackground).not.toBe(styles.inactiveBackground);
  expect(styles.activeIconColor).not.toBe(styles.inactiveIconColor);
});
