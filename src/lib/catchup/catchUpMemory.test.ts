// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CatchUpItem } from '@/lib/notifications/catchUp';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import {
  buildCatchUpMemorySnapshot,
  catchUpItemFromMemory,
  CATCH_UP_MEMORY_KEY,
  CATCH_UP_MEMORY_LIMIT,
  clearCatchUpMemory,
  firstUnreadMapFromMemory,
  parseCatchUpMemoryItems,
  readCatchUpMemory,
  sanitizeCatchUpMemoryItem,
  writeCatchUpMemory,
} from './catchUpMemory';

const OWNER: DeviceMemoryOwner = {
  serverUrl: 'wss://example.test',
  identity: 'mira',
};

function item(over: Partial<CatchUpItem> = {}): CatchUpItem {
  return {
    key: over.key ?? 'c:#room',
    kind: over.kind ?? 'channel',
    name: over.name ?? '#room',
    target: over.target ?? '#room',
    unread: over.unread ?? 3,
    highlights: over.highlights ?? 1,
    followed: over.followed ?? false,
    lastActivity: over.lastActivity ?? 1_000,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('sanitizeCatchUpMemoryItem', () => {
  it('accepts a well-formed channel row and rejects zero-activity rows', () => {
    expect(sanitizeCatchUpMemoryItem({
      key: 'c:#root',
      kind: 'channel',
      name: '#root',
      target: '#root',
      unread: 2,
      highlights: 1,
      followed: true,
      lastActivity: 50,
      firstUnreadId: 'msg-1',
      preview: 'hello',
      messageCount: 2,
      mentionCount: 1,
      firstMessageId: 'msg-1',
      firstAt: '2026-07-19T00:00:00.000Z',
      voices: ['kai'],
    })).toMatchObject({
      target: '#root',
      unread: 2,
      highlights: 1,
      followed: true,
      firstUnreadId: 'msg-1',
      voices: ['kai'],
    });

    expect(sanitizeCatchUpMemoryItem({
      kind: 'channel',
      name: '#root',
      target: '#root',
      unread: 0,
      highlights: 0,
      lastActivity: 1,
    })).toBeNull();
  });

  it('rejects channel/DM target mismatches and control characters', () => {
    expect(sanitizeCatchUpMemoryItem({
      kind: 'channel',
      name: 'alice',
      target: 'alice',
      unread: 1,
      highlights: 0,
      lastActivity: 1,
    })).toBeNull();

    expect(sanitizeCatchUpMemoryItem({
      kind: 'dm',
      name: '#room',
      target: '#room',
      unread: 1,
      highlights: 0,
      lastActivity: 1,
    })).toBeNull();

    expect(sanitizeCatchUpMemoryItem({
      kind: 'channel',
      name: '#ro\u0000om',
      target: '#room',
      unread: 1,
      highlights: 0,
      lastActivity: 1,
    })).toBeNull();
  });
});

describe('parseCatchUpMemoryItems', () => {
  it('dedupes by target, ranks mentions/DMs first, and bounds length', () => {
    const many = Array.from({ length: CATCH_UP_MEMORY_LIMIT + 4 }, (_, index) => ({
      kind: 'channel' as const,
      name: `#r${index}`,
      target: `#r${index}`,
      unread: 1,
      highlights: 0,
      lastActivity: index,
    }));
    const parsed = parseCatchUpMemoryItems([
      {
        kind: 'channel',
        name: '#old',
        target: '#Room',
        unread: 1,
        highlights: 0,
        lastActivity: 10,
      },
      {
        kind: 'channel',
        name: '#Room',
        target: '#Room',
        unread: 4,
        highlights: 2,
        lastActivity: 20,
      },
      {
        kind: 'dm',
        name: 'alice',
        target: 'alice',
        unread: 1,
        highlights: 0,
        lastActivity: 5,
      },
      ...many,
    ]);

    expect(parsed[0]?.kind).toBe('channel');
    expect(parsed[0]?.target).toBe('#Room');
    expect(parsed[0]?.highlights).toBe(2);
    expect(parsed.some((row) => row.kind === 'dm' && row.target === 'alice')).toBe(true);
    expect(parsed).toHaveLength(CATCH_UP_MEMORY_LIMIT);
  });

  it('fails closed on non-arrays and hostile oversize payloads', () => {
    expect(parseCatchUpMemoryItems(null)).toEqual([]);
    expect(parseCatchUpMemoryItems({ items: [] })).toEqual([]);
  });
});

describe('buildCatchUpMemorySnapshot', () => {
  it('attaches first-unread boundaries and recap seeds without mutating inputs', () => {
    const live = [
      item({ target: '#room', name: '#room', key: 'c:#room', unread: 2, highlights: 1 }),
      item({ kind: 'dm', target: 'kai', name: 'kai', key: 'd:kai', unread: 1, highlights: 0 }),
    ];
    const firstUnreadId = new Map<string, string | null>([
      ['#room', 'msg-a'],
      ['kai', null],
    ]);
    const recaps = new Map([
      ['#room', {
        preview: 'latest line',
        messageCount: 2,
        mentionCount: 1,
        firstMessageId: 'msg-a',
        firstAt: '2026-07-19T12:00:00.000Z',
        voices: ['kai', 'mira'],
      }],
    ]);

    const snapshot = buildCatchUpMemorySnapshot(live, { firstUnreadId, recaps });
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({
      target: '#room',
      firstUnreadId: 'msg-a',
      preview: 'latest line',
      voices: ['kai', 'mira'],
    });
    expect(snapshot.find((row) => row.target === 'kai')?.firstUnreadId).toBeNull();
    expect(live[0]?.unread).toBe(2);
  });
});

describe('read/writeCatchUpMemory', () => {
  it('persists per owner and never leaks across identities', () => {
    const other: DeviceMemoryOwner = {
      serverUrl: 'wss://example.test',
      identity: 'other',
    };
    writeCatchUpMemory([
      {
        kind: 'channel',
        name: '#root',
        target: '#root',
        unread: 3,
        highlights: 1,
        lastActivity: 99,
        firstUnreadId: 'm1',
        preview: 'ping',
        messageCount: 3,
        mentionCount: 1,
        firstMessageId: 'm1',
        firstAt: '2026-07-19T00:00:00.000Z',
        voices: ['kai'],
      },
    ], OWNER);

    expect(readCatchUpMemory(OWNER)).toHaveLength(1);
    expect(readCatchUpMemory(other)).toEqual([]);
    expect(localStorage.getItem(CATCH_UP_MEMORY_KEY)).toBeNull();

    clearCatchUpMemory(OWNER);
    expect(readCatchUpMemory(OWNER)).toEqual([]);
  });

  it('clears storage when writing an empty snapshot', () => {
    writeCatchUpMemory([
      {
        kind: 'dm',
        name: 'kai',
        target: 'kai',
        unread: 1,
        highlights: 0,
        lastActivity: 1,
      },
    ], OWNER);
    expect(readCatchUpMemory(OWNER)).toHaveLength(1);
    writeCatchUpMemory([], OWNER);
    expect(readCatchUpMemory(OWNER)).toEqual([]);
  });
});

describe('projection helpers', () => {
  it('projects memory rows to catch-up items and first-unread maps', () => {
    const memory = buildCatchUpMemorySnapshot([
      item({ target: '#a', name: '#a', key: 'c:#a', highlights: 1 }),
    ], {
      firstUnreadId: new Map([['#a', 'id-1']]),
    });
    expect(catchUpItemFromMemory(memory[0]!)).toEqual({
      key: 'c:#a',
      kind: 'channel',
      name: '#a',
      target: '#a',
      unread: 3,
      highlights: 1,
      followed: false,
      lastActivity: 1_000,
    });
    expect(firstUnreadMapFromMemory(memory).get('#a')).toBe('id-1');
  });
});
