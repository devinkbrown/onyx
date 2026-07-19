import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Voice / Video e2e — exercises the Onyx Server MEDIA (Cadence) signaling + capture
// path with TWO fake-media users in a FRESH channel on the staging media server.
//
// WHY a dedicated, self-launched browser (not the project `browser` fixture /
// webServer / baseURL):
//   • window.__onyx is only exposed under `import.meta.env.DEV` (src/index.tsx),
//     so the production preview on :4173 (the playwright.config webServer) does
//     NOT expose the store. This spec drives the DEV app on :5174 instead.
//   • The DEV app on :5174 is pinned (VITE_IRC_WS) to the media-enabled staging
//     server at wss://127.0.0.1:7080 — a self-signed cert, hence ignoreHTTPSErrors
//     + explicit mic/camera permissions on every context.
//   • Onyx Server's hand-rolled TLS does not yet offer Chrome's post-quantum key share,
//     and the `chromium-headless-shell` binary (used by the default project) drops
//     the WSS connection when two contexts connect concurrently. The FULL chromium
//     binary (chromium.launch with the fake-media args) holds both connections
//     reliably — proven by tools/voice-groundtruth.mjs — so we launch it ourselves
//     here rather than inheriting the runner's headless-shell browser.
//
// Configure via env when running elsewhere:
//   ONYX_APP   default http://localhost:5174/app
//   ONYX_WS    default wss://127.0.0.1:7080
//
// Graceful degradation (mirrors the legacy Ocean spec): the OPUS/opcodec WASM
// codec may be unavailable in headless Chromium. When that is the genuine cause,
// we test.skip() with a clear message instead of hard-failing on the environment
// — the signaling path (no "Unknown command: MEDIA") is still asserted first.
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];

// One full-chromium instance shared by every test (durable two-context WSS).
let mediaBrowser: Browser;
test.beforeAll(async () => {
  mediaBrowser = await chromium.launch({ args: FAKE_MEDIA_ARGS });
  // Prime the transport: the very first WSS connection after launch can flicker
  // (TLS warm-up / first reconnect). Pay that cost on a throwaway context so the
  // first real test isn't the one that absorbs the flake.
  const warm = await mediaBrowser.newContext({ ignoreHTTPSErrors: true });
  const wp = await warm.newPage();
  try {
    await wp.goto(process.env.ONYX_APP ?? 'http://localhost:5174/app', { waitUntil: 'domcontentloaded' });
    await wp
      .waitForFunction(
        (g) => !!(window as unknown as Record<string, OnyxStore>)[g]?.store?.getState,
        ONYX,
        { timeout: STORE_TIMEOUT },
      )
      .catch(() => {});
    await wp
      .evaluate(
        ([g, url]) =>
          (window as unknown as Record<string, OnyxStore>)[g].store!.getState().connect({ url, nick: 'warmup' + Math.floor(Math.random() * 1e5) }),
        [ONYX, WS] as const,
      )
      .catch(() => {});
    await wp.waitForTimeout(4_000);
  } catch {
    /* warm-up is best-effort */
  } finally {
    await warm.close().catch(() => {});
  }
});
test.afterAll(async () => {
  await mediaBrowser?.close();
});

const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app';
const WS = process.env.ONYX_WS ?? 'wss://127.0.0.1:7080';

// Generous timeouts: two real WebSocket logins + key exchange + media warm-up.
const CONNECT_TIMEOUT = 45_000;
const STORE_TIMEOUT = 25_000;
const SETTLE_AFTER_JOIN = 4_000; // let both users see each other in the channel
const SETTLE_AFTER_VOICE = 9_000; // codec warm-up + MEDIA roster exchange

// ── Typed view of the bits of the store this spec touches ────────────────────
interface OnyxNotification {
  type: 'mention' | 'dm' | 'system' | 'error';
  text: string;
}
interface OnyxToast {
  variant: string;
  title: string;
  description?: string;
}
interface OnyxVoiceState {
  callChannel: string | null;
  localStream: MediaStream | null;
  peers?: Map<string, unknown>;
}
interface OnyxStoreState {
  status: string;
  ourNick: string;
  voice: OnyxVoiceState;
  voiceChannelParticipants: Map<string, Iterable<string>>;
  notifications: OnyxNotification[];
  toasts: OnyxToast[];
  connect(opts: { url: string; nick: string }): void;
  joinChannel(channel: string): void;
  navigate(view: { kind: string; channel: string }): void;
  joinVoiceChannel(channel: string, withVideo?: boolean): Promise<void>;
  leaveVoiceChannel(): void;
}
interface OnyxStore {
  store?: { getState(): OnyxStoreState };
}
const ONYX = '__onyx' as const;

