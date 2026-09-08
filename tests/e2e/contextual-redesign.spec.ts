import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { OnyxState } from '../../src/lib/store/store';
import type { ChatMessage } from '../../src/lib/irc/types';
import type { CustomTheme } from '../../src/theme/customThemes';

// Built-candidate UI evidence ONLY: fictional state, no daemon, no account
// authentication, no server echo, no notification delivery or media capture.
// Import types only. Browser code discovers the actual hashed runtime export;
// it never imports /src modules or supplies replacement component markup.
const ROOM = '#fictional-qa';
const NICK = 'fictional-qa-owner';
const LOCKED = 'QA_LOCKED_DO_NOT_DISPLAY';
const WITHDRAWN = 'QA_WITHDRAWN_DO_NOT_DISPLAY';
const QA_IMAGE_URL = 'https://qa-media.invalid/fixture.png';
type ImageFixture = { requests: string[]; allowLoad: boolean };
const CUSTOM: CustomTheme = {
  id: 'custom:fictional-qa-lilac',
  name: 'Fictional QA Lilac',
  base: 'pearl',
  overrides: { '--ink': '#eee9fa', '--lapis': '#604090' },
};
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
] as const;

type RuntimeStore = {
  getState(): OnyxState;
  setState(partial: Partial<OnyxState>): void;
};
type QaWindow = Window & {
  __contextualQa?: { store: RuntimeStore; landings: string[]; moderationCalls: string[][] };
};

