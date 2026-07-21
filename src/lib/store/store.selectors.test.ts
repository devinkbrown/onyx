// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import type { Channel, ChatMessage } from '@/lib/irc/types';
import {
  selectAccount,
  selectFirstUnreadId,
  selectMediaTranscript,
  selectReadMarker,
  selectOfflineMemo,
  selectUnreadCount,
  selectUserMetadata,
  selectUserMetaProfile,
  store,
  type DMConversation,
  type RichUserProfile,
  type Server,
} from './store';

const initialState = store.getInitialState();

function channel(name: string, unread: number): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function dm(nick: string, unread: number): DMConversation {
  return {
    nick,
    account: null,
    unread,
    highlights: 0,
    messages: [],
  };
}

function server(account: string | null): Server {
  return {
    id: 'local',
    name: 'Local',
    network: 'Onyx',
    url: 'wss://example.invalid',
    icon: '#000',
    nick: 'me',
    account,
    connected: true,
  };
}

beforeEach(() => {
  localStorage.clear();
  store.setState(initialState, true);
});

describe('store selectors', () => {
  it('selectUnreadCount reads normalized channel and DM counts with zero fallback', () => {
    store.setState({
      ...initialState,
      channels: new Map([['#root', channel('#root', 7)]]),
      dms: new Map([['alice', dm('Alice', 3)]]),
    }, true);

    expect(selectUnreadCount('#ROOT')(store.getState())).toBe(7);
    expect(selectUnreadCount('ALICE')(store.getState())).toBe(3);
    expect(selectUnreadCount('#missing')(store.getState())).toBe(0);
  });

  it('selectAccount derives the signed-in account from server state', () => {
    store.setState({ ...initialState, server: server('kain') }, true);
    expect(selectAccount(store.getState())).toBe('kain');

    store.setState({ server: server(null) });
    expect(selectAccount(store.getState())).toBeNull();

    store.setState({ server: null });
    expect(selectAccount(store.getState())).toBeNull();
  });

  it('selectFirstUnreadId and selectReadMarker read normalized target keys', () => {
    const readAt = '2026-07-12T10:15:00.000Z';
    store.setState({
      ...initialState,
      firstUnreadId: new Map([['#root', 'msg-7']]),
      readMarkers: new Map([['alice', readAt]]),
    }, true);

    expect(selectFirstUnreadId('#ROOT')(store.getState())).toBe('msg-7');
    expect(selectFirstUnreadId('#missing')(store.getState())).toBeNull();
    expect(selectReadMarker('ALICE')(store.getState())).toBe(readAt);
    expect(selectReadMarker('bob')(store.getState())).toBeNull();
  });

  it('selectUserMetaProfile projects rich profile fields from normalized nicks', () => {
    const profile: RichUserProfile = {
      nick: 'Alice',
      account: 'alice',
      displayName: 'Alice A.',
      pronouns: 'she/her',
      bio: 'Ships mesh clients',
      accentColor: '#4f8cff',
      links: ['https://example.invalid/alice'],
    };
    store.setState({
      ...initialState,
      userProfiles: new Map([['alice', profile]]),
    }, true);

    expect(selectUserMetaProfile('ALICE')(store.getState())).toEqual({
      displayName: 'Alice A.',
      pronouns: 'she/her',
      bio: 'Ships mesh clients',
      accent: '#4f8cff',
      links: ['https://example.invalid/alice'],
    });
    expect(selectUserMetaProfile('bob')(store.getState())).toBeNull();
  });

  it('selectUserMetadata returns raw metadata for normalized nicks', () => {
    const metadata = {
      'ocean.display-name': 'Alice A.',
      'ocean.pronouns': 'she/her',
    };
    store.setState({
      ...initialState,
      userMetadata: new Map([['alice', metadata]]),
    }, true);

    expect(selectUserMetadata('ALICE')(store.getState())).toBe(metadata);
    expect(selectUserMetadata('bob')(store.getState())).toEqual({});
  });

  it('selectMediaTranscript and selectOfflineMemo read normalized aggregate keys', () => {
    const at = new Date('2026-07-12T10:20:00.000Z');
    const transcript: Array<{ nick: string; text: string; time: Date }> = [
      { nick: 'Alice', text: 'caption one', time: at },
    ];
    const offlineMemo = { count: 2, firstMsgId: 'offline-1' };
    const message: ChatMessage = {
      id: 'offline-1',
      time: at,
      from: 'Alice',
      text: 'queued while away',
      type: 'msg',
      target: 'Alice',
    };
    store.setState({
      ...initialState,
      mediaTranscripts: new Map([['#stage', transcript]]),
      offlineMemo: new Map([['alice', offlineMemo]]),
      dms: new Map([['alice', { ...dm('Alice', 1), messages: [message] }]]),
    }, true);

    expect(selectMediaTranscript('#STAGE')(store.getState())).toBe(transcript);
    expect(selectMediaTranscript('#empty')(store.getState())).toEqual([]);
    expect(selectOfflineMemo('ALICE')(store.getState())).toBe(offlineMemo);
    expect(selectOfflineMemo('bob')(store.getState())).toBeNull();
  });
});
