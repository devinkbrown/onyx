// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatchUpItem } from '@/lib/notifications/catchUp';
import { buildAwayDigest } from '@/lib/notifications/awayDigest';
import type { ResumePoint } from '@/lib/catchup/resumePoints';
import {
  composeHomeBriefing,
  type HomeBriefing,
  type HomeBriefingInput,
} from './homeBriefingModel';
import { HomeBriefingView, type HomeBriefingViewProps } from './HomeBriefingView';
import type { HomeBriefingActions, HomeMoreActivityView } from './homeController';

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

function resume(target: string, unread: number, highlights = 0): ResumePoint {
  return {
    key: `c:${target.toLowerCase()}`,
    kind: 'channel',
    name: target,
    target,
    boundaryId: `${target}-first`,
    unread,
    highlights,
    followed: false,
    tier: highlights > 0 ? 'mention' : 'active',
    lastActivity: NOW - 30_000,
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
    resumePoints: [resume('#mentions', 3, 2)],
    scheduledEvents: [],
    liveCall: null,
    directory: [],
    recentRooms: [],
    coldVaultRooms: [],
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
    ...over,
  };
}

function more(over: Partial<HomeMoreActivityView> = {}): HomeMoreActivityView {
  return {
    hasContent: false,
    reviewHistory: [],
    reviewHistorySummary: 'catch-up ranges',
    stats: null,
    totalMessages: 0,
    roomRhythm: [],
    rememberedRooms: [],
    quietActivity: [],
    quietBoosts: [],
    localHistory: true,
    connected: true,
    ...over,
  };
}

