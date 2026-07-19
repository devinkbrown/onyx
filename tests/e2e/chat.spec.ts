import { test, expect, chromium, type Browser, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Chat round-trip e2e — the single most fundamental Onyx journey:
//
//   connect → join a fresh channel → type a message in the real composer →
//   press Enter → SEE it echoed back in the message timeline.
//
// This is the flow every other feature stands on, yet the suite only exercised
// voice, invites, and the static marketing routes. Here we drive the ACTUAL UI
// (the composer textarea + the message-history log) so the assertion is exactly
// what a human observes, and we prove the SERVER round-trip — not just an
// optimistic local echo — by requiring the rendered message to leave the
// `pending` (offline-outbox) state.
//
// HARNESS (identical rationale to voice.spec / invite.spec):
//   • window.__onyx is DEV-only (src/index.tsx), so the :4173 production preview
//     has NO store handle. We drive the DEV app (:5174) to connect + join.
//   • The DEV app is pinned (VITE_IRC_WS) to a live Onyx Server WSS with a self-signed
//     cert → ignoreHTTPSErrors on every context.
//   • The default `chromium-headless-shell` drops the self-signed WSS, so we
//     self-launch the FULL chromium binary, exactly like the sibling specs.
//
// Configure via env (defaults match voice.spec / invite.spec):
//   ONYX_APP  default http://localhost:5174/app
//   ONYX_WS   default wss://127.0.0.1:7080
// ─────────────────────────────────────────────────────────────────────────────

const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app';
const WS = process.env.ONYX_WS ?? 'wss://127.0.0.1:7080';
const ONYX = '__onyx' as const;

const STORE_TIMEOUT = 25_000;
const CONNECT_TIMEOUT = 45_000;
const ECHO_TIMEOUT = 30_000; // JOIN + PRIVMSG self-echo round-trip

// ── Typed view of the store slice this spec touches ──────────────────────────
interface StoredMessage {
  from: string;
  text: string;
  plaintext?: string;
  pending?: boolean;
}
interface StoredChannel {
  messages: StoredMessage[];
}
interface OnyxStoreState {
  status: string;
  ourNick: string;
  channels: Map<string, StoredChannel>;
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
async function waitForStableConnection(page: Page, nick: string): Promise<void> {
  const POLL_MS = 1_000;
  const NEEDED_CONSECUTIVE = 3; // ~3s of uninterrupted connectivity
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

/**
 * Poll until a message with `text`, authored by `nick`, is present in the
 * channel AND has left the `pending` outbox state — for several consecutive
 * samples. A `pending` line is only the local optimistic placeholder; it
 * clearing proves the message actually round-tripped through the server and
 * came back as a confirmed line. Consecutive-sample stability guards against
 * asserting on a mid-flight frame.
 */
async function waitForConfirmedEcho(page: Page, chan: string, nick: string, text: string): Promise<void> {
  const POLL_MS = 750;
  const NEEDED_CONSECUTIVE = 2;
  const deadline = Date.now() + ECHO_TIMEOUT;
  let consecutive = 0;
  let last = 'none';
  while (Date.now() < deadline) {
    last = await page.evaluate(
      ([g, c, n, t]) => {
        const chn = (window as unknown as WindowWithStore)[g].store!.getState().channels.get(c);
        if (!chn) return 'no-channel';
        const hit = chn.messages.find((m) => (m.plaintext ?? m.text) === t && m.from === n);
        if (!hit) return 'absent';
        return hit.pending ? 'pending' : 'confirmed';
      },
      [ONYX, chan, nick, text] as const,
    );
    consecutive = last === 'confirmed' ? consecutive + 1 : 0;
    if (consecutive >= NEEDED_CONSECUTIVE) return;
    await page.waitForTimeout(POLL_MS);
  }
  expect(consecutive >= NEEDED_CONSECUTIVE, `server-confirmed echo of "${text}" from ${nick} (last state: ${last})`).toBe(true);
}

test.describe('chat round-trip (connected DEV build)', () => {
  // The staging WSS can drop the very first connection while the suite + preview
  // warm up; one retry covers the rare hard flake (mirrors voice/invite specs).
  // Not a bug mask — waitForStableConnection still fails loudly if the transport
  // never settles.
  test.describe.configure({ retries: 1 });

  let browser: Browser;
  test.beforeAll(async () => {
    // Full chromium (not headless-shell) holds the self-signed WSS reliably.
    browser = await chromium.launch();
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('connect → join a fresh channel → send via the composer → see it echoed', async () => {
    test.setTimeout(120_000);
    const chan = freshChannel('chatqa');
    const nick = 'chatA' + Math.floor(Math.random() * 1e4);
    // Unique token so the locator can never collide with join/topic/system lines.
    const body = `hello-onyx-${Math.floor(Math.random() * 1e9).toString(36)}`;
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

      // Join + focus the fresh channel so the shell mounts the message log + composer.
      await page.evaluate(
        ([g, c]) => {
          const s = (window as unknown as WindowWithStore)[g].store!.getState();
          s.joinChannel(c);
          s.navigate({ kind: 'channel', channel: c });
        },
        [ONYX, chan] as const,
      );

      // The composer textarea is labelled `Message <target>` (Composer.tsx). Its
      // presence is the observable signal that the channel view is live.
      const composer = page.getByRole('textbox', { name: `Message ${chan}` });
      await expect(composer).toBeVisible({ timeout: 30_000 });

      // Drive the REAL user action: type the message and press Enter to send.
      await composer.click();
      await composer.fill(body);
      await composer.press('Enter');

      // Composer clears on a successful send — the immediate UI acknowledgement.
      await expect(composer).toHaveValue('', { timeout: 10_000 });

      // Observable success signal #1 (what the human sees): the sent line appears
      // in the message-history log, authored by us. The article's accessible
      // label is `<from> at <time>: <text>` (messageAccessibleLabel).
      const log = page.getByRole('log', { name: 'Message history' });
      const echoed = log.getByRole('article', { name: new RegExp(`^${nick} at .*${body}`) });
      await expect(echoed).toBeVisible({ timeout: ECHO_TIMEOUT });

      // Observable success signal #2 (round-trip proof): the rendered line is a
      // server-confirmed message, not a stuck offline-outbox placeholder.
      await waitForConfirmedEcho(page, chan, nick, body);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
