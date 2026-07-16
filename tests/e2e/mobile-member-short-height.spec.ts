import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps the high-zoom member drawer close and roster keyboard reachable', async ({ page, browserName }) => {
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

    const self = { nick: 'ui-qa', modes: new Set(['q']) };
    const channel = {
      name: '#root',
      topic: 'UI quality assurance',
      topicSetBy: 'server',
      topicSetAt: null,
      modes: '',
      users: new Map([['ui-qa', self]]),
      unread: 0,
      highlights: 0,
      createdAt: null,
      messages: [],
    };
    document.documentElement.style.fontSize = '64px';
    store.setState({
      connectionStatus: 'connected',
      ourNick: 'ui-qa',
      channels: new Map([['#root', channel]]),
      activeView: { kind: 'channel', channel: '#root' },
    });
  });

  const toggle = page.getByRole('button', { name: 'Toggle member list', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const drawer = page.locator('.shell-members[role="dialog"]');
  const close = page.getByRole('button', { name: 'Close member list' });
  await expect(drawer).toBeVisible();
  await expect(close).toBeFocused();

  const openingGeometry = await drawer.evaluate((element) => {
    const drawerRect = element.getBoundingClientRect();
    const closeRect = element.querySelector<HTMLElement>('.shell-members-close')!.getBoundingClientRect();
    const roster = element.querySelector<HTMLElement>('.shell-members-scroll')!;
    const rosterRect = roster.getBoundingClientRect();
    return {
      drawerTop: drawerRect.top,
      drawerBottom: drawerRect.bottom,
      drawerScrollTop: element.scrollTop,
      drawerClientHeight: element.clientHeight,
      drawerScrollHeight: element.scrollHeight,
      closeTop: closeRect.top,
      closeBottom: closeRect.bottom,
      closeRight: closeRect.right,
      rosterTop: rosterRect.top,
      rosterBottom: rosterRect.bottom,
      rosterClientHeight: roster.clientHeight,
      rosterScrollHeight: roster.scrollHeight,
    };
  });

  expect(openingGeometry.drawerScrollTop).toBeLessThanOrEqual(1);
  expect(openingGeometry.drawerScrollHeight).toBe(openingGeometry.drawerClientHeight);
  expect(openingGeometry.closeTop).toBeGreaterThanOrEqual(openingGeometry.drawerTop);
  expect(openingGeometry.closeBottom).toBeLessThanOrEqual(openingGeometry.drawerBottom);
  expect(openingGeometry.closeRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.rosterTop).toBeGreaterThanOrEqual(openingGeometry.drawerTop);
  expect(openingGeometry.rosterBottom).toBeLessThanOrEqual(openingGeometry.drawerBottom + 1);
  expect(openingGeometry.rosterClientHeight).toBeGreaterThan(0);
  expect(openingGeometry.rosterScrollHeight).toBeGreaterThanOrEqual(openingGeometry.rosterClientHeight);

  await page.keyboard.press('Tab');
  const member = page.getByRole('button', { name: /ui-qa/ });
  await expect(member).toBeFocused();
  const memberBox = await member.boundingBox();
  expect(memberBox).not.toBeNull();
  expect(memberBox!.y + memberBox!.height).toBeGreaterThan(openingGeometry.rosterTop);
  expect(memberBox!.y).toBeLessThan(openingGeometry.rosterBottom);
});
