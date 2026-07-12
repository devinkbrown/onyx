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
  return `TSUMUGI1 ${toB64url(body)}`;
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

  it('a first-contact envelope that does NOT decrypt never poisons the pin (open-then-pin)', async () => {
    // An attacker who can spoof a PRIVMSG origin but does not hold the private
    // half of the presented key cannot produce a valid envelope. A garbage
    // first-contact body must stay locked AND must NOT establish a pin — else it
    // would block the real peer's later legitimate key.
    const impostor = await makePeer();
    const garbage = `TSUMUGI1 ${toB64url(crypto.getRandomValues(new Uint8Array(60)))}`;
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
});
