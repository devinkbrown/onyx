// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { CatchUpItem } from '@/lib/notifications/catchUp';
import { buildAwayDigest } from '@/lib/notifications/awayDigest';
import { buildResumePoints, type ResumePoint } from '@/lib/catchup/resumePoints';
import type { ScheduledEventItem } from '@/lib/notifications/scheduledEvents';
import type { HomeMemoryItem } from '@/lib/notifications/homeMemory';
import type { StatsChannel } from '@/lib/stats/networkIndex';
import {
  HOME_BRIEFING_CAPS,
  composeHomeBriefing,
  selectHomeCatchUpSource,
  vaultOwnerAccepted,
  type HomeBriefingInput,
} from './homeBriefingModel';

const NOW = Date.parse('2026-08-13T18:00:00.000Z');
const OWNER_A = '["wss://a.test","alice"]';
const OWNER_B = '["wss://a.test","bob"]';

function item(
  kind: CatchUpItem['kind'],
  target: string,
  unread: number,
  highlights = 0,
  extra: Partial<CatchUpItem> = {},
): CatchUpItem {
  return {
    key: `${kind[0]}:${target.toLowerCase()}`,
    kind,
    name: target,
    target,
    unread,
    highlights,
    followed: false,
    lastActivity: extra.lastActivity ?? NOW - 60_000,
    ...extra,
  };
}

function resume(target: string, unread: number, highlights = 0): ResumePoint {
  return {
    key: `c:${target.toLowerCase()}`,
    kind: target.startsWith('#') || target.startsWith('&') ? 'channel' : 'dm',
    name: target,
    target,
    boundaryId: `${target}-first`,
    unread,
    highlights,
    followed: false,
    tier: highlights > 0 ? 'mention' : target.startsWith('#') || target.startsWith('&') ? 'active' : 'dm',
    lastActivity: NOW - 30_000,
  };
}

function event(channel: string, at: number, live = false): ScheduledEventItem {
  return { channel, at, title: `${channel} gathering`, live };
}

function room(channel: string, messages: number): StatsChannel {
  return {
    channel,
    messages,
    active_users: 0,
    present: 0,
    last_active: Math.floor(NOW / 1000) - 40,
    topic: '',
    spark: [0, 1, 0],
  };
}

function memory(target: string): HomeMemoryItem {
  return {
    target,
    count: 2,
    participants: ['mira'],
    lastAt: new Date(NOW - 3_600_000),
    lastMessageId: `${target}-last`,
    lastFrom: 'mira',
    preview: 'remembered line',
  };
}

function base(over: Partial<HomeBriefingInput> = {}): HomeBriefingInput {
  const liveCatchUp = over.liveCatchUp ?? [];
  const memoryCatchUp = over.memoryCatchUp ?? [];
  const digestSource = selectHomeCatchUpSource({
    connectionStatus: over.connectionStatus ?? 'connected',
    localHistory: over.localHistory ?? true,
    hasRooms: over.hasRooms ?? liveCatchUp.length > 0,
    hasLiveTranscript: over.hasLiveTranscript ?? liveCatchUp.length > 0,
    liveCatchUp,
    memoryCatchUp,
  });
  return {
    nowMs: NOW,
    connectionStatus: 'connected',
    localHistory: true,
    currentOwnerKey: OWNER_A,
    vaultOwnerKey: OWNER_A,
    hasRooms: liveCatchUp.length > 0,
    hasLiveTranscript: liveCatchUp.length > 0,
    liveCatchUp,
    memoryCatchUp,
    awayDigest: buildAwayDigest(digestSource.items, {
      notifyLevels: new Map(),
      preset: 'regular',
    }),
    resumePoints: [],
    scheduledEvents: [],
    liveCall: null,
    directory: [],
    recentRooms: [],
    coldVaultRooms: [],
    ...over,
  };
}