test.describe('contextual redesign — fictional built-runtime fixtures', () => {
  test.setTimeout(180_000);

  test('You opens all nine phone account categories and real device preferences without submitting account changes', async ({ browser, baseURL }, info) => {
    await atWidths(browser, baseURL, info, async (page, capture) => {
      // Deliberately unsupported server fixture: no authenticator ceremony or
      // invented credential controls. Browser capability remains genuine.
      await page.evaluate(() => (window as QaWindow).__contextualQa!.store.setState({ passkeySupported: false }));
      const you = await openYou(page);
      if ((page.viewportSize()?.width ?? 1440) <= 390) {
        await phoneAccountCategories(you, capture);
      }
      await you.getByRole('navigation', { name: 'Account sections' })
        .getByRole('button', { name: 'Email', exact: true }).click();
      const email = you.getByRole('textbox', { name: 'Email address', exact: true });
      await email.fill('fictional-qa@example.invalid');
      await expect(email).toHaveValue('fictional-qa@example.invalid');
      await expect(you.getByLabel('Current password (to confirm email change)', { exact: true })).toHaveAttribute('type', 'password');
      await capture('account-email');

      // No submit: this fixture does not authenticate or claim server success.
      await you.getByRole('navigation', { name: 'You workspace' })
        .getByRole('button', { name: 'Preferences', exact: true }).click();
      const preferences = page.getByRole('dialog', { name: 'Device preferences', exact: true });
      await expect(you).toBeHidden();
      const display = preferences.getByRole('tab', { name: /^Display/ });
      await display.focus();
      await display.press('End');
      const accessibility = preferences.getByRole('tab', { name: /^Accessibility/ });
      await expect(accessibility).toBeFocused();
      await expect(accessibility).toHaveAttribute('aria-selected', 'true');
      await capture('preferences-keyboard');
      await preferences.getByRole('button', { name: 'Close preferences' }).click();
      await returnedToNavigation(page);
    });
  });

  test('Notifications changes room policy and Voice settings changes join-muted without starting a call', async ({ browser, baseURL }, info) => {
    await atWidths(browser, baseURL, info, async (page, capture) => {
      const you = await openYou(page);
      await you.getByRole('navigation', { name: 'You workspace' })
        .getByRole('button', { name: 'Notifications', exact: true }).click();
      const notifications = page.getByRole('dialog', { name: 'Notifications', exact: true });
      const modes = notifications.getByRole('radiogroup', { name: `Notifications for ${ROOM}` });
      const all = modes.getByRole('radio', { name: 'All messages', exact: true });
      await all.focus();
      await all.press('End');
      const mute = modes.getByRole('radio', { name: /^Mute/ });
      await expect(mute).toBeFocused();
      await expect(mute).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => page.evaluate((room) => (
        (window as QaWindow).__contextualQa!.store.getState().channelNotify.get(room)
      ), ROOM)).toBe('none'); // canonical persisted value behind the public Mute option
      await capture('notifications-muted');
      // Do not click Turn on alerts: browser permission/push are not fixtures.
      await notifications.getByRole('button', { name: 'Close notifications' }).click();
      await returnedToNavigation(page);

      const reopened = await openYou(page);
      await reopened.getByRole('button', { name: /^Voice devices/ }).click();
      const voice = page.getByRole('dialog', { name: 'Voice settings', exact: true });
      const joinMuted = voice.getByRole('checkbox', { name: /^Join muted/ });
      await joinMuted.check();
      await expect(joinMuted).toBeChecked();
      await expect.poll(() => page.evaluate(() => {
        const state = (window as QaWindow).__contextualQa!.store.getState().voice;
        return { muted: state.muteOnJoin, call: state.callState, stream: state.localStream === null };
      })).toEqual({ muted: true, call: 'idle', stream: true });
      await capture('voice-join-muted');
      await voice.getByRole('button', { name: 'Close voice settings' }).click();
      await expect(voice).toBeHidden();
    });
  });

  test('populated search navigates loaded matches, excludes locked text, and restores keyboard focus', async ({ browser, baseURL }, info) => {
    await atWidths(browser, baseURL, info, async (page, capture) => {
      const phone = (page.viewportSize()?.width ?? 1440) <= 390;
      const trigger = page.getByRole('button', {
        name: phone ? 'Room actions' : 'Search messages', exact: true,
      });
      if (phone) {
        // Search captures the persistent Room actions trigger, not the menu
        // item that unmounts when its popover closes.
        await expect(trigger).toBeVisible();
        await openRoomAction(page, page.getByRole('menuitem', { name: 'Search messages', exact: true })
          .and(page.getByTestId('ribbon-more-search')));
      } else {
        // Desktop retains its primary ribbon action.
        await expect(trigger).toHaveAttribute('data-testid', 'ribbon-search');
        await trigger.click();
      }
      const search = page.getByRole('search', { name: 'Message search', exact: true });
      const input = search.getByRole('searchbox', { name: 'Search messages', exact: true });
      await expect(input).toBeFocused();
      await input.fill('qa-orbit');
      await expect(search).toContainText('1 of 2');
      await search.getByRole('button', { name: 'Next match', exact: true }).click();
      await expect(search).toContainText('2 of 2');
      await expect(message(page, 'qa-match-2')).toBeInViewport();
      await capture('search-populated');
      await input.fill(LOCKED);
      await expect(search.getByRole('button', { name: 'Next match', exact: true })).toBeDisabled();
      await expect(search).toContainText('No visible matches');
      // Query text is intentionally visible in the input/status, not a result.
      await expect(search.getByRole('list', { name: 'Archived message results' })).toHaveCount(0);
      await input.press('Escape');
      await expect(search).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });

  test('populated pins and media protect withdrawn/locked text and jump to real loaded messages', async ({ browser, baseURL }, info) => {
    await atWidths(browser, baseURL, info, async (page, capture, imageFixture) => {
      await openRoomAction(page, 'ribbon-pins');
      const pins = page.getByRole('dialog', { name: 'Pinned messages', exact: true });
      await expect(pins.getByRole('list', { name: `Pinned messages in ${ROOM}` }).getByRole('listitem')).toHaveCount(3);
      await protectedTextAbsent(pins);
      await expect(pins).toContainText('[message deleted]');
      await capture('pins-protected');
      await pins.getByRole('button', { name: /Jump to pinned message.*qa-orbit/i }).click();
      await expect(pins).toBeHidden();
      await landed(page, 'qa-match-1');

      await openRoomAction(page, 'ribbon-room-media');
      const media = page.getByRole('dialog', { name: 'Pictures, files, and links', exact: true });
      for (const label of ['Pictures', 'Files', 'Links']) {
        const tab = media.getByRole('tab', { name: label, exact: true });
        await expect(tab).toBeVisible();
        // Check actual rendered text, not just the button's visibility: a
        // narrow tab can clip PICTURES while remaining fully on screen.
        await expect.poll(() => tab.evaluate((button) => {
          const range = document.createRange();
          range.selectNodeContents(button);
          const text = range.getBoundingClientRect();
          const box = button.getBoundingClientRect();
          if (text.width <= 0 || text.height <= 0) return Number.POSITIVE_INFINITY;
          return Math.max(
            button.scrollWidth - button.clientWidth,
            button.scrollHeight - button.clientHeight,
            box.left - text.left, text.right - box.right,
            box.top - text.top, text.bottom - box.bottom,
          );
        }), `${label}: full tab label must fit its button`).toBeLessThanOrEqual(1);
      }
      const jumpPicture = media.getByRole('button', { name: 'Jump to picture fictional-qa.png' });
      await scrollCurrentGalleryPicture(media, jumpPicture);
      await expect(jumpPicture).toBeVisible();
      const loadImage = media.getByRole('button', { name: 'Load external picture from qa-media.invalid', exact: true });
      await expect(media.locator('img')).toHaveCount(0);
      await expect(loadImage).toHaveCount(0);
      await capture('media-previews-off');
      await page.waitForTimeout(350);
      expect(imageFixture.requests, 'Previews off must neither fetch nor offer external Load').toEqual([]);
      await media.getByRole('button', { name: 'Close pictures, files, and links', exact: true }).click();

      // Enable the real device preference, not a store shortcut. The global
      // switch permits previews but does not grant external-item consent.
      const you = await openYou(page);
      await you.getByRole('navigation', { name: 'You workspace' })
        .getByRole('button', { name: 'Preferences', exact: true }).click();
      const preferences = page.getByRole('dialog', { name: 'Device preferences', exact: true });
      await preferences.getByRole('tab', { name: 'Conversation', exact: true }).click();
      const previews = preferences.getByRole('switch', { name: 'Preview web links', exact: true });
      await expect(previews).toHaveAttribute('aria-checked', 'false');
      await previews.click();
      await expect(previews).toHaveAttribute('aria-checked', 'true');
      await page.waitForTimeout(350);
      expect(imageFixture.requests, 'Enabling previews alone must not fetch the external image').toEqual([]);
      await preferences.getByRole('button', { name: 'Close preferences', exact: true }).click();
      await openRoomAction(page, 'ribbon-room-media');
      await scrollCurrentGalleryPicture(media, jumpPicture);
      await expect(jumpPicture).toBeVisible();
      await expect(media.locator('img')).toHaveCount(0);
      await capture('media-before-consent');
      // Negative request assertion needs an observation window after the row
      // enters the viewport, otherwise a lazy auto-fetch can escape the check.
      await page.waitForTimeout(350);
      expect(imageFixture.requests, 'No image fetch on transcript/gallery open before consent').toEqual([]);
      await expect(loadImage).toBeVisible();
      imageFixture.allowLoad = true;
      await loadImage.click();
      await expect.poll(() => imageFixture.requests).toEqual([QA_IMAGE_URL]);
      await expect.poll(() => media.locator('img').evaluateAll((images) => (
        images.some((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
      ))).toBe(true);
      const loadedImage = media.locator('img');
      const filename = media.getByText('fictional-qa.png', { exact: true });
      await expect(loadedImage).toHaveCount(1);
      await expect(filename).toBeVisible();
      await expect.poll(async () => {
        const [imageBox, nameBox] = await Promise.all([
          loadedImage.boundingBox(), filename.boundingBox(),
        ]);
        if (!imageBox || !nameBox || imageBox.width <= 0 || imageBox.height <= 0
          || nameBox.width <= 0 || nameBox.height <= 0) return false;
        return imageBox.x + imageBox.width <= nameBox.x
          || nameBox.x + nameBox.width <= imageBox.x
          || imageBox.y + imageBox.height <= nameBox.y
          || nameBox.y + nameBox.height <= imageBox.y;
      }, 'Loaded image box must not overlap its filename').toBe(true);
      await expect(media).toBeVisible();
      await expect.poll(() => page.evaluate(() => (
        (window as QaWindow).__contextualQa!.landings.includes('qa-picture')
      ))).toBe(false);
      await capture('media-explicit-load');
      await protectedTextAbsent(media);
      // Consent loads only the preview. Jump is a distinct task/action.
      await jumpPicture.click();
      await expect(media).toBeHidden();
      await landed(page, 'qa-picture');
      await openRoomAction(page, 'ribbon-room-media');
      await media.getByRole('tab', { name: 'Files', exact: true }).click();
      await expect(media.getByRole('button', { name: 'Jump to file fictional-qa.pdf' })).toBeVisible();
      await media.getByRole('tab', { name: 'Links', exact: true }).click();
      const link = media.getByRole('link').filter({ hasText: 'fictional-qa.invalid' });
      await expect(link).toHaveAttribute('href', 'https://fictional-qa.invalid/guide');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('target', '_blank');
      await protectedTextAbsent(media);
      await capture('media-links');
      // Jump locally; never open or fetch a destination as proof of content.
      await media.getByRole('button', { name: 'Jump to link fictional-qa.invalid' }).click();
      await expect(media).toBeHidden();
      await landed(page, 'qa-link');
    });
  });

  test('moderation review cannot apply a pending block after room permission is lost', async ({ browser, baseURL }, info) => {
    await atWidths(browser, baseURL, info, async (page, capture) => {
      const mobile = (page.viewportSize()?.width ?? 1440) <= 900;
      if (mobile) {
        await openRoomAction(page, 'ribbon-room-desk');
      } else {
        await page.getByTestId('ribbon-context').click();
      }
      const desk = mobile
        ? page.getByRole('dialog', { name: `Room controls for ${ROOM}`, exact: true })
        : page.getByRole('complementary', { name: 'Room context', exact: true });
      await desk.getByLabel('Block an address in this room', { exact: true }).fill('fictional-qa-reader!*@*');
      await desk.getByRole('button', { name: 'Review block', exact: true }).click();
      const review = page.getByTestId('moderation-action-review');
      const confirm = review.getByRole('button', { name: 'Block from room', exact: true });
      await expect(confirm).toBeEnabled();
      await expect.poll(() => moderationCalls(page)).toEqual([]);
      await page.evaluate(({ room, nick }) => {
        const store = (window as QaWindow).__contextualQa!.store;
        const channels = new Map(store.getState().channels);
        const channel = channels.get(room);
        if (!channel) throw new Error('Fictional QA room missing');
        const users = new Map(channel.users);
        users.set(nick, { nick, modes: new Set() });
        channels.set(room, { ...channel, users });
        store.setState({ channels });
      }, { room: ROOM, nick: NICK });
      await expect(confirm).toBeDisabled();
      await expect(review.getByRole('status')).toContainText('no longer have moderator permission');
      await capture('moderation-permission-lost');
      // Even a stale/programmatic click cannot dispatch the real ban action.
      await confirm.evaluate((button: HTMLButtonElement) => button.click());
      await expect.poll(() => moderationCalls(page)).toEqual([]);
      await review.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(review).toBeHidden();
      await expect(desk).toBeVisible();
      await expect(desk.getByRole('button', { name: 'Review block', exact: true })).toHaveCount(0);
    }, undefined, 'advanced'); // room control desk is deliberately not on Standard's path
  });

  test('Appearance selects actual Pearl and canonical custom tokens and retains the custom choice on reload', async ({ browser, baseURL }, info) => {
    await atWidths(browser, baseURL, info, async (page, capture) => {
      const you = await openYou(page);
      await you.getByRole('navigation', { name: 'You workspace' })
        .getByRole('button', { name: 'Appearance', exact: true }).click();
      const appearance = page.getByRole('dialog', { name: 'Appearance', exact: true });
      await appearance.getByTestId('appearance-advanced').locator(':scope > summary').click();
      const looks = appearance.getByRole('radiogroup', { name: 'All looks', exact: true });
      await looks.getByRole('radio', { name: 'Pearl theme', exact: true }).click();
      await expect(looks.getByRole('radio', { name: 'Pearl theme', exact: true })).toHaveAttribute('aria-checked', 'true');
      await assertTheme(page, 'pearl', '#f5f0e5');
      await capture('theme-pearl');
      await looks.getByRole('radio', { name: `${CUSTOM.name} theme`, exact: true }).click();
      await expect(looks.getByRole('radio', { name: `${CUSTOM.name} theme`, exact: true })).toHaveAttribute('aria-checked', 'true');
      await assertTheme(page, CUSTOM.id, CUSTOM.overrides['--ink']!);
      await capture('theme-custom');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await seedRuntime(page);
      await assertTheme(page, CUSTOM.id, CUSTOM.overrides['--ink']!);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('onyx:custom-themes') ?? '[]'))).toEqual([CUSTOM]);
      await capture('theme-custom-reloaded');
    }, 'onyx');
  });
});

