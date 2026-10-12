// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * keyPinning.security.test.ts — adversarial vectors for the TOFU pin gate.
 *
 * These encode the ATTACKS the pin layer must survive: a Byzantine node swapping
 * a peer's device key mid-conversation, an impostor colliding an accepted re-pin
 * with the wrong key, and the fail-closed posture when trust cannot be verified.
 * Happy-path coverage lives in keyPinning.test.ts; attack cases live here.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetDeviceKeysForTests, _resetSharedKeysForTests, deviceKeys, toB64url } from './dmCipher';
import {
  openDmTrusted,
  peerKeyStatus,
  pinPeerKey,
  pinnedPeerKey,
  safetyNumber,
  sealDmTrusted,
} from './keyPinning';

async function makePeer() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { kp, publicB64: toB64url(raw) };
}

async function peerSeal(peer: Awaited<ReturnType<typeof makePeer>>, myPublicB64: string, text: string) {
  const { fromB64url } = await import('./dmCipher');
  const myRaw = fromB64url(myPublicB64)!;
  const myKey = await crypto.subtle.importKey(
    'raw',
    myRaw.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: myKey }, peer.kp.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const pair = [peer.publicB64, myPublicB64].sort();
  const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('onyx-dm-v1'), info },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(text));
  const body = new Uint8Array(12 + ct.byteLength);
  body.set(nonce, 0);
  body.set(new Uint8Array(ct), 12);
  return `ONYXDM1 ${toB64url(body)}`;
}

async function putRawPin(account: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('onyx-key-pins', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('pins')) {
        request.result.createObjectStore('pins');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pins', 'readwrite');
    tx.objectStore('pins').put(value, account.toLowerCase());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
});

describe('anti-MITM: a Byzantine node swaps the peer key mid-conversation', () => {
  it('the send path refuses to seal to the impostor and never moves the pin', async () => {
    const real = await makePeer();
    const impostor = await makePeer();

    // Legit first contact pins the real key.
    expect((await sealDmTrusted('Alice', real.publicB64, 'hi')).status).toBe('sealed');

    // The server now hands the impostor's key for the SAME account.
    for (let i = 0; i < 3; i++) {
      const out = await sealDmTrusted('Alice', impostor.publicB64, `attempt ${i}`);
      expect(out.status).toBe('key-changed');
      expect(out.envelope).toBeNull();
    }
    // The impostor never becomes trusted through repeated attempts.
    expect(await pinnedPeerKey('Alice')).toBe(real.publicB64);
    expect(await peerKeyStatus('Alice', impostor.publicB64)).toBe('changed');
  });

  it('serializes concurrent first-contact seals so only one peer key can win TOFU', async () => {
    const first = await makePeer();
    const second = await makePeer();
    const attempts = [
      { key: first.publicB64, outcome: sealDmTrusted('Alice', first.publicB64, 'first secret') },
      { key: second.publicB64, outcome: sealDmTrusted('Alice', second.publicB64, 'second secret') },
    ];

    const outcomes = await Promise.all(attempts.map(async (attempt) => ({
      key: attempt.key,
      outcome: await attempt.outcome,
    })));
    const sealed = outcomes.filter((attempt) => attempt.outcome.status === 'sealed');
    const blocked = outcomes.filter((attempt) => attempt.outcome.status === 'key-changed');

    expect(sealed).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(await pinnedPeerKey('Alice')).toBe(sealed[0]!.key);
  });

  it('a first-contact envelope that does NOT decrypt never poisons the pin (open-then-pin)', async () => {
    // An attacker who can spoof a PRIVMSG origin but does not hold the private
    // half of the presented key cannot produce a valid envelope. A garbage
    // first-contact body must stay locked AND must NOT establish a pin — else it
    // would block the real peer's later legitimate key.
    const impostor = await makePeer();
    const garbage = `ONYXDM1 ${toB64url(crypto.getRandomValues(new Uint8Array(60)))}`;
    const out = await openDmTrusted('Alice', impostor.publicB64, garbage);
    expect(out.status).toBe('locked');
    expect(await pinnedPeerKey('Alice')).toBeNull(); // no pin poisoned

    // The real peer's first VALID message still pins cleanly afterwards.
    const real = await makePeer();
    const mine = (await deviceKeys())!.publicB64;
    const good = await peerSeal(real, mine, 'the real alice');
    const ok = await openDmTrusted('Alice', real.publicB64, good);
    expect(ok.status).toBe('opened');
    expect(await pinnedPeerKey('Alice')).toBe(real.publicB64);
  });

  it('serializes concurrent first-contact opens so only the pinned peer yields plaintext', async () => {
    const first = await makePeer();
    const second = await makePeer();
    const mine = (await deviceKeys())!.publicB64;
    const attempts = [
      { key: first.publicB64, outcome: openDmTrusted('Alice', first.publicB64, await peerSeal(first, mine, 'first peer')) },
      { key: second.publicB64, outcome: openDmTrusted('Alice', second.publicB64, await peerSeal(second, mine, 'second peer')) },
    ];

    const outcomes = await Promise.all(attempts.map(async (attempt) => ({
      key: attempt.key,
      outcome: await attempt.outcome,
    })));
    const opened = outcomes.filter((attempt) => attempt.outcome.status === 'opened');
    const blocked = outcomes.filter((attempt) =>
      attempt.outcome.status === 'locked' && attempt.outcome.reason === 'key-changed');

    expect(opened).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(await pinnedPeerKey('Alice')).toBe(opened[0]!.key);
  });

  it('the receive path keeps an impostor-sealed DM LOCKED even though it decrypts under the impostor key', async () => {
    const real = await makePeer();
    const impostor = await makePeer();
    const mine = (await deviceKeys())!.publicB64;

    // Pin the real peer first.
    await pinPeerKey('Alice', real.publicB64);

    // The impostor seals a message with THEIR key (it WOULD decrypt if we
    // naively trusted the presented key). The gate must refuse on key mismatch.
    const forged = await peerSeal(impostor, mine, 'trust me, it is really alice');
    const out = await openDmTrusted('Alice', impostor.publicB64, forged);
    expect(out.status).toBe('locked');
    if (out.status === 'locked') expect(out.reason).toBe('key-changed');
  });
});

