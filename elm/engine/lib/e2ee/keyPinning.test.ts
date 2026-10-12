// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * keyPinning.test.ts — trust-on-first-use (TOFU) device-key pinning + the
 * key-change anti-MITM gate + the comparable safety number.
 *
 * This closes the gap where onyx trusted the SERVER-supplied E2EE device-key
 * directory blindly: a Byzantine/compromised node could hand a forged
 * `ocean.dm-key` and MITM an "end-to-end" DM. TOFU pins the peer's key on first
 * contact and refuses to seal/open under a silently-swapped key until the user
 * explicitly accepts the change.
 *
 * Real WebCrypto (Node) + fake-indexeddb; every test gets a fresh universe.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  deviceKeys,
  fromB64url,
  isEnvelope,
  toB64url,
} from './dmCipher';
import {
  openDmTrusted,
  peerKeyStatus,
  peerSafetyNumber,
  pinPeerKey,
  pinPeerKeys,
  pinPeerTrustBinding,
  pinnedPeerKey,
  safetyNumber,
  safetyNumberForDeviceSet,
  sealDmTrusted,
  unpinPeerKey,
} from './keyPinning';

/** A peer device: raw keypair + its independent view of the shared key. */
async function makePeer() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { kp, publicB64: toB64url(raw) };
}

/** The peer's side of the static-static derivation, built independently. */
async function peerDerive(peer: Awaited<ReturnType<typeof makePeer>>, otherPublicB64: string) {
  const otherRaw = fromB64url(otherPublicB64)!;
  const otherKey = await crypto.subtle.importKey(
    'raw',
    otherRaw.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: otherKey }, peer.kp.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const pair = [peer.publicB64, otherPublicB64].sort();
  const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('onyx-dm-v1'), info },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a message as the peer would, so openDmTrusted has a real envelope. */
async function peerSeal(peer: Awaited<ReturnType<typeof makePeer>>, myPublicB64: string, text: string) {
  const key = await peerDerive(peer, myPublicB64);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(text));
  const body = new Uint8Array(12 + ct.byteLength);
  body.set(nonce, 0);
  body.set(new Uint8Array(ct), 12);
  return `ONYXDM1 ${toB64url(body)}`;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
});

describe('safetyNumber', () => {
  it('is stable across calls for the same key pair', async () => {
    const a = await makePeer();
    const b = await makePeer();
    const first = await safetyNumber(a.publicB64, b.publicB64);
    const second = await safetyNumber(a.publicB64, b.publicB64);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
  });

  it('is order-independent (both parties compute the same number)', async () => {
    const a = await makePeer();
    const b = await makePeer();
    const ab = await safetyNumber(a.publicB64, b.publicB64);
    const ba = await safetyNumber(b.publicB64, a.publicB64);
    expect(ab).toBe(ba);
  });

  it('renders as grouped decimal digits a human can read aloud', async () => {
    const a = await makePeer();
    const b = await makePeer();
    const sn = (await safetyNumber(a.publicB64, b.publicB64))!;
    // Only digits and single-space group separators.
    expect(sn).toMatch(/^\d{5}( \d{5})*$/);
    // 60 significant digits, Signal-style.
    expect(sn.replace(/ /g, '')).toHaveLength(60);
  });

  it('differs for a different peer (a swapped key is visibly different)', async () => {
    const a = await makePeer();
    const b = await makePeer();
    const c = await makePeer();
    const ab = await safetyNumber(a.publicB64, b.publicB64);
    const ac = await safetyNumber(a.publicB64, c.publicB64);
    expect(ab).not.toBe(ac);
  });

  it('returns null for a structurally invalid key', async () => {
    const a = await makePeer();
    expect(await safetyNumber(a.publicB64, 'not-a-key')).toBeNull();
    expect(await safetyNumber('!!!', a.publicB64)).toBeNull();
  });
});

