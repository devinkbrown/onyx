// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.commercial.test.tsx — public-default hierarchy for commercial Home.
 *
 * Locks: welcome → Needs you → Continue → Live now → Explore → caught-up →
 * More activity, no hardcoded #root CTA, technical surfaces + catch-up recaps
 * collapsed, truthful empty state, accessible section names. Behavior still
 * flows through buildCatchUp / buildAwayDigest / buildResumePoints (no invented
 * people or occupancy).
 */
import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import { mergeFollowedKeys } from '@/lib/notifications/followed';
import { recordReviewHistory } from '@/lib/notifications/reviewHistory';
import { resetPreferences } from '@/lib/prefs/preferences';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

const OWNER = {
  serverUrl: 'wss://example.test',
  identity: 'me',
} as const;

const server = {
  id: 'home-commercial',
  name: 'Onyx',
  network: 'Onyx',
  url: OWNER.serverUrl,
  icon: '',
  nick: 'me',
  account: 'me',
  connected: true,
};

function makeChannel(
  name: string,
  unread: number,
  highlights: number,
  messages: ChatMessage[] = [],
): Channel {
  const users = new Map<string, ChannelUser>();
  users.set('me', { nick: 'me', modes: new Set() });
  return {
    name,
    topic: '',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users,
    unread,
    highlights,
    createdAt: null,
    messages,
  };
}

function makeMsg(
  id: string,
  from: string,
  text: string,
  opts: { highlight?: boolean; time?: Date } = {},
): ChatMessage {
  return {
    id,
    time: opts.time ?? new Date('2026-07-19T12:00:00.000Z'),
    from,
    text,
    type: 'msg',
    target: '#mentions',
    highlight: opts.highlight,
  };
}

function seedHierarchy(): void {
  const t0 = new Date('2026-07-19T10:00:00.000Z');
  const t1 = new Date('2026-07-19T11:00:00.000Z');
  const channels = new Map<string, Channel>();
  channels.set(
    '#mentions',
    makeChannel('#mentions', 3, 2, [
      makeMsg('m-1', 'alice', 'hey @me', { highlight: true, time: t0 }),
      makeMsg('m-2', 'bob', 'second', { time: t1 }),
      makeMsg('m-3', 'carol', 'third', { time: t1 }),
    ]),
  );
  channels.set('#news', makeChannel('#news', 4, 0, [
    makeMsg('n-1', 'ed', 'followed chatter', { time: t1 }),
  ]));
  channels.set('#ambient', makeChannel('#ambient', 2, 0));
  mergeFollowedKeys(['#news'], OWNER);
  store.setState(
    {
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      firstUnreadId: new Map<string, string | null>([
        ['#mentions', 'm-1'],
        ['#news', 'n-1'],
      ]),
    },
    true,
  );
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPreferences();
});

