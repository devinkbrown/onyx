// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.keyPinning.test.ts — the DM send/receive path routed through the
 * TOFU-pinned cipher (sealDmTrusted / openDmTrusted), the anti-MITM key-change
 * BLOCK + visible warning state, the explicit accept-and-re-pin action, and the
 * out-of-band safety number.
 *
 * These prove the live store wiring — not the cipher primitives (which have
 * their own vectors) — so every case drives store.getState() the way the app
 * does: sendMessage() for the send path, a fed PRIVMSG for the receive path.
 *
 * FAIL-CLOSED is the load-bearing assertion throughout: a changed peer key must
 * never put plaintext on the wire (send) and must never yield plaintext in the
 * store (receive) — it stays LOCKED and raises a visible warning until the user
 * explicitly accepts the new key.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';
import { parseIRCMessage } from '@/lib/irc/parser';
import {
  ENVELOPE_PREFIX,
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  deviceKeys,
  fromB64url,
  toB64url,
} from '@/lib/e2ee/dmCipher';
import { pinnedPeerKey as readPinnedPeerKey } from '@/lib/e2ee/keyPinning';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://e2ee-store.example/ws', identity: 'alice' } as const;
const BOB_MEMORY_OWNER = { ...MEMORY_OWNER, identity: 'bob' } as const;

function pinnedPeerKey(peer: string): Promise<string | null> {
  return readPinnedPeerKey(peer, MEMORY_OWNER);
}

/** A peer device that can seal to us, mirroring dmCipher's static-static derivation. */
async function makePeer(myPublicB64: string) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const publicB64 = toB64url(raw);
  async function seal(plaintext: string): Promise<string> {
    const myRaw = fromB64url(myPublicB64)!;
    const myKey = await crypto.subtle.importKey('raw', myRaw.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: myKey }, kp.privateKey, 256);
    const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const pair = [publicB64, myPublicB64].sort();
    const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
    const aes = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('onyx-dm-v1'), info },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, new TextEncoder().encode(plaintext));
    const body = new Uint8Array(12 + ct.byteLength);
    body.set(nonce, 0);
    body.set(new Uint8Array(ct), 12);
    return `${ENVELOPE_PREFIX}${toB64url(body)}`;
  }
  return { publicB64, seal };
}

function mockClient(sendRaw = vi.fn()) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send: vi.fn(),
  } as never;
}

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function untilAsync(ok: () => Promise<boolean>, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));
const dmMsgs = (nick: string) => store.getState().dms.get(nick.toLowerCase())?.messages ?? [];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // fresh onyx-keys AND onyx-key-pins DBs
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
  localStorage.clear();
  store.setState({
    ...initialState,
    ourNick: 'me',
    connectionStatus: 'connected',
    client: mockClient(),
    server: {
      id: 'e2ee-store',
      name: 'E2EE store test',
      network: 'e2ee-store',
      url: MEMORY_OWNER.serverUrl,
      icon: 'E',
      nick: 'me',
      account: MEMORY_OWNER.identity,
      connected: true,
    },
  }, true);
});

afterEach(() => vi.useRealTimers());

