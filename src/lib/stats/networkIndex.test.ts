// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_STATS_CHANNEL_LENGTH,
  MAX_STATS_CHANNELS,
  MAX_STATS_DAYS,
  MAX_STATS_SPARK_POINTS,
  MAX_STATS_TOPIC_LENGTH,
  normalizeIndex,
  fetchStatsIndex,
  relTime,
} from './networkIndex';

describe('fetchStatsIndex continuity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('keeps the last populated public index through a transient empty restart feed', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        generated_at: 1_783_500_000, users_online: 8, channels: [{ channel: '#root', messages: 42 }], network_days: [],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        generated_at: 1_783_500_030, users_online: 8, channels: [], network_days: [],
      }))));

    expect((await fetchStatsIndex())?.channels[0]?.channel).toBe('#root');
    expect((await fetchStatsIndex())?.channels[0]?.channel).toBe('#root');
  });
});

describe('normalizeIndex', () => {
  it('returns null when the external feed has no channel list', () => {
    expect(normalizeIndex(null)).toBeNull();
    expect(normalizeIndex({ network: 'Onyx' })).toBeNull();
  });

  it('normalizes network metadata, day totals, channels, and sparse spark values', () => {
    const index = normalizeIndex({
      generated_at: 1783500000,
      network: 'Onyx',
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
      network: 'Onyx',
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
      network_days_complete: false,
      channels_complete: false,
    });
  });

  it('bounds feed work, strings, arrays, and non-finite counters', () => {
    const channels = Array.from({ length: MAX_STATS_CHANNELS + 5 }, (_, index) => ({
      channel: `#room-${index}`,
      messages: index === 0 ? Number.POSITIVE_INFINITY : index,
      active_users: index === 0 ? -1 : index,
      present: index,
      last_active: index === 0 ? Number.NaN : index,
      topic: 't'.repeat(MAX_STATS_TOPIC_LENGTH + 50),
      spark: Array.from({ length: MAX_STATS_SPARK_POINTS + 3 }, (__, sparkIndex) => (
        sparkIndex === MAX_STATS_SPARK_POINTS + 2 ? Number.POSITIVE_INFINITY : sparkIndex
      )),
    }));
    channels[1]!.channel = `#${'c'.repeat(MAX_STATS_CHANNEL_LENGTH)}`;
    const networkDays = Array.from({ length: MAX_STATS_DAYS + 2 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      messages: index,
    }));

    const index = normalizeIndex({
      generated_at: Number.POSITIVE_INFINITY,
      network: 'n'.repeat(300),
      node: 'o'.repeat(300),
      users_online: -10,
      network_days: networkDays,
      channels,
    })!;

    expect(index.channels).toHaveLength(MAX_STATS_CHANNELS - 1);
    expect(index.channels[0]).toMatchObject({ messages: 0, active_users: 0, last_active: 0 });
    expect(index.channels[0]!.topic).toHaveLength(MAX_STATS_TOPIC_LENGTH);
    expect(index.channels[0]!.spark).toHaveLength(MAX_STATS_SPARK_POINTS);
    expect(index.channels[0]!.spark.at(-1)).toBe(0);
    expect(index.network_days).toHaveLength(MAX_STATS_DAYS);
    expect(index.generated_at).toBe(0);
    expect(index.users_online).toBe(0);
    expect(index.network).toHaveLength(256);
    expect(index.node).toHaveLength(256);
    expect(index.network_days_complete).toBe(false);
    expect(index.channels_complete).toBe(false);
  });

  it('renders one canonical row for case-insensitive duplicate channels', () => {
    const index = normalizeIndex({
      network_days: [
        { date: '2026-07-15', messages: 4 },
        { date: '2026-07-15', messages: 999 },
        { date: '2026-07-16', messages: 8 },
      ],
      channels: [
        { channel: '#Root', messages: 12, present: 3 },
        { channel: '#root', messages: 999, present: 99 },
        { channel: '#Elsewhere', messages: 4, present: 1 },
      ],
    })!;

    expect(index.channels.map((channel) => channel.channel)).toEqual(['#Root', '#Elsewhere']);
    expect(index.channels[0]).toMatchObject({ messages: 12, present: 3 });
    expect(index.network_days).toEqual([
      { date: '2026-07-15', messages: 4 },
      { date: '2026-07-16', messages: 8 },
    ]);
    expect(index.network_days_complete).toBe(false);
    expect(index.channels_complete).toBe(false);
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

  it('fails safely for non-finite and out-of-range feed timestamps', () => {
    expect(relTime(Number.POSITIVE_INFINITY, Date.now())).toBe('a while ago');
    expect(relTime(1, Number.NaN)).toBe('a while ago');
    expect(relTime(9_000_000_000_000, Date.now())).toBe('a while ago');
  });
});