describe('safetyNumberForDeviceSet (multi-device)', () => {
  it('matches pairwise safetyNumber for a single peer device', async () => {
    const local = await makePeer();
    const peer = await makePeer();
    const pair = await safetyNumber(local.publicB64, peer.publicB64);
    const set = await safetyNumberForDeviceSet(local.publicB64, [peer.publicB64]);
    expect(set).toBe(pair);
  });

  it('is order-independent over the peer device set', async () => {
    const local = await makePeer();
    const d1 = await makePeer();
    const d2 = await makePeer();
    const ab = await safetyNumberForDeviceSet(local.publicB64, [d1.publicB64, d2.publicB64]);
    const ba = await safetyNumberForDeviceSet(local.publicB64, [d2.publicB64, d1.publicB64]);
    expect(ab).not.toBeNull();
    expect(ab).toBe(ba);
    expect(ab!.replace(/ /g, '')).toHaveLength(60);
  });

  it('changes when any peer device is added or swapped', async () => {
    const local = await makePeer();
    const d1 = await makePeer();
    const d2 = await makePeer();
    const d3 = await makePeer();
    const two = await safetyNumberForDeviceSet(local.publicB64, [d1.publicB64, d2.publicB64]);
    const one = await safetyNumberForDeviceSet(local.publicB64, [d1.publicB64]);
    const swapped = await safetyNumberForDeviceSet(local.publicB64, [d1.publicB64, d3.publicB64]);
    expect(two).not.toBe(one);
    expect(two).not.toBe(swapped);
  });

  it('returns null when the peer set is empty or all invalid', async () => {
    const local = await makePeer();
    expect(await safetyNumberForDeviceSet(local.publicB64, [])).toBeNull();
    expect(await safetyNumberForDeviceSet(local.publicB64, ['!!!', 'also-bad'])).toBeNull();
    expect(await safetyNumberForDeviceSet('not-a-key', [(await makePeer()).publicB64])).toBeNull();
  });
});

describe('peerKeyStatus + pin lifecycle', () => {
  it('persists only canonical SHA-256 base64url composite trust bindings', async () => {
    const binding = toB64url(new Uint8Array(32).fill(0x5a));
    expect(await pinPeerTrustBinding('alice#media#device', binding)).toBe(true);
    expect(await peerKeyStatus('alice#media#device', binding)).toBe('unchanged');
    expect(await pinPeerTrustBinding('alice#media#bad', `${binding}=`)).toBe(false);
  });

  it('isolates the same peer pin by local account and quarantines the legacy bucket', async () => {
    const localAlice = { serverUrl: 'wss://e2ee.example/ws', identity: 'alice' } as const;
    const localBob = { serverUrl: 'wss://e2ee.example/ws', identity: 'bob' } as const;
    const aliceView = await makePeer();
    const bobView = await makePeer();
    const legacyView = await makePeer();

    await pinPeerKey('Trev', legacyView.publicB64);
    await pinPeerKey('Trev', aliceView.publicB64, localAlice);
    await pinPeerKey('Trev', bobView.publicB64, localBob);

    expect(await pinnedPeerKey('trev', localAlice)).toBe(aliceView.publicB64);
    expect(await pinnedPeerKey('trev', localBob)).toBe(bobView.publicB64);
    expect(await pinnedPeerKey('trev')).toBe(legacyView.publicB64);
    expect(await peerKeyStatus('TREV', bobView.publicB64, localAlice)).toBe('changed');
    expect(await peerKeyStatus('TREV', bobView.publicB64, localBob)).toBe('unchanged');
  });

  it('reports first-use when nothing is pinned, then unchanged after a pin', async () => {
    const peer = await makePeer();
    expect(await peerKeyStatus('Alice', peer.publicB64)).toBe('first-use');
    expect(await pinPeerKey('Alice', peer.publicB64)).toBe(true);
    expect(await pinnedPeerKey('Alice')).toBe(peer.publicB64);
    expect(await peerKeyStatus('Alice', peer.publicB64)).toBe('unchanged');
  });

  it('is account-scoped and case-insensitive on the account key', async () => {
    const alice = await makePeer();
    const bob = await makePeer();
    await pinPeerKey('Alice', alice.publicB64);
    await pinPeerKey('Bob', bob.publicB64);
    expect(await pinnedPeerKey('alice')).toBe(alice.publicB64); // same account, different case
    expect(await peerKeyStatus('BOB', bob.publicB64)).toBe('unchanged');
  });

  it('reports changed when a different key is presented for a pinned account', async () => {
    const original = await makePeer();
    const impostor = await makePeer();
    await pinPeerKey('Alice', original.publicB64);
    expect(await peerKeyStatus('Alice', impostor.publicB64)).toBe('changed');
  });

  it('unpin clears the pin (back to first-use)', async () => {
    const peer = await makePeer();
    await pinPeerKey('Alice', peer.publicB64);
    await unpinPeerKey('Alice');
    expect(await pinnedPeerKey('Alice')).toBeNull();
    expect(await peerKeyStatus('Alice', peer.publicB64)).toBe('first-use');
  });
});

