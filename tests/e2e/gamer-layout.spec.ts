import { expect, test, type Page } from '@playwright/test';

/**
 * This is a deterministic QA fixture, not a network proof and not product
 * activity. The fixture is deliberately branded in every rendered value so a
 * screenshot or failure cannot be mistaken for live Onyx content.
 */
type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

type Viewport = {
  name: string;
  width: number;
  height: number;
};

const ROUTE_VIEWPORTS: readonly Viewport[] = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-320', width: 320, height: 640 },
];

const SHELL_VIEWPORTS: readonly Viewport[] = ROUTE_VIEWPORTS;

const QA_CHANNEL = '#root';
const QA_NICK = 'qa-layout';
const QA_LAST_MESSAGE = 'QA fixture transcript 24';

function useQaMedia(page: Page, colorScheme: 'dark' | 'light' = 'dark'): Promise<void> {
  return page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
}

async function assertReducedMotion(page: Page): Promise<void> {
  const motion = await page.evaluate(() => {
    const samples = Array.from(document.querySelectorAll<HTMLElement>(
      'button, a, input, textarea, [data-primary-nav-item], .shell, .conn-card, .home-hero',
    ));
    const durations = (value: string): number[] => value.split(',').map((part) => {
      const trimmed = part.trim();
      if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
      if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
      return 0;
    });
    return {
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionDurations: samples.flatMap((sample) => durations(getComputedStyle(sample).transitionDuration)),
      animationDurations: samples.flatMap((sample) => durations(getComputedStyle(sample).animationDuration)),
    };
  });

  expect(motion.reducedMotion).toBe(true);
  expect(motion.transitionDurations.length).toBeGreaterThan(0);
  expect(motion.animationDurations.length).toBeGreaterThan(0);
  expect(motion.transitionDurations.every((duration) => duration <= 0.01)).toBe(true);
  expect(motion.animationDurations.every((duration) => duration <= 0.01)).toBe(true);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const dimensions = (element: HTMLElement | null) => element
      ? { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
      : null;
    return {
      viewportWidth: window.innerWidth,
      root: dimensions(document.documentElement),
      body: dimensions(document.body),
      main: dimensions(document.querySelector<HTMLElement>('main')),
      home: dimensions(document.querySelector<HTMLElement>('.home')),
      shell: dimensions(document.querySelector<HTMLElement>('.shell')),
      conversation: dimensions(document.querySelector<HTMLElement>('.shell-conversation')),
      feed: dimensions(document.querySelector<HTMLElement>('.shell-feed')),
      composer: dimensions(document.querySelector<HTMLElement>('.shell-composer')),
    };
  });

  for (const [name, dimensions] of Object.entries(geometry)) {
    if (name === 'viewportWidth' || !dimensions || typeof dimensions === 'number') continue;
    expect(dimensions.scrollWidth, `${name} overflow`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
}

async function findRuntimeStore(page: Page): Promise<void> {
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => (
    /\/assets\/runtime-[^/]+\.js$/.test(new URL(entry.name).pathname)
  )));

  await page.evaluate(async ({ channel, nick }) => {
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

    const users = new Map([
      [nick, { nick, modes: new Set(['q']) }],
      ['qa-moderator', { nick: 'qa-moderator', modes: new Set(['o']) }],
      ['qa-reader', { nick: 'qa-reader', modes: new Set() }],
      ['qa-newcomer', { nick: 'qa-newcomer', modes: new Set() }],
    ]);
    const messages = Array.from({ length: 24 }, (_, index) => ({
      id: `gamer-layout-qa-${index + 1}`,
      time: new Date(1_786_650_000_000 + index * 60_000),
      from: index % 2 === 0 ? 'qa-moderator' : 'qa-reader',
      text: `QA fixture transcript ${index + 1}: responsive shell geometry stays readable at this breakpoint.`,
      type: 'msg',
      target: channel,
    }));

    store.setState({
      status: 'connected',
      connectionStatus: 'connected',
      autoReconnect: false,
      ourNick: nick,
      networkName: 'Onyx QA fixture',
      server: {
        id: 'gamer-layout-qa',
        name: 'Onyx QA fixture',
        network: 'Onyx QA fixture',
        url: 'wss://gamer-layout-qa.invalid',
        icon: '',
        nick,
        account: nick,
        connected: true,
      },
      activeView: { kind: 'channel', channel },
      channels: new Map([[channel, {
        name: channel,
        topic: 'QA fixture layout geometry only',
        topicSetBy: 'qa-fixture',
        topicSetAt: null,
        modes: '+nt',
        users,
        unread: 0,
        highlights: 0,
        createdAt: null,
        messages,
      }]]),
      dms: new Map(),
      channelProps: new Map(),
      userProps: new Map(),
    });
  }, { channel: QA_CHANNEL, nick: QA_NICK });
}

