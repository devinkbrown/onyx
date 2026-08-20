import { expect, test, type Page } from '@playwright/test';

// The watch-activity launcher is a connected-shell surface. Like the existing
// passkeys/invite render-path specs, this suite drives the DEV-only store handle
// without opening a socket. That keeps the regression about real AppShell
// geometry and pointer layering rather than transport availability.
const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app';
const ONYX = '__onyx' as const;
const STORE_TIMEOUT = 25_000;

interface OnyxStoreModule {
  store?: {
    setState(partial: Record<string, unknown>): void;
  };
}

type WindowWithStore = Window & Record<typeof ONYX, OnyxStoreModule> & {
  __watchBackgroundClicks?: number;
};

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

async function seedWatchRoom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('onyx:preferences', JSON.stringify({ watchTogether: true }));
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (globalName) => Boolean((window as unknown as WindowWithStore)[globalName]?.store?.setState),
    ONYX,
    { timeout: STORE_TIMEOUT },
  );

  await page.evaluate((globalName) => {
    const channel = '#watch-qa';
    const store = (window as unknown as WindowWithStore)[globalName].store!;
    store.setState({
      status: 'connected',
      connectionStatus: 'connected',
      autoReconnect: true,
      ourNick: 'modal-tester',
      networkName: 'Onyx QA',
      activeView: { kind: 'channel', channel },
      channels: new Map([[
        channel,
        {
          name: channel,
          topic: 'Modal geometry regression room',
          topicSetBy: 'server',
          topicSetAt: null,
          modes: '',
          users: new Map([['modal-tester', { nick: 'modal-tester', modes: new Set() }]]),
          unread: 0,
          highlights: 0,
          createdAt: null,
          messages: [{
            id: 'geometry-anchor',
            time: new Date('2026-07-16T12:00:00Z'),
            from: 'alice',
            text: 'Transcript anchor',
            type: 'msg',
            target: channel,
          }],
        },
      ]]),
      channelProps: new Map(),
      client: {
        isupport: { CHANTYPES: '#&' },
        binaryHandlers: new Set(),
        extraMessageHandlers: new Set(),
        publishWatchTogether: () => undefined,
      },
    });
  }, ONYX);

  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: STORE_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Start watch activity' })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Message history' })).toBeVisible();
}

async function feedBox(page: Page): Promise<Box> {
  return page.getByRole('log', { name: 'Message history' }).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  });
}

function expectSameBox(actual: Box, expected: Box): void {
  expect(actual.top).toBeCloseTo(expected.top, 1);
  expect(actual.left).toBeCloseTo(expected.left, 1);
  expect(actual.width).toBeCloseTo(expected.width, 1);
  expect(actual.height).toBeCloseTo(expected.height, 1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('.onyx-modal__dialog');
    const body = document.querySelector<HTMLElement>('.onyx-modal__body');
    const form = document.querySelector<HTMLElement>('#watch-start-editor');
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : -1,
      body: body ? body.scrollWidth - body.clientWidth : -1,
      form: form ? form.scrollWidth - form.clientWidth : -1,
    };
  });

  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.dialog).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.form).toBeLessThanOrEqual(1);
}

for (const viewport of [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
] as const) {
  test(`${viewport.label}: activity editor and review stay modal without moving the transcript`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedWatchRoom(page);

    const before = await feedBox(page);
    const launcher = page.getByRole('button', { name: 'Start watch activity' });
    await launcher.click();

    const editorDialog = page.getByRole('dialog', { name: 'Start watch activity' });
    await expect(editorDialog).toBeVisible();
    await expect(editorDialog).toHaveAttribute('aria-modal', 'true');
    expectSameBox(await feedBox(page), before);
    await expectNoHorizontalOverflow(page);

    // A real pointer hit on the obscured feed must land on the backdrop. The
    // backdrop may dismiss the modal, but the transcript itself cannot receive
    // the activation.
    const pointer = await page.getByRole('log', { name: 'Message history' }).evaluate((element) => {
      const win = window as unknown as WindowWithStore;
      win.__watchBackgroundClicks = 0;
      element.addEventListener('click', () => { win.__watchBackgroundClicks! += 1; }, { once: true });
      const rect = element.getBoundingClientRect();
      return { x: Math.max(1, rect.left + 2), y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(pointer.x, pointer.y);
    await expect(editorDialog).not.toBeVisible();
    expect(await page.evaluate(() => (window as unknown as WindowWithStore).__watchBackgroundClicks)).toBe(0);
    await expect(launcher).toBeFocused();
    expectSameBox(await feedBox(page), before);

    await launcher.click();
    await page.getByRole('textbox', { name: 'Activity title' }).fill('Movie night');
    await page.getByRole('textbox', { name: 'Media URL (optional, http or https)' }).fill(
      `https://example.test/${'unbroken-private-path-'.repeat(24)}`,
    );
    await page.getByRole('spinbutton', { name: 'Duration in seconds (optional)' }).fill('120');
    await editorDialog.getByRole('button', { name: 'Review activity' }).click();

    const reviewDialog = page.getByRole('dialog', { name: 'Review room-wide activity' });
    await expect(reviewDialog).toBeVisible();
    await expect(reviewDialog).toContainText('everyone in #watch-qa');
    await expect(reviewDialog).toContainText('only after you confirm');
    expectSameBox(await feedBox(page), before);
    await expectNoHorizontalOverflow(page);
  });
}
