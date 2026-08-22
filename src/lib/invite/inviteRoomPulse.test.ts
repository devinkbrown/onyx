// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { ChannelDetail } from '@/lib/stats/channelDetail';
import type { StatsChannel, StatsIndex } from '@/lib/stats/networkIndex';

import { formatInvitePulse, loadInviteRoomPulse } from './inviteRoomPulse';

const NOW_MS = Date.UTC(2026, 7, 22, 21, 0, 0);

function indexWith(room: Partial<StatsChannel> & { channel: string }): StatsIndex {
  return {
    generated_at: 1_784_650_000,
    network: 'Onyx',
    node: 'eshmaki.me',
    users_online: 12,
    network_days: [],
    channels: [{
      channel: room.channel,
      messages: room.messages ?? 10,
      active_users: room.active_users ?? 4,
      present: room.present ?? 12,
      last_active: room.last_active ?? 0,
      topic: room.topic ?? '',
      spark: [],
    }],
    network_days_complete: true,
    channels_complete: true,
  };
}

function detailWith(over: Partial<ChannelDetail> = {}): ChannelDetail {
  return {
    channel: '#lounge',
    generatedAt: 1_784_650_000,
    firstSeen: 1_784_000_000,
    lastActive: 0,
    present: 12,
    lastSpeaker: '',
    totals: {
      messages: 0,
      words: 0,
      activeUsers: 0,
      joins: 0,
      parts: 0,
      quits: 0,
      kicks: 0,
      topicChanges: 0,
    },
    hours: Array.from({ length: 24 }, () => 0),
    days: [],
    heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    busiestDay: null,
    peakHour: null,
    complete: false,
    ...over,
  };
}

describe('formatInvitePulse', () => {
  it('uses a real timestamp and maps just-now to just started', () => {
    expect(formatInvitePulse(NOW_MS / 1000 - 5 * 60, NOW_MS, false)).toBe('5m ago');
    expect(formatInvitePulse(NOW_MS / 1000 - 10, NOW_MS, false)).toBe('just started');
  });

  it('says just started only when the room is known and empty', () => {
    expect(formatInvitePulse(0, NOW_MS, true)).toBe('just started');
    expect(formatInvitePulse(0, NOW_MS, false)).toBeNull();
  });
});

describe('loadInviteRoomPulse', () => {
  it('returns topic, last pulse, and last speaker without a present count', async () => {
    const pulse = await loadInviteRoomPulse('#lounge', {
      nowMs: NOW_MS,
      fetchIndex: async () => indexWith({
        channel: '#lounge',
        topic: 'Friday hangout',
        last_active: NOW_MS / 1000 - 3 * 60,
        present: 12,
        messages: 40,
      }),
      fetchDetail: async () => detailWith({
        lastSpeaker: 'aria',
        lastActive: NOW_MS / 1000 - 3 * 60,
        present: 12,
      }),
    });

    expect(pulse).toEqual({
      topic: 'Friday hangout',
      lastPulse: '3m ago',
      faces: ['aria'],
    });
    expect(JSON.stringify(pulse)).not.toMatch(/12|online|present/i);
  });

  it('omits every row when the public feeds have nothing for the room', async () => {
    const pulse = await loadInviteRoomPulse('#secret', {
      nowMs: NOW_MS,
      fetchIndex: async () => indexWith({ channel: '#lounge' }),
      fetchDetail: async () => null,
    });

    expect(pulse).toBeNull();
  });

  it('drops an invalid last speaker instead of inventing faces', async () => {
    const pulse = await loadInviteRoomPulse('#lounge', {
      nowMs: NOW_MS,
      fetchIndex: async () => indexWith({
        channel: '#lounge',
        topic: '',
        last_active: 0,
        messages: 0,
        present: 12,
      }),
      fetchDetail: async () => detailWith({ lastSpeaker: 'bad nick' }),
    });

    expect(pulse).toEqual({
      topic: null,
      lastPulse: 'just started',
      faces: [],
    });
  });

  it('returns null when both public fetches fail', async () => {
    await expect(loadInviteRoomPulse('#lounge', {
      fetchIndex: async () => { throw new Error('offline'); },
      fetchDetail: async () => { throw new Error('offline'); },
    })).resolves.toBeNull();
  });
});
