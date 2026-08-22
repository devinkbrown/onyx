// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FORMATION_WINDOW_MS, emptyFormationMemory } from './formationLoop';
import {
  FORMATION_MEMORY_KEY,
  foldFormationMemory,
  inviteChannelFromSearch,
  readFormationMemory,
  rememberExpectedNicks,
  resetFormationMemoryForTests,
  writeFormationMemory,
} from './formationMemory';

const OWNER = { serverUrl: 'wss://example.test', identity: 'me' } as const;
const NOW = Date.parse('2026-08-22T18:00:00.000Z');

beforeEach(() => {
  resetFormationMemoryForTests();
});

afterEach(() => {
  resetFormationMemoryForTests();
});

describe('foldFormationMemory', () => {
  it('records a founder the first time we are the only member', () => {
    const next = foldFormationMemory({
      nowMs: NOW,
      ourNick: 'me',
      pendingJoin: null,
      memory: emptyFormationMemory(),
      channels: [{
        name: '#lounge',
        createdAtMs: NOW - 1_000,
        members: [{ nick: 'me', modes: ['Q'], hasChat: false }],
      }],
    });
    expect(next.rooms['#lounge']).toMatchObject({
      role: 'founder',
      firstSeenAt: NOW - 1_000,
      firstJoiner: null,
    });
  });

  it('remembers the first other person who actually appears', () => {
    const started = foldFormationMemory({
      nowMs: NOW - 60_000,
      ourNick: 'me',
      pendingJoin: null,
      memory: emptyFormationMemory(),
      channels: [{
        name: '#lounge',
        createdAtMs: NOW - 60_000,
        members: [{ nick: 'me', modes: ['Q'], hasChat: false }],
      }],
    });
    const next = foldFormationMemory({
      nowMs: NOW,
      ourNick: 'me',
      pendingJoin: null,
      memory: started,
      channels: [{
        name: '#lounge',
        createdAtMs: NOW - 60_000,
        members: [
          { nick: 'me', modes: ['Q'], hasChat: false },
          { nick: 'Alex', modes: [], hasChat: false },
        ],
      }],
    });
    expect(next.rooms['#lounge']?.firstJoiner).toBe('Alex');
  });

  it('keeps invite context from a pending join or ?join= search', () => {
    const fromPending = foldFormationMemory({
      nowMs: NOW,
      ourNick: 'alex',
      pendingJoin: '#lounge',
      memory: emptyFormationMemory(),
      channels: [{
        name: '#lounge',
        createdAtMs: NOW,
        members: [
          { nick: 'Mira', modes: ['Q'], hasChat: false },
          { nick: 'alex', modes: [], hasChat: false },
        ],
      }],
    });
    expect(fromPending.inviteChannel).toBe('#lounge');
    expect(fromPending.rooms['#lounge']?.role).toBe('joiner');

    const fromSearch = foldFormationMemory({
      nowMs: NOW,
      ourNick: 'alex',
      pendingJoin: null,
      locationSearch: '?join=%23kitchen',
      memory: emptyFormationMemory(),
      channels: [],
    });
    expect(fromSearch.inviteChannel).toBe('#kitchen');
  });

  it('drops rooms older than 48h and ignores invented nicks', () => {
    const next = foldFormationMemory({
      nowMs: NOW,
      ourNick: 'me',
      pendingJoin: null,
      memory: {
        rooms: {
          '#old': {
            firstSeenAt: NOW - FORMATION_WINDOW_MS - 5,
            role: 'founder',
            firstJoiner: null,
            expectedNicks: ['<script>', 'ok'],
          },
        },
        inviteChannel: 'not-a-room',
      },
      channels: [{
        name: '#old',
        createdAtMs: NOW - FORMATION_WINDOW_MS - 5,
        members: [{ nick: 'me', modes: ['Q'], hasChat: false }],
      }],
    });
    expect(next.rooms['#old']).toBeUndefined();
    expect(next.inviteChannel).toBeNull();
  });
});

describe('formationMemory persistence', () => {
  it('round-trips owner-scoped storage and ignores hostile payloads', () => {
    const written = writeFormationMemory({
      rooms: {
        '#lounge': {
          firstSeenAt: NOW - 10,
          role: 'founder',
          firstJoiner: 'Alex',
          expectedNicks: ['Alex'],
        },
      },
      inviteChannel: '#lounge',
    }, OWNER, NOW);
    expect(readFormationMemory(OWNER, NOW)).toEqual(written);
    expect(Object.keys(localStorage).some((key) => key.startsWith(FORMATION_MEMORY_KEY))).toBe(true);

    const key = Object.keys(localStorage).find((item) => item.startsWith(FORMATION_MEMORY_KEY));
    localStorage.setItem(key!, '{"rooms":{"#x":{"firstSeenAt":"nope"}}}');
    expect(readFormationMemory(OWNER, NOW)).toEqual(emptyFormationMemory());
  });

  it('remembers expected names only when they are real nicks', () => {
    const base = writeFormationMemory({
      rooms: {
        '#lounge': {
          firstSeenAt: NOW,
          role: 'founder',
          firstJoiner: null,
          expectedNicks: [],
        },
      },
      inviteChannel: null,
    }, OWNER, NOW);
    const next = rememberExpectedNicks(base, '#lounge', ['Alex', 'bad nick', 'Alex'], NOW);
    expect(next.rooms['#lounge']?.expectedNicks).toEqual(['Alex']);
  });
});

describe('inviteChannelFromSearch', () => {
  it('reuses the existing ?join= validator', () => {
    expect(inviteChannelFromSearch('?join=%23lounge')).toBe('#lounge');
    expect(inviteChannelFromSearch('?join=nope')).toBeNull();
  });
});
