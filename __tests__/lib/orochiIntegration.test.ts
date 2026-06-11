import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useOnyxStore,
  selectFirstUnreadId,
  selectMediaTranscript,
  selectTegami,
  selectUnreadCount,
  selectUserMetaProfile,
} from '@/lib/store';
import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import type { IRCClient } from '@/lib/irc/client';

function installClient(caps: string[] = []) {
  const client = {
    negotiatedCaps: new Set(caps),
    isupport: { CHANTYPES: '#&' },
    tagmsg: vi.fn(),
    sendRaw: vi.fn(),
    send: vi.fn(),
    join: vi.fn(),
  };
  useOnyxStore.setState({ client: client as unknown as IRCClient });
  return client;
}

function handle(line: string) {
  useOnyxStore.getState()._handleMessage(parseIRCMessage(line));
}

function makeChannel(name: string, over: Partial<Channel> = {}): Channel {
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
    ...over,
  };
}

function makeMsg(id: string, from: string, text: string, time: Date, target: string): ChatMessage {
  return { id, time, from, text, type: 'msg', target };
}

beforeEach(() => {
  vi.clearAllMocks();
  useOnyxStore.setState({
    client: null,
    ourNick: 'me',
    channels: new Map(),
    dms: new Map(),
    firstUnreadId: new Map(),
    channelUnread: {},
    channelMentions: {},
    totalUnreadMentions: 0,
    userMetadata: new Map(),
    userProfiles: new Map(),
    mediaTranscripts: new Map(),
    tegami: new Map(),
    readMarkers: new Map(),
    activeView: { kind: 'home' },
    channelNotify: new Map(),
    notifications: [],
  });
});

// ── 1. RENAME migration ───────────────────────────────────────────────────────

describe('RENAME channel-key migration', () => {
  it('moves messages, membership, unread, and satellites under the new key', () => {
    const t = new Date('2026-06-10T10:00:00.000Z');
    const users = new Map([['alice', { nick: 'alice', modes: new Set<string>() }]]);
    useOnyxStore.setState({
      channels: new Map([
        ['#old', makeChannel('#old', {
          messages: [makeMsg('m1', 'alice', 'hello', t, '#old')],
          users,
          unread: 3,
          highlights: 1,
        })],
      ]),
      firstUnreadId: new Map([['#old', 'm1']]),
      channelUnread: { '#old': 3 },
      channelMentions: { '#old': 1 },
      activeView: { kind: 'channel', channel: '#old' },
    });

    handle(':kain!u@h RENAME #old #new :spring cleaning');

    const s = useOnyxStore.getState();
    expect(s.channels.has('#old')).toBe(false);
    const ch = s.channels.get('#new');
    expect(ch).toBeTruthy();
    expect(ch!.name).toBe('#new');
    // membership followed
    expect(ch!.users.has('alice')).toBe(true);
    // messages followed and a system line was appended
    expect(ch!.messages[0].id).toBe('m1');
    const last = ch!.messages[ch!.messages.length - 1];
    expect(last.type).toBe('system');
    expect(last.text).toContain('kain renamed #old → #new');
    expect(last.text).toContain('spring cleaning');
    // unread + satellites followed
    expect(ch!.unread).toBe(3);
    expect(s.firstUnreadId.get('#new')).toBe('m1');
    expect(s.firstUnreadId.has('#old')).toBe(false);
    expect(s.channelUnread['#new']).toBe(3);
    expect(s.channelUnread['#old']).toBeUndefined();
    expect(s.channelMentions['#new']).toBe(1);
    // active view followed
    expect(s.activeView).toEqual({ kind: 'channel', channel: '#new' });
  });

  it('sends RENAME when the UI dispatches ocean:channel-rename', () => {
    const client = installClient();
    window.dispatchEvent(new CustomEvent('ocean:channel-rename', {
      detail: { channel: '#old', newName: '#new' },
    }));
    expect(client.sendRaw).toHaveBeenCalledWith('RENAME', '#old', '#new');
  });

  it('surfaces FAIL RENAME as an error notification', () => {
    handle(':irc.test FAIL RENAME CHANNEL_NAME_IN_USE :Target channel name is already in use');
    const notes = useOnyxStore.getState().notifications;
    expect(notes.some(n => n.type === 'error' && /already in use/i.test(n.text))).toBe(true);
  });
});

// ── 2. METADATA round-trip ────────────────────────────────────────────────────

