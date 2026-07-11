// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { normalizeIndex, relTime } from './networkIndex';

describe('normalizeIndex', () => {
  it('returns null when the external feed has no channel list', () => {
    expect(normalizeIndex(null)).toBeNull();
    expect(normalizeIndex({ network: 'IRCXNet' })).toBeNull();
  });

  it('normalizes network metadata, day totals, channels, and sparse spark values', () => {
    const index = normalizeIndex({
      generated_at: 1783500000,
      network: 'IRCXNet',
      node: 'eshmaki.me',
      users_online: 12,
      network_days: [
        { date: '2026-07-10', messages: 4.8 },
        { date: '2026-07-11', messages: -2 },
        { date: '', messages: 99 },
        { nope: true },
      ],
      channels: [
        {
          channel: '#root',
          messages: 10,
          active_users: 3,
          present: 5,
          last_active: 1783499900,
          topic: 'Ops',
          spark: [1, -1, '2', 4.5],
        },
        { channel: '', messages: 999 },
        { channel: '#quiet' },
      ],
    });

    expect(index).toEqual({
      generated_at: 1783500000,
      network: 'IRCXNet',
      node: 'eshmaki.me',
      users_online: 12,
      network_days: [
        { date: '2026-07-10', messages: 4 },
        { date: '2026-07-11', messages: 0 },
      ],
      channels: [
        {
          channel: '#root',
          messages: 10,
          active_users: 3,
          present: 5,
          last_active: 1783499900,
          topic: 'Ops',
          spark: [1, 0, 0, 4.5],
        },
        {
          channel: '#quiet',
          messages: 0,
          active_users: 0,
          present: 0,
          last_active: 0,
          topic: '',
          spark: [],
        },
      ],
    });
  });
});

describe('relTime', () => {
  it('keeps the empty timestamp fallback', () => {
    expect(relTime(0, Date.parse('2026-07-08T12:00:00Z'))).toBe('a while ago');
  });

  it('uses the shared compact relative formatter for valid timestamps', () => {
    const now = Date.parse('2026-07-08T12:00:00Z');

    expect(relTime(Date.parse('2026-07-08T11:57:00Z') / 1000, now)).toBe('3m ago');
    expect(relTime(Date.parse('2026-07-08T14:00:00Z') / 1000, now)).toBe('in 2h');
  });
});
