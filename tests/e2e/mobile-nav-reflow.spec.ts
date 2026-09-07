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

  const finalAction = page.getByRole('button', { name: 'Open You' });
  await finalAction.focus();
  await expect(finalAction).toBeFocused();
  await expect.poll(() => nav.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
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

test('keeps the Advanced room control desk reachable at 400% short reflow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area inset override uses the Chromium DevTools protocol.');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 256 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: 8,
      topMax: 8,
      right: 18,
      rightMax: 18,
      bottom: 20,
      bottomMax: 20,
      left: 12,
      leftMax: 12,
    },
  });
  await page.addInitScript(() => {
    localStorage.setItem('onyx:preferences', JSON.stringify({ experienceMode: 'advanced' }));
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
      server: {
        id: 'ui-qa',
        name: 'UI QA',
        network: 'UI QA',
        url: 'wss://ui-qa.invalid',
        icon: '',
        nick: 'ui-qa',
        account: 'ui-qa',
        connected: true,
      },
      ourNick: 'ui-qa',
      activeView: { kind: 'channel', channel: '#access' },
      channels: new Map([['#access', {
        name: '#access',
        topic: 'Accessible room operations',
        topicSetBy: 'ui-qa',
        topicSetAt: null,
        modes: '+t',
        users: new Map([
          ['ui-qa', { nick: 'ui-qa', modes: new Set(['o']) }],
          ['ada', { nick: 'ada', modes: new Set() }],
        ]),
        unread: 0,
        highlights: 0,
        createdAt: null,
        messages: [],
      }]]),
    });
  });

  const youTrigger = page.getByRole('button', { name: 'Open You' });
  await youTrigger.focus();
  await youTrigger.click();
  const you = page.getByRole('dialog', { name: 'You' });
  const appearance = you.getByRole('button', { name: 'Appearance', exact: true });
  const preferences = you.getByRole('button', { name: 'Preferences' });
  await expect(appearance).toBeVisible();
  await expect(preferences).toBeVisible();
  expect((await appearance.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((await preferences.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  const ribbonMore = page.getByTestId('ribbon-more');
  const moreTrigger = ribbonMore.locator('xpath=ancestor-or-self::button').first();
  await moreTrigger.click();
  const launcher = page.getByTestId('ribbon-room-desk');
  await expect(launcher).toBeVisible();
  await launcher.click();

  const desk = page.getByRole('dialog', { name: 'Room controls for #access' });
  await expect(desk).toBeVisible();
  await expect(desk.getByRole('button', { name: 'Back' })).toBeFocused();
  await expect(desk.getByTestId('moderation-cockpit')).toBeVisible();

  const invite = desk.getByLabel('Invite someone');
  const ban = desk.getByLabel('Block an address in this room');
  await invite.scrollIntoViewIfNeeded();
  await expect(invite).toBeVisible();
  await ban.fill('ada!*@*');
  const review = desk.getByRole('button', { name: 'Review block' });
  await review.scrollIntoViewIfNeeded();
  await review.focus();
  await expect(review).toBeFocused();
  await page.keyboard.press('Enter');
  const confirmation = page.getByRole('button', { name: 'Block from room' });
  await confirmation.scrollIntoViewIfNeeded();
  await confirmation.focus();
  await expect(confirmation).toBeFocused();

  const geometryDesk = page.getByRole('dialog', {
    name: 'Room controls for #access',
    includeHidden: true,
  });
  const geometry = await geometryDesk.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      position: getComputedStyle(element).position,
      height: getComputedStyle(element).height,
      maxHeight: getComputedStyle(element).maxHeight,
      topStyle: getComputedStyle(element).top,
      bottomStyle: getComputedStyle(element).bottom,
      overflowY: getComputedStyle(element).overflowY,
    };
  });
  expect(geometry.position).toBe('fixed');
  expect(geometry.overflowY).toBe('auto');
  expect(geometry.maxHeight).not.toBe('none');
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(256);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);

  await page.keyboard.press('Escape');
  await expect(review).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(desk).toHaveCount(0);
});