describe('selectHomeCatchUpSource', () => {
  const live = [item('channel', '#ops', 2, 1)];
  const stored = [item('dm', 'alice', 1)];

  it('lets live buffers win while connected', () => {
    const source = selectHomeCatchUpSource({
      connectionStatus: 'connected',
      localHistory: true,
      hasRooms: true,
      hasLiveTranscript: true,
      liveCatchUp: live,
      memoryCatchUp: stored,
    });
    expect(source.fromMemory).toBe(false);
    expect(source.items).toEqual(live);
    expect(source.sourceLabel).toBe('live');
  });

  it('keeps on-device live unreads while reconnecting', () => {
    const source = selectHomeCatchUpSource({
      connectionStatus: 'reconnecting',
      localHistory: true,
      hasRooms: true,
      hasLiveTranscript: true,
      liveCatchUp: live,
      memoryCatchUp: stored,
    });
    expect(source.fromMemory).toBe(false);
    expect(source.items).toBe(live);
    expect(source.sourceLabel).toBe('on this device');
  });

  it('falls back to owner-scoped memory when live is empty', () => {
    const source = selectHomeCatchUpSource({
      connectionStatus: 'connecting',
      localHistory: true,
      hasRooms: false,
      hasLiveTranscript: false,
      liveCatchUp: [],
      memoryCatchUp: stored,
    });
    expect(source.fromMemory).toBe(true);
    expect(source.items).toEqual(stored);
    expect(source.sourceLabel).toBe('saved on this device');
  });

  it('ignores device memory when local history is off', () => {
    const source = selectHomeCatchUpSource({
      connectionStatus: 'disconnected',
      localHistory: false,
      hasRooms: false,
      hasLiveTranscript: false,
      liveCatchUp: [],
      memoryCatchUp: stored,
    });
    expect(source.fromMemory).toBe(false);
    expect(source.items).toEqual([]);
  });

  it('does not flash memory once connected transcript is caught up', () => {
    const source = selectHomeCatchUpSource({
      connectionStatus: 'connected',
      localHistory: true,
      hasRooms: true,
      hasLiveTranscript: true,
      liveCatchUp: [],
      memoryCatchUp: stored,
    });
    expect(source.fromMemory).toBe(false);
    expect(source.items).toEqual([]);
    expect(source.sourceLabel).toBe('live');
  });
});

describe('composeHomeBriefing — phases', () => {
  it('marks a connected active desk as connected', () => {
    const briefing = composeHomeBriefing(base({
      liveCatchUp: [item('dm', 'kai', 1)],
      hasRooms: true,
      hasLiveTranscript: true,
      awayDigest: buildAwayDigest([item('dm', 'kai', 1)], {
        notifyLevels: new Map(),
        preset: 'regular',
      }),
    }));
    expect(briefing.phase).toBe('connected');
    expect(briefing.showCaughtUpEmpty).toBe(false);
  });

  it('marks reconnecting live buffers as reconnecting, not cold', () => {
    const liveCatchUp = [item('channel', '&ops', 3, 1)];
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'reconnecting',
      liveCatchUp,
      hasRooms: true,
      hasLiveTranscript: true,
      awayDigest: buildAwayDigest(liveCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
      coldVaultRooms: [memory('#old')],
    }));
    expect(briefing.phase).toBe('reconnecting');
    expect(briefing.catchUpFromMemory).toBe(false);
    expect(briefing.showColdVault).toBe(false);
    expect(briefing.attention[0]?.target).toBe('&ops');
  });

  it('marks a disconnected empty desk as offline', () => {
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'disconnected',
      hasRooms: false,
      hasLiveTranscript: false,
    }));
    expect(briefing.phase).toBe('offline');
    expect(briefing.showCatchUp).toBe(false);
    expect(briefing.showColdVault).toBe(false);
  });

  it('marks owner-scoped memory as cold', () => {
    const memoryCatchUp = [item('channel', '#general', 4, 2)];
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'connecting',
      hasRooms: false,
      hasLiveTranscript: false,
      memoryCatchUp,
      awayDigest: buildAwayDigest(memoryCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
    }));
    expect(briefing.phase).toBe('cold');
    expect(briefing.catchUpFromMemory).toBe(true);
    expect(briefing.catchUpSourceLabel).toBe('saved on this device');
  });

  it('marks a connected empty digest as caught-up', () => {
    const briefing = composeHomeBriefing(base({
      hasRooms: true,
      hasLiveTranscript: true,
      awayDigest: buildAwayDigest([], { notifyLevels: new Map(), preset: 'regular' }),
    }));
    expect(briefing.phase).toBe('caught-up');
    expect(briefing.showCaughtUpEmpty).toBe(true);
    expect(briefing.liveNowVisible).toBe(false);
  });
});

describe('composeHomeBriefing — catch-up inbox', () => {
  it('lists mentions and unreads by recency, not operator rank', () => {
    const liveCatchUp = [
      item('channel', '#older', 20, 0, { lastActivity: NOW - 8_000 }),
      item('channel', '#ping', 2, 1, { lastActivity: NOW - 2_000 }),
      item('dm', 'mira', 1, 0, { lastActivity: NOW }),
    ];
    const briefing = composeHomeBriefing(base({
      liveCatchUp,
      hasRooms: true,
      hasLiveTranscript: true,
      firstUnreadId: new Map([['#ping', 'p-1']]),
    }));
    expect(briefing.inbox.mentions.map((row) => row.target)).toEqual(['#ping']);
    expect(briefing.inbox.mentions[0]?.boundaryId).toBe('p-1');
    expect(briefing.inbox.missed.map((row) => row.target)).toEqual(['mira', '#older']);
    expect(briefing.showQuietEmpty).toBe(false);
  });
});

