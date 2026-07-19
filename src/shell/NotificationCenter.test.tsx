// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * NotificationCenter tests — badge counting, list rendering, jump + mark-read.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Notification } from '@/lib/store/store';
import { NotificationCenter } from './NotificationCenter';

const initialState = store.getInitialState();

const note = (over: Partial<Notification>): Notification => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  type: 'mention',
  text: 'hello there',
  at: new Date(),
  ...over,
});

beforeEach(() => {
  store.setState({ ...initialState, readNotificationIds: new Set<string>() }, true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('<NotificationCenter>', () => {
  it('ages relative times while the inbox stays open without a store update', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    store.setState({
      notifications: [note({ id: 'timed', type: 'dm', from: 'mizu', at: new Date() })],
    });
    render(() => <NotificationCenter />);

    fireEvent.click(screen.getByRole('button', { name: /Inbox — 1 unread/i }));
    expect(screen.getByText('just now')).toBeInTheDocument();

    vi.advanceTimersByTime(60_000);

    expect(screen.getByText('1m ago')).toBeInTheDocument();
  });

  it('runs the shared relative-time clock only while the inbox is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    store.setState({
      notifications: [note({ id: 'timed', type: 'dm', from: 'mizu', at: new Date() })],
    });
    render(() => <NotificationCenter />);
    const trigger = screen.getByRole('button', { name: /Inbox — 1 unread/i });

    expect(setIntervalSpy).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(setIntervalSpy).toHaveBeenCalledOnce();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    const clock = setIntervalSpy.mock.results[0]?.value;

    fireEvent.click(screen.getByRole('button', { name: 'Close notification inbox' }));
    expect(clearIntervalSpy).toHaveBeenCalledWith(clock);
  });

  it('shows the empty state when there are no notifications', () => {
    const { getByText } = render(() => <NotificationCenter />);
    const trigger = screen.getByRole('button', { name: 'Inbox' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(within(trigger).queryByRole('button')).toBeNull();

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Notification inbox' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', dialog.id);
    expect(getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('counts only unread mentions and DMs in the badge', () => {
    store.setState({
      notifications: [
        note({ id: 'a', type: 'mention', from: 'trev', channel: '#root' }),
        note({ id: 'b', type: 'dm', from: 'mizu' }),
        note({ id: 'f', type: 'follow', from: 'lapis', channel: '#root' }),
        note({ id: 'c', type: 'system', text: 'connected' }),
        note({ id: 'd', type: 'mention', from: 'cadence', channel: '#zig' }),
      ],
      readNotificationIds: new Set(['d']),
    });
    render(() => <NotificationCenter />);
    expect(screen.getByRole('button', { name: 'Inbox — 3 unread notifications' })).toBeInTheDocument();
  });

  it('clicking a mention marks it read and navigates to the channel', () => {
    store.setState({
      notifications: [note({ id: 'm1', type: 'mention', from: 'trev', channel: '#root', text: 'ping kain' })],
    });
    const { getByText } = render(() => <NotificationCenter />);
    const trigger = screen.getByRole('button', { name: 'Inbox — 1 unread notification' });
    fireEvent.click(trigger);
    fireEvent.click(getByText('ping kain'));
    expect(store.getState().readNotificationIds.has('m1')).toBe(true);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAccessibleName('Inbox');
    expect(screen.queryByRole('dialog', { name: 'Notification inbox' })).toBeNull();
  });

  it('clicking a followed conversation notification marks it read and navigates to the channel', () => {
    store.setState({
      notifications: [
        note({
          id: 'f1',
          type: 'follow',
          from: 'trev',
          channel: '#root',
          topic: ' roadmap ',
          text: 'quiet update',
        }),
      ],
      channelProps: new Map([['#root', { 'onyx_server.topics': 'roadmap' }]]),
    });
    const { getByTestId, getByText } = render(() => <NotificationCenter />);
    fireEvent.click(getByTestId('ribbon-bell'));
    fireEvent.click(getByText('quiet update'));
    expect(store.getState().readNotificationIds.has('f1')).toBe(true);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
    expect(store.getState().activeChannelTopics.get('#root')).toBe('roadmap');
  });

  it('ignores an invalid topic on a followed conversation notification', () => {
    store.setState({
      notifications: [
        note({ id: 'f2', type: 'follow', from: 'trev', channel: '#root', topic: 'bad,topic', text: 'quiet update' }),
      ],
    });
    const { getByTestId, getByText } = render(() => <NotificationCenter />);
    fireEvent.click(getByTestId('ribbon-bell'));
    fireEvent.click(getByText('quiet update'));
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
    expect(store.getState().activeChannelTopics.has('#root')).toBe(false);
  });

  it('dismiss removes a notification; mark-all clears the badge', () => {
    store.setState({
      notifications: [
        note({ id: 'x', type: 'dm', from: 'mizu', text: 'psst' }),
        note({ id: 'y', type: 'mention', from: 'trev', channel: '#root', text: 'oi' }),
      ],
    });
    const { getByTestId, getByText, getAllByLabelText } = render(() => <NotificationCenter />);
    fireEvent.click(getByTestId('ribbon-bell'));
    const list = screen.getByRole('list', { name: 'Notification inbox items' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open notification from trev in #root: oi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss notification from trev in #root: oi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open notification from mizu: psst' })).toBeInTheDocument();
    // The list renders newest-first, so the first dismiss removes 'y'.
    fireEvent.click(getAllByLabelText('Dismiss notification from trev in #root: oi')[0]!);
    expect(store.getState().notifications.map((n) => n.id)).toEqual(['x']);
    fireEvent.click(getByText('Mark all read'));
    expect(store.getState().readNotificationIds.has('x')).toBe(true);
  });

  it('moves focus to the next row after dismissing the focused middle row', async () => {
    store.setState({
      notifications: [
        note({ id: 'oldest', type: 'dm', from: 'oldest', text: 'oldest message' }),
        note({ id: 'middle', type: 'dm', from: 'middle', text: 'middle message' }),
        note({ id: 'newest', type: 'dm', from: 'newest', text: 'newest message' }),
      ],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 3 unread/i }));
    const middle = screen.getByRole('button', { name: /Dismiss notification from middle/i });
    middle.focus();

    fireEvent.click(middle);

    const next = screen.getByRole('button', { name: /Dismiss notification from oldest/i });
    await waitFor(() => expect(next).toHaveFocus());
    expect(store.getState().notifications.map((notification) => notification.id)).toEqual(['oldest', 'newest']);
  });

  it('moves focus to the previous row when the focused last row has no next row', async () => {
    store.setState({
      notifications: [
        note({ id: 'oldest', type: 'dm', from: 'oldest', text: 'oldest message' }),
        note({ id: 'newest', type: 'dm', from: 'newest', text: 'newest message' }),
      ],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 2 unread/i }));
    const oldest = screen.getByRole('button', { name: /Dismiss notification from oldest/i });
    oldest.focus();

    fireEvent.click(oldest);

    const previous = screen.getByRole('button', { name: /Dismiss notification from newest/i });
    await waitFor(() => expect(previous).toHaveFocus());
  });

  it('skips a next row that disappears before focus handoff completes', async () => {
    store.setState({
      notifications: [
        note({ id: 'oldest', type: 'dm', from: 'oldest', text: 'oldest message' }),
        note({ id: 'middle', type: 'dm', from: 'middle', text: 'middle message' }),
        note({ id: 'newest', type: 'dm', from: 'newest', text: 'newest message' }),
      ],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 3 unread/i }));
    const newest = screen.getByRole('button', { name: /Dismiss notification from newest/i });
    newest.focus();

    fireEvent.click(newest);
    store.getState().dismissNotification('middle');

    const remaining = screen.getByRole('button', { name: /Dismiss notification from oldest/i });
    await waitFor(() => expect(remaining).toHaveFocus());
  });

  it('moves focus to the stable close control after dismissing the only row', async () => {
    store.setState({
      notifications: [note({ id: 'only', type: 'dm', from: 'only', text: 'only message' })],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 1 unread/i }));
    const dismiss = screen.getByRole('button', { name: /Dismiss notification from only/i });
    dismiss.focus();

    fireEvent.click(dismiss);

    const close = screen.getByRole('button', { name: 'Close notification inbox' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('recaptures focus when a synchronized update removes the focused row', async () => {
    store.setState({
      notifications: [note({ id: 'remote', type: 'dm', from: 'mizu', text: 'remote message' })],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 1 unread/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveFocus());
    const row = screen.getByRole('button', { name: /Open notification from mizu/i });
    row.focus();
    expect(row).toHaveFocus();

    store.setState({ notifications: [] });

    const close = screen.getByRole('button', { name: 'Close notification inbox' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('keeps Tab and Shift+Tab inside the notification dialog', async () => {
    store.setState({
      notifications: [note({ id: 'only', type: 'dm', from: 'mizu', text: 'one message' })],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 1 unread/i }));
    const first = screen.getByRole('button', { name: 'Mark all read' });
    await waitFor(() => expect(first).toHaveFocus());
    const last = screen.getByRole('button', { name: /Dismiss notification from mizu/i });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('closes on Escape and restores focus to the inbox trigger', async () => {
    store.setState({
      notifications: [note({ id: 'only', type: 'dm', from: 'mizu', text: 'one message' })],
    });
    render(() => <NotificationCenter />);
    const trigger = screen.getByRole('button', { name: /Inbox — 1 unread/i });
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close notification inbox' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveFocus());

    fireEvent.keyDown(close, { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Notification inbox' })).toBeNull();
  });

  it('does not navigate from a stale row that was already removed', () => {
    store.setState({
      notifications: [note({ id: 'stale', type: 'dm', from: 'mizu', text: 'stale message' })],
    });
    render(() => <NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Inbox — 1 unread/i }));
    const stale = screen.getByRole('button', { name: /Open notification from mizu/i });
    store.setState({ notifications: [] });

    fireEvent.click(stale);

    expect(store.getState().activeView).toEqual(initialState.activeView);
    expect(store.getState().readNotificationIds.has('stale')).toBe(false);
  });
});