async function seedConnectedShell(
  page: Page,
  viewport: Viewport,
  options: { highZoom?: boolean; themeId?: 'pearl' | 'frost' } = {},
): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await useQaMedia(page, options.themeId ? 'light' : 'dark');
  if (options.themeId) {
    // ThemeProvider's persisted preference is the source of truth; media
    // emulation alone must not be mistaken for an active light palette.
    await page.addInitScript(({ themeId }) => {
      localStorage.setItem('onyx:theme', themeId);
    }, { themeId: options.themeId });
  }
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await findRuntimeStore(page);

  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByRole('log', { name: 'Message history' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: `Message ${QA_CHANNEL}` })).toBeVisible();
  await expect(page.getByText(QA_LAST_MESSAGE, { exact: false })).toBeVisible();

  if (options.highZoom) {
    // 32px root text is a deterministic stress case, not full-browser zoom.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
  }
}

async function assertConnectedShellLayout(page: Page, viewport: Viewport): Promise<void> {
  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing shell geometry element: ${selector}`);
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shell: bounds('.shell'),
      conversation: bounds('.shell-conversation'),
      feed: bounds('.shell-feed'),
      composer: bounds('.shell-composer'),
    };
  });

  expect(geometry.viewportWidth).toBe(viewport.width);
  expect(geometry.viewportHeight).toBe(viewport.height);
  expect(geometry.shell.left).toBeGreaterThanOrEqual(0);
  expect(geometry.shell.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.shell.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(geometry.conversation.width).toBeGreaterThan(0);
  expect(geometry.feed.width).toBeGreaterThan(0);
  expect(geometry.feed.left).toBeGreaterThanOrEqual(geometry.conversation.left - 1);
  expect(geometry.feed.right).toBeLessThanOrEqual(geometry.conversation.right + 1);
  expect(geometry.feed.scrollWidth).toBeLessThanOrEqual(geometry.feed.clientWidth + 1);
  expect(geometry.composer.left).toBeGreaterThanOrEqual(geometry.conversation.left - 1);
  expect(geometry.composer.right).toBeLessThanOrEqual(geometry.conversation.right + 1);
  expect(geometry.composer.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(geometry.composer.height).toBeGreaterThan(0);

  await assertNoHorizontalOverflow(page);

  const contextRail = page.locator('#shell-context-rail');
  if (await contextRail.count()) {
    await expect(contextRail).toHaveAttribute('data-open', 'false');
    await expect(contextRail).toHaveAttribute('aria-hidden', 'true');
    await expect(contextRail).toHaveAttribute('inert', '');
  }
}

async function assertShellNavigationKeyboard(page: Page, mobile: boolean): Promise<void> {
  const nav = page.locator(
    `nav[data-primary-navigation][data-primary-navigation-variant="${mobile ? 'mobile' : 'desktop'}"]`,
  );
  await expect(nav).toBeVisible();
  const buttons = nav.locator('button[data-primary-nav-item]');
  await expect(buttons).toHaveCount(5);

  const sections = await buttons.evaluateAll((elements) => elements.map((element) => (
    element.getAttribute('data-section')
  )));
  expect(sections).toEqual(['home', 'rooms', 'messages', 'calls', 'you']);

  const geometry = await nav.evaluate((element) => {
    const navRect = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll<HTMLElement>('button[data-primary-nav-item]')).map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        navTop: navRect.top,
        navBottom: navRect.bottom,
      };
    });
  });
  for (const button of geometry) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.top).toBeGreaterThanOrEqual(button.navTop - 1);
    expect(button.bottom).toBeLessThanOrEqual(button.navBottom + 1);
  }

  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    await button.focus();
    await expect(button).toBeFocused();
  }
}

async function assertPhoneRibbonIdentityAndLabels(page: Page): Promise<void> {
  const roomIdentity = page.getByTestId('ribbon-copy-name');
  const callLabel = page.locator('.shell-ribbon-call .shell-ribbon-action-label');
  const peopleLabel = page.locator('.shell-ribbon-members .shell-ribbon-action-label');
  await expect(roomIdentity).toBeVisible();
  await expect(roomIdentity).toContainText('root');
  await expect(callLabel).toHaveText('Call');
  await expect(peopleLabel).toHaveText('People');

  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing phone ribbon element: ${selector}`);
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const room = bounds('[data-testid="ribbon-copy-name"]');
    const call = bounds('.shell-ribbon-call');
    const people = bounds('.shell-ribbon-members');
    const callText = bounds('.shell-ribbon-call .shell-ribbon-action-label');
    const peopleText = bounds('.shell-ribbon-members .shell-ribbon-action-label');
    const labelsVerticallyOverlap = callText.bottom > peopleText.top && peopleText.bottom > callText.top;
    return {
      ribbon: bounds('.shell-ribbon'),
      room,
      call,
      people,
      callText,
      peopleText,
      labelsIntersect: labelsVerticallyOverlap
        && callText.right > peopleText.left
        && peopleText.right > callText.left,
    };
  });

  expect(geometry.room.width).toBeGreaterThan(0);
  expect(geometry.room.height).toBeGreaterThan(0);
  expect(geometry.room.left).toBeGreaterThanOrEqual(geometry.ribbon.left);
  expect(geometry.room.right).toBeLessThanOrEqual(geometry.ribbon.right + 1);
  expect(geometry.room.scrollWidth).toBeLessThanOrEqual(geometry.room.clientWidth + 1);
  for (const control of [geometry.call, geometry.people]) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
  }
  for (const [label, control] of [
    [geometry.callText, geometry.call],
    [geometry.peopleText, geometry.people],
  ] as const) {
    expect(label.width, 'ribbon label width').toBeGreaterThan(0);
    expect(label.height, 'ribbon label height').toBeGreaterThan(0);
    expect(label.left).toBeGreaterThanOrEqual(control.left - 1);
    expect(label.right).toBeLessThanOrEqual(control.right + 1);
    expect(label.top).toBeGreaterThanOrEqual(control.top - 1);
    expect(label.bottom).toBeLessThanOrEqual(control.bottom + 1);
  }
  expect(geometry.labelsIntersect).toBe(false);
}

