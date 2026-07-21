import { expect, test, type Page } from '@playwright/test';

/**
 * Real AppShell journey for dense nicklist reflow.
 *
 * Gap: member-list-reflow.spec.ts (and related fixtures) hand-roll markup via
 * setContent with a handful of static rows. That proves CSS containment, but
 * never exercises the live MemberList reconciler, role grouping, or the shell
 * drawer/column that users actually open.
 *
 * This suite seeds a large channel roster through the production runtime store
 * (same harness as mobile-member-short-height) and asserts observable layout:
 * no overflow disaster, scrollable roster, first/last members reachable.
 */

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

type SeedUser = {
  nick: string;
  modes: string[];
  away: boolean;
};

type SeedEntry = [string, SeedUser];

const DENSE_MEMBER_COUNT = 48;
const CHANNEL = '#dense-roster';
const SELF_NICK = 'ui-qa';
const FIRST_PEER = 'peer-00';
const LAST_PEER = 'peer-46';

/** Build a mixed-role roster large enough to force vertical scroll at 400% zoom. */
function buildDenseUsers(): SeedEntry[] {
  const users: SeedEntry[] = [
    [SELF_NICK.toLowerCase(), { nick: SELF_NICK, modes: ['o'], away: false }],
  ];

  for (let i = 0; i < DENSE_MEMBER_COUNT - 1; i++) {
    const nick = `peer-${String(i).padStart(2, '0')}`;
    // Spread roles so multiple groups render (ops / voice / members) without
    // collapsing into a single short list that never needs to scroll.
    let modes: string[] = [];
    if (i < 4) modes = ['o'];
    else if (i < 10) modes = ['v'];
    // A few deliberately long nicks stress horizontal containment inside the row.
    const displayNick = i % 11 === 0
      ? `${nick}-VeryLongAccessibilityNick`
      : nick;
    users.push([
      displayNick.toLowerCase(),
      {
        nick: displayNick,
        modes,
        away: i % 7 === 0,
      },
    ]);
  }

  return users;
}

async function seedDenseChannel(page: Page, options: { highZoom?: boolean } = {}): Promise<void> {
  await page.goto('/app/');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => (
    /\/assets\/runtime-[^/]+\.js$/.test(new URL(entry.name).pathname)
  )));

  const users = buildDenseUsers();
  await page.evaluate(async ({ channel, selfNick, seeded, highZoom }) => {
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

    const usersMap = new Map(
      seeded.map(([key, user]) => [
        key,
        {
          nick: user.nick,
          modes: new Set(user.modes),
          ...(user.away ? { away: true } : {}),
        },
      ]),
    );

    // 400% text zoom is simulated the same way as mobile-member-short-height.
    if (highZoom) document.documentElement.style.fontSize = '64px';

    store.setState({
      connectionStatus: 'connected',
      status: 'connected',
      ourNick: selfNick,
      networkName: 'Onyx QA',
      channels: new Map([[
        channel.toLowerCase(),
        {
          name: channel,
          topic: 'Dense nicklist reflow room',
          topicSetBy: 'server',
          topicSetAt: null,
          modes: '',
          users: usersMap,
          unread: 0,
          highlights: 0,
          createdAt: null,
          messages: [{
            id: 'dense-anchor',
            time: new Date('2026-07-16T12:00:00Z'),
            from: selfNick,
            text: 'Dense roster anchor',
            type: 'msg',
            target: channel,
          }],
        },
      ]]),
      activeView: { kind: 'channel', channel },
      showMemberList: true,
    });
  }, {
    channel: CHANNEL,
    selfNick: SELF_NICK,
    seeded: users,
    highZoom: options.highZoom === true,
  });

  await expect(page.getByTestId('app-shell')).toBeVisible();
}

