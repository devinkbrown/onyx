import { expect, test } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

test('keeps message search usable at 400% short reflow', async ({ page, browserName }) => {
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
      channels: new Map([['#root', {
        name: '#root',
        topic: 'UI quality assurance',
        topicSetBy: 'server',
        topicSetAt: null,
        modes: '',
        users: new Map([['ui-qa', { nick: 'ui-qa', modes: new Set() }]]),
        unread: 0,
        highlights: 0,
        createdAt: null,
        messages: [],
      }]]),
      activeView: { kind: 'channel', channel: '#root' },
    });
  });

  // Home no longer has a search button. Exercise the conversation ribbon's
  // actual control, including its focus return when search closes.
  const trigger = page.getByRole('button', { name: 'Search messages', exact: true });
  await trigger.click();
  const search = page.locator('.onyx-message-search');
  const surface = search.locator('.onyx-message-search__surface');
  const input = page.getByRole('searchbox', { name: 'Search messages' });
  const close = page.getByRole('button', { name: 'Close search' });
  await expect(search).toBeVisible();
  await expect(input).toBeFocused();

  const openingGeometry = await search.evaluate((element) => {
    const rootRect = element.getBoundingClientRect();
    const surface = element.querySelector<HTMLElement>('.onyx-message-search__surface')!;
    const surfaceRect = surface.getBoundingClientRect();
    const inputRect = element.querySelector<HTMLElement>('.onyx-message-search__input')!.getBoundingClientRect();
    const closeRect = element.querySelector<HTMLElement>('.onyx-message-search__button--close')!.getBoundingClientRect();
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: element.clientWidth,
      rootScrollWidth: element.scrollWidth,
      rootScrollTop: element.scrollTop,
      rootTop: rootRect.top,
      rootBottom: rootRect.bottom,
      rootLeft: rootRect.left,
      rootRight: rootRect.right,
      surfaceTop: surfaceRect.top,
      surfaceBottom: surfaceRect.bottom,
      surfaceLeft: surfaceRect.left,
      surfaceRight: surfaceRect.right,
      inputTop: inputRect.top,
      inputBottom: inputRect.bottom,
      inputWidth: inputRect.width,
      closeTop: closeRect.top,
      closeBottom: closeRect.bottom,
      closeRight: closeRect.right,
      closeWidth: closeRect.width,
      closeHeight: closeRect.height,
    };
  });

  expect(openingGeometry.documentScrollWidth).toBe(openingGeometry.documentClientWidth);
  expect(openingGeometry.rootScrollWidth).toBe(openingGeometry.rootClientWidth);
  expect(openingGeometry.rootScrollTop).toBe(0);
  expect(openingGeometry.rootTop).toBeGreaterThanOrEqual(12);
  expect(openingGeometry.rootBottom).toBeLessThanOrEqual(256 - 20 - 56 - 8);
  expect(openingGeometry.rootLeft).toBeGreaterThanOrEqual(0);
  expect(openingGeometry.rootRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.surfaceTop).toBeGreaterThanOrEqual(openingGeometry.rootTop);
  expect(openingGeometry.surfaceBottom).toBeLessThanOrEqual(openingGeometry.rootBottom);
  expect(openingGeometry.surfaceLeft).toBeGreaterThanOrEqual(openingGeometry.rootLeft);
  expect(openingGeometry.surfaceRight).toBeLessThanOrEqual(openingGeometry.rootRight);
  expect(openingGeometry.inputTop).toBeGreaterThanOrEqual(openingGeometry.surfaceTop);
  expect(openingGeometry.inputBottom).toBeLessThanOrEqual(openingGeometry.surfaceBottom);
  expect(openingGeometry.inputWidth).toBeGreaterThanOrEqual(120);
  expect(openingGeometry.closeTop).toBeGreaterThanOrEqual(openingGeometry.surfaceTop);
  expect(openingGeometry.closeBottom).toBeLessThanOrEqual(openingGeometry.surfaceBottom);
  expect(openingGeometry.closeRight).toBeLessThanOrEqual(320 - 24);
  expect(openingGeometry.closeWidth).toBeGreaterThanOrEqual(44);
  expect(openingGeometry.closeHeight).toBeGreaterThanOrEqual(44);

  await input.fill('roadmap');
  const body = search.locator('.onyx-message-search__body');
  const savedName = body.getByRole('textbox', { name: 'Saved search name' });
  await savedName.scrollIntoViewIfNeeded();
  await savedName.fill('Roadmap notes');
  await expect(savedName).toHaveValue('Roadmap notes');
  const advanced = body.getByRole('button', { name: 'Advanced', exact: true });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.click();
  const related = body.getByRole('button', { name: 'Related terms', exact: true });
  await related.scrollIntoViewIfNeeded();
  await related.focus();
  await expect(related).toBeFocused();
  const populatedGeometry = await search.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.onyx-message-search__body')!;
    body.scrollTop = body.scrollHeight;
    const bodyRect = body.getBoundingClientRect();
    const rootRect = element.getBoundingClientRect();
    const surfaceRect = element.querySelector<HTMLElement>('.onyx-message-search__surface')!
      .getBoundingClientRect();
    const closeRect = element.querySelector<HTMLElement>('.onyx-message-search__button--close')!
      .getBoundingClientRect();
    return {
      rootClientWidth: element.clientWidth,
      rootScrollWidth: element.scrollWidth,
      rootClientHeight: element.clientHeight,
      rootScrollHeight: element.scrollHeight,
      rootScrollTop: element.scrollTop,
      rootTop: rootRect.top,
      rootBottom: rootRect.bottom,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyScrollTop: body.scrollTop,
      surfaceTop: surfaceRect.top,
      surfaceBottom: surfaceRect.bottom,
      closeTop: closeRect.top,
      closeBottom: closeRect.bottom,
      wideElements: Array.from(element.querySelectorAll<HTMLElement>('*'))
        .filter((node) => {
          const overflowX = getComputedStyle(node).overflowX;
          return node.scrollWidth > node.clientWidth + 1
            && overflowX !== 'auto'
            && overflowX !== 'scroll'
            && !node.classList.contains('sr-only');
        })
        .map((node) => ({
          className: node.className,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
        })),
    };
  });

  expect(populatedGeometry.wideElements).toEqual([]);
  expect(populatedGeometry.rootScrollWidth).toBe(populatedGeometry.rootClientWidth);
  expect(populatedGeometry.rootScrollHeight).toBe(populatedGeometry.rootClientHeight);
  expect(populatedGeometry.rootScrollTop).toBe(0);
  expect(populatedGeometry.bodyScrollHeight).toBeGreaterThan(populatedGeometry.bodyClientHeight);
  expect(populatedGeometry.bodyScrollTop).toBeGreaterThan(0);
  expect(populatedGeometry.bodyClientHeight).toBeGreaterThanOrEqual(44);
  expect(populatedGeometry.bodyTop).toBeGreaterThanOrEqual(populatedGeometry.surfaceBottom);
  expect(populatedGeometry.bodyBottom).toBeLessThanOrEqual(populatedGeometry.rootBottom);
  expect(populatedGeometry.surfaceTop).toBeGreaterThanOrEqual(populatedGeometry.rootTop);
  expect(populatedGeometry.closeTop).toBeGreaterThanOrEqual(populatedGeometry.surfaceTop);
  expect(populatedGeometry.closeBottom).toBeLessThanOrEqual(populatedGeometry.surfaceBottom);

  await input.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Escape');
  await expect(surface).toBeHidden();
  await expect(trigger).toBeFocused();
});
