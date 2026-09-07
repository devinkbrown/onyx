// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { store } from '@/lib/store';
import { setPreference } from '@/lib/prefs/preferences';
import { ContextRail } from './ContextRail';

vi.mock('@/lib/stats/channelDetail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stats/channelDetail')>();
  return {
    ...actual,
    fetchChannelDetail: vi.fn(async () => ({
      channel: '#general',
      generatedAt: 1,
      firstSeen: 1,
      lastActive: Math.floor(Date.now() / 1000) - 60,
      present: 4,
      lastSpeaker: 'alice',
      totals: {
        messages: 100,
        words: 400,
        activeUsers: 4,
        joins: 1,
        parts: 0,
        quits: 0,
        kicks: 0,
        topicChanges: 0,
      },
      hours: Array.from({ length: 24 }, () => 0),
      days: [],
      heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      busiestDay: { date: '2026-07-01', messages: 10 },
      peakHour: 14,
      complete: true,
    })),
  };
});

const initial = store.getInitialState();

beforeEach(() => {
  store.setState(initial, true);
  store.setState({ activeView: { kind: 'channel', channel: '#general' } });
});

afterEach(() => {
  cleanup();
  store.setState(initial, true);
});

describe('ContextRail', () => {
  it('links the active channel to the public room ledger', () => {
    render(() => <ContextRail open={true} onClose={() => {}} />);

    expect(screen.getByTestId('context-rail-channel-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
    expect(screen.getByRole('link', { name: 'Room ledger for #general' })).toHaveTextContent(
      'Room ledger',
    );
  });

  it('omits the room ledger outside # and & rooms', () => {
    store.setState({ activeView: { kind: 'dm', nick: 'bob' } });

    render(() => <ContextRail open={true} onClose={() => {}} />);

    expect(screen.queryByTestId('context-rail-channel-ledger')).toBeNull();
  });

  it('remounts loaded room tools for the current room before issuing an action', async () => {
    const client = { sendRaw: vi.fn(() => true) };
    const room = (name: string) => ({
      name,
      topic: '',
      topicSetBy: '',
      topicSetAt: null,
      modes: '',
      users: new Map([['me', { nick: 'me', modes: new Set(['o']) }]]),
      unread: 0,
      highlights: 0,
      createdAt: null,
      messages: [],
    });
    store.setState({
      ...initial,
      client: client as never,
      connectionStatus: 'connected',
      server: { id: 'test', name: 'Test', network: 'Test', url: 'wss://test', icon: '', nick: 'me', account: 'me', connected: true },
      ourNick: 'me',
      channels: new Map([['#alpha', room('#alpha')], ['#beta', room('#beta')]]),
      activeView: { kind: 'channel', channel: '#alpha' },
    }, true);
    setPreference('experienceMode', 'advanced');

    render(() => <ContextRail open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('moderation-cockpit')).toBeInTheDocument());

    store.setState({ activeView: { kind: 'channel', channel: '#beta' } });
    await waitFor(() => expect(screen.getByText('MODE #beta (no modes set)')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Moderated/ }));
    expect(client.sendRaw).toHaveBeenCalledWith('MODE', '#beta', '+m');
    expect(client.sendRaw).not.toHaveBeenCalledWith('MODE', '#alpha', '+m');
  });
});
