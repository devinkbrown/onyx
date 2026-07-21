import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// E2EE direct-message e2e — the shipped Phase-3.6 flow (src/lib/e2ee/dmCipher.ts:
// static-static P-256 / HKDF-SHA-256 / AES-GCM, device key published as METADATA
// ocean.dm-key, ChatMessage.text ALWAYS the ciphertext envelope). This suite had
// unit coverage (store.e2ee.test.ts) but no browser-level proof, so we drive the
// REAL store + UI here and assert the one invariant that actually matters:
//
//   The wire/store text a peer holds is CIPHERTEXT (never the plaintext token),
//   yet the rendered bubble shows the CLEARTEXT — and a peer WITHOUT the sender's
//   device key sees the LOCKED_PLACEHOLDER, never a plaintext fallback.
//
// HARNESS (identical rationale to chat.spec / voice.spec):
//   • window.__onyx is DEV-only (src/index.tsx), so the :4173 production preview
//     has NO store handle. We drive the DEV app (:5174), pinned via VITE_IRC_WS to
//     a live Onyx Server WSS (self-signed cert → ignoreHTTPSErrors on every context).
//   • The default `chromium-headless-shell` drops the self-signed WSS, so we
//     self-launch the FULL chromium binary, exactly like the sibling specs.
//   • __onyx exposes the zustand vanilla store: `.getState()` for the actions and
//     `.setState()` for the deterministic locked-placeholder injection below.
//
// Configure via env (default WS points at a locally-running Onyx Server):
//   ONYX_APP  default http://localhost:5174/app
//   ONYX_WS   default wss://127.0.0.1:8080
// ─────────────────────────────────────────────────────────────────────────────

const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app';
const WS = process.env.ONYX_WS ?? 'wss://127.0.0.1:8080';
const ONYX = '__onyx' as const;

// dmCipher.ts constants — mirrored here so the e2e never imports app modules.
const ENVELOPE_PREFIX = 'ONYXDM1 ';
const LOCKED_TEXT = 'Encrypted message (sent to another device)'; // LOCKED_PLACEHOLDER body

const STORE_TIMEOUT = 25_000;
const CONNECT_TIMEOUT = 45_000;
const VISIBLE_TIMEOUT = 30_000; // roster convergence for two independent logins
const KEY_TIMEOUT = 30_000; // METADATA ocean.dm-key round-trip
const DM_TIMEOUT = 30_000; // sealed PRIVMSG delivery + in-place decrypt

// ── Typed view of the store slice this spec touches ──────────────────────────
interface StoredMessage {
  from: string;
  text: string;
  plaintext?: string;
  encrypted?: boolean;
  type: string;
  target: string;
}
interface StoredDM {
  nick: string;
  messages: StoredMessage[];
}
interface StoredChannel {
  users: Map<string, unknown>;
}
interface OnyxStoreState {
  status: string;
  ourNick: string;
  channels: Map<string, StoredChannel>;
  dms: Map<string, StoredDM>;
  peerDmKeys: Map<string, string>;
  connect(opts: { url: string; nick: string }): void;
  joinChannel(channel: string): void;
  navigate(view: { kind: 'channel'; channel: string } | { kind: 'dm'; nick: string }): void;
  sendMessage(target: string, text: string): void;
}
interface OnyxStore {
  store?: {
    getState(): OnyxStoreState;
    setState(partial: Record<string, unknown>): void;
  };
}
type WindowWithStore = Record<string, OnyxStore>;

function rand(): string {
  return Math.floor(Math.random() * 1e7).toString(36);
}
function freshChannel(prefix: string): string {
  return `#${prefix}${rand()}`;
}