describe('METADATA round-trip', () => {
  it('sends METADATA * SET for ocean:metadata-set events and unsets on null', () => {
    const client = installClient();

    window.dispatchEvent(new CustomEvent('ocean:metadata-set', {
      detail: { key: 'ocean.pronouns', value: 'they/them' },
    }));
    expect(client.sendRaw).toHaveBeenCalledWith('METADATA', '*', 'SET', 'ocean.pronouns', 'they/them');

    window.dispatchEvent(new CustomEvent('ocean:metadata-set', {
      detail: { key: 'ocean.pronouns', value: null },
    }));
    expect(client.sendRaw).toHaveBeenCalledWith('METADATA', '*', 'SET', 'ocean.pronouns');
  });

  it('parses 761 RPL_KEYVALUE into per-user metadata and rich profile fields', () => {
    handle(':irc.test 761 me alice ocean.pronouns * :they/them');
    handle(':irc.test 761 me alice ocean.bio * :deep sea dweller');
    handle(':irc.test 761 me alice ocean.accent * :#0ea5e9');
    handle(':irc.test 761 me alice ocean.links * :https://a.example https://b.example');
    handle(':irc.test 761 me alice ocean.display-name * :Alice of the Abyss');
    handle(':irc.test 762 me :end of metadata');

    const s = useOnyxStore.getState();
    expect(s.userMetadata.get('alice')).toMatchObject({
      'ocean.pronouns': 'they/them',
      'ocean.bio': 'deep sea dweller',
    });
    const profile = selectUserMetaProfile('Alice')(s);
    expect(profile).toEqual({
      displayName: 'Alice of the Abyss',
      pronouns: 'they/them',
      bio: 'deep sea dweller',
      accent: '#0ea5e9',
      links: ['https://a.example', 'https://b.example'],
    });
  });

  it('clears a key on 766 ERR_KEYNOTSET', () => {
    handle(':irc.test 761 me alice ocean.pronouns * :they/them');
    handle(':irc.test 766 me alice ocean.pronouns :key not set');
    const s = useOnyxStore.getState();
    expect(s.userMetadata.get('alice')?.['ocean.pronouns']).toBeUndefined();
    expect(selectUserMetaProfile('alice')(s)?.pronouns).toBeUndefined();
  });
});

// ── 3. Caption re-dispatch ────────────────────────────────────────────────────

describe('NOTE MEDIA CAPTION / TRANSCRIPT', () => {
  it('re-dispatches ocean:caption and stores the rolling transcript', () => {
    const received: Array<{ channel: string; nick: string; text: string; final: boolean }> = [];
    const listener = (e: Event) => {
      received.push((e as CustomEvent<{ channel: string; nick: string; text: string; final: boolean }>).detail);
    };
    window.addEventListener('ocean:caption', listener);
    try {
      handle(':irc.test NOTE MEDIA #call CAPTION alice :hello out there');
    } finally {
      window.removeEventListener('ocean:caption', listener);
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      channel: '#call',
      nick: 'alice',
      text: 'hello out there',
      final: true,
    });

    const transcript = selectMediaTranscript('#CALL')(useOnyxStore.getState());
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({ nick: 'alice', text: 'hello out there' });
  });

  it('stores TRANSCRIPT replay lines without re-dispatching captions', () => {
    const listener = vi.fn();
    window.addEventListener('ocean:caption', listener);
    try {
      handle(':irc.test NOTE MEDIA #call TRANSCRIPT bob :earlier words');
    } finally {
      window.removeEventListener('ocean:caption', listener);
    }
    expect(listener).not.toHaveBeenCalled();
    const transcript = selectMediaTranscript('#call')(useOnyxStore.getState());
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({ nick: 'bob', text: 'earlier words' });
  });
});

// ── 4. TEGAMI aggregation ─────────────────────────────────────────────────────

describe('NOTE TEGAMI offline delivery', () => {
  it('aggregates count + first msgid per sender and dispatches ocean:tegami', () => {
    const events: Array<{ channel: string; count: number; firstMsgId: string }> = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent<{ channel: string; count: number; firstMsgId: string }>).detail);
    };
    window.addEventListener('ocean:tegami', listener);
    try {
      handle(':irc.test NOTE TEGAMI :from bob :hello while you were away');
      handle(':irc.test NOTE TEGAMI :from bob :second letter');
    } finally {
      window.removeEventListener('ocean:tegami', listener);
    }

    const s = useOnyxStore.getState();
    const dm = s.dms.get('bob');
    expect(dm).toBeTruthy();
    expect(dm!.messages.map(m => m.text)).toEqual([
      'hello while you were away',
      'second letter',
    ]);

    expect(events).toHaveLength(2);
    expect(events[1].channel).toBe('bob');
    expect(events[1].count).toBe(2);
    expect(events[1].firstMsgId).toBe(dm!.messages[0].id);

    expect(selectTegami('Bob')(s)).toEqual({ count: 2, firstMsgId: dm!.messages[0].id });
  });

  it('clears the aggregate when the DM is opened', () => {
    handle(':irc.test NOTE TEGAMI :from bob :hi');
    useOnyxStore.getState().navigate({ kind: 'dm', nick: 'bob' });
    expect(selectTegami('bob')(useOnyxStore.getState())).toBeNull();
  });
});

