// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';
import type { Channel } from '@/lib/irc/types';
import { store, type Server } from '@/lib/store/store';
import { PresenceRibbon } from './PresenceRibbon';

const initialState = store.getInitialState();

function channel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function runtime(room: string): GroupControlRuntimeState {
  return {
    generation: 1,
    lifecycle: 'ready',
    activation: 'hold',
    identity: { clientId: 'private-client', endpoint: 'wss://private.example/ws', account: 'alice', deviceId: 'phone' },
    rooms: [{ room, status: 'control-applied', provisioned: true }],
    counters: { accepted: 8, processed: 8, queued: 0, applied: 1, locked: 0, rejected: 0, ignored: 0, coalesced: 0, evicted: 0, expired: 0 },
    queueDepth: 0,
    sessionCount: 1,
  };
}

function server(account: string | null): Server {
  return {
    id: 'test',
    name: 'Test',
    network: 'Test',
    url: 'wss://test.example/ws',
    icon: '●',
    nick: 'alice',
    account,
    connected: true,
  };
}

describe('PresenceRibbon group-control projection', () => {
  beforeEach(() => store.setState(initialState, true));
  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
  });

  it('mounts the safe active-room projection in Place before People without an activation claim', () => {
    const room = '#lobby';
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: room },
      channels: new Map([[room, channel(room)]]),
      server: server('alice'),
      groupControlRuntime: runtime(room),
    });
    render(() => <PresenceRibbon />);

    const indicator = screen.getByTestId('group-control-room-indicator');
    const place = screen.getByRole('group', { name: 'Place' });
    const people = screen.getByRole('group', { name: 'People' });
    expect(place).toContainElement(indicator);
    expect(indicator.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(indicator).toHaveTextContent('Message protection: not active');
    expect(indicator).toHaveTextContent('Room controls applied; message protection remains inactive');
    expect(indicator.textContent?.toLowerCase()).not.toContain('encrypted');
    expect(indicator.querySelector('button, a, input, select, textarea')).toBeNull();
    for (const privateValue of ['private-client', 'private.example', 'alice', 'phone', '8']) {
      expect(indicator.textContent ?? '').not.toContain(privateValue);
    }
  });

  it('hides the projection for missing active-room state, guests, and non-channel views', () => {
    const room = '#lobby';
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: room },
      channels: new Map([[room, channel(room)]]),
      server: server('alice'),
      groupControlRuntime: runtime('#other'),
    });
    const view = render(() => <PresenceRibbon />);
    expect(screen.queryByTestId('group-control-room-indicator')).toBeNull();

    store.setState({ groupControlRuntime: runtime(room), server: server(null) });
    expect(screen.queryByTestId('group-control-room-indicator')).toBeNull();

    store.setState({ activeView: { kind: 'dm', nick: 'mika' }, server: server('alice') });
    expect(screen.queryByTestId('group-control-room-indicator')).toBeNull();
    view.unmount();
  });
});