describe('HomeView — commercial public hierarchy', () => {
  it('orders Needs you before Continue and exposes accessible band names', () => {
    seedHierarchy();
    render(() => <HomeView />);

    const needs = screen.getByRole('region', { name: 'Catch up on what you missed' });
    const cont = screen.getByRole('region', { name: 'Continue where you left off' });
    const explore = screen.getByRole('region', { name: 'Explore' });

    expect(needs.compareDocumentPosition(cont) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cont.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(needs).toHaveAttribute('data-home-band', 'needs-you');
    expect(cont).toHaveAttribute('data-home-band', 'continue');
    expect(explore).toHaveAttribute('data-home-band', 'explore');

    // Single consumer "Needs you" — section label only, no duplicate tier label.
    expect(within(needs).getByRole('heading', { name: 'Needs you' })).toBeInTheDocument();
    expect(within(needs).queryByRole('heading', { name: 'Needs you', level: 4 })).not.toBeInTheDocument();
    expect(within(needs).getByRole('group', { name: 'Mentions and direct messages' })).toBeInTheDocument();
    expect(within(cont).getByRole('group', { name: 'Followed channels' })).toBeInTheDocument();
    expect(within(cont).getByRole('region', { name: 'Resume where you left off' })).toBeInTheDocument();
  });

  it('orders Explore before the caught-up empty band when both render', () => {
    // Truthful caught-up: joined rooms with transcript, zero unread/highlights.
    const channels = new Map<string, Channel>();
    channels.set(
      '#general',
      makeChannel('#general', 0, 0, [
        makeMsg('g-1', 'alice', 'already read', { time: new Date('2026-07-19T12:00:00.000Z') }),
      ]),
    );
    store.setState(
      {
        ...initialState,
        channels,
        ourNick: 'me',
        connectionStatus: 'connected',
        activeView: { kind: 'home' },
        server,
        firstUnreadId: new Map(),
      },
      true,
    );

    render(() => <HomeView />);

    const explore = screen.getByRole('region', { name: 'Explore' });
    const caughtUp = screen.getByRole('region', { name: "You're caught up" });
    expect(explore).toHaveAttribute('data-home-band', 'explore');
    expect(caughtUp).toHaveAttribute('data-home-band', 'caught-up');
    expect(explore.compareDocumentPosition(caughtUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not offer a hardcoded Join #root CTA', () => {
    seedHierarchy();
    render(() => <HomeView />);

    expect(screen.queryByRole('button', { name: /Join #root/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Join #root/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse rooms' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search messages' })).toBeInTheDocument();
  });

  it('collapses technical More activity by default; quiet + catch-up details stay collapsed in Needs you', () => {
    seedHierarchy();
    // Seed a review history entry so More activity has content without inventing stats.
    recordReviewHistory(
      {
        target: '#mentions',
        name: '#mentions',
        kind: 'channel',
        firstMessageId: 'm-1',
        firstAt: '2026-07-19T10:00:00.000Z',
        reviewedAt: '2026-07-19T12:30:00.000Z',
        messageCount: 3,
        mentionCount: 2,
        preview: 'hey @me',
      },
      OWNER,
    );
    render(() => <HomeView />);

    const more = document.querySelector('details.home-more-activity') as HTMLDetailsElement | null;
    expect(more).not.toBeNull();
    expect(more?.open).toBe(false);
    expect(more?.querySelector('.home-more-activity__summary')?.textContent).toMatch(/More activity/i);
    expect(more?.querySelector('.home-review-history')).not.toBeNull();

    const quiet = document.querySelector('[data-home-stratum="quiet"]') as HTMLDetailsElement | null;
    expect(quiet).not.toBeNull();
    expect(quiet?.open).toBe(false);
    expect(more?.contains(quiet)).toBe(false);

    const needs = screen.getByRole('region', { name: 'Catch up on what you missed' });
    const recapDetails = needs.querySelector('details.home-catchup-details') as HTMLDetailsElement | null;
    expect(recapDetails).not.toBeNull();
    expect(recapDetails?.open).toBe(false);
    expect(recapDetails?.querySelector('.home-catchup-details__summary')?.textContent).toMatch(
      /Catch-up details \(\d+\)/,
    );
    // Recap actions remain in the DOM under the closed disclosure (not deleted).
    expect(recapDetails?.querySelector('.home-recap-strip')).not.toBeNull();
    expect(recapDetails?.querySelector('.home-recap-card__open')).not.toBeNull();
    expect(more?.contains(recapDetails)).toBe(false);
  });

  it('shows a truthful caught-up empty state without inventing people or rooms', () => {
    const channels = new Map<string, Channel>();
    channels.set('#general', makeChannel('#general', 0, 0, [
      makeMsg('g-1', 'alice', 'already read', { time: new Date('2026-07-19T12:00:00.000Z') }),
    ]));
    store.setState(
      {
        ...initialState,
        channels,
        ourNick: 'me',
        connectionStatus: 'connected',
        activeView: { kind: 'home' },
        server,
        firstUnreadId: new Map(),
      },
      true,
    );

    render(() => <HomeView />);

    const empty = screen.getByRole('region', { name: "You're caught up" });
    expect(empty).toHaveAttribute('data-home-band', 'caught-up');
    expect(within(empty).getByText(/No unread messages need you/i)).toBeInTheDocument();
    expect(within(empty).queryByText(/testimonial|enterprise|secure badge|people online/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live now' })).not.toBeInTheDocument();
  });

  it('keeps Live now absent when there is no real scheduled or call state', () => {
    seedHierarchy();
    render(() => <HomeView />);
    expect(screen.queryByRole('region', { name: 'Live now' })).not.toBeInTheDocument();
    expect(store.getState().voice.callState).toBe('idle');
  });
});