test('dense mobile nicklist stays contained, scrollable, and keyboard-reachable at 400% zoom', async ({ page, browserName }) => {
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

  await seedDenseChannel(page, { highZoom: true });

  const toggle = page.getByRole('button', { name: 'Toggle member list', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const drawer = page.locator('.shell-members[role="dialog"]');
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close member list' })).toBeFocused();

  // Count badge is user-observable proof the full dense roster landed.
  await expect(page.getByLabel(`${DENSE_MEMBER_COUNT} members`, { exact: true })).toBeVisible();

  const roster = page.getByRole('region', { name: `Channel members in ${CHANNEL}` });
  await expect(roster).toBeVisible();

  // First peer must be in the DOM (MemberList is not virtualized today — if it
  // becomes so later, this still proves the head of the roster is reachable).
  const firstMember = page.getByRole('button', {
    name: new RegExp(`Open member details for ${FIRST_PEER}`),
  });
  await expect(firstMember).toBeAttached();

  const lastMember = page.getByRole('button', {
    name: new RegExp(`Open member details for ${LAST_PEER}`),
  });
  await expect(lastMember).toBeAttached();

  const geometry = await drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const header = element.querySelector('.shell-members-head') as HTMLElement;
    const scrollElement = element.querySelector('.shell-members-scroll') as HTMLElement;
    const close = element.querySelector('.shell-members-close') as HTMLElement;
    const triggers = Array.from(
      scrollElement.querySelectorAll('.onyx-popover__trigger'),
    ) as HTMLElement[];
    const rows = Array.from(
      scrollElement.querySelectorAll('.shell-member-row'),
    ) as HTMLElement[];
    const nicks = Array.from(
      scrollElement.querySelectorAll('.shell-member-nick'),
    ) as HTMLElement[];

    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      panelLeft: rect.left,
      panelRight: rect.right,
      panelTop: rect.top,
      panelBottom: rect.bottom,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      panelClientHeight: element.clientHeight,
      panelScrollHeight: element.scrollHeight,
      headerHeight: header.getBoundingClientRect().height,
      closeRight: close.getBoundingClientRect().right,
      closeWidth: close.getBoundingClientRect().width,
      closeHeight: close.getBoundingClientRect().height,
      scrollClientWidth: scrollElement.clientWidth,
      scrollScrollWidth: scrollElement.scrollWidth,
      scrollClientHeight: scrollElement.clientHeight,
      scrollScrollHeight: scrollElement.scrollHeight,
      scrollTop: scrollElement.scrollTop,
      triggerCount: triggers.length,
      sampleTriggerHeights: triggers.slice(0, 8).map((trigger) => trigger.getBoundingClientRect().height),
      sampleRowWidths: rows.slice(0, 8).map((row) => row.getBoundingClientRect().width),
      sampleNickFontSizes: nicks.slice(0, 8).map((nick) => Number.parseFloat(getComputedStyle(nick).fontSize)),
    };
  });

  // No horizontal overflow disaster on the document or the drawer.
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.scrollScrollWidth).toBe(geometry.scrollClientWidth);
  expect(geometry.panelLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.panelRight).toBeLessThanOrEqual(320);
  expect(geometry.panelTop).toBeGreaterThanOrEqual(0);
  expect(geometry.panelBottom).toBeLessThanOrEqual(256);
  // Drawer itself must not grow past the viewport (roster scrolls inside).
  expect(geometry.panelScrollHeight).toBe(geometry.panelClientHeight);
  expect(geometry.headerHeight).toBeLessThanOrEqual(64);
  expect(geometry.closeRight).toBeLessThanOrEqual(320 - 24);
  expect(geometry.closeWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.closeHeight).toBeGreaterThanOrEqual(44);

  // Dense roster must overflow the scrollport so users can reach the tail.
  expect(geometry.triggerCount).toBe(DENSE_MEMBER_COUNT);
  expect(geometry.scrollScrollHeight).toBeGreaterThan(geometry.scrollClientHeight);
  expect(geometry.scrollClientHeight).toBeGreaterThan(0);

  for (const height of geometry.sampleTriggerHeights) {
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(60);
  }
  for (const width of geometry.sampleRowWidths) {
    expect(width).toBeLessThanOrEqual(geometry.scrollClientWidth);
  }
  for (const fontSize of geometry.sampleNickFontSizes) {
    expect(fontSize).toBeGreaterThanOrEqual(14);
    expect(fontSize).toBeLessThanOrEqual(18);
  }

  // Scroll the tail into view and prove focus stays inside the roster viewport.
  // (Programmatic .focus() does not engage :focus-visible rings — that path is
  // covered by the static member-list-reflow CSS fixture. Here we assert the
  // real-shell scroll/reachability invariant a user would notice.)
  await lastMember.evaluate((element) => {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  await lastMember.focus();
  await expect(lastMember).toBeFocused();

  const focusedGeometry = await drawer.evaluate((element) => {
    const scrollElement = element.querySelector('.shell-members-scroll') as HTMLElement;
    const focused = document.activeElement as HTMLElement;
    const focusedRect = focused.getBoundingClientRect();
    const scrollRect = scrollElement.getBoundingClientRect();
    return {
      scrollTop: scrollElement.scrollTop,
      scrollClientHeight: scrollElement.clientHeight,
      scrollScrollHeight: scrollElement.scrollHeight,
      focusedTop: focusedRect.top,
      focusedBottom: focusedRect.bottom,
      scrollTopEdge: scrollRect.top,
      scrollBottomEdge: scrollRect.bottom,
    };
  });

  expect(focusedGeometry.scrollTop).toBeGreaterThan(0);
  expect(focusedGeometry.scrollTop + focusedGeometry.scrollClientHeight)
    .toBeLessThanOrEqual(focusedGeometry.scrollScrollHeight + 1);
  expect(focusedGeometry.focusedTop).toBeGreaterThanOrEqual(focusedGeometry.scrollTopEdge - 1);
  expect(focusedGeometry.focusedBottom).toBeLessThanOrEqual(focusedGeometry.scrollBottomEdge + 1);
});