describe('composeHomeBriefing — caps, overflow, order', () => {
  it('caps attention at 6 and reports the exact remainder', () => {
    const attention = Array.from({ length: 8 }, (_, i) =>
      item('channel', `#room-${i}`, 1, 1, { lastActivity: NOW - i * 1_000 }),
    );
    const briefing = composeHomeBriefing(base({
      liveCatchUp: attention,
      hasRooms: true,
      hasLiveTranscript: true,
      awayDigest: {
        attention,
        followed: [],
        quiet: [],
        totalUnread: 8,
        totalMentions: 8,
        empty: false,
      },
    }));
    expect(briefing.attention).toHaveLength(HOME_BRIEFING_CAPS.attention);
    expect(briefing.attention.map((row) => row.target)).toEqual(
      attention.slice(0, 6).map((row) => row.target),
    );
    expect(briefing.attentionOverflow).toEqual({
      count: 2,
      label: '2 more items that need you',
      action: 'expand',
    });
  });

  it('caps Continue at 4 across resume then followed, without inventing rank', () => {
    const resumePoints = ['#a', '#b', '#c'].map((name, i) => resume(name, 2 + i, i === 0 ? 1 : 0));
    const followed = [item('channel', '#d', 4, 0, { followed: true }), item('channel', '#e', 3, 0, { followed: true })];
    const briefing = composeHomeBriefing(base({
      hasRooms: true,
      hasLiveTranscript: true,
      resumePoints,
      awayDigest: {
        attention: [],
        followed,
        quiet: [],
        totalUnread: 7,
        totalMentions: 0,
        empty: false,
      },
    }));
    expect(briefing.resume.map((row) => row.target)).toEqual(['#a', '#b', '#c']);
    expect(briefing.followed.map((row) => row.target)).toEqual(['#d']);
    expect(briefing.continueOverflow).toEqual({
      count: 1,
      label: '1 more place to continue',
      action: 'expand',
    });
  });

  it('caps Live now at 3 with call first, then classifier event order', () => {
    const events = [
      event('#now', NOW / 1000 - 10, true),
      event('#soon', NOW / 1000 + 600, false),
      event('#later', NOW / 1000 + 3_600, false),
      event('#tail', NOW / 1000 + 7_200, false),
    ];
    const briefing = composeHomeBriefing(base({
      scheduledEvents: events,
      liveCall: { present: true, label: 'Incoming call · #voice' },
    }));
    expect(briefing.liveSlots).toHaveLength(3);
    expect(briefing.liveSlots[0]).toEqual({ kind: 'call', label: 'Incoming call · #voice' });
    expect(briefing.liveSlots[1]).toMatchObject({ kind: 'event', event: events[0] });
    expect(briefing.liveSlots[2]).toMatchObject({ kind: 'event', event: events[1] });
    expect(briefing.liveOverflow).toEqual({
      count: 2,
      label: '2 more live items',
      action: 'expand',
    });
  });

  it('hides scheduled events while offline and still shows a truthful call', () => {
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'disconnected',
      scheduledEvents: [event('#now', NOW / 1000, true)],
      liveCall: { present: true, label: 'In a call · #ops' },
    }));
    expect(briefing.liveSlots).toEqual([{ kind: 'call', label: 'In a call · #ops' }]);
    expect(briefing.liveOverflow).toBeNull();
  });

  it('caps Explore directory at 6 and points overflow at Browse rooms', () => {
    const directory = Array.from({ length: 9 }, (_, i) => room(`#pub-${i}`, 100 - i));
    const briefing = composeHomeBriefing(base({
      directory,
      recentRooms: ['#left-a', '#left-b'],
    }));
    expect(briefing.directory).toHaveLength(6);
    expect(briefing.recentRooms).toEqual(['#left-a', '#left-b']);
    expect(briefing.exploreOverflow).toEqual({
      count: 3,
      label: '3 more rooms',
      action: 'browse-rooms',
    });
  });

  it('preserves deterministic classifier ties instead of re-ranking', () => {
    const tied = [
      item('channel', '#zeta', 2, 1, { lastActivity: NOW }),
      item('channel', '#alpha', 2, 1, { lastActivity: NOW }),
    ];
    const briefing = composeHomeBriefing(base({
      liveCatchUp: tied,
      hasRooms: true,
      awayDigest: {
        attention: tied,
        followed: [],
        quiet: [],
        totalUnread: 4,
        totalMentions: 2,
        empty: false,
      },
    }));
    expect(briefing.attention.map((row) => row.target)).toEqual(['#zeta', '#alpha']);
  });

  it('keeps DMs, #rooms, and &ops on their classifier kinds', () => {
    const rows = [
      item('dm', 'mira', 1),
      item('channel', '#root', 2, 1),
      item('channel', '&ops', 3, 1),
    ];
    const resumePoints = [
      { ...resume('mira', 1), kind: 'dm' as const, name: 'mira' },
      resume('#root', 2, 1),
      resume('&ops', 3, 1),
    ];
    const briefing = composeHomeBriefing(base({
      liveCatchUp: rows,
      hasRooms: true,
      awayDigest: buildAwayDigest(rows, { notifyLevels: new Map(), preset: 'regular' }),
      resumePoints,
    }));
    expect(briefing.attention.map((row) => [row.kind, row.target])).toEqual(
      buildAwayDigest(rows, { notifyLevels: new Map(), preset: 'regular' })
        .attention
        .map((row) => [row.kind, row.target]),
    );
    expect(briefing.resume.map((row) => [row.kind, row.target])).toEqual([
      ['dm', 'mira'],
      ['channel', '#root'],
      ['channel', '&ops'],
    ]);
  });
});

