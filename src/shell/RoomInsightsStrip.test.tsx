// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { store } from '@/lib/store';
import { RoomInsightsStrip } from './RoomInsightsStrip';

vi.mock('@/lib/stats/channelDetail', () => ({
  fetchChannelDetail: vi.fn(async () => ({
    channel: '#root',
    generatedAt: 1,
    firstSeen: 1,
    lastActive: Math.floor(Date.now() / 1000) - 60,
    present: 12,
    lastSpeaker: 'alice',
    totals: {
      messages: 1500,
      words: 4000,
      activeUsers: 40,
      joins: 10,
      parts: 5,
      quits: 2,
      kicks: 0,
      topicChanges: 1,
    },
    hours: Array.from({ length: 24 }, () => 0),
    days: [],
    heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    busiestDay: { date: '2026-07-01', messages: 100 },
    peakHour: 14,
    complete: true,
  })),
}));

const initial = store.getInitialState();

beforeEach(() => {
  store.setState(initial, true);
  store.setState({ activeView: { kind: 'channel', channel: '#root' } });
});

afterEach(() => {
  cleanup();
  store.setState(initial, true);
});

describe('RoomInsightsStrip', () => {
  it('renders public aggregate metrics for the active channel', async () => {
    render(() => <RoomInsightsStrip />);
    await waitFor(() => {
      expect(screen.getByTestId('room-insights-metrics')).toBeInTheDocument();
    });
    expect(screen.getByText('1.5k')).toBeInTheDocument();
    expect(screen.getByTestId('room-insights-open-stats')).toHaveAttribute(
      'href',
      expect.stringMatching(/\/stats\/\?/),
    );
  });
});
