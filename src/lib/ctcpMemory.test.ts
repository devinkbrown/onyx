// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  CTCP_CONFIG_STORAGE_KEY,
  DEFAULT_CTCP_CONFIG,
  loadCtcpConfig,
  normalizeCtcpConfig,
  normalizeCtcpVersionReply,
  saveCtcpConfig,
} from './ctcpMemory';

const endpoint = 'wss://ctcp-memory.example/ws';
const alice = { serverUrl: endpoint, identity: 'alice' } as const;
const bob = { serverUrl: endpoint, identity: 'bob' } as const;
const aliceElsewhere = { serverUrl: 'wss://elsewhere.example/ws', identity: 'alice' } as const;

function storageKey(owner = alice): string {
  return deviceMemoryStorageKey(CTCP_CONFIG_STORAGE_KEY, owner)!;
}

describe('account-scoped CTCP configuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('isolates exact endpoint+account/guest owners and purges ownerless legacy replies', () => {
    localStorage.setItem(CTCP_CONFIG_STORAGE_KEY, JSON.stringify({
      versionReply: 'Legacy private build',
      timeEnabled: false,
    }));

    expect(saveCtcpConfig({ versionReply: 'Alice client', timeEnabled: false }, alice))
      .toEqual({ versionReply: 'Alice client', timeEnabled: false });
    expect(saveCtcpConfig({ versionReply: 'Bob client', timeEnabled: true }, bob))
      .toEqual({ versionReply: 'Bob client', timeEnabled: true });

    expect(loadCtcpConfig(alice)).toEqual({ versionReply: 'Alice client', timeEnabled: false });
    expect(loadCtcpConfig(bob)).toEqual({ versionReply: 'Bob client', timeEnabled: true });
    expect(loadCtcpConfig(aliceElsewhere)).toEqual(DEFAULT_CTCP_CONFIG);
    expect(localStorage.getItem(CTCP_CONFIG_STORAGE_KEY)).toBeNull();
  });

  it('bounds reply text and strips IRC line or CTCP framing bytes', () => {
    expect(normalizeCtcpVersionReply('Custom\r\n\0\x01Reply')).toBe('CustomReply');
    expect(normalizeCtcpVersionReply('x'.repeat(300))).toHaveLength(256);
    expect(normalizeCtcpConfig({
      versionReply: 'Safe\nVERSION forged',
      timeEnabled: false,
    })).toEqual({
      versionReply: 'SafeVERSION forged',
      timeEnabled: false,
    });
    expect(normalizeCtcpConfig({ versionReply: 7, timeEnabled: 'yes' }))
      .toEqual(DEFAULT_CTCP_CONFIG);
    expect(normalizeCtcpConfig([])).toEqual(DEFAULT_CTCP_CONFIG);
  });

  it('fails closed without an owner or for malformed, oversized, and wrong-shape storage', () => {
    expect(saveCtcpConfig({ versionReply: 'Ownerless', timeEnabled: false })).toBeNull();
    expect(loadCtcpConfig()).toEqual(DEFAULT_CTCP_CONFIG);
    expect(localStorage.length).toBe(0);

    localStorage.setItem(storageKey(), '{bad-json');
    expect(loadCtcpConfig(alice)).toEqual(DEFAULT_CTCP_CONFIG);

    localStorage.setItem(storageKey(), 'x'.repeat(64 * 1024 + 1));
    expect(loadCtcpConfig(alice)).toEqual(DEFAULT_CTCP_CONFIG);

    localStorage.setItem(storageKey(), JSON.stringify(['hostile', false]));
    expect(loadCtcpConfig(alice)).toEqual(DEFAULT_CTCP_CONFIG);

    expect(saveCtcpConfig(DEFAULT_CTCP_CONFIG, alice)).toEqual(DEFAULT_CTCP_CONFIG);
    expect(localStorage.getItem(storageKey())).toBeNull();
  });

  it('reports write failure instead of changing the caller-visible contract', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    expect(saveCtcpConfig({ versionReply: 'Not retained', timeEnabled: false }, alice)).toBeNull();
  });
});
