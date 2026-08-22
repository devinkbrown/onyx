import { test, expect, chromium, type Browser } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Rich invite e2e — the create → consume round-trip a user actually runs.
//
// A user opens a channel's "Share invite" affordance, Onyx builds a canonical
// `<origin>/invite/?join=…` link, and the recipient lands on the /invite/ route
// which renders a preview of exactly that room. Two halves, two harnesses:
//
//   • CONSUME side (static): the /invite landing route is a PURE route — it reads
//     window.location.search directly (Invite.tsx → buildInviteCard), needs no
//     store and no WS. So it runs on the production preview (baseURL :4173) with
//     the default `page` fixture, exactly like landing.spec / about.spec.
//
//   • CREATE side (connected): the "Share invite" section lives in ChannelSettings,
//     which only mounts once the app is connected and focused on a channel. That
//     requires the DEV build (window.__onyx store handle is DEV-only, src/index.tsx)
//     pinned to a live Onyx Server WS — the same self-launched full-chromium harness
//     voice.spec uses (the headless-shell binary drops the self-signed WSS). We
//     drive the real UI: open the settings gear, read the generated share link,
//     then open it in a fresh page and assert the landing preview names the room.
//
// Configure the connected half via env (defaults match voice.spec):
//   ONYX_APP  default http://localhost:5174/app/
//   ONYX_WS   default wss://127.0.0.1:7080
// ─────────────────────────────────────────────────────────────────────────────

