// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchChannelDetail,
  netMembershipFlow,
  normalizeChannelDetail,
  parseStatsRoomQuery,
  peakHourShare,
  roomShareOfNetwork,
  statsRoomHref,
} from './channelDetail';

function validDetail() {
  return {
    channel: '#Root',
    generated_at: 1_784_650_000,
    first_seen: 1_784_000_000,
    last_active: 1_784_649_000,
    present: 9,
    last_speaker: 'alice',
    totals: {
      messages: 462,
      words: 4559,
      active_users: 9,
      joins: 101,
      parts: 2,
      quits: 57,
      kicks: 1,
      topic_changes: 3,
    },
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    days: [{ date: '2026-07-20', messages: 205 }, { date: '2026-07-21', messages: 257 }],
    heatmap: Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => day + hour)),
    records: { busiest_day: { date: '2026-07-21', messages: 257 }, peak_hour: 3 },
    top_users: [{ nick: 'ignored', messages: 999 }],
    top_words: [{ word: 'ignored', count: 999 }],
  };
}

describe('normalizeChannelDetail', () => {
  it('normalizes aggregate room rhythm without ingesting participant leaderboards', () => {
    const detail = normalizeChannelDetail(validDetail(), '#root');

    expect(detail).toMatchObject({
      channel: '#Root',
      present: 9,
      lastSpeaker: 'alice',
      totals: { messages: 462, words: 4559, activeUsers: 9, joins: 101 },
      busiestDay: { date: '2026-07-21', messages: 257 },
      peakHour: 3,
      complete: true,
    });
    expect(detail?.hours).toHaveLength(24);
    expect(detail?.heatmap).toHaveLength(7);
    expect(detail).not.toHaveProperty('topUsers');
    expect(detail).not.toHaveProperty('topWords');
  });

  it('rejects a mismatched channel document and degrades malformed matrices safely', () => {
    expect(normalizeChannelDetail(validDetail(), '#elsewhere')).toBeNull();

    const malformed = validDetail();
    malformed.hours = [4];
    malformed.heatmap = [[9]];
    malformed.days = [
      { date: '2026-07-20', messages: 4 },
      { date: '2026-07-20', messages: 999 },
    ];
    malformed.records = { busiest_day: { date: 'not-a-date', messages: 5 }, peak_hour: 99 };
    const detail = normalizeChannelDetail(malformed);

    expect(detail?.complete).toBe(false);
    expect(detail?.hours).toEqual(Array.from({ length: 24 }, () => 0));
    expect(detail?.heatmap).toHaveLength(7);
    expect(detail?.days).toEqual([{ date: '2026-07-20', messages: 4 }]);
    expect(detail?.busiestDay).toBeNull();
    expect(detail?.peakHour).toBeNull();
  });
});

describe('fetchChannelDetail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the server-compatible slug and keeps failures non-fatal', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validDetail())));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChannelDetail('#Root')).resolves.toMatchObject({ channel: '#Root' });
    expect(fetchMock).toHaveBeenCalledWith('/stats/data/root.json', expect.any(Object));

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchChannelDetail('#Root')).resolves.toBeNull();
  });
});

describe('channel rhythm helpers', () => {
  it('computes room share, peak concentration, and net membership flow', () => {
    expect(roomShareOfNetwork(25, 100)).toBe(25);
    expect(roomShareOfNetwork(10, 0)).toBeNull();
    expect(peakHourShare([0, 0, 8, 2])).toBe(80);
    expect(peakHourShare([0, 0, 0])).toBe(0);
    expect(netMembershipFlow({
      messages: 12,
      words: 40,
      activeUsers: 3,
      joins: 10,
      parts: 2,
      quits: 1,
      kicks: 1,
      topicChanges: 0,
    })).toBe(6);
  });

  it('builds and parses public room inspector links without accepting injection', () => {
    expect(statsRoomHref('#root')).toBe('/stats/?room=%23root');
    expect(parseStatsRoomQuery('?room=%23root')).toBe('#root');
    expect(parseStatsRoomQuery('room=ops')).toBe('#ops');
    expect(parseStatsRoomQuery('?room=%26ops')).toBe('&ops');
    expect(parseStatsRoomQuery('?room=%23evil,%20x')).toBe('');
    expect(parseStatsRoomQuery('?room=')).toBe('');
  });
});