// ── 5. MARKREAD / unread selectors ───────────────────────────────────────────

describe('MARKREAD read-marker driven unread', () => {
  const t1 = new Date('2026-06-10T10:00:00.000Z');
  const t2 = new Date('2026-06-10T10:05:00.000Z');
  const t3 = new Date('2026-06-10T10:10:00.000Z');

  function seedChannel() {
    useOnyxStore.setState({
      channels: new Map([
        ['#c', makeChannel('#c', {
          messages: [
            makeMsg('m1', 'alice', 'one', t1, '#c'),
            makeMsg('m2', 'alice', 'two', t2, '#c'),
            makeMsg('m3', 'alice', 'three', t3, '#c'),
          ],
          unread: 3,
          highlights: 3,
        })],
      ]),
      channelUnread: { '#c': 3 },
      firstUnreadId: new Map([['#c', 'm1']]),
      activeView: { kind: 'home' },
    });
  }

  it('recomputes unread + firstUnreadId from a server MARKREAD timestamp', () => {
    seedChannel();
    handle(':irc.test MARKREAD #c timestamp=2026-06-10T10:02:00.000Z');

    const s = useOnyxStore.getState();
    expect(selectUnreadCount('#C')(s)).toBe(2);
    expect(selectFirstUnreadId('#c')(s)).toBe('m2');
    expect(s.channelUnread['#c']).toBe(2);
    expect(s.readMarkers.get('#c')).toBe('2026-06-10T10:02:00.000Z');
  });

  it('zeroes unread and clears firstUnreadId when the marker covers everything', () => {
    seedChannel();
    handle(':irc.test MARKREAD #c timestamp=2026-06-10T11:00:00.000Z');

    const s = useOnyxStore.getState();
    expect(selectUnreadCount('#c')(s)).toBe(0);
    expect(selectFirstUnreadId('#c')(s)).toBeNull();
    expect(s.channelUnread['#c']).toBe(0);
  });

  it('records absence of a marker on MARKREAD <target> *', () => {
    seedChannel();
    useOnyxStore.setState({ readMarkers: new Map([['#c', '2026-06-10T10:02:00.000Z']]) });
    handle(':irc.test MARKREAD #c *');
    expect(useOnyxStore.getState().readMarkers.has('#c')).toBe(false);
  });

  it('markRead sends MARKREAD SET and stores the marker locally', () => {
    seedChannel();
    const client = installClient(['draft/read-marker']);

    useOnyxStore.getState().markRead('#c');

    const call = client.sendRaw.mock.calls.find(c => c[0] === 'MARKREAD');
    expect(call).toBeTruthy();
    expect(call![1]).toBe('#c');
    expect(call![2]).toMatch(/^timestamp=\d{4}-\d{2}-\d{2}T/);
    expect(useOnyxStore.getState().readMarkers.get('#c')).toBeTruthy();
  });

  it('requests the stored marker (MARKREAD GET) on self-JOIN', () => {
    const client = installClient(['draft/read-marker', 'draft/chathistory']);
    handle(':me!u@h JOIN #c');
    expect(client.sendRaw).toHaveBeenCalledWith('MARKREAD', '#c');
  });

  it('re-derives unread from the marker after a CHATHISTORY batch replay', () => {
    useOnyxStore.setState({
      channels: new Map([['#c', makeChannel('#c')]]),
      readMarkers: new Map([['#c', '2026-06-10T10:02:00.000Z']]),
    });

    handle(':irc.test BATCH +ref draft/chathistory #c');
    handle('@batch=ref;msgid=h1;time=2026-06-10T10:00:00.000Z :alice!u@h PRIVMSG #c :one');
    handle('@batch=ref;msgid=h2;time=2026-06-10T10:05:00.000Z :alice!u@h PRIVMSG #c :two');
    handle(':irc.test BATCH -ref');

    const s = useOnyxStore.getState();
    expect(selectUnreadCount('#c')(s)).toBe(1);
    expect(selectFirstUnreadId('#c')(s)).toBe('h2');
  });
});
