// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.localSlash.test.ts — local-only slash verbs never hit the wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store, type Server } from './store';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://slash.test', identity: 'alice' } as const;
const memoryServer: Server = {
  id: 'slash-local',
  name: 'Slash',
  network: 'Onyx',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: MEMORY_OWNER.identity,
  account: MEMORY_OWNER.identity,
  connected: true,
};

function mockClient(sendRaw = vi.fn()) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send: vi.fn(),
  } as never;
}

function seedChannel(name = '#ops', sendRaw = vi.fn()): void {
  const channels = new Map();
  channels.set(name.toLowerCase(), {
    name,
    topic: '',
    users: new Map(),
    messages: [
      {
        id: 'm1',
        time: new Date('2026-07-25T11:00:00.000Z'),
        from: 'bob',
        text: 'hello',
        type: 'msg',
        target: name,
      },
    ],
    unread: 2,
    highlights: 1,
  });
  store.setState({
    ...initialState,
    server: memoryServer,
    ourNick: MEMORY_OWNER.identity,
    networkName: 'Onyx',
    connectionStatus: 'connected',
    client: mockClient(sendRaw),
    channels,
    dms: new Map(),
    channelNotify: new Map(),
    activeView: { kind: 'channel', channel: name },
    toasts: [],
  }, true);
}

describe('local slash commands', () => {
  beforeEach(() => {
    localStorage.clear();
    seedChannel();
  });

  it('/mute and /unmute write personal notify mode only', () => {
    const sendRaw = store.getState().client!.sendRaw as ReturnType<typeof vi.fn>;
    store.getState().sendMessage('#ops', '/mute');
    expect(store.getState().channelNotify.get('#ops')).toBe('none');
    store.getState().sendMessage('#ops', '/unmute');
    expect(store.getState().channelNotify.has('#ops')).toBe(false);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('/notify mentions sets channel notify mode', () => {
    const sendRaw = store.getState().client!.sendRaw as ReturnType<typeof vi.fn>;
    store.getState().sendMessage('#ops', '/notify mentions');
    expect(store.getState().channelNotify.get('#ops')).toBe('mentions');
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('/read clears unread without a wire verb', () => {
    const sendRaw = store.getState().client!.sendRaw as ReturnType<typeof vi.fn>;
    store.getState().sendMessage('#ops', '/read');
    const ch = store.getState().channels.get('#ops');
    expect(ch?.unread).toBe(0);
    expect(ch?.highlights).toBe(0);
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('/export does not send EXPORT as IRC', async () => {
    const sendRaw = store.getState().client!.sendRaw as ReturnType<typeof vi.fn>;
    store.getState().sendMessage('#ops', '/export');
    await Promise.resolve();
    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('/share outside a channel does not emit SHARE', () => {
    const sendRaw = vi.fn();
    store.setState({
      client: mockClient(sendRaw),
      activeView: { kind: 'dm', nick: 'bob' },
      dms: new Map([
        ['bob', { nick: 'bob', account: null, unread: 0, highlights: 0, messages: [] }],
      ]),
    });
    store.getState().sendMessage('bob', '/share');
    expect(sendRaw).not.toHaveBeenCalled();
    expect(store.getState().toasts.some((t) => t.title === 'Share a room')).toBe(true);
  });

  it('/help lists local commands without a wire verb', async () => {
    const sendRaw = store.getState().client!.sendRaw as ReturnType<typeof vi.fn>;
    store.getState().sendMessage('#ops', '/help');
    await vi.waitFor(() => {
      expect(store.getState().toasts.some((t) => t.title === 'Local slash commands')).toBe(true);
    });
    expect(sendRaw).not.toHaveBeenCalled();
  });
});