async function atWidths(
  browser: Browser,
  baseURL: string | undefined,
  info: TestInfo,
  task: (page: Page, capture: (name: string) => Promise<void>, imageFixture: ImageFixture) => Promise<void>,
  initialTheme?: string,
  experienceMode: 'standard' | 'advanced' = 'standard',
): Promise<void> {
  if (!baseURL) throw new Error('This spec requires the built-candidate Playwright baseURL');
  info.annotations.push({ type: 'fixture', description: 'Fictional QA store in the real production bundle; no live network evidence.' });
  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      const context = await browser.newContext({
        baseURL, viewport, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'dark',
      });
      try {
        await context.addInitScript(({ custom, themeId, mode }) => {
          // Do not overwrite on reload: persistence is part of the theme case.
          if (!localStorage.getItem('onyx:custom-themes')) localStorage.setItem('onyx:custom-themes', JSON.stringify([custom]));
          if (!localStorage.getItem('onyx:theme')) localStorage.setItem('onyx:theme', themeId);
          if (!localStorage.getItem('onyx:preferences')) localStorage.setItem('onyx:preferences', JSON.stringify({
            linkPreviews: false, reduceMotion: true, experienceMode: mode,
          }));
        }, { custom: CUSTOM, themeId: initialTheme ?? (viewport.width === 1440 ? 'pearl' : CUSTOM.id), mode: experienceMode });
        const page = await context.newPage();
        // A stale semantic selector should fail locally, not consume the
        // entire three-viewport case timeout while waiting on one action.
        page.setDefaultTimeout(15_000);
        // No live data or destinations. The exact image route below is the
        // only external response and is fulfilled entirely from fixture bytes.
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url());
          return url.origin === new URL(baseURL).origin && url.pathname !== '/linkpreview'
            ? route.continue() : route.abort();
        });
        const imageFixture: ImageFixture = { requests: [], allowLoad: false };
        // Installed before boot so accidental transcript fetches also count.
        // Registered last: this exact route takes priority over the deny rule.
        await context.route(QA_IMAGE_URL, (route) => {
          imageFixture.requests.push(route.request().url());
          if (!imageFixture.allowLoad) return route.abort();
          return route.fulfill({
            status: 200,
            contentType: 'image/png',
            headers: { 'cache-control': 'no-store' },
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFeYAAAAASUVORK5CYII=', 'base64'),
          });
        });
        await page.routeWebSocket(/.*/, (socket) => socket.close());
        await page.goto('/app/', { waitUntil: 'domcontentloaded' });
        await seedRuntime(page);
        const capture = async (name: string): Promise<void> => {
          await expect.poll(() => page.evaluate(() => (
            document.documentElement.scrollWidth - document.documentElement.clientWidth
          )), `${name}: page must not widen`).toBeLessThanOrEqual(1);
          await page.screenshot({ path: info.outputPath(`${name}-${viewport.width}.png`), animations: 'disabled' });
        };
        await task(page, capture, imageFixture);
      } finally {
        await context.close();
      }
    });
  }
}

