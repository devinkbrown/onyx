// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MarkAllCaughtUp tests — the button reflects the unread backlog, clicking it
 * advances read-state through the store's markRead action (unread + highlights
 * → 0 across every room and DM), and the button self-hides once caught up. The
 * self-hide assertion is the reactivity guard: the component must respond to the
 * store change, not read a one-shot snapshot.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import type { DMConversation } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';

import { MarkAllCaughtUp } from './MarkAllCaughtUp';

const initialState = store.getInitialState();

const channel = (over: Partial<Channel> & { name: string }): Channel => ({
  topic: '',
  topicSetBy: '',
  topicSetAt: null,
  modes: '',
  users: new Map(),
  unread: 0,
  highlights: 0,
  createdAt: null,
  messages: [],
  ...over,
});

const dmConversation = (over: Partial<DMConversation> & { nick: string }): DMConversation => ({
  account: null,
  unread: 0,
  highlights: 0,
  messages: [],
  ...over,
});

function seed(opts: { channels?: Channel[]; dms?: DMConversation[] }): void {
  store.setState(
    {
      ...initialState,
      ourNick: 'kain',
      channels: new Map((opts.channels ?? []).map((c) => [c.name.toLowerCase(), c])),
      dms: new Map((opts.dms ?? []).map((d) => [d.nick.toLowerCase(), d])),
    },
    true,
  );
}

beforeEach(() => {
  store.setState({ ...initialState }, true);
});

afterEach(() => cleanup());

describe('<MarkAllCaughtUp>', () => {
  it('renders no button when nothing is unread', () => {
    seed({ channels: [channel({ name: '#root', unread: 0 })] });
    render(() => <MarkAllCaughtUp />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the unread-room count on the button', () => {
    seed({
      channels: [channel({ name: '#root', unread: 4 }), channel({ name: '#zig', unread: 9 })],
      dms: [dmConversation({ nick: 'trev', unread: 2 })],
    });
    render(() => <MarkAllCaughtUp />);
    const button = screen.getByRole('button', {
      name: /Mark all caught up — clears 15 unread across 3 rooms/i,
    });
    expect(button).toBeInTheDocument();
  });

  it('advances read-state across every room and DM on click', () => {
    seed({
      channels: [
        channel({ name: '#root', unread: 4, highlights: 2 }),
        channel({ name: '#zig', unread: 9, highlights: 0 }),
      ],
      dms: [dmConversation({ nick: 'trev', unread: 2, highlights: 1 })],
    });
    render(() => <MarkAllCaughtUp />);
    fireEvent.click(screen.getByRole('button', { name: /Mark all caught up/i }));

    const state = store.getState();
    for (const key of ['#root', '#zig']) {
      const ch = state.channels.get(key)!;
      expect(ch.unread).toBe(0);
      expect(ch.highlights).toBe(0);
    }
    const dm = state.dms.get('trev')!;
    expect(dm.unread).toBe(0);
    expect(dm.highlights).toBe(0);
  });

  it('self-hides the button and announces after catching up (reactivity guard)', () => {
    seed({
      channels: [channel({ name: '#root', unread: 3, highlights: 1 })],
      dms: [dmConversation({ nick: 'trev', unread: 2 })],
    });
    render(() => <MarkAllCaughtUp />);
    fireEvent.click(screen.getByRole('button', { name: /Mark all caught up/i }));

    // The store change flows back through useStore: the button is gone.
    expect(screen.queryByRole('button')).toBeNull();
    // ...and the live region confirms the result.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Marked 2 rooms as caught up, clearing 1 mention.');
    // Focus is parked on the status line, not dropped to <body> (WCAG 2.4.3).
    expect(document.activeElement).toBe(status);
  });

  it('fires onCaughtUp with the applied plan', () => {
    const applied: number[] = [];
    seed({ channels: [channel({ name: '#root', unread: 5 })] });
    render(() => <MarkAllCaughtUp onCaughtUp={(plan) => applied.push(plan.rooms)} />);
    fireEvent.click(screen.getByRole('button', { name: /Mark all caught up/i }));
    expect(applied).toEqual([1]);
  });
});