describe('DM key pinning (TOFU) through the store', () => {
  it('rejects an Alice decrypt completion after the live account switches to Bob', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);
    const envelope = await peer.seal('Alice account plaintext');
    const message = {
      id: 'shared-server-message-id',
      time: new Date(1_000),
      from: 'trev',
      text: envelope,
      encrypted: true,
      type: 'msg',
      target: 'me',
    } as const;
    store.setState({
      peerDmKeys: new Map([['trev', peer.publicB64]]),
      dms: new Map([['trev', {
        nick: 'trev',
        account: 'trev',
        unread: 0,
        highlights: 0,
        messages: [message],
      }]]) as never,
    });

    store.getState()._decryptDm('trev', message.id);
    feed(':e2ee-store.example 900 me me!u@h bob :You are now logged in as bob');
    store.setState({
      peerDmKeys: new Map([['trev', peer.publicB64]]),
      dms: new Map([['trev', {
        nick: 'trev',
        account: 'trev',
        unread: 0,
        highlights: 0,
        messages: [{ ...message }],
      }]]) as never,
    });

    await untilAsync(async () => (await readPinnedPeerKey('trev', MEMORY_OWNER)) === peer.publicB64);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.getState().server?.account).toBe('bob');
    expect(await readPinnedPeerKey('trev', BOB_MEMORY_OWNER)).toBeNull();
    expect(dmMsgs('trev')[0]?.plaintext).toBeUndefined();
    expect(store.getState().notifications.some((entry) => entry.text === 'Alice account plaintext')).toBe(false);
  });

  it('routes the DM send through sealDmTrusted — first use pins the key, then seals unchanged', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient() });
    store.getState().client!.send = send;
    store.setState({ peerDmKeys: new Map([['trev', peer.publicB64]]) });

    store.getState().sendMessage('trev', 'meet at the quiet dock');

    await until(() => send.mock.calls.length > 0);
    const wire = String(send.mock.calls[0]![0]);
    expect(wire).toContain(ENVELOPE_PREFIX);
    expect(wire).not.toContain('quiet dock');

    // The Trusted path PINNED the key on first use — the tell that we routed
    // through sealDmTrusted, not the raw sealDm.
    await untilAsync(async () => (await pinnedPeerKey('trev')) === peer.publicB64);
    expect(await pinnedPeerKey('trev')).toBe(peer.publicB64);

    // A second send under the SAME (unchanged) key still seals and sends.
    store.getState().sendMessage('trev', 'and again');
    await until(() => send.mock.calls.length > 1);
    expect(String(send.mock.calls[1]![0])).toContain(ENVELOPE_PREFIX);
    expect(store.getState().peerKeyChanges.has('trev')).toBe(false);
  });

  it('BLOCKS the send when the peer key changed — no plaintext on the wire, visible warning set', async () => {
    const mine = await deviceKeys();
    const peerA = await makePeer(mine!.publicB64);
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient() });
    store.getState().client!.send = send;

    // First use pins peerA.
    store.setState({ peerDmKeys: new Map([['trev', peerA.publicB64]]) });
    store.getState().sendMessage('trev', 'first, trusted');
    await until(() => send.mock.calls.length > 0);
    expect(await pinnedPeerKey('trev')).toBe(peerA.publicB64);
    const sealedCalls = send.mock.calls.length;

    // The directory now hands us a DIFFERENT key (possible MITM).
    const peerB = await makePeer(mine!.publicB64);
    store.setState({ peerDmKeys: new Map([['trev', peerB.publicB64]]) });
    const notesBefore = store.getState().notifications.length;

    store.getState().sendMessage('trev', 'secret plan for the changed key');

    await until(() => store.getState().peerKeyChanges.has('trev'));

    // FAIL CLOSED: nothing new put on the wire, and never the plaintext.
    expect(send.mock.calls.length).toBe(sealedCalls);
    for (const call of send.mock.calls) {
      expect(String(call[0])).not.toContain('secret plan');
    }

    // Visible warning state carries both keys for the accept UI + safety compare.
    const change = store.getState().peerKeyChanges.get('trev')!;
    expect(change.pinnedKey).toBe(peerA.publicB64);
    expect(change.newKey).toBe(peerB.publicB64);

    // Non-silent: a persistent error notification landed.
    await until(() => store.getState().notifications.length > notesBefore);
    expect(store.getState().notifications.at(-1)!.type).toBe('error');
    expect(store.getState().notifications.at(-1)!.text).toContain('trev');

    // No plaintext echo leaked into the DM buffer for the blocked send.
    expect(dmMsgs('trev').some((m) => m.plaintext === 'secret plan for the changed key')).toBe(false);
  });

  it('leaves an inbound envelope LOCKED (never plaintext) when the sender key changed, then unlocks on accept', async () => {
    const mine = await deviceKeys();
    const peerA = await makePeer(mine!.publicB64);

    // Establish trust in peerA by decrypting a first-use message from them.
    store.setState({ peerDmKeys: new Map([['trev', peerA.publicB64]]) });
    feed(`:trev!u@h PRIVMSG me :${await peerA.seal('hello from the pinned key')}`);
    await until(() => dmMsgs('trev')[0]?.plaintext !== undefined);
    expect(await pinnedPeerKey('trev')).toBe(peerA.publicB64);

    // The sender's advertised key changes; a new envelope arrives sealed to it.
    const peerB = await makePeer(mine!.publicB64);
    store.setState({ peerDmKeys: new Map([['trev', peerB.publicB64]]) });
    const envB = await peerB.seal('rotated-key message');
    feed(`:trev!u@h PRIVMSG me :${envB}`);

    // The new message is inserted as ciphertext and STAYS LOCKED — the changed
    // key is never used to decrypt, so no plaintext appears.
    await until(() => dmMsgs('trev').length > 1);
    await until(() => store.getState().peerKeyChanges.has('trev'));
    const locked = dmMsgs('trev').find((m) => m.text === envB)!;
    expect(locked.encrypted).toBe(true);
    expect(locked.plaintext).toBeUndefined(); // LOCKED, never plaintext

    // Explicit accept re-pins the new key and unlocks messages sealed to it.
    store.getState().acceptPeerKeyChange('trev');
    await untilAsync(async () => (await pinnedPeerKey('trev')) === peerB.publicB64);
    await until(() => dmMsgs('trev').find((m) => m.text === envB)?.plaintext !== undefined);
    expect(dmMsgs('trev').find((m) => m.text === envB)!.plaintext).toBe('rotated-key message');
    expect(store.getState().peerKeyChanges.has('trev')).toBe(false);
  });

  it('exposes a stable safety number for a pinned peer, and null before any pin', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);

    // No pin yet → no safety number.
    expect(await store.getState().loadSafetyNumber('trev')).toBeNull();

    // Pin peer via a first-use send.
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient() });
    store.getState().client!.send = send;
    store.setState({ peerDmKeys: new Map([['trev', peer.publicB64]]) });
    store.getState().sendMessage('trev', 'pin me');
    await until(() => send.mock.calls.length > 0);

    const sn1 = await store.getState().loadSafetyNumber('trev');
    expect(sn1).toMatch(/^\d{5}( \d{5}){11}$/); // 12 groups of 5 digits (Signal shape)
    expect(store.getState().peerSafetyNumbers.get('trev')).toBe(sn1);

    // Stable: the same two device keys always fold to the same number.
    const sn2 = await store.getState().loadSafetyNumber('trev');
    expect(sn2).toBe(sn1);
  });

  it('exposes a distinct, stable safety number for a PENDING changed key (the one being accepted)', async () => {
    const mine = await deviceKeys();
    const peerA = await makePeer(mine!.publicB64);
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient() });
    store.getState().client!.send = send;

    // Pin peerA, then present peerB → a pending key change.
    store.setState({ peerDmKeys: new Map([['trev', peerA.publicB64]]) });
    store.getState().sendMessage('trev', 'pin peerA');
    await until(() => send.mock.calls.length > 0);
    const pinnedSn = await store.getState().loadSafetyNumber('trev');

    const peerB = await makePeer(mine!.publicB64);
    store.setState({ peerDmKeys: new Map([['trev', peerB.publicB64]]) });
    store.getState().sendMessage('trev', 'blocked under peerB');
    await until(() => store.getState().peerKeyChanges.has('trev'));

    // The pending-key safety number binds OUR key to peerB — the key the user is
    // being asked to accept — so it must differ from the pinned (peerA) number.
    const pendingSn = await store.getState().loadPendingKeySafetyNumber('trev');
    expect(pendingSn).toMatch(/^\d{5}( \d{5}){11}$/);
    expect(pendingSn).not.toBe(pinnedSn);
    expect(store.getState().pendingKeySafetyNumbers.get('trev')).toBe(pendingSn);

    // Stable across calls.
    expect(await store.getState().loadPendingKeySafetyNumber('trev')).toBe(pendingSn);

    // No pending change → null.
    expect(await store.getState().loadPendingKeySafetyNumber('nobody')).toBeNull();
  });
});