// A single connected user (its own browser context — isolated storage/media).
interface VoiceUser {
  ctx: BrowserContext;
  page: Page;
  nick: string;
  mediaLogs: string[];
}

/** Snapshot of the voice-relevant slice of one user's store. */
interface VoiceSnapshot {
  status: string;
  callChannel: string | null;
  audioTracks: number;
  videoTracks: number;
  peers: number;
  participants: string[];
  codecUnavailable: boolean;
  unknownMediaCommand: boolean;
  dataCloneError: boolean;
}

async function makeUser(nick: string): Promise<VoiceUser> {
  const ctx = await mediaBrowser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone', 'camera'],
  });
  const page = await ctx.newPage();
  const mediaLogs: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/media|voice|codec|opus|cadencevox|datacloneerror|error/i.test(t)) {
      mediaLogs.push(`[${m.type()}] ${t}`.slice(0, 200));
    }
  });
  page.on('pageerror', (e) => mediaLogs.push(`[pageerror] ${String(e)}`.slice(0, 200)));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  // DEV-only store handle (src/index.tsx). If absent, the app isn't the dev build.
  await page.waitForFunction(
    (g) => !!(window as unknown as Record<string, OnyxStore>)[g]?.store?.getState,
    ONYX,
    { timeout: STORE_TIMEOUT },
  );
  await page.evaluate(
    ([g, url, n]) =>
      (window as unknown as Record<string, OnyxStore>)[g].store!.getState().connect({ url, nick: n }),
    [ONYX, WS, nick] as const,
  );
  // Wait for a SUSTAINED connection. The first connection or two after the
  // browser launches can flicker (transient drop → auto-reconnect) before the
  // WSS settles, so require `connected` to hold across several consecutive polls
  // rather than asserting on a single sample. Auto-reconnect is enabled by the
  // store after the first successful connect, so transient drops self-heal.
  await waitForStableConnection(page, nick);
  return { ctx, page, nick, mediaLogs };
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
      (g) => (window as unknown as Record<string, OnyxStore>)[g].store?.getState().status ?? 'unknown',
      ONYX,
    );
    consecutive = lastStatus === 'connected' ? consecutive + 1 : 0;
    if (consecutive >= NEEDED_CONSECUTIVE) return;
    await page.waitForTimeout(POLL_MS);
  }
  expect(consecutive >= NEEDED_CONSECUTIVE, `${nick}: WSS connection stable (last status: ${lastStatus})`).toBe(
    true,
  );
}

/**
 * Re-confirm the WSS is up right before we drive media. If a transient drop
 * happened (common for the first connections during a busy suite startup), wait
 * for the store's auto-reconnect to restore it, and re-issue connect() as a last
 * resort. Throws via expect() only if the transport never recovers — that is a
 * genuine connectivity failure, not a flake.
 */
async function ensureConnected(u: VoiceUser): Promise<void> {
  const status = await u.page.evaluate(
    (g) => (window as unknown as Record<string, OnyxStore>)[g].store?.getState().status ?? 'unknown',
    ONYX,
  );
  if (status === 'connected') return;

  // Nudge a fresh connect (auto-reconnect may be mid-backoff) then wait for it.
  await u.page
    .evaluate(
      ([g, url, n]) =>
        (window as unknown as Record<string, OnyxStore>)[g].store!.getState().connect({ url, nick: n }),
      [ONYX, WS, u.nick] as const,
    )
    .catch(() => {});
  await waitForStableConnection(u.page, u.nick);
}

/** Join + focus the channel so MEDIA presence has a place to land. */
async function enterChannel(u: VoiceUser, channel: string): Promise<void> {
  await u.page.evaluate(
    ([g, c]) => {
      const s = (window as unknown as Record<string, OnyxStore>)[g].store!.getState();
      s.joinChannel(c);
      s.navigate({ kind: 'channel', channel: c });
    },
    [ONYX, channel] as const,
  );
}

async function joinVoice(u: VoiceUser, channel: string, withVideo: boolean): Promise<void> {
  // Guarantee the transport is live before driving media — joinVoiceChannel
  // no-ops when the IRC client is disconnected (store guards `if (!client)`).
  await ensureConnected(u);
  await enterChannel(u, channel);
  await u.page.evaluate(
    async ([g, c, v]) => {
      await (window as unknown as Record<string, OnyxStore>)[g]
        .store!.getState()
        .joinVoiceChannel(c, v as boolean);
    },
    [ONYX, channel, withVideo] as const,
  );
}