describe('sealDmTrusted (send-side anti-MITM gate)', () => {
  it('pins on first use and seals an envelope the peer can open', async () => {
    const peer = await makePeer();
    const out = await sealDmTrusted('Alice', peer.publicB64, 'quiet water, quiet wire');
    expect(out.status).toBe('sealed');
    if (out.status !== 'sealed') return;
    expect(out.keyStatus).toBe('first-use');
    expect(isEnvelope(out.envelope)).toBe(true);
    // First use pinned the key.
    expect(await pinnedPeerKey('Alice')).toBe(peer.publicB64);
    // The peer can actually open it (static-static round-trip preserved).
    const peerKey = await peerDerive(peer, (await deviceKeys())!.publicB64);
    const body = fromB64url(out.envelope.slice('ONYXDM1 '.length))!;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.slice(0, 12) }, peerKey, body.slice(12));
    expect(new TextDecoder().decode(pt)).toBe('quiet water, quiet wire');
  });

  it('seals silently when the presented key is unchanged from the pin', async () => {
    const peer = await makePeer();
    await sealDmTrusted('Alice', peer.publicB64, 'first'); // pins
    const out = await sealDmTrusted('Alice', peer.publicB64, 'second');
    expect(out.status).toBe('sealed');
    if (out.status === 'sealed') expect(out.keyStatus).toBe('unchanged');
  });

  it('BLOCKS (no ciphertext emitted) when the key silently changed', async () => {
    const original = await makePeer();
    const impostor = await makePeer();
    await sealDmTrusted('Alice', original.publicB64, 'trusted'); // pins original
    const out = await sealDmTrusted('Alice', impostor.publicB64, 'should not send');
    expect(out.status).toBe('key-changed');
    expect(out.envelope).toBeNull(); // nothing goes on the wire
    if (out.status === 'key-changed') expect(out.pinnedKey).toBe(original.publicB64);
    // The pin is NOT silently moved to the impostor.
    expect(await pinnedPeerKey('Alice')).toBe(original.publicB64);
  });

  it('seals to the new key only after an explicit accept (re-pin)', async () => {
    const original = await makePeer();
    const rotated = await makePeer();
    await sealDmTrusted('Alice', original.publicB64, 'trusted');
    expect((await sealDmTrusted('Alice', rotated.publicB64, 'x')).status).toBe('key-changed');
    // User verified out-of-band and accepted the change:
    expect(await pinPeerKey('Alice', rotated.publicB64)).toBe(true);
    const out = await sealDmTrusted('Alice', rotated.publicB64, 'now trusted');
    expect(out.status).toBe('sealed');
  });

  it('fails closed (unavailable, no pin) on a structurally invalid peer key', async () => {
    const out = await sealDmTrusted('Alice', 'not-a-valid-key', 'secret');
    expect(out.status).toBe('unavailable');
    expect(out.envelope).toBeNull();
    expect(await pinnedPeerKey('Alice')).toBeNull(); // never pinned garbage
  });
});