async function bootConnectedPage(ctx: BrowserContext, nick: string): Promise<Page> {
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
  return page;
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

/** Poll until `page`'s roster for `chan` includes `peerNick`, for N samples. */
async function waitForPeerVisible(page: Page, chan: string, peerNick: string): Promise<void> {
  const POLL_MS = 750;
  const NEEDED_CONSECUTIVE = 2;
  const deadline = Date.now() + VISIBLE_TIMEOUT;
  let consecutive = 0;
  while (Date.now() < deadline) {
    const seen = await page.evaluate(
      ([g, c, p]) => {
        const ch = (window as unknown as WindowWithStore)[g].store!.getState().channels.get(c.toLowerCase());
        return !!ch && ch.users.has(p.toLowerCase());
      },
      [ONYX, chan, peerNick] as const,
    );
    consecutive = seen ? consecutive + 1 : 0;
    if (consecutive >= NEEDED_CONSECUTIVE) return;
    await page.waitForTimeout(POLL_MS);
  }
  expect(consecutive >= NEEDED_CONSECUTIVE, `${peerNick} visible in ${chan} roster`).toBe(true);
}

/**
 * Poll until `page` holds `peerNick`'s published device key in peerDmKeys — a
 * non-empty base64url value — re-issuing the METADATA GET each iteration so a
 * publish/fetch race can't wedge the test. The key's presence is the observable
 * signal that outbound DMs to the peer will seal rather than fall back to plain.
 */
async function waitForPeerKey(page: Page, peerNick: string): Promise<void> {
  const POLL_MS = 1_000;
  const NEEDED_CONSECUTIVE = 2;
  const deadline = Date.now() + KEY_TIMEOUT;
  let consecutive = 0;
  while (Date.now() < deadline) {
    const hasKey = await page.evaluate(
      ([g, p]) => {
        const s = (window as unknown as WindowWithStore)[g].store!.getState();
        const key = s.peerDmKeys.get(p.toLowerCase());
        if (key && key.length > 0) return true;
        // Nudge another fetch — the reply lands in peerDmKeys asynchronously.
        s.navigate({ kind: 'dm', nick: p });
        return false;
      },
      [ONYX, peerNick] as const,
    );
    consecutive = hasKey ? consecutive + 1 : 0;
    if (consecutive >= NEEDED_CONSECUTIVE) return;
    await page.waitForTimeout(POLL_MS);
  }
  expect(consecutive >= NEEDED_CONSECUTIVE, `${peerNick}'s ocean.dm-key resolved into peerDmKeys`).toBe(true);
}

/**
 * The core invariant check, run against ONE store: locate the DM message from
 * `fromNick` and require (a) `text` is the ONYXDM1 ciphertext envelope, (b) that
 * ciphertext does NOT contain the plaintext token, and (c) `plaintext` decrypted
 * to exactly the cleartext — held for N consecutive samples so we never assert on
 * a mid-decrypt frame. Returns nothing; fails loudly on timeout.
 */
async function waitForCiphertextThenDecrypt(
  page: Page,
  peerKey: string,
  fromNick: string,
  cleartext: string,
): Promise<void> {
  const POLL_MS = 750;
  const NEEDED_CONSECUTIVE = 2;
  const deadline = Date.now() + DM_TIMEOUT;
  let consecutive = 0;
  let last = 'none';
  while (Date.now() < deadline) {
    last = await page.evaluate(
      ([g, k, n, ct, prefix]) => {
        const dm = (window as unknown as WindowWithStore)[g].store!.getState().dms.get(k.toLowerCase());
        if (!dm) return 'no-dm';
        const hit = dm.messages.find((m) => m.from === n && m.encrypted === true);
        if (!hit) return 'absent';
        if (!hit.text.startsWith(prefix)) return 'not-envelope';
        if (hit.text.includes(ct)) return 'PLAINTEXT-ON-WIRE';
        if (hit.plaintext === undefined) return 'undecrypted';
        return hit.plaintext === ct ? 'decrypted' : 'wrong-plaintext';
      },
      [ONYX, peerKey, fromNick, cleartext, ENVELOPE_PREFIX] as const,
    );
    // A plaintext leak is a hard failure the instant it is observed.
    expect(last, `wire must never carry plaintext (peer ${peerKey})`).not.toBe('PLAINTEXT-ON-WIRE');
    consecutive = last === 'decrypted' ? consecutive + 1 : 0;
    if (consecutive >= NEEDED_CONSECUTIVE) return;
    await page.waitForTimeout(POLL_MS);
  }
  expect(consecutive >= NEEDED_CONSECUTIVE, `ciphertext-at-rest + in-place decrypt of "${cleartext}" from ${fromNick} (last: ${last})`).toBe(true);
}

test.describe('E2EE direct messages (connected DEV build)', () => {
  // The staging WSS can drop the very first connection while the suite warms up;
  // one retry covers the rare hard flake (mirrors chat/voice specs). Not a bug
  // mask — every wait fails loudly if the transport or key exchange never settles.
  test.describe.configure({ retries: 1 });

  let browser: Browser;
  test.beforeAll(async () => {
    // Full chromium (not headless-shell) holds the self-signed WSS reliably.
    browser = await chromium.launch();
  });
  test.afterAll(async () => {
    await browser?.close();
  });

  test('two devices: a sealed DM rides the wire as ciphertext and decrypts to cleartext for the peer', async () => {
    test.setTimeout(180_000);
    const chan = freshChannel('dmqa');
    const aliceNick = 'dmA' + rand();
    const bobNick = 'dmB' + rand();
    // Unique secret token so a leak assertion can never false-negative on chrome.
    const secret = `sealed-secret-${rand()}${rand()}`;

    const aliceCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bobCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const [alice, bob] = await Promise.all([
        bootConnectedPage(aliceCtx, aliceNick),
        bootConnectedPage(bobCtx, bobNick),
      ]);

      // Meet in a shared channel first: guarantees mutual visibility so METADATA
      // GET (ocean.dm-key) and the DM PRIVMSG both resolve deterministically.
      await Promise.all([
        alice.evaluate(([g, c]) => (window as unknown as WindowWithStore)[g].store!.getState().joinChannel(c), [ONYX, chan] as const),
        bob.evaluate(([g, c]) => (window as unknown as WindowWithStore)[g].store!.getState().joinChannel(c), [ONYX, chan] as const),
      ]);
      await Promise.all([
        waitForPeerVisible(alice, chan, bobNick),
        waitForPeerVisible(bob, chan, aliceNick),
      ]);

      // Alice opens the DM → fetches Bob's published device key so her send seals.
      await waitForPeerKey(alice, bobNick);

      // The real user action: Alice sends a DM. With Bob's key present and e2eeDms
      // on (default), sendMessage seals it into a single ONYXDM1 envelope PRIVMSG.
      await alice.evaluate(
        ([g, t, body]) => (window as unknown as WindowWithStore)[g].store!.getState().sendMessage(t, body),
        [ONYX, bobNick, secret] as const,
      );

      // INVARIANT on the SENDER: her stored copy is ciphertext-at-rest (envelope),
      // never the plaintext token, with the cleartext held only in `plaintext`.
      await waitForCiphertextThenDecrypt(alice, bobNick, aliceNick, secret);

      // INVARIANT on the RECEIVER: Bob's inbound copy arrived as ciphertext, and
      // decrypted in place after his fetch of Alice's key — proving both the
      // no-plaintext-on-the-wire guarantee and successful two-party decryption.
      await waitForCiphertextThenDecrypt(bob, aliceNick, aliceNick, secret);

      // OBSERVABLE UI on the RECEIVER: open the DM and see the CLEARTEXT bubble,
      // and confirm the locked placeholder is absent (it decrypted for real).
      await bob.evaluate(
        ([g, n]) => (window as unknown as WindowWithStore)[g].store!.getState().navigate({ kind: 'dm', nick: n }),
        [ONYX, aliceNick] as const,
      );
      const bobComposer = bob.getByRole('textbox', { name: `Message ${aliceNick}` });
      await expect(bobComposer).toBeVisible({ timeout: VISIBLE_TIMEOUT });
      const bobLog = bob.getByRole('log', { name: 'Message history' });
      await expect(bobLog.getByText(secret, { exact: false })).toBeVisible({ timeout: DM_TIMEOUT });
      await expect(bob.getByText(LOCKED_TEXT, { exact: false })).toHaveCount(0);
    } finally {
      await aliceCtx.close().catch(() => {});
      await bobCtx.close().catch(() => {});
    }
  });

  test('fail-closed: an envelope from a peer whose key we lack renders the locked placeholder, never plaintext', async () => {
    test.setTimeout(120_000);
    // A random peer nick that has published NO ocean.dm-key on the server, so the
    // navigate-time METADATA GET resolves to nothing and the message stays locked.
    const ghostNick = 'ghost' + rand() + rand();
    const secret = `never-shown-${rand()}${rand()}`;
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const me = 'dmC' + rand();
      const page = await bootConnectedPage(ctx, me);

      // Build a GENUINE ONYXDM1 envelope in-page with the same primitives the app
      // ships (P-256 ECDH → HKDF-SHA-256 → AES-GCM), sealing `secret` between two
      // ephemeral keypairs. Neither private key is ever registered as our device
      // key, so the ciphertext is real yet undecryptable here — the honest
      // "sent to another device" case.
      const envelope = await page.evaluate(async (plaintext) => {
        const toB64url = (bytes: Uint8Array) => {
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const mk = () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        const a = await mk();
        const b = await mk();
        const aPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', a.publicKey));
        const bPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', b.publicKey));
        const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: b.publicKey }, a.privateKey, 256);
        const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        const pair = [toB64url(aPubRaw), toB64url(bPubRaw)].sort();
        const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
        const key = await crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('onyx-dm-v1'), info },
          hkdf,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt'],
        );
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext)));
        const bodyBytes = new Uint8Array(12 + ct.byteLength);
        bodyBytes.set(nonce, 0);
        bodyBytes.set(ct, 12);
        return `ONYXDM1 ${toB64url(bodyBytes)}`;
      }, secret);

      // Sanity: the envelope really is ciphertext that does not leak the plaintext.
      expect(envelope.startsWith(ENVELOPE_PREFIX)).toBe(true);
      expect(envelope.includes(secret)).toBe(false);

      // Inject the received DM directly into the store as encrypted-with-no-plaintext
      // (text = the real envelope), keyed under the ghost peer with NO peerDmKeys
      // entry — exactly the shape the inbound handler produces before decryption.
      await page.evaluate(
        ([g, peer, env]) => {
          const s = (window as unknown as WindowWithStore)[g].store!;
          const key = peer.toLowerCase();
          s.setState({
            dms: new Map([
              [key, {
                nick: peer,
                account: null,
                unread: 1,
                highlights: 0,
                messages: [{
                  id: 'e2ee-locked-fixture',
                  time: new Date(),
                  from: peer,
                  text: env,
                  type: 'msg',
                  target: peer,
                  encrypted: true,
                }],
              }],
            ]),
          });
          s.getState().navigate({ kind: 'dm', nick: peer });
        },
        [ONYX, ghostNick, envelope] as const,
      );

      // OBSERVABLE: the DM view mounts and renders the LOCKED placeholder for the
      // undecryptable message — and the plaintext is nowhere in the DOM.
      const composer = page.getByRole('textbox', { name: `Message ${ghostNick}` });
      await expect(composer).toBeVisible({ timeout: VISIBLE_TIMEOUT });
      await expect(page.getByText(LOCKED_TEXT, { exact: false })).toBeVisible({ timeout: VISIBLE_TIMEOUT });
      await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
