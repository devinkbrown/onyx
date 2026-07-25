// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  GROUP_ENVELOPE_PREFIX,
  GROUP_LOCKED_PLACEHOLDER,
  groupMessageDisplayText,
  isGroupEnvelope,
  openGroupMessage,
  packGroupEnvelope,
  parseGroupEnvelope,
  sealGroupMessage,
} from './groupEnvelope';

async function testKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

describe('groupEnvelope (C1 foundation)', () => {
  it('round-trips a sealed room message', async () => {
    const key = await testKey();
    const envelope = await sealGroupMessage(key, 7, 'hello #root');
    expect(envelope).toBeTruthy();
    expect(isGroupEnvelope(envelope!)).toBe(true);
    expect(envelope!.startsWith(GROUP_ENVELOPE_PREFIX)).toBe(true);
    const parts = parseGroupEnvelope(envelope!);
    expect(parts?.keyEpoch).toBe(7);
    await expect(openGroupMessage(key, envelope!, 7)).resolves.toBe('hello #root');
  });

  it('fails closed on wrong key or epoch', async () => {
    const key = await testKey();
    const other = await testKey();
    const envelope = (await sealGroupMessage(key, 3, 'secret'))!;
    await expect(openGroupMessage(other, envelope)).resolves.toBeNull();
    await expect(openGroupMessage(key, envelope, 99)).resolves.toBeNull();
  });

  it('rejects malformed packs', () => {
    expect(parseGroupEnvelope('not-an-envelope')).toBeNull();
    expect(packGroupEnvelope(-1, new Uint8Array(12), new Uint8Array(16))).toBeNull();
    expect(packGroupEnvelope(1, new Uint8Array(8), new Uint8Array(16))).toBeNull();
  });

  it('display helper never paints ONYXROOM1 ciphertext (fail closed)', async () => {
    const key = await testKey();
    const envelope = (await sealGroupMessage(key, 1, 'room secret'))!;
    expect(groupMessageDisplayText(envelope)).toBe(GROUP_LOCKED_PLACEHOLDER);
    expect(groupMessageDisplayText(envelope)).not.toContain('room secret');
    expect(groupMessageDisplayText(envelope)).not.toContain(GROUP_ENVELOPE_PREFIX.trim());
    expect(groupMessageDisplayText(envelope, 'opened body')).toBe('opened body');
    expect(groupMessageDisplayText('ordinary room chat')).toBe('ordinary room chat');
  });
});