async function exerciseMobileDrawers(page: Page, viewport: Viewport): Promise<void> {
  const nav = page.locator('nav[data-primary-navigation-variant="mobile"]');
  const rooms = nav.getByRole('button', { name: 'Open Rooms', exact: true });
  const peopleDrawer = page.locator('.shell-members[role="dialog"]');
  await expect(peopleDrawer).toHaveAttribute('aria-hidden', 'true');
  await expect(peopleDrawer).toHaveAttribute('inert', '');
  await rooms.focus();
  await page.keyboard.press('Enter');

  const roomDialog = page.getByRole('dialog', { name: 'Room switcher', exact: true });
  const roomDrawer = page.locator('.shell-sidebar');
  await expect(roomDialog).toBeVisible();
  await expect(roomDialog.getByRole('button', { name: 'Close switcher', exact: true })).toBeFocused();
  const openRoomGeometry = await roomDrawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      visibility: getComputedStyle(element).visibility,
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  });
  expect(openRoomGeometry.left).toBeGreaterThanOrEqual(0);
  expect(openRoomGeometry.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(openRoomGeometry.right).toBeGreaterThan(0);
  expect(openRoomGeometry.visibility).toBe('visible');
  expect(openRoomGeometry.pointerEvents).not.toBe('none');
  await assertNoHorizontalOverflow(page);

  await page.keyboard.press('Escape');
  await expect(roomDialog).toBeHidden();
  await expect(rooms).toBeFocused();
  const closedRoomGeometry = await roomDrawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      right: rect.right,
      visibility: getComputedStyle(element).visibility,
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  });
  // WebKit DPR 2 measured a persistent 0.09375px edge after the transform
  // settled; allow the same 1px precision tolerance as other geometry checks.
  expect(closedRoomGeometry.right).toBeLessThanOrEqual(1);
  expect(closedRoomGeometry.visibility).toBe('hidden');
  expect(closedRoomGeometry.pointerEvents).toBe('none');

  const people = page.getByTestId('ribbon-members');
  await people.focus();
  await page.keyboard.press('Enter');
  await expect(peopleDrawer).toBeVisible();
  await expect(peopleDrawer.getByRole('button', { name: 'Close member list', exact: true })).toBeFocused();
  const openPeopleGeometry = await peopleDrawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const roster = element.querySelector<HTMLElement>('.shell-members-scroll');
    if (!roster) throw new Error('People drawer roster scrollport was not rendered.');
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      rosterWidth: roster.clientWidth,
      rosterScrollWidth: roster.scrollWidth,
      modal: element.getAttribute('aria-modal'),
    };
  });
  expect(openPeopleGeometry.left).toBeGreaterThanOrEqual(0);
  expect(openPeopleGeometry.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(openPeopleGeometry.width).toBeGreaterThan(0);
  expect(openPeopleGeometry.rosterScrollWidth).toBeLessThanOrEqual(openPeopleGeometry.rosterWidth + 1);
  expect(openPeopleGeometry.modal).toBe('true');
  await assertNoHorizontalOverflow(page);

  await page.keyboard.press('Escape');
  await expect(people).toBeFocused();
  await expect(peopleDrawer).toHaveAttribute('aria-hidden', 'true');
  await expect(peopleDrawer).toHaveAttribute('inert', '');
  const closedPeopleGeometry = await peopleDrawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  });
  expect(closedPeopleGeometry.left).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(closedPeopleGeometry.pointerEvents).toBe('none');
}