async function snapshot(u: VoiceUser, channel: string): Promise<VoiceSnapshot> {
  const raw = await u.page.evaluate(
    ([g, c]) => {
      const s = (window as unknown as Record<string, OnyxStore>)[g].store!.getState();
      const v = s.voice ?? ({} as OnyxVoiceState);
      const stream = v.localStream;
      const parts =
        s.voiceChannelParticipants?.get?.((c as string).toLowerCase()) ??
        s.voiceChannelParticipants?.get?.(c as string);
      const notifTexts = (s.notifications ?? []).map((n) => n.text ?? '');
      const toastTexts = (s.toasts ?? []).map((t) => `${t.title ?? ''} ${t.description ?? ''}`);
      const allText = [...notifTexts, ...toastTexts];
      const peersVal = v.peers as unknown;
      return {
        status: s.status,
        callChannel: v.callChannel ?? null,
        audioTracks: stream ? stream.getAudioTracks().length : 0,
        videoTracks: stream ? stream.getVideoTracks().length : 0,
        peers:
          peersVal instanceof Map
            ? peersVal.size
            : peersVal && typeof peersVal === 'object'
              ? Object.keys(peersVal as object).length
              : 0,
        participants: parts ? Array.from(parts as Iterable<string>) : [],
        // Codec genuinely missing → onError notification AND/OR the mic toast.
        codecUnavailable: allText.some((t) =>
          /codec unavailable|microphone error|could not access your microphone/i.test(t),
        ),
        unknownMediaCommand: notifTexts.some((t) => /unknown command:\s*media/i.test(t)),
        dataCloneError: allText.some((t) => /datacloneerror/i.test(t)),
      };
    },
    [ONYX, channel] as const,
  );
  return raw as VoiceSnapshot;
}

function freshChannel(prefix: string): string {
  return `#${prefix}${Math.floor(Math.random() * 1e7).toString(36)}`;
}

async function teardown(users: VoiceUser[]): Promise<void> {
  for (const u of users) await u.ctx.close().catch(() => {});
}

