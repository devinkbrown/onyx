// ─────────────────────────────────────────────────────────────────────────────
// Unit coverage for the since-you-left digest model.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  buildSinceDigest,
  digestHeadline,
  type DigestMessage,
  type SinceDigest,
} from './sinceDigest';

const SINCE = new Date('2026-01-01T00:00:00.000Z');

function atOffset(ms: number): Date {
  return new Date(SINCE.getTime() + ms);
}

function message(
  channel: string,
  nick: string,
  at: Date,
  isMention = false,
): DigestMessage {
  return { channel, nick, at, isMention };
}

describe('buildSinceDigest', () => {
  it('keeps only messages strictly after since in non-empty channels', () => {
    const digest = buildSinceDigest(
      [
        message('#alpha', 'Kai', atOffset(-1)),
        message('#alpha', 'Mira', SINCE),
        message('', 'NoChannel', atOffset(1), true),
        message('#alpha', 'Nia', atOffset(2), true),
      ],
      SINCE,
    );

    expect(digest.totalMessages).toBe(1);
    expect(digest.totalMentions).toBe(1);
    expect(digest.activeChannels).toBe(1);
    expect(digest.channels).toHaveLength(1);
    expect(digest.channels[0]).toMatchObject({
      channel: '#alpha',
      count: 1,
      mentions: 1,
      participants: ['Nia'],
    });
  });

  it('groups counts, mentions, participants, and first and last activity per channel', () => {
    const earliest = atOffset(1_000);
    const middle = atOffset(2_000);
    const latest = atOffset(3_000);

    const digest = buildSinceDigest(
      [
        message('#alpha', 'Kai', latest, true),
        message('#alpha', 'Mira', earliest),
        message('#alpha', 'Kai', middle),
      ],
      SINCE,
    );

    expect(digest.channels).toHaveLength(1);
    expect(digest.channels[0]).toEqual({
      channel: '#alpha',
      count: 3,
      mentions: 1,
      participants: ['Kai', 'Mira'],
      firstAt: earliest,
      lastAt: latest,
    });
  });

  it('sorts channels by mentions, then count, then channel name', () => {
    const digest = buildSinceDigest(
      [
        message('#busy', 'A', atOffset(1)),
        message('#busy', 'B', atOffset(2)),
        message('#busy', 'C', atOffset(3)),
        message('#busy', 'D', atOffset(4)),
        message('#busy', 'E', atOffset(5)),
        message('#zeta', 'A', atOffset(6), true),
        message('#zeta', 'B', atOffset(7)),
        message('#alpha', 'A', atOffset(8), true),
        message('#alpha', 'B', atOffset(9)),
        message('#solo', 'A', atOffset(10), true),
      ],
      SINCE,
    );

    expect(digest.channels.map((channel) => channel.channel)).toEqual([
      '#alpha',
      '#zeta',
      '#solo',
      '#busy',
    ]);
  });

  it('caps channels while preserving all-channel totals and active channel count', () => {
    const digest = buildSinceDigest(
      [
        message('#alpha', 'A', atOffset(1), true),
        message('#alpha', 'B', atOffset(2)),
        message('#beta', 'C', atOffset(3), true),
        message('#beta', 'D', atOffset(4)),
        message('#gamma', 'E', atOffset(5), true),
        message('#gamma', 'F', atOffset(6)),
      ],
      SINCE,
      { maxChannels: 2 },
    );

    expect(digest.channels).toHaveLength(2);
    expect(digest.totalMessages).toBe(6);
    expect(digest.totalMentions).toBe(3);
    expect(digest.activeChannels).toBe(3);
  });
});

describe('digestHeadline', () => {
  it('returns All caught up when there are no messages', () => {
    expect(digestHeadline(buildSinceDigest([], SINCE))).toBe('All caught up');
  });

  it('omits the mentions clause when there are no mentions', () => {
    expect(digestHeadline(digestWithTotals(1, 0, 1))).toBe('1 message across 1 channel');
    expect(digestHeadline(digestWithTotals(2, 0, 3))).toBe('2 messages across 3 channels');
  });

  it('pluralizes messages, channels, and mentions', () => {
    expect(digestHeadline(digestWithTotals(1, 1, 1))).toBe(
      '1 message across 1 channel · 1 mention',
    );
    expect(digestHeadline(digestWithTotals(42, 3, 5))).toBe(
      '42 messages across 5 channels · 3 mentions',
    );
  });
});

function digestWithTotals(
  totalMessages: number,
  totalMentions: number,
  activeChannels: number,
): SinceDigest {
  return {
    since: SINCE,
    totalMessages,
    totalMentions,
    activeChannels,
    channels: [],
  };
}
