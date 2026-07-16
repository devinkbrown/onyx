// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView.resume.test.tsx — accessibility contract for the "Pick up where you
 * left off" resume section.
 *
 * The resume items must be REAL controls (native <button>, not a click-bound
 * div): that gives keyboard operability (Enter/Space activate a button by the
 * platform, SC 2.1.1) and an exposed name+role (SC 4.1.2). Activating one must
 * navigate to the target and land focus on the authoritative first-unread
 * boundary via focusMessage (SC 2.4.3 Focus Order).
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { HomeView } from './HomeView';

const initialState = store.getInitialState();

function makeChannel(name: string, unread: number, highlights: number): Channel {
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
    messages: [],
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
      // Authoritative read boundary the resume point deep-links to.
      firstUnreadId: new Map<string, string | null>([['#general', 'msg-42']]),
    },
    true,
  );
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
  // HomeView kicks off a stats createResource; keep it offline + quiet.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
