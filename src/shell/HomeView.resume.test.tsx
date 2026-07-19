// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.resume.test.tsx — resume a11y + Era-1 A9/A13 contracts.
 *
 * Resume items must be REAL controls (native <button>, not a click-bound
 * div): keyboard operability (SC 2.1.1) and name+role (SC 4.1.2). Activating
 * one navigates and lands focus on the first-unread boundary (SC 2.4.3).
 *
 * A9 — Home strata expose data-home-stratum markers for thesis-first hierarchy
 * (attention / followed / quiet / resume / memory).
 *
 * A13 — catch-up review handoffs (resume / open / review-from-start /
 * reopen-reviewed) enable readerMode via setPreference, mirroring Connect
 * deep-link `?reader=1`.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser, ChatMessage } from '@/lib/irc/types';
import {
  preferences,
  resetPreferences,
  setPreference,
} from '@/lib/prefs/preferences';
import { mergeFollowedKeys } from '@/lib/notifications/followed';
import { recordReviewHistory } from '@/lib/notifications/reviewHistory';
import {
  saveMessages,
  _resetVaultForTests,
} from '@/lib/vault/historyVault';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

const OWNER = {
  serverUrl: 'wss://example.test',
  identity: 'me',
} as const;

const server = {
  id: 'home-resume',
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
    target: '#general',
    highlight: opts.highlight,
  };
}

function seedResume(): void {
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general', 3, 2));
  store.setState(
    {
      ...initialState,
      channels,
      ourNick: 'me',
      connectionStatus: 'connected',
      activeView: { kind: 'home' },
      server,
      // Authoritative read boundary the resume point deep-links to.
      firstUnreadId: new Map<string, string | null>([['#general', 'msg-42']]),
    },
    true,
  );
}

/** Seed Needs-you + Followed + Quiet tiers (and recap-ready messages). */
function seedStrata(): void {
  const t0 = new Date('2026-07-19T10:00:00.000Z');
  const t1 = new Date('2026-07-19T11:00:00.000Z');
  const t2 = new Date('2026-07-19T12:00:00.000Z');
  const channels = new Map<string, Channel>();
  channels.set(
    '#mentions',
    makeChannel('#mentions', 4, 2, [
      makeMsg('m-1', 'alice', 'hey @me look', { highlight: true, time: t0 }),
      makeMsg('m-2', 'bob', 'second line', { time: t1 }),
      makeMsg('m-3', 'carol', 'third line', { time: t2 }),
      makeMsg('m-4', 'dave', 'fourth line', { time: t2 }),
    ]),
  );
  channels.set(
    '#news',
    makeChannel('#news', 5, 0, [
      makeMsg('n-1', 'ed', 'followed room chatter', { time: t1 }),
      makeMsg('n-2', 'fran', 'more followed chatter', { time: t2 }),
    ]),
  );
  channels.set('#ambient', makeChannel('#ambient', 2, 0));
  // Followed tier needs a local followed key for #news (owner-scoped).
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
  // Fresh IndexedDB per test so vault-backed Device memory stays isolated.
  globalThis.indexedDB = new IDBFactory();
  _resetVaultForTests();
  store.setState(initialState, true);
  localStorage.clear();
  resetPreferences();
  // HomeView kicks off a stats createResource; keep it offline + quiet.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPreferences();
  _resetVaultForTests();
});

describe('HomeView — resume section a11y', () => {
  it('keeps Home mounted while the optional network pulse is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    render(() => (
      <Suspense fallback={<p data-testid="home-suspended">Loading shell</p>}>
        <HomeView />
      </Suspense>
    ));

    await waitFor(() => {
      expect(screen.queryByTestId('home-suspended')).not.toBeInTheDocument();
      expect(screen.getByRole('main', { name: 'Network home' })).toBeInTheDocument();
    });
  });

  it('renders each resume point as a named native button, not a bare div', () => {
    seedResume();
    render(() => <HomeView />);

    const resume = screen.getByRole('region', { name: 'Resume where you left off' });
    expect(resume).toBeInTheDocument();

    const btn = screen.getByRole('button', {
      name: 'Resume #general at your first unread message, 3 unread, 2 mentions',
    });
    // A real <button> is keyboard-operable (Enter/Space) by the platform.
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('activating a resume point navigates and lands focus on the first-unread boundary', () => {
    seedResume();
    const navigate = vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    const focusMessage = vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Resume #general at your first unread message, 3 unread, 2 mentions',
      }),
    );

    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#general' });
    expect(focusMessage).toHaveBeenCalledWith('msg-42');
  });
});

