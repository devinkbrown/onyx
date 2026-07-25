// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * multiDevice.test.ts — Era 3 C2 multi-device fan-out envelope + TOFU set pin.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  deviceKeys,
  isMultiEnvelope,
  normalizePeerDeviceKeys,
  openDm,
  sealDmToDevices,
  toB64url,
} from './dmCipher';
import {
  pinnedPeerKeys,
  sealDmTrustedToDevices,
  unpinPeerKey,
} from './keyPinning';

async function mintPeer(): Promise<{ publicB64: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicB64: toB64url(raw) };
}

beforeEach(async () => {
  // Fresh IDB universe per test (same discipline as keyPinning.test.ts).
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
  await unpinPeerKey('bob');
});

describe('normalizePeerDeviceKeys', () => {
  it('dedupes, validates, and caps', async () => {
    const a = await mintPeer();
    const b = await mintPeer();
    expect(normalizePeerDeviceKeys([a.publicB64, a.publicB64, 'bad', b.publicB64])).toEqual([
      a.publicB64,
      b.publicB64,
    ]);
  });
});

describe('sealDmToDevices multi fan-out', () => {
  it('emits classic ONYXDM1 for a single device', async () => {
    const peer = await mintPeer();
    const mine = await deviceKeys();
    expect(mine).toBeTruthy();
    const envelope = await sealDmToDevices([peer.publicB64], 'one device');
    expect(envelope).toMatch(/^ONYXDM1 /);
    expect(isMultiEnvelope(envelope!)).toBe(false);
  });

  it('emits ONYXDMN1 and opens under each sealed device half', async () => {
    const d1 = await mintPeer();
    const mine = await deviceKeys();
    expect(mine).toBeTruthy();
    const self = mine!.publicB64;
    // Seal to self + foreign device: openDm(self) and openDm(d1) both succeed
    // because open tries each seal half under ECDH(ourPriv, presentedPub).
    const selfEnv = await sealDmToDevices([self, d1.publicB64], 'self-and-peer');
    expect(isMultiEnvelope(selfEnv!)).toBe(true);
    await expect(openDm(self, selfEnv!)).resolves.toBe('self-and-peer');
    await expect(openDm(d1.publicB64, selfEnv!)).resolves.toBe('self-and-peer');
  });
});

describe('sealDmTrustedToDevices', () => {
  it('pins the full device set on first use and seals multi', async () => {
    const d1 = await mintPeer();
    const d2 = await mintPeer();
    const out = await sealDmTrustedToDevices('bob', [d1.publicB64, d2.publicB64], 'fanout');
    expect(out.status).toBe('sealed');
    if (out.status !== 'sealed') return;
    expect(isMultiEnvelope(out.envelope)).toBe(true);
    expect(out.keyStatus).toBe('first-use');
    const pinned = await pinnedPeerKeys('bob');
    expect(pinned?.slice().sort()).toEqual([d1.publicB64, d2.publicB64].sort());
  });

  it('blocks when a new device appears after the set is pinned', async () => {
    const d1 = await mintPeer();
    const d2 = await mintPeer();
    const d3 = await mintPeer();
    await sealDmTrustedToDevices('bob', [d1.publicB64, d2.publicB64], 'first');
    const blocked = await sealDmTrustedToDevices(
      'bob',
      [d1.publicB64, d2.publicB64, d3.publicB64],
      'x',
    );
    expect(blocked.status).toBe('key-changed');
  });
});
