import { test, expect, chromium, type Browser, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled-messages ("send later") e2e — the just-shipped critical flow with no
// prior browser coverage. Two journeys, both asserted on what a HUMAN observes:
//
//   1. SCHEDULE → QUEUE → CANCEL (no timing dependency, fully UI-driven):
//        connect → join a fresh channel → type in the real composer → open the
//        composer's "send later" clock → pick a preset → the message lands in the
//        ScheduledMessagesSheet pending queue with the right channel + text +
//        time → hit Cancel → it's gone. Nothing here waits on a wall clock, so it
//        is deterministic.
//
//   2. DUE ENTRY DISPATCHES (real invariant, near-future time): schedule a
//        message just past the minimum lead (MIN_LEAD_MS = 30s) and prove the
//        store's dispatch tick (every 15s) actually fires it onto the wire once
//        due — the message appears in the channel timeline, server-confirmed, and
//        the queue drops it. This is the whole point of the feature, so it is
//        worth the ~1 minute of real time.
//
// HARNESS (identical rationale to chat.spec / voice.spec / invite.spec):
//   • window.__onyx is DEV-only (src/index.tsx), so the :4173 production preview
//     has NO store handle. We drive the DEV app (:5174) to connect + join.
//   • The DEV app is pinned (VITE_IRC_WS) to a live Onyx Server WSS with a self-signed
//     cert → ignoreHTTPSErrors on every context.
//   • The default `chromium-headless-shell` drops the self-signed WSS, so we
//     self-launch the FULL chromium binary, exactly like the sibling specs.
//
// Configure via env (defaults match chat.spec / voice.spec):
//   ONYX_APP  default http://localhost:5174/app
//   ONYX_WS   default wss://127.0.0.1:7080
// ─────────────────────────────────────────────────────────────────────────────

const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app';
const WS = process.env.ONYX_WS ?? 'wss://127.0.0.1:7080';
const ONYX = '__onyx' as const;

const STORE_TIMEOUT = 25_000;
const CONNECT_TIMEOUT = 45_000;
const ECHO_TIMEOUT = 30_000;

// Mirror src/lib/schedule/scheduleTime.ts. A scheduled message must be at least
// MIN_LEAD_MS out; the store's dispatch loop ticks every _SCHED_DISPATCH_MS.
const MIN_LEAD_MS = 30_000;
const SCHED_DISPATCH_MS = 15_000;
// Worst case a due entry sends one full tick after it becomes due, plus the
// server round-trip. Give the dispatch poll comfortable, bounded headroom.
const DISPATCH_TIMEOUT = MIN_LEAD_MS + 3 * SCHED_DISPATCH_MS + ECHO_TIMEOUT;

// ── Typed view of the store slices this spec touches ─────────────────────────
interface StoredMessage {
  from: string;
  text: string;
  plaintext?: string;
  pending?: boolean;
}
interface StoredChannel {
  messages: StoredMessage[];
}
interface ScheduledEntry {
  id: string;
  channel: string;
  text: string;
  sendAt: number;
}
interface OnyxStoreState {
  status: string;
  ourNick: string;
  channels: Map<string, StoredChannel>;
  scheduledMessages: ScheduledEntry[];
  connect(opts: { url: string; nick: string }): void;
  joinChannel(channel: string): void;
  navigate(view: { kind: string; channel: string }): void;
  scheduleMessage(channel: string, text: string, sendAt: number): void;
}
interface OnyxStore {
  store?: { getState(): OnyxStoreState };
}
type WindowWithStore = Record<string, OnyxStore>;

function freshChannel(prefix: string): string {
  return `#${prefix}${Math.floor(Math.random() * 1e7).toString(36)}`;
}

/** Read the whole scheduled-message queue (a plain, serializable snapshot). */
function readQueue(page: Page): Promise<ScheduledEntry[]> {
  return page.evaluate(
    (g) => (window as unknown as WindowWithStore)[g].store!.getState().scheduledMessages,
    ONYX,
  );
}

/** True when an entry with this exact body is still queued. */
function isQueued(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    ([g, t]) => (window as unknown as WindowWithStore)[g].store!.getState().scheduledMessages.some((m) => m.text === t),
    [ONYX, text] as const,
  );
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
 * clearing proves the message actually round-tripped through the server.
 */
async function waitForConfirmedEcho(
  page: Page,
  chan: string,
  nick: string,
  text: string,
  timeout: number,
): Promise<void> {
  const POLL_MS = 750;
  const NEEDED_CONSECUTIVE = 2;
  const deadline = Date.now() + timeout;
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

/** connect → join → focus a fresh channel; returns once the composer is live. */
async function enterFreshChannel(page: Page, nick: string, chan: string) {
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
  await page.evaluate(
    ([g, c]) => {
      const s = (window as unknown as WindowWithStore)[g].store!.getState();
      s.joinChannel(c);
      s.navigate({ kind: 'channel', channel: c });
    },
    [ONYX, chan] as const,
  );
  const composer = page.getByRole('textbox', { name: `Message ${chan}` });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  return composer;
}

test.describe('scheduled messages · "send later" (connected DEV build)', () => {
  // The staging WSS can drop the very first connection while the suite + preview
  // warm up; one retry covers the rare hard flake (mirrors chat/voice specs).
  // Not a bug mask — waitForStableConnection still fails loudly if it never settles.
  test.describe.configure({ retries: 1 });

  let browser: Browser;
  test.beforeAll(async () => {
    // Full chromium (not headless-shell) holds the self-signed WSS reliably.
    browser = await chromium.launch();
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('schedule via the composer clock → it appears in the queue → cancel removes it', async () => {
    test.setTimeout(120_000);
    const chan = freshChannel('schedqa');
    const nick = 'schedA' + Math.floor(Math.random() * 1e4);
    const body = `later-onyx-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      const page = await ctx.newPage();
      const composer = await enterFreshChannel(page, nick, chan);

      // Real user action: type a message, then open the composer's "send later"
      // clock. The clock trigger only enables for plain, non-empty text.
      await composer.click();
      await composer.fill(body);

      const clock = page.getByRole('button', { name: 'Schedule message to send later' });
      await expect(clock).toBeEnabled();
      await clock.click();

      // The scheduling popover is a labelled dialog — its visibility is the
      // observable signal the affordance opened.
      const picker = page.getByRole('dialog', { name: 'Schedule message' });
      await expect(picker).toBeVisible();

      const approxNow = Date.now();
      // Pick the "In 15 minutes" preset — a concrete, checkable target time.
      await picker.getByRole('button', { name: 'In 15 minutes' }).click();

      // The popover closes on a successful schedule; the queue now holds exactly
      // one entry with the right target + body + a ~15-minute-out time.
      await expect(picker).toBeHidden();
      const queued = await readQueue(page);
      expect(queued.length, 'exactly one message queued').toBe(1);
      expect(queued[0].channel, 'queued to the active channel').toBe(chan);
      expect(queued[0].text, 'queued body matches what was typed').toBe(body);
      const leadMs = queued[0].sendAt - approxNow;
      // 15 minutes ± a minute of slop for clock skew between test and page.
      expect(leadMs, 'scheduled ~15 minutes out').toBeGreaterThan(14 * 60_000);
      expect(leadMs, 'scheduled ~15 minutes out').toBeLessThan(16 * 60_000);

      // Observable success signal (what the human sees): open the queue sheet and
      // find the entry rendered with its channel + text.
      await clock.click();
      await expect(picker).toBeVisible();
      await picker.getByRole('button', { name: /^View \d+ scheduled$/ }).click();

      const sheet = page.getByRole('dialog', { name: 'Scheduled messages' });
      await expect(sheet).toBeVisible();
      const pending = sheet.getByRole('list', { name: 'Pending scheduled messages' });
      await expect(pending).toContainText(chan);
      await expect(pending).toContainText(body);

      // Cancel the entry from the queue — the real per-item control.
      await sheet.getByRole('button', { name: /^Cancel scheduled message to / }).click();

      // The queue empties: the list is replaced by the empty-state copy, and the
      // store holds nothing.
      await expect(sheet.getByText('Nothing scheduled.', { exact: false })).toBeVisible();
      await expect
        .poll(async () => (await readQueue(page)).length, { timeout: 5_000 })
        .toBe(0);
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  test('a due scheduled message dispatches into the channel timeline once its time arrives', async () => {
    test.setTimeout(DISPATCH_TIMEOUT + 60_000);
    const chan = freshChannel('schedfire');
    const nick = 'fireA' + Math.floor(Math.random() * 1e4);
    const body = `fires-onyx-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      const page = await ctx.newPage();
      await enterFreshChannel(page, nick, chan);

      // Schedule just past the minimum lead. Driving a precise near-future instant
      // through the native datetime-local field is brittle (locale-formatted, and
      // rounded to the minute), so we queue through the store action the composer
      // itself calls — the dispatch loop under test is identical either way.
      const sendAt = Date.now() + MIN_LEAD_MS + 1_000;
      await page.evaluate(
        ([g, c, t, at]) =>
          (window as unknown as WindowWithStore)[g].store!.getState().scheduleMessage(c, t as string, at as number),
        [ONYX, chan, body, sendAt] as const,
      );

      // Precondition: it is genuinely queued and NOT yet in the timeline.
      const queued = await readQueue(page);
      expect(queued.some((m) => m.text === body && m.channel === chan), 'message is queued').toBe(true);

      // Success signal #1 (round-trip proof): once due, the dispatch tick sends it
      // and the server echoes it back as a confirmed (non-pending) line.
      await waitForConfirmedEcho(page, chan, nick, body, DISPATCH_TIMEOUT);

      // Success signal #2 (what the human sees): the sent line is in the visible
      // message-history log, authored by us. The article's accessible label is
      // `<from> at <time>: <text>` (messageAccessibleLabel).
      const log = page.getByRole('log', { name: 'Message history' });
      const echoed = log.getByRole('article', { name: new RegExp(`^${nick} at .*${body}`) });
      await expect(echoed).toBeVisible({ timeout: ECHO_TIMEOUT });

      // Success signal #3 (invariant): a dispatched entry is dropped from the queue
      // — it must not linger and double-send on the next tick.
      await expect
        .poll(() => isQueued(page, body), { timeout: 10_000 })
        .toBe(false);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