async function seedRuntime(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => '__onyx' in window)).toBe(false);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => (
    /\/assets\/runtime-[^/]+\.js$/.test(new URL(entry.name).pathname)
  )));
  await page.evaluate(async ({ room, nick, locked, withdrawn, imageUrl }) => {
    const entry = performance.getEntriesByType('resource').find((item) => (
      /\/assets\/runtime-[^/]+\.js$/.test(new URL(item.name).pathname)
    ));
    if (!entry) throw new Error('Expected a built runtime chunk, not DEV');
    const runtime = await import(entry.name) as Record<string, unknown>;
    const store = Object.values(runtime).find((value): value is RuntimeStore => (
      typeof value === 'object' && value !== null
      && typeof (value as RuntimeStore).getState === 'function'
      && typeof (value as RuntimeStore).setState === 'function'
    ));
    if (!store) throw new Error('Built runtime store export missing');
    const row = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
      id, text, target: room, from: 'fictional-qa-reader', type: 'msg',
      time: new Date('2026-09-01T12:00:00Z'), ...extra,
    });
    const messages = [
      row('qa-match-1', 'Fictional QA qa-orbit meeting: bring the map.'),
      row('qa-match-2', 'Fictional QA qa-orbit follow-up: check the landing.'),
      row('qa-picture', `[file: fictional-qa.png] 12 KB ${imageUrl}`),
      row('qa-file', '[file: fictional-qa.pdf] 12 KB https://fictional-qa.invalid/fictional-qa.pdf'),
      row('qa-link', 'Fictional QA guide https://fictional-qa.invalid/guide'),
      row('qa-locked', `ONYXDM1 ${locked} https://locked-qa.invalid/hidden`, { encrypted: true }),
      row('qa-withdrawn', `${withdrawn} https://withdrawn-qa.invalid/hidden`, { deleted: true }),
    ];
    const qa = { store, landings: [] as string[], moderationCalls: [] as string[][] };
    (window as QaWindow).__contextualQa = qa;
    const originalFocus = store.getState().focusMessage;
    const originalBan = store.getState().banMask;
    store.setState({
      status: 'connected', connectionStatus: 'connected', autoReconnect: false,
      ourNick: nick, networkName: 'Fictional QA — no network connection', client: null,
      server: { id: 'fictional-qa', name: 'Fictional QA', network: 'Fictional QA',
        url: 'wss://fictional-qa.invalid', nick, account: nick, icon: '', connected: true },
      activeView: { kind: 'channel', channel: room },
      channels: new Map([[room, {
        name: room, topic: 'Fictional QA fixtures only — not live activity', topicSetBy: nick,
        topicSetAt: null, modes: '+nt', unread: 0, highlights: 0, createdAt: null, messages,
        users: new Map([
          [nick, { nick, modes: new Set(['o']) }],
          ['fictional-qa-reader', { nick: 'fictional-qa-reader', modes: new Set() }],
        ]),
      }]]),
      channelProps: new Map([[room, { PINS: 'qa-match-1,qa-locked,qa-withdrawn' }]]),
      userProps: new Map(), dms: new Map(), notifications: [], channelNotify: new Map(),
      // Observe calls without replacing their implementation or return value.
      focusMessage(id) { qa.landings.push(id); return originalFocus(id); },
      banMask(channel, mask) { qa.moderationCalls.push([channel, mask]); return originalBan(channel, mask); },
    });
  }, { room: ROOM, nick: NICK, locked: LOCKED, withdrawn: WITHDRAWN, imageUrl: QA_IMAGE_URL });
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByRole('textbox', { name: `Message ${ROOM}`, exact: true })).toBeVisible();
}

