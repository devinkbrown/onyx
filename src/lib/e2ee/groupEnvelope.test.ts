// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  GROUP_ENVELOPE_PREFIX,
  GROUP_LOCKED_PLACEHOLDER,
  buildGroupAad,
  groupMessageDisplayText,
  isGroupEnvelope,
  openGroupMessage,
  openGroupMessageWithKeyring,
  packGroupEnvelope,
  parseGroupEnvelope,
  sealGroupMessage,
  sealGroupMessageWithKeyring,
} from './groupEnvelope';
import { RoomEpochKeyring } from './groupKeyring';

async function testKey(extractable = true): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

async function nonExtractableKey(): Promise<CryptoKey> {
  return testKey(false);
}

describe('groupEnvelope (C1 foundation)', () => {
  it('round-trips a sealed room message with room-bound AAD', async () => {
    const key = await testKey();
    const envelope = await sealGroupMessage(key, ' #Root ', 7, 'hello #root');
    expect(envelope).toBeTruthy();
    expect(isGroupEnvelope(envelope!)).toBe(true);
    expect(envelope!.startsWith(GROUP_ENVELOPE_PREFIX)).toBe(true);
    const parts = parseGroupEnvelope(envelope!);
    expect(parts?.keyEpoch).toBe(7);
    // Normalized room form opens the same AAD.
    await expect(openGroupMessage(key, '#root', envelope!, 7)).resolves.toBe('hello #root');
  });

  it('fails closed on wrong key or epoch', async () => {
    const key = await testKey();
    const other = await testKey();
    const envelope = (await sealGroupMessage(key, '#root', 3, 'secret'))!;
    await expect(openGroupMessage(other, '#root', envelope)).resolves.toBeNull();
    await expect(openGroupMessage(key, '#root', envelope, 99)).resolves.toBeNull();
  });

  it('rejects cross-room replay of the same key material', async () => {
    const key = await testKey();
    const envelope = (await sealGroupMessage(key, '#root', 1, 'room-secret'))!;
    await expect(openGroupMessage(key, '#root', envelope, 1)).resolves.toBe('room-secret');
    // Same AES key, different room context — AAD must fail closed.
    await expect(openGroupMessage(key, '#other', envelope, 1)).resolves.toBeNull();
    await expect(openGroupMessage(key, '&root', envelope, 1)).resolves.toBeNull();
  });

  it('rejects cross-epoch AAD even when the wire epoch header is trusted by the caller', async () => {
    const key = await testKey();
    // Seal under epoch 5; open path builds AAD from parts.keyEpoch.
    const envelope = (await sealGroupMessage(key, '#ops', 5, 'epoch-bound'))!;
    const parts = parseGroupEnvelope(envelope)!;
    expect(parts.keyEpoch).toBe(5);
    await expect(openGroupMessage(key, '#ops', envelope, 5)).resolves.toBe('epoch-bound');
    // Pack a forged envelope reusing nonce/ct under a different epoch label.
    const forged = packGroupEnvelope(6, parts.nonce, parts.ciphertext);
    expect(forged).toBeTruthy();
    await expect(openGroupMessage(key, '#ops', forged!, 6)).resolves.toBeNull();
    // AAD for epoch 5 must not match forged epoch-6 header open.
    await expect(openGroupMessage(key, '#ops', forged!)).resolves.toBeNull();
  });

  it('buildGroupAad normalizes room and fails closed on invalid inputs', () => {
    const a = buildGroupAad(' #Root ', 1);
    const b = buildGroupAad('#root', 1);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!).toEqual(b!);
    expect(buildGroupAad('#root', 2)).not.toEqual(a!);
    expect(buildGroupAad('#other', 1)).not.toEqual(a!);
    expect(buildGroupAad('', 1)).toBeNull();
    expect(buildGroupAad('#root', -1)).toBeNull();
    expect(buildGroupAad('#root', 1.5)).toBeNull();
  });

  it('rejects malformed packs', () => {
    expect(parseGroupEnvelope('not-an-envelope')).toBeNull();
    expect(packGroupEnvelope(-1, new Uint8Array(12), new Uint8Array(16))).toBeNull();
    expect(packGroupEnvelope(1, new Uint8Array(8), new Uint8Array(16))).toBeNull();
  });

  it('display helper never paints ONYXROOM1 ciphertext (fail closed)', async () => {
    const key = await testKey();
    const envelope = (await sealGroupMessage(key, '#root', 1, 'room secret'))!;
    expect(groupMessageDisplayText(envelope)).toBe(GROUP_LOCKED_PLACEHOLDER);
    expect(groupMessageDisplayText(envelope)).not.toContain('room secret');
    expect(groupMessageDisplayText(envelope)).not.toContain(GROUP_ENVELOPE_PREFIX.trim());
    expect(groupMessageDisplayText(envelope, 'opened body')).toBe('opened body');
    expect(groupMessageDisplayText('ordinary room chat')).toBe('ordinary room chat');
  });

  it('keyring helpers seal with active epoch and open retained epochs', async () => {
    const ring = new RoomEpochKeyring();
    const k1 = await nonExtractableKey();
    const k2 = await nonExtractableKey();
    expect(ring.install('#root', 1, k1, 'commit-1')).toBe('installed');
    expect(ring.install('#root', 2, k2, 'commit-2')).toBe('installed');
    expect(ring.activeEpoch('#root')).toBe(2);

    const sealed = await sealGroupMessageWithKeyring(ring, ' #Root ', 'via-active');
    expect(sealed).toBeTruthy();
    expect(parseGroupEnvelope(sealed!)?.keyEpoch).toBe(2);
    await expect(openGroupMessageWithKeyring(ring, '#root', sealed!)).resolves.toBe('via-active');

    // Older epoch remains openable after install of a newer active.
    const old = (await sealGroupMessage(k1, '#root', 1, 'old-epoch'))!;
    await expect(openGroupMessageWithKeyring(ring, '#root', old)).resolves.toBe('old-epoch');
    // Wrong room still fail-closed through the keyring path.
    await expect(openGroupMessageWithKeyring(ring, '#other', sealed!)).resolves.toBeNull();
  });
});
