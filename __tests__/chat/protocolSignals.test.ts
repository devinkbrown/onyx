import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import type { IRCClient } from '@/lib/irc/client';

function installClient() {
  const client = {
    negotiatedCaps: new Set(['draft/typing', 'draft/chathistory']),
    tagmsg: vi.fn(),
    sendRaw: vi.fn(),
  };

  useOnyxStore.setState({
    client: client as unknown as IRCClient,
    historyLoading: new Map(),
    historyExhausted: new Map(),
  });

  return client;
}

describe('IRCv3 protocol signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOnyxStore.getState().sendTypingStop('#test-reset');
    useOnyxStore.setState({ monitoredNicks: new Set() });
  });

  it('sends typing notifications with the draft/typing message tag', () => {
    const client = installClient();

    useOnyxStore.getState().sendTypingStart('#root');
    useOnyxStore.getState().sendTypingStop('#root');

    expect(client.tagmsg).toHaveBeenNthCalledWith(1, '#root', { '+draft/typing': 'active' });
    expect(client.tagmsg).toHaveBeenNthCalledWith(2, '#root', { '+draft/typing': 'done' });
  });

  it('loads recent channel history with CHATHISTORY LATEST', () => {
    const client = installClient();

    useOnyxStore.getState().loadHistory('#root');

    expect(client.sendRaw).toHaveBeenCalledWith('CHATHISTORY', 'LATEST', '#root', '*', '50');
  });

  it('loads older channel history with CHATHISTORY BEFORE and a msgid reference', () => {
    const client = installClient();
    const oldest = { id: 'server-msgid-1', time: new Date('2026-05-30T00:00:00.000Z') } as ChatMessage;

    useOnyxStore.getState().loadHistory('#root', oldest);

    expect(client.sendRaw).toHaveBeenCalledWith('CHATHISTORY', 'BEFORE', '#root', 'msgid=server-msgid-1', '50');
  });

  it('loads older local-only history with a timestamp reference', () => {
    const client = installClient();
    const oldest = { id: 'onyx-local-1', time: new Date('2026-05-30T01:02:03.000Z') } as ChatMessage;

    useOnyxStore.getState().loadHistory('#root', oldest);

    expect(client.sendRaw).toHaveBeenCalledWith('CHATHISTORY', 'BEFORE', '#root', 'timestamp=2026-05-30T01:02:03.000Z', '50');
  });

  it('sends friend presence through MONITOR', () => {
    const client = installClient();

    useOnyxStore.getState().monitorAdd('alice');

    expect(client.sendRaw).toHaveBeenCalledWith('MONITOR', '+', 'alice');
  });

  it('does not send EDIT when draft/message-editing is absent', () => {
    const client = installClient();

    useOnyxStore.getState().editMessage('#root', 'msg-1', 'changed');

    expect(client.sendRaw).not.toHaveBeenCalledWith('EDIT', '#root', 'msg-1', 'changed');
  });

  it('sends EDIT when draft/message-editing is ACKed', () => {
    const client = installClient();
    client.negotiatedCaps.add('draft/message-editing');

    useOnyxStore.getState().editMessage('#root', 'msg-1', 'changed');

    expect(client.sendRaw).toHaveBeenCalledWith('EDIT', '#root', 'msg-1', 'changed');
  });
});