// ── CONSUME side — static /invite landing route (preview baseURL) ────────────
test.describe('Onyx /invite landing preview (consume side)', () => {
  test('a channel invite renders that room and hands off to the app', async ({ page }) => {
    await page.goto('/invite/?join=%23general');

    // The observable success signal: the landing page names the exact room.
    await expect(page.locator('h1')).toContainText('#general');
    await expect(page.getByText(/Choose a display name to walk in/i)).toBeVisible();

    // The primary CTA deep-links into the app carrying the validated join param.
    const openCta = page.getByTestId('invite-join');
    await expect(openCta).toHaveAttribute('href', '/app/?join=%23general');
  });

  test('a rich invite preserves room, suggested name, and topic', async ({ page }) => {
    await page.goto('/invite/?join=%23design&as=river&topic=roadmap');

    await expect(page.locator('h1')).toContainText('#design');
    // Suggested guest name seats the join field; topic is the room's purpose line.
    await expect(page.getByLabel('Display name')).toHaveValue('river');
    await expect(page.getByText('roadmap').first()).toBeVisible();

    // App handoff carries every validated field so the room opens the same way.
    const openCta = page.getByTestId('invite-join');
    await expect(openCta).toHaveAttribute('href', /\/app\/\?.*join=%23design/);
    await expect(openCta).toHaveAttribute('href', /as=river/);
    await expect(openCta).toHaveAttribute('href', /topic=roadmap/);
  });

  test('a bare invite degrades to a network-only preview (no phantom room)', async ({ page }) => {
    await page.goto('/invite/');

    await expect(page.locator('h1')).toContainText('Onyx');
    // Fallback copy tells the recipient to pick a room rather than naming a fake one.
    await expect(page.getByText(/pick a room once you are in/i).first()).toBeVisible();
  });

  test('an invalid room param is rejected, not reflected (no injection)', async ({ page }) => {
    // A comma is a JOIN-list / CRLF-smuggling vector — buildInviteCard drops it,
    // so the landing route must fall back to the network-only preview.
    await page.goto('/invite/?join=%23bad%2Cevil');

    await expect(page.locator('h1')).toContainText('Onyx');
    await expect(page.locator('h1')).not.toContainText('evil');
  });

  test('no console errors while rendering an invite preview', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // Optional public chanstats 404 on preview/dev — the room card omits those rows.
      if (/Failed to load resource: the server responded with a status of 404/i.test(text)) return;
      errors.push(text);
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/invite/?join=%23general&as=river');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});

// ── CREATE side — build a real invite in-app, then consume it ────────────────
const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app/';
const WS = process.env.ONYX_WS ?? 'wss://127.0.0.1:7080';
const STORE_TIMEOUT = 25_000;
const CONNECT_TIMEOUT = 45_000;
const ONYX = '__onyx' as const;

interface OnyxStoreState {
  status: string;
  connect(opts: { url: string; nick: string }): void;
  joinChannel(channel: string): void;
  navigate(view: { kind: string; channel: string }): void;
}
interface OnyxStore {
  store?: { getState(): OnyxStoreState };
}
type WindowWithStore = Record<string, OnyxStore>;

function freshChannel(prefix: string): string {
  return `#${prefix}${Math.floor(Math.random() * 1e7).toString(36)}`;
}

/** Poll until the store reports `connected` for several consecutive samples. */
async function waitForStableConnection(page: import('@playwright/test').Page, nick: string): Promise<void> {
  const POLL_MS = 1_000;
  const NEEDED_CONSECUTIVE = 3;
  const deadline = Date.now() + CONNECT_TIMEOUT;
  let consecutive = 0;
  let lastStatus = 'unknown';
  while (Date.now() < deadline) {
    lastStatus = await page.evaluate(
      (g) => (window as unknown as WindowWithStore)[g].store?.getState().status ?? 'unknown',
      ONYX,
    );
    consecutive = lastStatus === 'connected' ? consecutive + 1 : 0;
    if (consecutive >= NEEDED_CONSECUTIVE) return;
    await page.waitForTimeout(POLL_MS);
  }
  expect(consecutive >= NEEDED_CONSECUTIVE, `${nick}: WSS connection stable (last status: ${lastStatus})`).toBe(true);
}

test.describe('invite create → consume round-trip (connected DEV build)', () => {
  // The staging WSS can drop the very first connection while the suite warms up;
  // one retry covers the rare hard flake (mirrors voice.spec). Not a bug mask —
  // waitForStableConnection still fails loudly if the transport never settles.
  test.describe.configure({ retries: 1 });

  let browser: Browser;
  test.beforeAll(async () => {
    // Full chromium (not headless-shell) holds the self-signed WSS reliably.
    browser = await chromium.launch();
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('build a rich invite via the channel settings gear; the landing route renders that room', async () => {
    test.setTimeout(120_000);
    const chan = freshChannel('inviteqa');
    const nick = 'invA' + Math.floor(Math.random() * 1e4);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      const page = await ctx.newPage();
      await page.goto(APP, { waitUntil: 'domcontentloaded' });

      // DEV-only store handle — absence means this isn't the dev build.
      await page.waitForFunction(
        (g) => !!(window as unknown as WindowWithStore)[g]?.store?.getState,
        ONYX,
        { timeout: STORE_TIMEOUT },
      );
      await page.evaluate(
        ([g, url, n]) => (window as unknown as WindowWithStore)[g].store!.getState().connect({ url, nick: n }),
        [ONYX, WS, nick] as const,
      );
      await waitForStableConnection(page, nick);

      // Enter the fresh channel so the shell mounts the ribbon + settings gear.
      await page.evaluate(
        ([g, c]) => {
          const s = (window as unknown as WindowWithStore)[g].store!.getState();
          s.joinChannel(c);
          s.navigate({ kind: 'channel', channel: c });
        },
        [ONYX, chan] as const,
      );

      // Open Channel settings from the ribbon gear (the real user affordance).
      await page.getByTestId('ribbon-more').click();
      const gear = page.getByTestId('ribbon-settings-gear');
      await expect(gear).toBeVisible({ timeout: 30_000 });
      await gear.click();
      const dialog = page.getByRole('dialog', { name: 'Room settings' });
      await expect(dialog).toBeVisible();

      // Suggest a guest name — the create-side field that flows into the link.
      await dialog.getByLabel(/Suggested guest name/i).fill('river');

      // Read the generated shareable link straight from the invite section.
      const shareValue = dialog
        .locator('section[aria-labelledby="chset-invite-heading"] .shell-chset-modes-mono')
        .first();
      await expect(shareValue).toContainText('/invite/?');
      const shareUrl = (await shareValue.innerText()).trim();
      expect(shareUrl, 'share link targets this room').toContain('join=');
      expect(shareUrl, 'share link carries the suggested name').toContain('as=river');

      // Consume the link a recipient would open: a fresh page on the landing route.
      const recipient = await ctx.newPage();
      await recipient.goto(shareUrl, { waitUntil: 'domcontentloaded' });

      // The round-trip signal: the landing preview names the exact room + guest.
      await expect(recipient.locator('h1')).toContainText(chan);
      await expect(recipient.getByLabel('Display name')).toHaveValue('river');
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