function renderView(over: Partial<{
  briefing: HomeBriefing;
  actions: HomeBriefingActions;
  more: HomeMoreActivityView;
  queued: HomeBriefingViewProps['queuedSends'] extends () => infer T ? T : never;
  chrome: HomeBriefingViewProps['outboxChrome'] extends () => infer T ? T : never;
  confirm: string | null;
  caughtUpRooms: number;
  caughtUpUnread: number;
  firstHourWelcome: boolean;
  firstHourTip: HomeBriefingViewProps['firstHourTip'] extends () => infer T ? T : never;
}> = {}) {
  const model = over.briefing ?? briefing();
  const nextActions = over.actions ?? actions();
  const rooms = over.caughtUpRooms ?? (model.catchUpFromMemory ? 0 : Math.max(1, model.attention.length));
  const unread = over.caughtUpUnread ?? model.catchUpTotals.unread;
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
      more={() => over.more ?? more()}
      showFirstRoomPrompt={() => false}
      showInviteFriends={() => false}
      showFirstHourWelcome={() => over.firstHourWelcome === true}
      firstHourTip={() => over.firstHourTip ?? null}
      isJoined={() => false}
      caughtUpPlan={() => rooms > 0
        ? { targets: [{ kind: 'channel', target: '#mentions', unread, highlights: 0 }], rooms, unread, mentions: 0 }
        : EMPTY_CAUGHT_UP}
      actions={nextActions}
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
  });

  it('exposes one labelled Network home with a heading outline', () => {
    renderView();
    const main = screen.getByRole('main', { name: 'Network home' });
    expect(within(main).getByRole('heading', { level: 1, name: 'Welcome, me.' })).toBeInTheDocument();
    expect(within(main).getByText('Home')).toBeInTheDocument();
    expect(within(main).getByRole('heading', { name: 'Needs you' })).toBeInTheDocument();
    expect(within(main).getByRole('heading', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search messages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toHaveClass('home-cta');
    expect(screen.getByRole('button', { name: 'Start a room' })).toHaveClass('home-cta');
    expect(screen.getByRole('button', { name: 'Search messages' })).toHaveClass('home-action--supporting');
    expect(screen.getByRole('button', { name: 'Search messages' })).not.toHaveClass('home-action--primary');
    expect(screen.queryByRole('button', { name: 'Invite friends' })).not.toBeInTheDocument();
  });

  it('offers Invite friends and Browse rooms in plain language when the desk is empty', () => {
    const openInviteFriends = vi.fn();
    render(() => (
      <HomeBriefingView
        nowMs={() => NOW}
        welcomeName={() => 'me'}
        connectionStatus={() => 'connected'}
        localMemoryStatus={() => 'On this device: remembered rooms stay available.'}
        briefing={() => briefing({ hasRooms: false, liveCatchUp: [], resumePoints: [] })}
        outboxChrome={() => null}
        queuedSends={() => []}
        confirmDiscardId={() => null}
        recaps={() => []}
        more={() => more()}
        showFirstRoomPrompt={() => true}
        showInviteFriends={() => true}
        showFirstHourWelcome={() => false}
        firstHourTip={() => null}
        isJoined={() => false}
        caughtUpPlan={() => EMPTY_CAUGHT_UP}
        actions={actions({ openInviteFriends })}
      />
    ));

    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invite friends' }));
    expect(openInviteFriends).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/invite friends with a link/i)).toBeInTheDocument();
    expect(screen.queryByText(/mesh|handshake|claim path|member count/i)).not.toBeInTheDocument();
  });

  it('lands an empty first hour on Browse, Start a room, and Invite friends', () => {
    const startRoom = vi.fn();
    const inviteFriends = vi.fn();
    const dismissFirstHourTip = vi.fn();
    renderView({
      firstHourWelcome: true,
      firstHourTip: { id: 'home-next', text: 'Browse a room, start one, or invite a friend.' },
      actions: actions({ startRoom, inviteFriends, dismissFirstHourTip }),
    });

    expect(screen.queryByText('Current ledger')).not.toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Power tip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search messages' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite friends' }));
    expect(startRoom).toHaveBeenCalledOnce();
    expect(inviteFriends).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(dismissFirstHourTip).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens Start a room from the welcome actions', () => {
    const openCreateRoom = vi.fn();
    renderView({ actions: actions({ openCreateRoom }) });
    fireEvent.click(screen.getByRole('button', { name: 'Start a room' }));
    expect(openCreateRoom).toHaveBeenCalledOnce();
  });

  it('offers Browse rooms and Start a room on the first-room empty state', () => {
    const openBrowseRooms = vi.fn();
    const openCreateRoom = vi.fn();
    render(() => (
      <HomeBriefingView
        nowMs={() => NOW}
        welcomeName={() => 'me'}
        connectionStatus={() => 'connected'}
        localMemoryStatus={() => 'On this device: remembered rooms stay available.'}
        briefing={() => briefing({ hasRooms: false, liveCatchUp: [], resumePoints: [] })}
        outboxChrome={() => null}
        queuedSends={() => []}
        confirmDiscardId={() => null}
        recaps={() => []}
        more={() => more()}
        showFirstRoomPrompt={() => true}
        showInviteFriends={() => false}
        showFirstHourWelcome={() => false}
        firstHourTip={() => null}
        isJoined={() => false}
        caughtUpPlan={() => EMPTY_CAUGHT_UP}
        actions={actions({ openBrowseRooms, openCreateRoom })}
      />
    ));

    const empty = screen.getByRole('note', { name: 'Start with a room' });
    fireEvent.click(within(empty).getByRole('button', { name: 'Browse rooms' }));
    fireEvent.click(within(empty).getByRole('button', { name: 'Start a room' }));
    expect(openBrowseRooms).toHaveBeenCalledOnce();
    expect(openCreateRoom).toHaveBeenCalledOnce();
  });

  it('keeps mobile reading order: needs, continue, live, explore', () => {
    const liveCatchUp = [item('#mentions', 2, 1)];
    renderView({
      briefing: briefing({
        liveCatchUp,
        awayDigest: buildAwayDigest(liveCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
        liveCall: { present: true, label: 'Incoming call · #voice' },
      }),
    });
    const needs = screen.getByRole('region', { name: 'Catch up on what you missed' });
    const cont = screen.getByRole('region', { name: 'Continue where you left off' });
    const live = screen.getByRole('region', { name: 'Live now' });
    const explore = screen.getByRole('region', { name: 'Explore' });
    expect(needs.compareDocumentPosition(cont) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cont.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(live.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('surfaces exact overflow counts as visible actions', () => {
    const attention = Array.from({ length: 8 }, (_, i) => item(`#need-${i}`, 1, 1));
    renderView({
      briefing: briefing({
        liveCatchUp: attention,
        awayDigest: {
          attention,
          followed: [],
          quiet: [],
          totalUnread: 8,
          totalMentions: 8,
          empty: false,
        },
      }),
    });
    const overflow = screen.getByText('2 more items that need you');
    expect(overflow.closest('summary')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Open #need-0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open #need-7/ })).toBeInTheDocument();
  });

  it('opens a live call room through the injected action only', () => {
    const openLiveCall = vi.fn();
    const liveCatchUp = [item('#mentions', 1, 1)];
    renderView({
      briefing: briefing({
        liveCatchUp,
        awayDigest: buildAwayDigest(liveCatchUp, { notifyLevels: new Map(), preset: 'regular' }),
        liveCall: { present: true, label: 'Incoming call · #voice' },
      }),
      actions: actions({ openLiveCall }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Incoming call · #voice/ }));
    expect(openLiveCall).toHaveBeenCalledOnce();
    expect(screen.getByText(/join stays explicit/i)).toBeInTheDocument();
  });

  it('renders DMs, #rooms, and &ops without collapsing kind glyphs', () => {
    const rows = [
      item('mira', 1, 0, 'dm'),
      item('#root', 2, 1),
      item('&ops', 3, 1),
    ];
    renderView({
      briefing: briefing({
        liveCatchUp: rows,
        awayDigest: buildAwayDigest(rows, { notifyLevels: new Map(), preset: 'regular' }),
      }),
    });
    expect(screen.getByRole('button', { name: /Open mira/ })).toHaveTextContent('@mira');
    expect(screen.getByRole('button', { name: /Open #root/ })).toHaveTextContent('#root');
    const ops = screen.getByRole('button', { name: /Open &ops/ });
    expect(ops).toHaveTextContent('&ops');
    expect(ops.textContent).not.toContain('#&ops');
  });

  it('keeps equal-timestamp attention order from the injected briefing', () => {
    const tied = [
      item('#zeta', 2, 1),
      item('#alpha', 2, 1),
    ].map((row) => ({ ...row, lastActivity: NOW }));
    renderView({
      briefing: briefing({
        liveCatchUp: tied,
        awayDigest: {
          attention: tied,
          followed: [],
          quiet: [],
          totalUnread: 4,
          totalMentions: 2,
          empty: false,
        },
      }),
    });
    const names = screen.getAllByRole('button', { name: /Open #/ })
      .map((button) => button.textContent ?? '');
    const zeta = names.findIndex((text) => text.includes('#zeta'));
    const alpha = names.findIndex((text) => text.includes('#alpha'));
    expect(zeta).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeGreaterThan(zeta);
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
    expect(screen.queryByText(/secret body|ONYXDM1/)).not.toBeInTheDocument();
  });

  it('labels the confirming remove action without exposing a body', () => {
    renderView({
      chrome: {
        title: 'Could not send',
        detail: '1 message could not be delivered.',
        tone: 'error',
        showRetry: true,
      },
      queued: [{ id: 'q1', target: '#private-room', queued_at: NOW - 60_000 }],
      confirm: 'q1',
    });
    expect(screen.getByRole('button', {
      name: 'Confirm remove queued message for #private-room',
    })).toBeInTheDocument();
    expect(screen.queryByText(/secret body|ONYXDM1/)).not.toBeInTheDocument();
  });

  it('does not mutate read-state from render or catch-up navigation', () => {
    const openCatchUp = vi.fn();
    const resumeAt = vi.fn();
    const markAllCaughtUp = vi.fn();
    renderView({
      actions: actions({ openCatchUp, resumeAt, markAllCaughtUp }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Open #mentions/ }));
    fireEvent.click(screen.getByRole('button', {
      name: /Resume #mentions at your first unread message/,
    }));
    expect(openCatchUp).toHaveBeenCalledOnce();
    expect(resumeAt).toHaveBeenCalledOnce();
    expect(markAllCaughtUp).not.toHaveBeenCalled();
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

  it('links quiet rooms to the public room ledger', () => {
    renderView({
      more: more({
        hasContent: true,
        quietActivity: [{ name: '#quiet', topic: 'still here', lastActivity: NOW - 60_000 }],
      }),
    });
    expect(screen.getByRole('link', { name: 'Room ledger for #quiet' })).toHaveAttribute(
      'href',
      '/stats/?room=%23quiet',
    );
    expect(screen.getByRole('link', { name: 'Room ledger' })).toHaveAttribute('href', '/stats/');
  });

  it('links live scheduled events to the public room ledger', () => {
    renderView({
      briefing: briefing({
        liveCall: null,
        scheduledEvents: [{
          channel: '#standup',
          at: Math.floor(NOW / 1000),
          title: 'Daily standup',
          live: true,
        }],
      }),
    });
    expect(screen.getByTestId('home-event-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23standup',
    );
  });

  it('links the network pulse to the public room ledger', () => {
    renderView({
      more: more({
        hasContent: true,
        totalMessages: 12,
        stats: {
          generated_at: Math.floor(NOW / 1000),
          network: 'Onyx',
          node: 'test',
          users_online: 4,
          network_days: [],
          channels: [],
          network_days_complete: true,
          channels_complete: true,
        },
      }),
    });
    expect(screen.getByRole('link', { name: 'Room ledger' })).toHaveAttribute('href', '/stats/');
  });
});