test('dense desktop nicklist column scrolls without expanding the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Short desktop height so a 48-member roster must scroll inside the column
  // rather than expanding the page or fitting entirely in the viewport.
  await page.setViewportSize({ width: 1440, height: 720 });
  await seedDenseChannel(page);

  // Desktop keeps the member column open via showMemberList (seeded true).
  const column = page.getByRole('complementary', { name: `Member list for ${CHANNEL}` });
  await expect(column).toBeVisible();
  await expect(page.getByLabel(`${DENSE_MEMBER_COUNT} members`, { exact: true })).toBeVisible();

  const roster = page.getByRole('region', { name: `Channel members in ${CHANNEL}` });
  await expect(roster).toBeVisible();

  const lastMember = page.getByRole('button', {
    name: new RegExp(`Open member details for ${LAST_PEER}`),
  });
  await expect(lastMember).toBeAttached();

  const geometry = await column.evaluate((element) => {
    const scrollElement = element.querySelector('.shell-members-scroll') as HTMLElement;
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      panelClientHeight: element.clientHeight,
      panelScrollHeight: element.scrollHeight,
      scrollClientHeight: scrollElement.clientHeight,
      scrollScrollHeight: scrollElement.scrollHeight,
      scrollClientWidth: scrollElement.clientWidth,
      scrollScrollWidth: scrollElement.scrollWidth,
      triggerCount: scrollElement.querySelectorAll('.onyx-popover__trigger').length,
    };
  });

  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
  expect(geometry.panelScrollWidth).toBe(geometry.panelClientWidth);
  expect(geometry.scrollScrollWidth).toBe(geometry.scrollClientWidth);
  expect(geometry.panelScrollHeight).toBe(geometry.panelClientHeight);
  expect(geometry.triggerCount).toBe(DENSE_MEMBER_COUNT);
  expect(geometry.scrollScrollHeight).toBeGreaterThan(geometry.scrollClientHeight);

  await lastMember.evaluate((element) => {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  await lastMember.focus();
  await expect(lastMember).toBeFocused();

  const afterScroll = await roster.evaluate((element) => ({
    scrollTop: element.scrollTop,
    focusedInRoster: element.contains(document.activeElement),
  }));
  expect(afterScroll.scrollTop).toBeGreaterThan(0);
  expect(afterScroll.focusedInRoster).toBe(true);
});