function youTrigger(page: Page): Locator {
  return page.getByRole('button', { name: /^(Open )?You$/ });
}

async function returnedToNavigation(page: Page): Promise<void> {
  // The existing shell contract returns to Open You on phones, and to the
  // selected primary destination (or its first button) on desktop.
  if ((page.viewportSize()?.width ?? 1440) <= 900) {
    await expect(youTrigger(page)).toBeFocused();
  } else {
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true }).locator('button:focus')).toHaveCount(1);
  }
}

async function phoneAccountCategories(
  you: Locator,
  capture: (name: string) => Promise<void>,
): Promise<void> {
  const categories = [
    ['Overview', 'acct-identity'],
    ['Email', 'acct-email-title'],
    ['Password', 'acct-password-title'],
    ['Security', 'acct-two-factor-authentication-title'],
    ['Devices', 'acct-sessions-title'],
    ['Recovery', 'acct-recovery-title'],
    ['Passkeys', 'acct-passkeys-title'],
    ['Data', 'acct-download-store-title'],
    ['Session', 'acct-session-title'],
  ] as const;
  const rail = you.getByRole('navigation', { name: 'Account sections' });
  const sections = you.locator('[data-account-nav-section]');
  const visibleSections = you.locator('[data-account-nav-section]:visible');
  const back = you.getByRole('button', { name: 'Back to account sections', exact: true });
  await expect(sections).toHaveCount(categories.length);
  await expect(visibleSections).toHaveCount(0);

  for (const [label, id] of categories) {
    await test.step(`phone Account → ${label} → Back`, async () => {
      const category = rail.getByRole('button', { name: label, exact: true });
      await expect(rail).toBeVisible();
      await category.focus();
      await expect(category).toBeFocused();
      await category.press('Enter');
      const selected = you.locator(`[data-account-nav-section="${id}"]`);
      await expect(rail).toBeHidden();
      await expect(selected).toBeVisible();
      // Real computed CSS: catches BOTH a hidden selected section and an
      // over-broad reveal rule accidentally exposing all nine mounted panels.
      await expect(visibleSections).toHaveCount(1);
      for (const [, otherId] of categories) {
        if (otherId !== id) await expect(you.locator(`[data-account-nav-section="${otherId}"]`)).toBeHidden();
      }
      await expect(back).toBeFocused();
      await expect(back).toBeInViewport();

      const controls: Record<string, () => Locator> = {
        Email: () => selected.getByRole('textbox', { name: 'Email address', exact: true }),
        Password: () => selected.getByLabel('New password', { exact: true }),
        Security: () => selected.getByRole('button', { name: 'Enable two-factor', exact: true }),
        Devices: () => selected.getByRole('button', { name: 'Refresh list', exact: true }),
        Recovery: () => selected.getByLabel('Password (optional re-check)', { exact: true }),
        Data: () => selected.getByTestId('account-download-store'),
        Session: () => selected.getByRole('button', { name: 'Sign out', exact: true }),
      };
      const control = controls[label]?.();
      if (control) {
        await expect(control).toBeVisible();
        await expect(control).toBeEnabled();
        // Traverse with Tab, rather than programmatic focus that can conceal
        // an unusable task path. Do not activate remote/destructive actions.
        await back.press('Tab');
        await expect(control).toBeFocused();
        await expect(control).toBeInViewport();
      } else if (label === 'Overview') {
        await expect(selected).toContainText(NICK);
        // Overview is read-only; Back is its genuine interactive control.
      } else {
        await expect(selected.getByText(/does not (?:support passkeys|offer passkey sign-in)/)).toBeVisible();
        // Unsupported Passkeys is also read-only. Do not fake WebAuthn merely
        // to manufacture an inner control; exercise the real Back control.
      }
      await capture(`account-category-${label.toLowerCase()}`);
      await back.focus();
      await expect(back).toBeFocused();
      await back.press('Enter');
      await expect(rail).toBeVisible();
      await expect(back).toBeHidden();
      await expect(visibleSections).toHaveCount(0);
      await expect(category).toBeFocused();
      await expect(category).toBeInViewport();
    });
  }
}