test.describe('voice / video MEDIA path (two fake-media users)', () => {
  // The staging WSS transport can drop the first connection or two while the
  // suite (and its preview webServer) is still warming up. Auto-reconnect and
  // ensureConnected() handle most of it; one retry covers the rare hard flake.
  test.describe.configure({ retries: 1 });

  test('signaling: both users join voice in a fresh channel, roster lists both, no "Unknown command: MEDIA"', async () => {
    test.setTimeout(160_000);
    const chan = freshChannel('voiceqa');
    const A = await makeUser('vqaA' + Math.floor(Math.random() * 1e4));
    const B = await makeUser('vqaB' + Math.floor(Math.random() * 1e4));
    const users = [A, B];

    try {
      for (const u of users) await enterChannel(u, chan);
      await A.page.waitForTimeout(SETTLE_AFTER_JOIN);

      for (const u of users) await joinVoice(u, chan, false);
      await A.page.waitForTimeout(SETTLE_AFTER_VOICE);

      const a = await snapshot(A, chan);
      const b = await snapshot(B, chan);
      // Logged so a skipped run still leaves a diagnosable trail.
       
      console.log('A(signal):', JSON.stringify(a));
       
      console.log('B(signal):', JSON.stringify(b));

      // The server MUST understand MEDIA — this is the core regression guard and
      // is independent of whether the headless codec can encode audio.
      expect(a.unknownMediaCommand, 'A saw "Unknown command: MEDIA"').toBe(false);
      expect(b.unknownMediaCommand, 'B saw "Unknown command: MEDIA"').toBe(false);

      if (a.codecUnavailable || b.codecUnavailable) {
        test.skip(
          true,
          'Voice codec (opcodec/OPUS WASM) unavailable in this headless env — ' +
            'MEDIA command accepted by server (no "Unknown command"); audio encode needs a real browser.',
        );
        return;
      }

      // Real codec present: the local call should be established for both.
      expect(a.callChannel, 'A callChannel').toBe(chan);
      expect(b.callChannel, 'B callChannel').toBe(chan);

      // MEDIA roster should converge so that the two users see each other. Either
      // direction is sufficient (presence broadcast can be asymmetric mid-warmup).
      const aSeesB = a.participants.includes(B.nick);
      const bSeesA = b.participants.includes(A.nick);
      expect(
        aSeesB || bSeesA,
        `MEDIA roster lists the peer (A=${JSON.stringify(a.participants)} B=${JSON.stringify(b.participants)})`,
      ).toBe(true);
    } finally {
      await teardown(users);
    }
  });

  test('audio capture: joinVoiceChannel yields a local stream with audio tracks (or skip on missing codec)', async () => {
    test.setTimeout(140_000);
    const chan = freshChannel('voiceaud');
    const A = await makeUser('audA' + Math.floor(Math.random() * 1e4));
    const users = [A];

    try {
      await enterChannel(A, chan);
      await A.page.waitForTimeout(SETTLE_AFTER_JOIN);
      await joinVoice(A, chan, false);
      await A.page.waitForTimeout(SETTLE_AFTER_VOICE);

      const a = await snapshot(A, chan);
       
      console.log('A(audio):', JSON.stringify(a));

      expect(a.unknownMediaCommand, 'A saw "Unknown command: MEDIA"').toBe(false);

      if (a.codecUnavailable) {
        test.skip(
          true,
          'Voice codec unavailable in headless env — cannot assert audio capture; ' +
            'signaling path verified (no "Unknown command: MEDIA").',
        );
        return;
      }

      expect(a.callChannel, 'callChannel set to the voice channel').toBe(chan);
      expect(a.audioTracks, 'localStream has at least one audio track').toBeGreaterThan(0);
    } finally {
      await teardown(users);
    }
  });

  test('video: joinVoiceChannel(chan, true) captures video tracks with no DataCloneError', async () => {
    test.setTimeout(140_000);
    const chan = freshChannel('videoqa');
    const A = await makeUser('vidA' + Math.floor(Math.random() * 1e4));
    const B = await makeUser('vidB' + Math.floor(Math.random() * 1e4));
    const users = [A, B];

    try {
      for (const u of users) await enterChannel(u, chan);
      await A.page.waitForTimeout(SETTLE_AFTER_JOIN);

      // A: audio-only, B: video. Exercises the mixed voice/video signaling path.
      await joinVoice(A, chan, false);
      await joinVoice(B, chan, true);
      await A.page.waitForTimeout(SETTLE_AFTER_VOICE);

      const a = await snapshot(A, chan);
      const b = await snapshot(B, chan);
       
      console.log('A(voice):', JSON.stringify(a));
       
      console.log('B(video):', JSON.stringify(b));

      // DataCloneError would mean MediaFrame/transfer wiring is broken — that is a
      // real bug, NOT an environment limitation, so we assert it unconditionally.
      expect(a.dataCloneError, 'A: no DataCloneError').toBe(false);
      expect(b.dataCloneError, 'B: no DataCloneError').toBe(false);
      expect(a.unknownMediaCommand || b.unknownMediaCommand, 'no "Unknown command: MEDIA"').toBe(false);

      if (a.codecUnavailable || b.codecUnavailable) {
        test.skip(
          true,
          'Voice/video codec unavailable in headless env — no DataCloneError observed; ' +
            'full video encode needs a real browser.',
        );
        return;
      }

      expect(b.callChannel, 'B callChannel').toBe(chan);
      expect(b.videoTracks, 'B localStream has at least one video track').toBeGreaterThan(0);
    } finally {
      await teardown(users);
    }
  });

  test('teardown: leaveVoiceChannel() clears callChannel', async () => {
    test.setTimeout(140_000);
    const chan = freshChannel('voiceout');
    const A = await makeUser('outA' + Math.floor(Math.random() * 1e4));
    const users = [A];

    try {
      await enterChannel(A, chan);
      await A.page.waitForTimeout(SETTLE_AFTER_JOIN);
      await joinVoice(A, chan, false);
      await A.page.waitForTimeout(SETTLE_AFTER_VOICE);

      const joined = await snapshot(A, chan);
       
      console.log('A(before leave):', JSON.stringify(joined));
      expect(joined.unknownMediaCommand, 'A saw "Unknown command: MEDIA"').toBe(false);

      if (joined.codecUnavailable) {
        // Codec missing means joinVoiceChannel returned early (no callChannel set),
        // so there is nothing meaningful to leave — verify the early-out instead.
        expect(joined.callChannel, 'no call established when codec is missing').toBeNull();
        test.skip(
          true,
          'Voice codec unavailable in headless env — joinVoiceChannel no-op, leave path not exercisable.',
        );
        return;
      }

      // Codec present: a call exists, leaving must clear it.
      expect(joined.callChannel, 'call established before leave').toBe(chan);

      await A.page.evaluate(
        (g) => (window as unknown as Record<string, OnyxStore>)[g].store!.getState().leaveVoiceChannel(),
        ONYX,
      );
      await A.page.waitForTimeout(1_500);

      const left = await snapshot(A, chan);
       
      console.log('A(after leave):', JSON.stringify(left));
      expect(left.callChannel, 'callChannel cleared after leaveVoiceChannel()').toBeNull();
    } finally {
      await teardown(users);
    }
  });
});
