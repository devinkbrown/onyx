// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * NotificationCenter tests — badge counting, list rendering, jump + mark-read.
 */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

afterEach(() => cleanup());

describe('<NotificationCenter>', () => {
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
        note({ id: 'd', type: 'mention', from: 'kagura', channel: '#zig' }),
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
      channelProps: new Map([['#root', { 'orochi.topics': 'roadmap' }]]),
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
});
