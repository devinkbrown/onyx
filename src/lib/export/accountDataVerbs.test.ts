// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { parseVaultExport } from '@/lib/vault/historyVault';
import * as historyVault from '@/lib/vault/historyVault';
import { getState } from '@/lib/store';

import {
  ACCOUNT_DATA_VERB_COPY,
  ACCOUNT_STORE_RECORD_KIND,
  DEVICE_HISTORY_COPY_KIND,
  accountStoreRecordFilename,
  buildAccountStoreRecord,
  buildDeviceHistoryCopy,
  collectDeviceHistoryCopy,
  deviceHistoryCopyFilename,
  roomsOwnedByNick,
} from './accountDataVerbs';

function room(name: string, nick: string) {
  return {
    target: name,
    messages: [{
      id: `${name}-1`,
      time: new Date('2026-08-01T12:00:00.000Z'),
      from: nick,
      text: 'hello',
      type: 'msg',
      target: name,
    }],
  };
}

describe('account data verbs — copy and shapes', () => {
  it('keeps three distinct labels and never a Your data bundle', () => {
    const titles = [
      ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.title,
      ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.title,
      ACCOUNT_DATA_VERB_COPY.deleteAccount.title,
    ];
    expect(new Set(titles).size).toBe(3);
    expect(JSON.stringify(ACCOUNT_DATA_VERB_COPY)).not.toMatch(/your data/i);
    expect(JSON.stringify(ACCOUNT_DATA_VERB_COPY)).not.toMatch(/\.zip/i);
    expect(ACCOUNT_STORE_RECORD_KIND).not.toBe(DEVICE_HISTORY_COPY_KIND);
  });

  it('download copy names account metadata, not chat', () => {
    expect(ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.hint).toBe(
      'Nick, email, and rooms you own. Not the chat.',
    );
    expect(ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.historyNote).toBe(
      'History lives on this device.',
    );
  });

  it('device-history copy names the local cap and refuses reimport', () => {
    expect(ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.hint).toBe(
      'The last ~400 messages per room on this device. You cannot load this back in.',
    );
  });

  it('delete copy does not claim other people lose their copies', () => {
    expect(ACCOUNT_DATA_VERB_COPY.deleteAccount.hint).toBe(
      'This removes your identity. Other people keep their own copies.',
    );
  });
});

describe('account store record', () => {
  it('exports only metadata the client already knows', () => {
    const record = buildAccountStoreRecord({
      nick: 'Alice',
      account: 'alice',
      email: 'alice@example.net',
      registeredAt: '2024-02-01',
      now: new Date('2026-08-22T12:00:00.000Z'),
      rooms: [
        { name: '#harbor', users: new Map([['alice', { modes: ['q'] }]]) },
        { name: '#lounge', users: new Map([['alice', { modes: ['o'] }]]) },
        { name: '#founders', users: new Map([['alice', { modes: ['Q'] }]]) },
      ],
    });

    expect(record).toMatchObject({
      kind: ACCOUNT_STORE_RECORD_KIND,
      nick: 'Alice',
      account: 'alice',
      email: 'alice@example.net',
      registeredAt: '2024-02-01',
      roomsOwned: ['#founders', '#harbor'],
      note: ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.hint,
      historyNote: ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.historyNote,
    });
    expect(JSON.stringify(record)).not.toMatch(/your data/i);
    expect(accountStoreRecordFilename(record)).toBe('onyx-account-record-alice-2026-08-22.json');
    expect(accountStoreRecordFilename(record)).not.toMatch(/your-data|\.zip/i);
  });

  it('omits email and owned rooms the client does not know', () => {
    const record = buildAccountStoreRecord({
      nick: 'alice',
      account: 'alice',
      now: new Date('2026-08-22T12:00:00.000Z'),
    });
    expect(record.email).toBeUndefined();
    expect(record.registeredAt).toBeUndefined();
    expect(record.roomsOwned).toEqual([]);
  });

  it('roomsOwnedByNick only lists founder or owner modes already on the roster', () => {
    expect(roomsOwnedByNick([
      { name: '#ops', users: new Map([['alice', { modes: new Set(['q', 'o']) }]]) },
      { name: '#chat', users: new Map([['bob', { modes: ['Q'] }]]) },
    ], 'alice')).toEqual(['#ops']);
  });
});

describe('device history copy', () => {
  it('labels a local dump and is not a vault import', () => {
    const copy = buildDeviceHistoryCopy({
      exportedAt: '2026-08-22T12:00:00.000Z',
      targets: [room('#harbor', 'alice')],
    });
    expect(copy.kind).toBe(DEVICE_HISTORY_COPY_KIND);
    expect(copy.reimportable).toBe(false);
    expect(copy.keepPerRoom).toBe(400);
    expect(copy.note).toBe(ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.hint);
    expect(copy.rooms[0]?.messageCount).toBe(1);
    expect(parseVaultExport(copy)).toBeNull();
    expect(deviceHistoryCopyFilename(copy)).toBe('onyx-device-history-2026-08-22.json');
    expect(deviceHistoryCopyFilename(copy)).not.toMatch(/your-data|\.zip/i);
  });

  it('does not raise the per-room cap and drops transient plaintext', () => {
    const messages = Array.from({ length: 402 }, (_, i) => ({
      id: `m${i}`,
      time: new Date('2026-08-22T12:00:00.000Z'),
      from: 'bob',
      text: `cipher-${i}`,
      plaintext: `plain-${i}`,
      type: 'msg' as const,
      target: '#harbor',
    }));
    const copy = buildDeviceHistoryCopy({
      exportedAt: '2026-08-22T12:00:00.000Z',
      targets: [{ target: '#harbor', messages }],
    });
    expect(copy.rooms[0]?.messageCount).toBe(400);
    expect(copy.rooms[0]?.messages[0]?.text).toBe('cipher-2');
    expect(copy.rooms[0]?.messages.at(-1)?.text).toBe('cipher-401');
    expect(JSON.stringify(copy)).not.toContain('plain-');
  });

  it('collectDeviceHistoryCopy reads the vault and never drops the account', async () => {
    const drop = vi.spyOn(getState(), 'dropAccount');
    const vault = vi.spyOn(historyVault, 'exportVault').mockResolvedValue({
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-08-22T12:00:00.000Z',
      targets: [room('#harbor', 'alice')],
    });

    const copy = await collectDeviceHistoryCopy({
      serverUrl: 'wss://eshmaki.me',
      identity: 'alice',
    });

    expect(vault).toHaveBeenCalledOnce();
    expect(copy.kind).toBe(DEVICE_HISTORY_COPY_KIND);
    expect(drop).not.toHaveBeenCalled();
  });
});