describe('HomeView — A9 strata visual hierarchy markers', () => {
  it('marks Needs you / Followed / Quiet / Resume with data-home-stratum', () => {
    seedStrata();
    render(() => <HomeView />);

    const attention = document.querySelector('[data-home-stratum="attention"]');
    const followed = document.querySelector('[data-home-stratum="followed"]');
    const quiet = document.querySelector('[data-home-stratum="quiet"]');
    const resume = document.querySelector('[data-home-stratum="resume"]');

    expect(attention).not.toBeNull();
    expect(attention).toHaveClass('home-catchup-tier--attention');
    expect(attention?.querySelector('.home-catchup-tier-label')?.textContent).toBe('Needs you');

    expect(followed).not.toBeNull();
    expect(followed).toHaveClass('home-catchup-tier--followed');
    expect(followed?.querySelector('.home-catchup-tier-label')?.textContent).toBe('Followed');

    expect(quiet).not.toBeNull();
    expect(quiet).toHaveClass('home-catchup-tier--quiet');
    // Quiet stays collapsed (details) so it never steals focus under calm.
    expect(quiet?.tagName).toBe('DETAILS');
    expect((quiet as HTMLDetailsElement).open).toBe(false);

    expect(resume).not.toBeNull();
    expect(resume).toHaveAttribute('aria-label', 'Resume where you left off');
  });

  it('marks Device memory as the calm local-first stratum', async () => {
    setPreference('localHistory', true);
    await saveMessages(
      '#archive',
      [
        makeMsg('a-1', 'alice', 'remembered line one', {
          time: new Date('2026-07-18T12:00:00.000Z'),
        }),
        makeMsg('a-2', 'bob', 'remembered line two', {
          time: new Date('2026-07-18T13:00:00.000Z'),
        }),
      ],
      OWNER,
    );
    store.setState(
      {
        ...initialState,
        channels: new Map(),
        // Left rooms only — memory paints rooms you've since left.
        joinHistory: ['#archive'],
        ourNick: 'me',
        connectionStatus: 'connected',
        activeView: { kind: 'home' },
        server,
      },
      true,
    );

    render(() => <HomeView />);

    await waitFor(() => {
      const memory = document.querySelector('[data-home-stratum="memory"]');
      expect(memory).not.toBeNull();
      expect(memory).toHaveAttribute('aria-label', 'Remembered rooms on this device');
      expect(memory?.querySelector('.home-section-label')?.textContent).toBe('Device memory');
    });
  });
});

describe('HomeView — A13 reader default for catch-up handoffs', () => {
  it('enables readerMode when resuming at the first-unread boundary', () => {
    seedResume();
    expect(preferences().readerMode).toBe(false);
    vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Resume #general at your first unread message, 3 unread, 2 mentions',
      }),
    );

    expect(preferences().readerMode).toBe(true);
    expect(document.documentElement.dataset.reader).toBe('true');
  });

  it('enables readerMode when opening a Needs-you catch-up row', () => {
    seedStrata();
    expect(preferences().readerMode).toBe(false);
    vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: /Open #mentions, 4 unread, 2 mentions/,
      }),
    );

    expect(preferences().readerMode).toBe(true);
  });

  it('enables readerMode on Review from start (canonical read-since-you-left path)', () => {
    seedStrata();
    expect(preferences().readerMode).toBe(false);
    vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});
    vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Review #mentions from first unread line',
      }),
    );

    expect(preferences().readerMode).toBe(true);
  });

  it('enables readerMode when reopening a reviewed catch-up span', () => {
    seedResume();
    recordReviewHistory(
      {
        target: '#general',
        name: '#general',
        kind: 'channel',
        firstMessageId: 'msg-42',
        firstAt: '2026-07-19T11:00:00.000Z',
        reviewedAt: '2026-07-19T12:30:00.000Z',
        messageCount: 3,
        mentionCount: 2,
        preview: 'boundary line',
      },
      OWNER,
    );
    expect(preferences().readerMode).toBe(false);
    vi.spyOn(store.getState(), 'openVaultResult').mockImplementation(() => {});
    vi.spyOn(store.getState(), 'travelTo').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reopen reviewed catch-up for #general',
      }),
    );

    expect(preferences().readerMode).toBe(true);
    expect(document.documentElement.dataset.reader).toBe('true');
  });

  it('does not thrash setPreference when readerMode is already on', () => {
    seedResume();
    setPreference('readerMode', true);
    const navigate = vi.spyOn(store.getState(), 'navigate').mockImplementation(() => {});
    vi.spyOn(store.getState(), 'focusMessage').mockImplementation(() => {});

    render(() => <HomeView />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Resume #general at your first unread message, 3 unread, 2 mentions',
      }),
    );

    expect(preferences().readerMode).toBe(true);
    expect(navigate).toHaveBeenCalled();
  });
});