describe('openDmTrusted (receive-side anti-MITM gate)', () => {
  it('opens and pins on first contact', async () => {
    const peer = await makePeer();
    const mine = (await deviceKeys())!.publicB64;
    const envelope = await peerSeal(peer, mine, 'replies flow back');
    const out = await openDmTrusted('Bob', peer.publicB64, envelope);
    expect(out.status).toBe('opened');
    if (out.status === 'opened') {
      expect(out.plaintext).toBe('replies flow back');
      expect(out.keyStatus).toBe('first-use');
    }
    expect(await pinnedPeerKey('Bob')).toBe(peer.publicB64);
  });

  it('stays LOCKED (does not decrypt) when the sender key silently changed', async () => {
    const original = await makePeer();
    const impostor = await makePeer();
    await pinPeerKey('Bob', original.publicB64);
    const mine = (await deviceKeys())!.publicB64;
    const forged = await peerSeal(impostor, mine, 'i am pretending to be alice');
    const out = await openDmTrusted('Bob', impostor.publicB64, forged);
    expect(out.status).toBe('locked');
    if (out.status === 'locked') expect(out.reason).toBe('key-changed');
  });

  it('locks (undecryptable) on a non-envelope or garbage body', async () => {
    const peer = await makePeer();
    expect((await openDmTrusted('Bob', peer.publicB64, 'plain text')).status).toBe('locked');
    const out = await openDmTrusted('Bob', peer.publicB64, `ONYXDM1 ${toB64url(new Uint8Array(4))}`);
    expect(out.status).toBe('locked');
    if (out.status === 'locked') expect(out.reason).toBe('undecryptable');
  });
});

describe('peerSafetyNumber (surface hook)', () => {
  it('combines our device key with the pinned peer key', async () => {
    const peer = await makePeer();
    await pinPeerKey('Alice', peer.publicB64);
    const mine = (await deviceKeys())!.publicB64;
    const expected = await safetyNumber(mine, peer.publicB64);
    expect(await peerSafetyNumber('Alice')).toBe(expected);
  });

  it('binds the full multi-device pin set into one conversation number', async () => {
    const d1 = await makePeer();
    const d2 = await makePeer();
    await pinPeerKeys('Alice', [d1.publicB64, d2.publicB64]);
    const mine = (await deviceKeys())!.publicB64;
    const expected = await safetyNumberForDeviceSet(mine, [d1.publicB64, d2.publicB64]);
    expect(await peerSafetyNumber('Alice')).toBe(expected);
    // Not merely the first device — multi-pin must cover every sealed device.
    expect(await peerSafetyNumber('Alice')).not.toBe(await safetyNumber(mine, d1.publicB64));
  });

  it('returns null when the peer is not yet pinned', async () => {
    expect(await peerSafetyNumber('Nobody')).toBeNull();
  });
});

describe('fail-closed when the pin store is unreadable', () => {
  const realIndexedDb = globalThis.indexedDB;
  afterEach(() => {
    globalThis.indexedDB = realIndexedDb;
  });

  it('reports unreadable and refuses to seal when IndexedDB is absent', async () => {
    // Prime a device key while IDB works, then make the pin store unreadable.
    const peer = await makePeer();
    // @ts-expect-error — simulate a private window / disabled storage.
    globalThis.indexedDB = undefined;
    expect(await peerKeyStatus('Alice', peer.publicB64)).toBe('unreadable');
    const out = await sealDmTrusted('Alice', peer.publicB64, 'secret');
    expect(out.status).toBe('unavailable');
    expect(out.envelope).toBeNull();
  });
});
