// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatchUpItem } from '@/lib/notifications/catchUp';
import { buildAwayDigest } from '@/lib/notifications/awayDigest';
import {
  composeHomeBriefing,
  type HomeBriefing,
  type HomeBriefingInput,
} from './homeBriefingModel';
import { HomeBriefingView, type HomeBriefingViewProps } from './HomeBriefingView';
import type { HomeBriefingActions } from './homeController';

const here = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(join(here, 'HomeBriefingView.tsx'), 'utf8');
const markCaughtUpSource = readFileSync(join(here, 'HomeMarkCaughtUp.tsx'), 'utf8');
const NOW = Date.parse('2026-08-13T18:00:00.000Z');
const EMPTY_CAUGHT_UP = { targets: [], rooms: 0, unread: 0, mentions: 0 };

function item(target: string, unread: number, highlights = 0, kind: CatchUpItem['kind'] = 'channel'): CatchUpItem {
  return {
    key: `${kind[0]}:${target.toLowerCase()}`,
    kind,
    name: target,
    target,
    unread,
    highlights,
    followed: false,
    lastActivity: NOW - 90_000,
  };
}

function briefing(over: Partial<HomeBriefingInput> = {}): HomeBriefing {
  const liveCatchUp = over.liveCatchUp ?? [item('#mentions', 3, 2)];
  return composeHomeBriefing({
    nowMs: NOW,
    connectionStatus: 'connected',
    localHistory: true,
    currentOwnerKey: '["wss://a.test","me"]',
    vaultOwnerKey: '["wss://a.test","me"]',
    hasRooms: true,
    hasLiveTranscript: true,
    liveCatchUp,
    memoryCatchUp: [],
    awayDigest: buildAwayDigest(liveCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
    resumePoints: [],
    scheduledEvents: [],
    liveCall: null,
    directory: [],
    recentRooms: [],
    coldVaultRooms: [],
    firstUnreadId: new Map([['#mentions', 'm-1']]),
    invites: [],
    ...over,
  });
}

function actions(over: Partial<HomeBriefingActions> = {}): HomeBriefingActions {
  const noop = () => undefined;
  return {
    openBrowseRooms: noop,
    openCreateRoom: noop,
    openSearchMessages: noop,
    startRoom: noop,
    inviteFriends: noop,
    dismissFirstHourTip: noop,
    openAppearance: noop,
    openShortcuts: noop,
    openCatchUp: noop,
    openInboxRow: noop,
    openInboxInvite: noop,
    resumeAt: noop,
    reviewCatchUpFromStart: noop,
    openCatchUpSpotlight: noop,
    openEvent: noop,
    openLiveCall: noop,
    openOrJoinActiveRoom: noop,
    joinRecentRoom: noop,
    openQueuedSend: noop,
    discardQueuedSend: noop,
    retryOutbox: noop,
    reopenReview: noop,
    openReviewSpotlight: noop,
    searchReviewText: noop,
    openMemory: noop,
    openColdMemory: noop,
    openQuietActivity: noop,
    openQuietBoost: noop,
    markAllCaughtUp: noop,
    openInviteFriends: noop,
    openFormationRoom: noop,
    reshareFormation: noop,
    ...over,
  };
}

function renderView(over: Partial<{
  briefing: HomeBriefing;
  actions: HomeBriefingActions;
  queued: HomeBriefingViewProps['queuedSends'] extends () => infer T ? T : never;
  chrome: HomeBriefingViewProps['outboxChrome'] extends () => infer T ? T : never;
  confirm: string | null;
  caughtUpRooms: number;
  caughtUpUnread: number;
  caughtUpMentions: number;
  firstHourWelcome: boolean;
  formation: HomeBriefingViewProps['formationStrip'] extends () => infer T ? T : never;
}> = {}) {
  const model = over.briefing ?? briefing();
  const rooms = over.caughtUpRooms ?? (model.catchUpFromMemory ? 0 : Math.max(1, model.inbox.mentions.length + model.inbox.missed.length));
  const unread = over.caughtUpUnread ?? model.catchUpTotals.unread;
  const mentions = over.caughtUpMentions ?? model.catchUpTotals.mentions;
  return render(() => (
    <HomeBriefingView
      nowMs={() => NOW}
      welcomeName={() => 'me'}
      connectionStatus={() => 'connected'}
      localMemoryStatus={() => 'On this device: remembered rooms stay available.'}
      briefing={() => model}
      outboxChrome={() => over.chrome ?? null}
      queuedSends={() => over.queued ?? []}
      confirmDiscardId={() => over.confirm ?? null}
      recaps={() => []}
      more={() => ({ hasContent: false })}
      showFirstRoomPrompt={() => false}
      showInviteFriends={() => false}
      showFirstHourWelcome={() => over.firstHourWelcome === true}
      firstHourTip={() => null}
      formationStrip={() => over.formation ?? null}
      isJoined={() => false}
      caughtUpPlan={() => rooms > 0
        ? { targets: [{ kind: 'channel', target: '#mentions', unread, highlights: 0 }], rooms, unread, mentions }
        : EMPTY_CAUGHT_UP}
      actions={over.actions ?? actions()}
    />
  ));
}

afterEach(() => {
  cleanup();
});

describe('HomeBriefingView — presentation contract', () => {
  it('does not own store, vault, fetch, or timers anywhere in its mounted tree', () => {
    const presentationFiles = readdirSync(here)
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'));
    expect(presentationFiles).toEqual(expect.arrayContaining([
      'HomeBriefingView.tsx',
      'HomeMarkCaughtUp.tsx',
    ]));
    for (const name of presentationFiles) {
      const source = readFileSync(join(here, name), 'utf8');
      expect(source, name).not.toMatch(/\buseStore\b|\bgetState\b|from ['"]@\/lib\/store/);
      expect(source, name).not.toMatch(/indexedDB|exportVault|loadRecent|loadOutbox|fetchStatsIndex|setInterval/);
      expect(source, name).not.toMatch(/joinVoiceChannel|acceptCall|markRead\b/);
    }
    expect(viewSource).not.toMatch(/MarkAllCaughtUp/);
    expect(markCaughtUpSource).toMatch(/HomeMarkCaughtUp/);
    expect(viewSource).not.toMatch(/hidden-rooms|closed-conversations|ThemeStudio|people online|Room ledger/i);
  });

  it('uses one Fraunces catch-up line and lists a mention row', () => {
    renderView();
    const main = screen.getByRole('main', { name: 'Home' });
    expect(within(main).getByRole('heading', { level: 1, name: 'What did you miss?' })).toBeInTheDocument();
    expect(within(main).getByRole('group', { name: 'Mentions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open #mentions at your first unread message/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs you' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Explore' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Room ledger|people online|Current ledger/i)).not.toBeInTheDocument();
  });

  it('surfaces the full caught-up plan as a compact queue summary', () => {
    renderView({ caughtUpRooms: 3, caughtUpUnread: 8, caughtUpMentions: 2 });
    const summary = screen.getByRole('region', { name: 'Catch-up summary' });

    expect(summary).toHaveTextContent(/3\s+conversations need you/);
    expect(within(summary).getByText('Unread')).toBeInTheDocument();
    expect(within(summary).getByText('8')).toBeInTheDocument();
    expect(within(summary).getByText('Mentions')).toBeInTheDocument();
    expect(within(summary).getByText('2')).toBeInTheDocument();
  });

  it('lists an unread room without a mention in the unread group', () => {
    const liveCatchUp = [item('#news', 4, 0)];
    renderView({
      briefing: briefing({
        liveCatchUp,
        awayDigest: buildAwayDigest(liveCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
        firstUnreadId: new Map(),
      }),
    });
    expect(screen.getByRole('group', { name: 'Unread rooms and messages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open #news, 4 unread/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mentions' })).not.toBeInTheDocument();
  });

  it('opens an inbox row through the injected action only', () => {
    const openInboxRow = vi.fn();
    renderView({ actions: actions({ openInboxRow }) });
    fireEvent.click(screen.getByRole('button', { name: /Open #mentions/ }));
    expect(openInboxRow).toHaveBeenCalledOnce();
    expect(openInboxRow.mock.calls[0]?.[0]?.target).toBe('#mentions');
    expect(openInboxRow.mock.calls[0]?.[0]?.boundaryId).toBe('m-1');
  });

  it('says the room is quiet without IRC or operator voice', () => {
    renderView({
      briefing: briefing({
        hasRooms: true,
        liveCatchUp: [],
        awayDigest: buildAwayDigest([], { notifyLevels: new Map(), preset: 'regular' }),
      }),
    });
    expect(screen.getByRole('heading', { name: 'The room is quiet.' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'The room is quiet' })).toBeInTheDocument();
    expect(screen.queryByText(/JOIN|PART|NICK|oper|mesh|ledger|channel list|unreal/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a room' })).toBeInTheDocument();
  });

  it('nags a founder with real names and the existing Reshare action', () => {
    const openFormationRoom = vi.fn();
    const reshareFormation = vi.fn();
    renderView({
      formation: {
        kind: 'first-join',
        channel: '#lounge',
        present: 2,
        missing: 1,
        knownNames: ['Alex'],
        headline: 'Alex is here — say the thing you invited them for.',
        detail: "1 of 3 hasn't opened this",
        canReshare: true,
      },
      actions: actions({ openFormationRoom, reshareFormation }),
    });

    const strip = screen.getByRole('region', { name: 'Room formation' });
    expect(strip).toHaveTextContent('Alex is here — say the thing you invited them for.');
    expect(strip).toHaveTextContent('#lounge');
    expect(strip).not.toHaveTextContent(/DAU|Discord|tour|people online/i);
    fireEvent.click(screen.getByRole('button', { name: 'Reshare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open #lounge' }));
    expect(reshareFormation).toHaveBeenCalledWith('#lounge');
    expect(openFormationRoom).toHaveBeenCalledWith('#lounge');
  });

  it('shows queued destination and age only, never a body', () => {
    renderView({
      chrome: {
        title: 'Queued on this device',
        detail: '1 message will send when you reconnect.',
        tone: 'queued',
        showRetry: false,
      },
      queued: [{ id: 'q1', target: '#private-room', queued_at: NOW - 60_000 }],
    });
    expect(screen.getByText('#private-room')).toBeInTheDocument();
    expect(screen.getByText(/Message bodies stay inside their conversations/)).toBeInTheDocument();
    expect(screen.queryByText(/secret body|ONYXDM1/)).not.toBeInTheDocument();
  });

  it('requires a second confirm click before queued removal', () => {
    const discard = vi.fn();
    renderView({
      chrome: {
        title: 'Queued on this device',
        detail: '1 message will send when you reconnect.',
        tone: 'queued',
        showRetry: false,
      },
      queued: [{ id: 'q1', target: '#private-room', queued_at: NOW - 60_000 }],
      confirm: null,
      actions: actions({ discardQueuedSend: discard }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message for #private-room' }));
    expect(discard).toHaveBeenCalledOnce();
  });

  it('forwards mark-all through the injected action and never reads a store', () => {
    const markAllCaughtUp = vi.fn();
    renderView({
      actions: actions({ markAllCaughtUp }),
      caughtUpRooms: 2,
      caughtUpUnread: 5,
    });
    fireEvent.click(screen.getByRole('button', {
      name: /Mark all caught up — clears 5 unread across 2 rooms/,
    }));
    expect(markAllCaughtUp).toHaveBeenCalledOnce();
  });

  it('surfaces an existing invite without inventing occupancy', () => {
    const openInboxInvite = vi.fn();
    renderView({
      briefing: briefing({
        liveCatchUp: [],
        awayDigest: buildAwayDigest([], { notifyLevels: new Map(), preset: 'regular' }),
        invites: [{ key: 'inv-1', inviter: 'Alex', channel: '#lounge', at: NOW }],
      }),
      actions: actions({ openInboxInvite }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Alex wants you in #lounge' }));
    expect(openInboxInvite).toHaveBeenCalledWith({
      key: 'inv-1',
      inviter: 'Alex',
      channel: '#lounge',
      at: NOW,
    });
    expect(screen.queryByText(/people online|12 people/i)).not.toBeInTheDocument();
  });

  it('uses a circle for people and a squircle for rooms', () => {
    const rows = [item('mira', 1, 0, 'dm'), item('#root', 2, 1)];
    renderView({
      briefing: briefing({
        liveCatchUp: rows,
        awayDigest: buildAwayDigest(rows, { notifyLevels: new Map(), preset: 'regular' }),
      }),
    });
    const mention = screen.getByRole('button', { name: /Open #root/ });
    const dm = screen.getByRole('button', { name: /Open mira/ });
    expect(mention.querySelector('.home-inbox-avatar--room')).not.toBeNull();
    expect(dm.querySelector('.home-inbox-avatar--person')).not.toBeNull();
  });

  it('does not dump Theme Studio, Explore, or an activity feed onto Home', () => {
    renderView();
    expect(screen.queryByRole('button', { name: 'Appearance' })).not.toBeInTheDocument();
    expect(screen.queryByText('More activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Network pulse')).not.toBeInTheDocument();
    expect(screen.queryByText('Quiet boosts')).not.toBeInTheDocument();
  });
});