async function openYou(page: Page): Promise<Locator> {
  await youTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'You', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function scrollCurrentGalleryPicture(media: Locator, jumpPicture: Locator): Promise<void> {
  await expect(media).toBeVisible();
  await expect(media.getByRole('status').filter({ hasText: 'Loading media from this device' })).toBeHidden();
  // Vault completion rebuilds indexed rows. Chrome/WebKit traces showed the
  // old row detaching during scroll stability checks after gallery reopen.
  // Retry only this non-activating scroll, resolving the current row each time.
  await expect(async () => {
    await jumpPicture.scrollIntoViewIfNeeded({ timeout: 1_000 });
    await expect(jumpPicture).toBeInViewport({ timeout: 1_000 });
  }).toPass({ timeout: 5_000, intervals: [100, 250, 500] });
}

async function openRoomAction(page: Page, action: string | Locator): Promise<void> {
  // Existing ribbon-more testid belongs to its icon span, not the button.
  await page.getByTestId('ribbon-more').locator('xpath=ancestor-or-self::button').first().click();
  await (typeof action === 'string' ? page.getByTestId(action) : action).click();
}

function message(page: Page, id: string): Locator {
  return page.locator(`[data-message-search-id="${id}"]`);
}

async function landed(page: Page, id: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as QaWindow).__contextualQa!.landings)).toContain(id);
  await expect(message(page, id)).toBeInViewport();
}

async function protectedTextAbsent(surface: Locator): Promise<void> {
  // Includes accessible names, title attributes and URL attributes, not merely
  // textContent. Sentinels are fabricated; no private material is embedded.
  const html = await surface.evaluate((element) => element.outerHTML);
  for (const forbidden of [LOCKED, WITHDRAWN, 'locked-qa.invalid', 'withdrawn-qa.invalid']) {
    expect(html).not.toContain(forbidden);
  }
}

async function moderationCalls(page: Page): Promise<string[][]> {
  return page.evaluate(() => (window as QaWindow).__contextualQa!.moderationCalls);
}

async function assertTheme(page: Page, selected: string, ink: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const root = document.documentElement;
    const computed = getComputedStyle(root);
    return {
      selected: localStorage.getItem('onyx:theme'),
      base: root.getAttribute('data-theme'),
      scheme: computed.colorScheme,
      ink: computed.getPropertyValue('--ink').trim().toLowerCase(),
    };
  })).toEqual({ selected, base: 'pearl', scheme: 'light', ink });
}