async function navigateHome(page: Page, mobile: boolean): Promise<void> {
  const nav = page.locator(
    `nav[data-primary-navigation][data-primary-navigation-variant="${mobile ? 'mobile' : 'desktop'}"]`,
  );
  const home = nav.getByRole('button', { name: mobile ? 'Open Home' : 'Home', exact: true });
  await home.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main', { name: 'Home', exact: true })).toBeVisible();
  await expect(home).toHaveAttribute('aria-current', 'page');
  await assertNoHorizontalOverflow(page);
}

async function navigateCalls(page: Page, mobile: boolean): Promise<void> {
  const nav = page.locator(
    `nav[data-primary-navigation][data-primary-navigation-variant="${mobile ? 'mobile' : 'desktop'}"]`,
  );
  const calls = nav.getByRole('button', { name: mobile ? 'Open Calls' : 'Calls', exact: true });
  await calls.focus();
  await page.keyboard.press('Enter');
  const hub = page.locator('.shell-calls-hub');
  await expect(hub).toBeVisible();
  await expect(hub.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(calls).toHaveAttribute('aria-current', 'page');
  await assertNoHorizontalOverflow(page);
}

test.describe('gamer redesign browser QA', () => {
  test('keeps the real landing surface inside desktop and phone viewports', async ({ page }, testInfo) => {
    for (const viewport of ROUTE_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await useQaMedia(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const main = page.getByRole('main', { name: 'Onyx home', exact: true });
      await expect(main).toBeVisible();
      await expect(main.locator('#hero-heading')).toHaveText('Good company. Great nights.');
      await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
      const heroOpen = main.locator('a.home-cta-primary');
      await expect(heroOpen).toHaveCount(1);
      await expect(heroOpen).toHaveText('Open Onyx');
      await expect(heroOpen).toHaveAttribute('href', '/app/');
      await assertReducedMotion(page);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`landing-${viewport.name}.png`),
        fullPage: false,
      });
    }
  });

  test('keeps the real connect door actionable inside desktop and phone viewports', async ({ page }, testInfo) => {
    for (const viewport of ROUTE_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await useQaMedia(page);
      await page.goto('/app/', { waitUntil: 'domcontentloaded' });

      const connect = page.getByTestId('connect-screen');
      const stage = page.locator('.conn-stage[role="main"]');
      const context = stage.locator('.conn-context');
      const card = stage.locator('.conn-card');
      const form = page.getByRole('form', { name: 'Connect form', exact: true });
      const submit = page.getByTestId('conn-submit');
      await expect(connect).toBeVisible();
      await expect(stage).toHaveCount(1);
      await expect(context).toHaveCount(1);
      await expect(card).toHaveCount(1);
      const composition = await stage.evaluate((element) => {
        const destination = element.querySelector('.conn-context');
        const formCard = element.querySelector('.conn-card');
        return {
          mainCount: document.querySelectorAll('[role="main"]').length,
          destinationInMain: destination !== null,
          formInMain: formCard !== null,
          destinationBeforeForm: destination !== null
            && formCard !== null
            && Boolean(destination.compareDocumentPosition(formCard) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      });
      expect(composition).toEqual({
        mainCount: 1,
        destinationInMain: true,
        formInMain: true,
        destinationBeforeForm: true,
      });
      if (viewport.width <= 672) await expect(card).toHaveCSS('min-height', '0px');
      await expect(form).toBeVisible();
      await expect(page.locator('#conn-nick')).toBeVisible();
      await expect(page.locator('#conn-room')).toBeVisible();
      await expect(submit).toBeVisible();
      const signIn = page.getByTestId('conn-mode-signin');
      const register = page.getByTestId('conn-mode-register');
      await expect(signIn).toBeVisible();
      await expect(register).toBeVisible();
      const modeGeometry = await page.locator('[data-testid="conn-mode-signin"], [data-testid="conn-mode-register"]')
        .evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }));
      for (const modeButton of modeGeometry) {
        expect(modeButton.width).toBeGreaterThanOrEqual(44);
        expect(modeButton.height).toBeGreaterThanOrEqual(44);
      }
      await signIn.focus();
      await expect(signIn).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(connect).toHaveAttribute('data-mode', 'signin');
      await expect(stage.getByRole('heading', { level: 2, name: 'Sign in', exact: true })).toBeVisible();
      const guest = page.getByTestId('conn-mode-guest');
      await guest.focus();
      await expect(guest).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(connect).toHaveAttribute('data-mode', 'guest');
      await assertReducedMotion(page);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`connect-${viewport.name}.png`),
        fullPage: false,
      });

      await submit.scrollIntoViewIfNeeded();
      const submitBox = await submit.boundingBox();
      expect(submitBox).not.toBeNull();
      expect(submitBox!.y).toBeGreaterThanOrEqual(0);
      expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(viewport.height);
      expect(submitBox!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps the seeded shell, phone drawers, and Home/Calls actions real at four viewport widths', async ({ page }, testInfo) => {
    for (const viewport of SHELL_VIEWPORTS) {
      const mobile = viewport.width <= 900;
      await seedConnectedShell(page, viewport);
      await assertConnectedShellLayout(page, viewport);
      await assertReducedMotion(page);
      await assertShellNavigationKeyboard(page, mobile);
      if (mobile) await assertPhoneRibbonIdentityAndLabels(page);
      await page.screenshot({
        path: testInfo.outputPath(`shell-${viewport.name}.png`),
        fullPage: false,
      });

      if (mobile) await exerciseMobileDrawers(page, viewport);
      await navigateHome(page, mobile);
      await page.screenshot({
        path: testInfo.outputPath(`home-${viewport.name}.png`),
        fullPage: false,
      });
      await navigateCalls(page, mobile);
      await page.screenshot({
        path: testInfo.outputPath(`calls-${viewport.name}.png`),
        fullPage: false,
      });
    }
  });

  test('keeps the seeded shell navigable at 200% text with reduced motion and the Pearl light theme', async ({ page }, testInfo) => {
    const viewport = { name: 'phone-320-light-200-text', width: 320, height: 640 };
    await seedConnectedShell(page, viewport, { highZoom: true, themeId: 'pearl' });
    const theme = await page.evaluate(() => ({
      id: document.documentElement.getAttribute('data-theme'),
      scheme: document.documentElement.dataset.themeScheme,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
    }));
    expect(theme.id).toBe('pearl');
    expect(theme.scheme).toBe('light');
    expect(theme.rootFontSize).toBe('32px');

    await assertConnectedShellLayout(page, viewport);
    await assertReducedMotion(page);
    await assertShellNavigationKeyboard(page, true);
    await assertPhoneRibbonIdentityAndLabels(page);
    await page.screenshot({
      path: testInfo.outputPath('shell-phone-320-light-200-text.png'),
      fullPage: false,
    });

    await navigateHome(page, true);
    await page.screenshot({
      path: testInfo.outputPath('home-phone-320-light-200-text.png'),
      fullPage: false,
    });
    await navigateCalls(page, true);
    await page.screenshot({
      path: testInfo.outputPath('calls-phone-320-light-200-text.png'),
      fullPage: false,
    });
  });
});