describe('composeHomeBriefing — account and live/device truth', () => {
  it('drops a late vault payload from another account', () => {
    expect(vaultOwnerAccepted(OWNER_A, OWNER_B)).toBe(false);
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'connecting',
      hasRooms: false,
      hasLiveTranscript: false,
      currentOwnerKey: OWNER_B,
      vaultOwnerKey: OWNER_A,
      coldVaultRooms: [memory('#alice-only')],
    }));
    expect(briefing.showColdVault).toBe(false);
    expect(briefing.coldVaultRooms).toEqual([]);
  });

  it('replaces device vault cards as soon as live catch-up exists', () => {
    const liveCatchUp = [item('channel', '#ops', 1, 1)];
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'reconnecting',
      liveCatchUp,
      hasRooms: true,
      hasLiveTranscript: true,
      awayDigest: buildAwayDigest(liveCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
      coldVaultRooms: [memory('#archive')],
    }));
    expect(briefing.showColdVault).toBe(false);
    expect(briefing.catchUpFromMemory).toBe(false);
    expect(briefing.attention[0]?.target).toBe('#ops');
  });

  it('accepts matching owner-scoped vault rows only while disconnected', () => {
    const briefing = composeHomeBriefing(base({
      connectionStatus: 'connecting',
      hasRooms: false,
      hasLiveTranscript: false,
      coldVaultRooms: [memory('#offline')],
    }));
    expect(briefing.showColdVault).toBe(true);
    expect(briefing.coldVaultRooms.map((row) => row.target)).toEqual(['#offline']);
  });

  it('drops owner-scoped vault rows when local history is off', () => {
    const briefing = composeHomeBriefing(base({
      localHistory: false,
      connectionStatus: 'connecting',
      hasRooms: false,
      hasLiveTranscript: false,
      currentOwnerKey: OWNER_A,
      vaultOwnerKey: OWNER_A,
      coldVaultRooms: [memory('#offline')],
      memoryCatchUp: [item('channel', '#offline', 2, 1)],
    }));
    expect(briefing.showColdVault).toBe(false);
    expect(briefing.coldVaultRooms).toEqual([]);
    expect(briefing.catchUpFromMemory).toBe(false);
    expect(briefing.attention).toEqual([]);
  });

  it('keeps equal-timestamp ranking exactly as the classifier supplied it', () => {
    const tied = [
      item('channel', '#zeta', 2, 1, { lastActivity: NOW }),
      item('channel', '#alpha', 2, 1, { lastActivity: NOW }),
      item('dm', 'mira', 2, 1, { lastActivity: NOW }),
    ];
    const briefing = composeHomeBriefing(base({
      liveCatchUp: tied,
      hasRooms: true,
      awayDigest: {
        attention: tied,
        followed: [],
        quiet: [],
        totalUnread: 6,
        totalMentions: 3,
        empty: false,
      },
    }));
    expect(briefing.attention.map((row) => row.target)).toEqual(['#zeta', '#alpha', 'mira']);
  });

  it('does not treat resume construction as a read mutation surface', () => {
    const rows = [item('channel', '#keep', 2, 1)];
    const firstUnread = new Map<string, string | null>([['#keep', 'keep-1']]);
    const resumePoints = buildResumePoints(rows, firstUnread, -1);
    const briefing = composeHomeBriefing(base({
      liveCatchUp: rows,
      hasRooms: true,
      hasLiveTranscript: true,
      awayDigest: buildAwayDigest(rows, { notifyLevels: new Map(), preset: 'regular' }),
      resumePoints,
    }));
    expect(resumePoints[0]?.boundaryId).toBe('keep-1');
    expect(briefing.resume[0]?.boundaryId).toBe('keep-1');
    expect(rows[0]?.unread).toBe(2);
  });
});
