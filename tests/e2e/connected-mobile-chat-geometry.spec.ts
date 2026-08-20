import { expect, test, type Page } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

type Rect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type ClosedGeometry = {
  composer: Rect;
  conversation: Rect;
  documentClientWidth: number;
  documentScrollWidth: number;
  feed: Rect;
  members: Rect;
  membersInert: boolean;
  membersPointerEvents: string;
  nav: Rect;
  sidebar: Rect;
  sidebarPointerEvents: string;
  sidebarVisibility: string;
  viewportHeight: number;
  viewportWidth: number;
};

async function seedConnectedRoom(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
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

    const channel = '#root';
    const users = new Map([
      ['ui-qa', { nick: 'ui-qa', modes: new Set(['q']) }],
      ['trev', { nick: 'trev', modes: new Set(['o']) }],
      ['ariadne', { nick: 'ariadne', modes: new Set() }],
      ['klys', { nick: 'klys', modes: new Set() }],
    ]);
    const messages = Array.from({ length: 36 }, (_, index) => ({
      id: `mobile-geometry-${index}`,
      time: new Date(1_786_650_000_000 + index * 60_000),
      from: index % 2 === 0 ? 'trev' : 'ariadne',
      text: `Connected mobile transcript line ${index + 1} stays readable without a permanent member rail.`,
      type: 'msg',
      target: channel,
    }));

    store.setState({
      status: 'connected',
      connectionStatus: 'connected',
      autoReconnect: true,
      ourNick: 'ui-qa',
      networkName: 'Onyx QA',
      server: {
        id: 'mobile-geometry',
        name: 'Onyx QA',
        network: 'Onyx QA',
        url: 'wss://ui-qa.invalid',
        icon: '',
        nick: 'ui-qa',
        account: 'ui-qa',
        connected: true,
      },
      activeView: { kind: 'channel', channel },
      channels: new Map([[channel, {
        name: channel,
        topic: 'Ordinary connected phone geometry',
        topicSetBy: 'server',
        topicSetAt: null,
        modes: '+nt',
        users,
        unread: 0,
        highlights: 0,
        createdAt: null,
        messages,
      }]]),
      channelProps: new Map(),
    });
  });

  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByRole('log', { name: 'Message history' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message #root' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page.getByText('Connected mobile transcript line 36', { exact: false })).toBeVisible();
}

async function closedGeometry(page: Page): Promise<ClosedGeometry> {
  return page.evaluate(() => {
    const bounds = (element: Element): Rect => {
      const box = element.getBoundingClientRect();
      return {
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
      };
    };
    const sidebar = document.querySelector<HTMLElement>('.shell-sidebar')!;
    const members = document.querySelector<HTMLElement>('.shell-members')!;
    return {
      composer: bounds(document.querySelector<HTMLElement>('.shell-composer')!),
      conversation: bounds(document.querySelector<HTMLElement>('.shell-conversation')!),
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      feed: bounds(document.querySelector<HTMLElement>('.shell-feed')!),
      members: bounds(members),
      membersInert: members.hasAttribute('inert'),
      membersPointerEvents: getComputedStyle(members).pointerEvents,
      nav: bounds(document.querySelector<HTMLElement>('.shell-mobile-nav')!),
      sidebar: bounds(sidebar),
      sidebarPointerEvents: getComputedStyle(sidebar).pointerEvents,
      sidebarVisibility: getComputedStyle(sidebar).visibility,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
}

function expectClosedPhoneShell(geometry: ClosedGeometry): void {
  expect(geometry.viewportWidth).toBe(390);
  expect(geometry.viewportHeight).toBe(844);
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);

  expect(geometry.conversation.left).toBeCloseTo(0, 1);
  expect(geometry.conversation.right).toBeCloseTo(geometry.viewportWidth, 1);
  expect(geometry.conversation.width).toBeCloseTo(geometry.viewportWidth, 1);
  expect(geometry.feed.left).toBeGreaterThanOrEqual(geometry.conversation.left);
  expect(geometry.feed.right).toBeLessThanOrEqual(geometry.conversation.right + 1);
  expect(geometry.feed.width).toBeCloseTo(geometry.viewportWidth, 1);
  expect(geometry.composer.left).toBeCloseTo(geometry.conversation.left, 1);
  expect(geometry.composer.right).toBeCloseTo(geometry.conversation.right, 1);
  expect(geometry.composer.width).toBeCloseTo(geometry.viewportWidth, 1);
  expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.nav.top + 1);
  expect(geometry.nav.left).toBeCloseTo(0, 1);
  expect(geometry.nav.right).toBeCloseTo(geometry.viewportWidth, 1);
  expect(geometry.nav.bottom).toBeCloseTo(geometry.viewportHeight, 1);

  expect(geometry.sidebar.right).toBeLessThanOrEqual(0);
  expect(geometry.sidebarVisibility).toBe('hidden');
  expect(geometry.sidebarPointerEvents).toBe('none');
  expect(geometry.members.left).toBeGreaterThanOrEqual(geometry.viewportWidth);
  expect(geometry.membersInert).toBe(true);
  expect(geometry.membersPointerEvents).toBe('none');
}

test('keeps an ordinary connected phone transcript full-width while drawers remain transient', async ({ page }) => {
  await seedConnectedRoom(page);

  const initial = await closedGeometry(page);
  expectClosedPhoneShell(initial);

  const roomsTrigger = page.getByRole('button', { name: 'Open Rooms', exact: true });
  await roomsTrigger.focus();
  await roomsTrigger.click();
  const roomDialog = page.getByRole('dialog', { name: 'Room switcher' });
  const roomDrawer = page.locator('.shell-sidebar');
  await expect(roomDialog).toBeVisible();
  await expect(roomDialog.getByRole('button', { name: 'Close switcher' })).toBeFocused();
  await expect(roomDrawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const roomOpen = await roomDrawer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      pointerEvents: getComputedStyle(element).pointerEvents,
      visibility: getComputedStyle(element).visibility,
    };
  });
  expect(roomOpen.left).toBeCloseTo(0, 1);
  expect(roomOpen.right).toBeGreaterThan(0);
  expect(roomOpen.right).toBeLessThanOrEqual(390);
  expect(roomOpen.pointerEvents).toBe('auto');
  expect(roomOpen.visibility).toBe('visible');
  await page.keyboard.press('Escape');
  await expect(roomDialog).toBeHidden();
  await expect(roomsTrigger).toBeFocused();
  await expect.poll(async () => (await closedGeometry(page)).sidebar.right)
    .toBeLessThanOrEqual(0);
  expectClosedPhoneShell(await closedGeometry(page));

  const membersTrigger = page.getByTestId('ribbon-members');
  await membersTrigger.focus();
  await membersTrigger.click();
  const memberDialog = page.getByRole('dialog', { name: 'Member list for #root' });
  const memberDrawer = page.locator('.shell-members');
  await expect(memberDialog).toBeVisible();
  await expect(memberDialog.getByRole('button', { name: 'Close member list' })).toBeFocused();
  await expect(memberDrawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const membersOpen = await memberDrawer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      inert: element.hasAttribute('inert'),
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  });
  expect(membersOpen.left).toBeGreaterThanOrEqual(0);
  expect(membersOpen.right).toBeCloseTo(390, 1);
  expect(membersOpen.inert).toBe(false);
  expect(membersOpen.pointerEvents).not.toBe('none');
  await page.keyboard.press('Escape');
  await expect(memberDialog).toBeHidden();
  await expect(membersTrigger).toBeFocused();
  await expect.poll(async () => (await closedGeometry(page)).members.left)
    .toBeGreaterThanOrEqual(390);
  expectClosedPhoneShell(await closedGeometry(page));
});
