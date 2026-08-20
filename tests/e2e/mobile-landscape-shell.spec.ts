import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps the ordinary landscape shell balanced without activating zoom fallback geometry', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
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

  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  const home = page.getByRole('main', { name: 'Network home' });
  await expect(nav).toBeVisible();
  await expect(home).toBeVisible();

  const geometry = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.shell-mobile-nav')!;
    const ribbon = document.querySelector<HTMLElement>('.shell-ribbon')!;
    const home = document.querySelector<HTMLElement>('.home')!;
    const navRect = nav.getBoundingClientRect();
    const ribbonRect = ribbon.getBoundingClientRect();
    const homeRect = home.getBoundingClientRect();
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'), (button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      navClientWidth: nav.clientWidth,
      navScrollWidth: nav.scrollWidth,
      navTop: navRect.top,
      navBottom: navRect.bottom,
      ribbonLeft: ribbonRect.left,
      ribbonRight: ribbonRect.right,
      ribbonBottom: ribbonRect.bottom,
      homeTop: homeRect.top,
      homeBottom: homeRect.bottom,
      buttons,
    };
  });

  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.navScrollWidth).toBe(geometry.navClientWidth);
  expect(geometry.ribbonLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.ribbonRight).toBeLessThanOrEqual(844);
  expect(geometry.homeTop).toBeGreaterThanOrEqual(geometry.ribbonBottom - 1);
  expect(geometry.homeBottom).toBeLessThanOrEqual(geometry.navTop + 1);
  expect(geometry.buttons).toHaveLength(4);
  for (const button of geometry.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(844);
    expect(button.top).toBeGreaterThanOrEqual(geometry.navTop);
    expect(button.bottom).toBeLessThanOrEqual(geometry.navBottom);
  }
});