describe('re-pin (accept) is explicit and exact', () => {
  it('accepting requires the operator to pin the exact new key; a third key still blocks', async () => {
    const original = await makePeer();
    const rotated = await makePeer();
    const third = await makePeer();

    await sealDmTrusted('Alice', original.publicB64, 'x'); // pin original
    // Operator accepts the rotated key out-of-band.
    expect(await pinPeerKey('Alice', rotated.publicB64)).toBe(true);
    expect((await sealDmTrusted('Alice', rotated.publicB64, 'y')).status).toBe('sealed');
    // A DIFFERENT key presented after the accept is still a change → blocked.
    expect((await sealDmTrusted('Alice', third.publicB64, 'z')).status).toBe('key-changed');
  });

  it('an invalid key can never be accepted as a pin', async () => {
    expect(await pinPeerKey('Alice', 'not-a-key')).toBe(false);
    expect(await pinPeerKey('Alice', toB64url(new Uint8Array(65)))).toBe(false); // 0x00 tag, not 0x04
    expect(await pinnedPeerKey('Alice')).toBeNull();
  });
});

describe('safety number detects the swap', () => {
  it('the impostor produces a visibly different safety number than the real peer', async () => {
    const mine = (await deviceKeys())!.publicB64;
    const real = await makePeer();
    const impostor = await makePeer();
    const realSn = await safetyNumber(mine, real.publicB64);
    const impostorSn = await safetyNumber(mine, impostor.publicB64);
    expect(realSn).not.toBeNull();
    expect(realSn).not.toBe(impostorSn);
  });
});

describe('fail-closed when trust cannot be verified', () => {
  const realIndexedDb = globalThis.indexedDB;
  afterEach(() => {
    globalThis.indexedDB = realIndexedDb;
  });

  it('an unreadable pin store blocks both seal and open rather than proceeding', async () => {
    const peer = await makePeer();
    const mine = (await deviceKeys())!.publicB64;
    const envelope = await peerSeal(peer, mine, 'never opened');
    // @ts-expect-error — simulate storage being disabled (private window).
    globalThis.indexedDB = undefined;

    const sealed = await sealDmTrusted('Alice', peer.publicB64, 'never sent');
    expect(sealed.status).toBe('unavailable');
    expect(sealed.envelope).toBeNull();

    const opened = await openDmTrusted('Alice', peer.publicB64, envelope);
    expect(opened.status).toBe('locked');
    if (opened.status === 'locked') expect(opened.reason).toBe('unavailable');
  });

  it('treats corrupt non-string pin records as unreadable, never as first use', async () => {
    const sealPeer = await makePeer();
    await putRawPin('Alice', { corrupted: true });

    expect(await peerKeyStatus('Alice', sealPeer.publicB64)).toBe('unreadable');
    const sealed = await sealDmTrusted('Alice', sealPeer.publicB64, 'never sent');
    expect(sealed.status).toBe('unavailable');
    expect(sealed.envelope).toBeNull();

    const openPeer = await makePeer();
    const mine = (await deviceKeys())!.publicB64;
    await putRawPin('Bob', 42);
    const opened = await openDmTrusted('Bob', openPeer.publicB64, await peerSeal(openPeer, mine, 'never opened'));
    expect(opened.status).toBe('locked');
    if (opened.status === 'locked') expect(opened.reason).toBe('unavailable');
  });
});
