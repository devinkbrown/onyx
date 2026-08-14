// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_SESSION_CREDENTIAL_LENGTH, parseIRCMessage } from '@/lib/irc/parser';
import { loadCredentials, saveCredentials, storeMeshToken, storeSessionToken } from '@/lib/credentials';
import { saveFriends, saveWatchList } from '@/lib/contactPresenceMemory';
import { emptyIdentityProfileMemory, saveIdentityProfileMemory } from '@/lib/identityProfileMemory';
import { saveUserNotes } from '@/lib/userNotes';
import { saveBookmarks } from '@/lib/bookmarks';
import { saveNickAliases } from '@/lib/nickAliases';
import {
  _beginNamesBurstForTests,
  _resetSessionRestoreForTests,
  MAX_LIVE_CHANNEL_USERS,
  store,
} from './store';

const initialState = store.getInitialState();

class FakeWebSocket {
  static readonly OPEN = 1;
  static latest: FakeWebSocket | null = null;

  readyState = FakeWebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = '';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor() {
    FakeWebSocket.latest = this;
  }
}

function receive(line: string): void {
  FakeWebSocket.latest?.onmessage?.(new MessageEvent('message', { data: line }));
}

describe('remembered session roster restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
    _resetSessionRestoreForTests();
    FakeWebSocket.latest = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    store.getState().disconnect();
    _resetSessionRestoreForTests();
    vi.unstubAllGlobals();
  });

  it('accepts canonical self JOIN and NAMES after a collision alias resumes the account', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    store.getState().client?.updateResumeTokens({ sessionToken: 'resume-token' });
    receive(':example.test 001 kain_ :Welcome to Onyx');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME resume-token\r\n');

    receive(':kain!webchat@example JOIN #root');
    receive(':example.test 353 kain_ = #root :@kain trev alice');
    receive(':example.test 366 kain_ #root :End of NAMES list');

    const root = store.getState().channels.get('#root');
    expect(root).toBeDefined();
    expect([...root!.users.values()].map(user => user.nick).sort()).toEqual(['alice', 'kain', 'trev']);

    receive(':kain!webchat@example JOIN #staff');
    receive(':example.test 353 kain_ = #staff :@kain operator');
    receive(':example.test 366 kain_ #staff :End of NAMES list');

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
  });

  it('hydrates bookmarks only after a collision alias establishes its account owner', () => {
    const owner = { serverUrl: 'wss://example.test', identity: 'kain' } as const;
    saveBookmarks([{
      id: 'kain-private-bookmark',
      time: new Date('2026-07-16T12:00:00.000Z'),
      from: 'trev',
      text: 'Kain private bookmark',
      type: 'msg',
      target: '#private',
    }], owner);

    store.getState().connect({
      url: owner.serverUrl,
      nick: owner.identity,
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    expect(store.getState().bookmarks).toEqual([]);

    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    expect(store.getState().bookmarks).toEqual([]);

    receive(':example.test 001 kain_ :Welcome to Onyx');
    expect(store.getState().bookmarks.map((message) => message.id)).toEqual(['kain-private-bookmark']);
  });

  it('hydrates and restores only the registered owner MONITOR contacts on 001', () => {
    const owner = { serverUrl: 'wss://example.test', identity: 'kain' } as const;
    saveFriends(new Map([['friend-one', { nick: 'friend-one', online: false }]]), owner);
    saveWatchList([{ nick: 'watch-one', online: false }], owner);
    saveUserNotes(new Map([['friend-one', 'private context']]), owner);
    store.getState().connect({
      url: owner.serverUrl,
      nick: owner.identity,
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    expect([...store.getState().friends.keys()]).toEqual(['friend-one']);
    expect(store.getState().watchList.map((entry) => entry.nick)).toEqual(['watch-one']);
    expect(store.getState().getUserNote('friend-one')).toBe('private context');
    expect(store.getState().monitoredNicks).toEqual(new Set(['friend-one', 'watch-one']));
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('MONITOR + friend-one\r\n');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('MONITOR + watch-one\r\n');
  });

  it('replaces guest identity drafts when a live nick change changes the owner', () => {
    const kain = { serverUrl: 'wss://example.test', identity: 'kain' } as const;
    const mika = { serverUrl: 'wss://example.test', identity: 'mika' } as const;
    saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      customStatus: '🎵 Listening to Kain mix',
      selfBio: 'Kain draft',
    }, kain);
    saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      customStatus: '🎵 Listening to Mika mix',
      selfBio: 'Mika draft',
    }, mika);

    store.getState().connect({ url: kain.serverUrl, nick: kain.identity });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome to Onyx');
    expect(store.getState().selfBio).toBe('Kain draft');

    receive(':kain!webchat@example NICK mika');

    expect(store.getState().ourNick).toBe('mika');
    expect(store.getState().selfBio).toBe('Mika draft');
    expect(store.getState().customStatus).toBe('🎵 Listening to Mika mix');
    expect(store.getState().userActivities.kain).toBeUndefined();
    expect(store.getState().userActivities.mika?.text).toBe('Listening to Mika mix');
  });

  it('retains an authoritative resume NAMES burst that arrives before self JOIN', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    store.getState().client?.updateResumeTokens({ sessionToken: 'resume-token' });
    receive(':example.test 001 kain_ :Welcome to Onyx');

    receive(':example.test 353 kain_ = #fabricated :intruder mallory');
    expect(store.getState().channels.has('#fabricated')).toBe(false);

    receive(':example.test 353 kain_ = #root :@kain trev alice');
    receive(':example.test 366 kain_ #root :End of NAMES list');
    receive(':kain!webchat@example JOIN #root');

    const root = store.getState().channels.get('#root');
    expect(root).toBeDefined();
    expect([...root!.users.values()].map(user => user.nick).sort()).toEqual(['alice', 'kain', 'trev']);
  });

  it('folds canonical and collision-alias self rows, unions modes, and PART removes the equivalence', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'Kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * Kain :Nickname is already in use');
    receive(':example.test 900 Kain_ Kain_!webchat@example Kain :You are now logged in as Kain');
    receive(':example.test 001 Kain_ :Welcome to Onyx');
    receive(':Kain!webchat@example JOIN #root');
    receive(':example.test 353 Kain_ = #root :@kain +Kain_ alice');
    receive(':example.test 366 Kain_ #root :End of NAMES list');

    const restored = store.getState().channels.get('#root');
    expect([...restored!.users.keys()].sort()).toEqual(['alice', 'kain']);
    expect(restored!.users.get('kain')).toMatchObject({ nick: 'Kain' });
    expect(restored!.users.get('kain')?.modes).toEqual(new Set(['o', 'v']));

    // The canonical PART belongs to the equivalent resumed identity, not the
    // current Kain_ transport nick. It must remove every equivalent roster row
    // without treating the live alias socket as having left the channel.
    receive(':kain!webchat@example PART #root :old session closed');
    const afterPart = store.getState().channels.get('#root');
    expect(afterPart).toBeDefined();
    expect([...afterPart!.users.keys()].sort()).toEqual(['alice', 'kain_']);
    expect(afterPart!.users.get('kain_')).toMatchObject({ nick: 'Kain_' });
    expect(afterPart!.users.get('kain_')?.modes).toEqual(new Set(['v']));
    expect(afterPart!.users.get('kain_')?.modes.has('o')).toBe(false);

    // Late lines from the completed burst cannot resurrect the canonical twin.
    receive(':example.test 353 Kain_ = #root :@kain +Kain_');
    expect([...store.getState().channels.get('#root')!.users.keys()].sort())
      .toEqual(['alice', 'kain_']);

    // An actual PART from the current transport identity still means we left.
    receive(':Kain_!webchat@example PART #root :leaving');
    expect(store.getState().channels.has('#root')).toBe(false);
  });

  it('QUIT of either restored self spelling cannot leave an equivalent twin stale', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain_ :Welcome to Onyx');
    receive(':kain!webchat@example JOIN #root');
    receive(':example.test 353 kain_ = #root :@kain +kain_ alice');
    receive(':example.test 366 kain_ #root :End of NAMES list');

    receive(':kain!webchat@example QUIT :ghost closed');

    const root = store.getState().channels.get('#root');
    expect([...root!.users.keys()].sort()).toEqual(['alice', 'kain_']);
    expect(root!.users.get('kain_')).toMatchObject({ nick: 'kain_' });
    expect(root!.users.get('kain_')?.modes).toEqual(new Set(['v']));
    expect(root!.users.get('kain_')?.modes.has('o')).toBe(false);

    receive(':example.test 353 kain_ = #root :@kain +kain_');
    expect([...store.getState().channels.get('#root')!.users.keys()].sort())
      .toEqual(['alice', 'kain_']);
  });

  it('bounds multi-line NAMES while retaining only self-spelling mode provenance', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'Kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 433 * Kain :Nickname is already in use');
    receive(':example.test 900 Kain_ Kain_!webchat@example Kain :You are now logged in as Kain');
    receive(':example.test 001 Kain_ :Welcome to Onyx');
    receive(':Kain!webchat@example JOIN #root');

    const first = Array.from({ length: 3_000 }, (_, index) => `user${index}`);
    const second = Array.from({ length: 3_000 }, (_, index) => `user${index + 3_000}`);
    receive(`:example.test 353 Kain_ = #root :@kain +Kain_ ${first.join(' ')}`);
    receive(`:example.test 353 Kain_ = #root :${second.join(' ')}`);
    receive(':example.test 366 Kain_ #root :End of NAMES list');

    expect(store.getState().channels.get('#root')!.users.size).toBe(MAX_LIVE_CHANNEL_USERS);

    // Flooded peer tokens cannot consume/contaminate the tiny self-only mode
    // provenance used to reconstruct the still-live transport spelling.
    receive(':kain!webchat@example PART #root :ghost closed');
    const root = store.getState().channels.get('#root')!;
    expect(root.users.size).toBe(MAX_LIVE_CHANNEL_USERS);
    expect(root.users.get('kain_')?.modes).toEqual(new Set(['v']));
    expect(root.users.get('kain_')?.modes.has('o')).toBe(false);
  });

  it('keeps alias equivalence for authoritative NAMES after the restore timers expire', () => {
    vi.useFakeTimers();
    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'Kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 433 * Kain :Nickname is already in use');
      receive(':example.test 900 Kain_ Kain_!webchat@example Kain :You are now logged in as Kain');
      receive(':example.test 001 Kain_ :Welcome to Onyx');
      receive(':Kain!webchat@example JOIN #root');
      receive(':example.test 353 Kain_ = #root :Kain_ stale-user');
      receive(':example.test 366 Kain_ #root :End of NAMES list');

      vi.advanceTimersByTime(46_000);
      _beginNamesBurstForTests('#root');
      receive(':example.test 353 Kain_ = #root :@kain +Kain_ fresh-user');
      receive(':example.test 366 Kain_ #root :End of NAMES list');

      const root = store.getState().channels.get('#root')!;
      expect([...root.users.keys()].sort()).toEqual(['fresh-user', 'kain']);
      expect(root.users.get('kain')).toMatchObject({ nick: 'Kain' });
      expect(root.users.get('kain')?.modes).toEqual(new Set(['o', 'v']));
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a fresh authoritative NAMES generation after reconnect', () => {
    vi.useFakeTimers();
    try {
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');
      receive(':kain!webchat@example JOIN #root');
      // Deliberately omit 366: this leaves the old socket's burst appending.
      receive(':example.test 353 kain = #root :kain stale-user');

      FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 001 kain :Welcome back');
      vi.advanceTimersByTime(600);
      receive(':example.test 353 kain = #root :kain fresh-user');
      receive(':example.test 366 kain #root :End of NAMES list');

      expect([...store.getState().channels.get('#root')!.users.keys()].sort())
        .toEqual(['fresh-user', 'kain']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a stray NAMES reply create a channel outside a restore generation', () => {
    store.setState({ ourNick: 'kain', connectionStatus: 'connected' });

    store.getState()._handleMessage(
      parseIRCMessage(':example.test 353 kain = #stray :kain intruder'),
    );

    expect(store.getState().channels.has('#stray')).toBe(false);
  });

  it('preserves the pre-drop active channel across multi-channel replay JOINs', () => {
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');
    receive(':kain!webchat@example JOIN #root');
    receive(':example.test 353 kain = #root :@kain trev');
    receive(':example.test 366 kain #root :End of NAMES list');
    receive(':kain!webchat@example JOIN #staff');
    receive(':example.test 353 kain = #staff :@kain alice');
    receive(':example.test 366 kain #staff :End of NAMES list');
    store.setState({ activeView: { kind: 'channel', channel: '#root' } });

    FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome back');

    const namesBeforeReplay = FakeWebSocket.latest?.send.mock.calls
      .filter(([line]) => line.startsWith('NAMES ')).length ?? 0;
    receive(':kain!webchat@example JOIN #root');
    expect(FakeWebSocket.latest?.send.mock.calls
      .filter(([line]) => line.startsWith('NAMES '))).toHaveLength(namesBeforeReplay + 1);
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('NAMES #root\r\n');
    receive(':kain!webchat@example JOIN #staff');

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#root' });
  });

  it('defers a passwordless remembered resume until account proof arrives', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test' });
    storeSessionToken('remembered-token');
    store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));

    receive(':example.test 433 * kain :Nickname is already in use');
    receive(':example.test 001 kain_ :Welcome to Onyx');

    expect(FakeWebSocket.latest?.send).not.toHaveBeenCalledWith('SESSION RESUME remembered-token\r\n');
    expect(store.getState().server?.account).toBeNull();
    const reclaimAttemptsBeforeSuccess = FakeWebSocket.latest?.send.mock.calls
      .filter(([line]) => line === 'NICK kain\r\n').length ?? 0;

    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME remembered-token\r\n');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION TOKEN\r\n');
    expect(store.getState().server?.account).toBe('kain');
    expect(FakeWebSocket.latest?.send.mock.calls
      .filter(([line]) => line === 'NICK kain\r\n')).toHaveLength(reclaimAttemptsBeforeSuccess + 1);

    receive(':example.test NOTE SESSION TOKEN :fresh-token');

    expect(store.getState().server?.account).toBe('kain');
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBe('fresh-token');
  });

  it('rotates a failed resume token without discarding fresh account proof', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test' });
    storeSessionToken('stale-token');
    store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome to Onyx');
    expect(FakeWebSocket.latest?.send).not.toHaveBeenCalledWith('SESSION RESUME stale-token\r\n');

    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME stale-token\r\n');

    receive(':example.test FAIL SESSION INVALID_TOKEN :The session token is invalid');

    expect(store.getState().server?.account).toBe('kain');
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();

    receive(':example.test NOTE SESSION TOKEN :late-token');

    expect(store.getState().server?.account).toBe('kain');
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBe('late-token');
  });

  it('does not promote an ordinary guest from an unsolicited SESSION token note', () => {
    store.getState().connect({ url: 'wss://example.test', nick: 'Guest42' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 Guest42 :Welcome to Onyx');

    receive(':example.test NOTE SESSION TOKEN :unsolicited-token');

    expect(store.getState().server?.account).toBeNull();
  });

  it('does not reuse remembered tokens after the account logs out', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test' });
    storeSessionToken('remembered-token');
    storeMeshToken('remembered-mesh');
    store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome to Onyx');
    expect(FakeWebSocket.latest?.send).not.toHaveBeenCalledWith('SESSION RESUME remembered-mesh\r\n');
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME remembered-mesh\r\n');
    receive(':example.test NOTE SESSION TOKEN :fresh-token');
    receive(':example.test NOTE SESSION MTOKEN :fresh-mesh');
    expect(store.getState().server?.account).toBe('kain');

    receive(':example.test 901 kain kain!webchat@example :You are now logged out');

    expect(store.getState().server?.account).toBeNull();
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBeUndefined();

    // A rotation already queued before 901 must not re-arm the logged-out
    // identity after logout cleanup wins the race.
    receive(':example.test NOTE SESSION TOKEN :late-token');
    receive(':example.test NOTE SESSION MTOKEN :late-mesh');
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBeUndefined();

    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome back');

    const replayedResume = FakeWebSocket.latest?.send.mock.calls
      .map(([line]) => line)
      .filter(line => line.startsWith('SESSION RESUME ')) ?? [];
    expect(replayedResume).toEqual([]);
  });

  it('keeps owner aliases and credentials canonical across collision fallback and reconnect', () => {
    const owner = { serverUrl: 'wss://example.test', identity: 'kain' } as const;
    saveCredentials({ nick: owner.identity, server: owner.serverUrl });
    storeSessionToken('canonical-token');
    saveNickAliases(['KainAway'], owner);

    store.getState().connect({ url: owner.serverUrl, nick: owner.identity });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 433 * kain :Nickname is already in use');
    expect(store.getState().nickAliases).toEqual([]);

    receive(':example.test 900 kain_ kain_!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain_ :Welcome to Onyx');
    expect(store.getState().nickAliases).toEqual(['KainAway']);

    receive(':example.test 433 kain_ kain :Nickname is still in use');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('NICK KainAway\r\n');
    receive(':kain_!webchat@example NICK KainAway');
    expect(store.getState().currentNickIsAlias).toBe(true);

    FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('NICK kain\r\n');

    receive(':example.test 433 * kain :Nickname is still in use');
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('NICK kain_\r\n');
    receive(':example.test 001 kain_ :Welcome back');
    expect(store.getState().nickAliases).toEqual(['KainAway']);
    receive(':kain_!webchat@example NICK kain');

    expect(loadCredentials(owner.serverUrl, owner.identity)?.sessionToken).toBe('canonical-token');
    expect(loadCredentials(owner.serverUrl, 'KainAway')).toBeNull();
  });

  it('reconnects with the mid-session mesh token pushed into the live client', () => {
    // Remembered identity with password SASL (no construction-time resume token).
    // The server mints TOKEN + MTOKEN mid-session; auto-reconnect reuses the same
    // IRCClient, so the store must push those notes via updateResumeTokens or
    // resume silently fails with an undefined construction-time token.
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    expect(FakeWebSocket.latest?.send.mock.calls
      .map(([line]) => line)
      .filter(line => line.startsWith('SESSION RESUME '))).toEqual([]);

    receive(':example.test NOTE SESSION TOKEN :local-fresh');
    receive(':example.test NOTE SESSION MTOKEN :mesh-fresh');
    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBe('local-fresh');
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBe('mesh-fresh');

    FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    // Reconnect resets _loggedIn; account proof must return before SESSION RESUME.
    receive(':example.test 001 kain :Welcome back');
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');

    // Mesh token is preferred over the local session token on resume.
    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME mesh-fresh\r\n');
    expect(FakeWebSocket.latest?.send).not.toHaveBeenCalledWith('SESSION RESUME local-fresh\r\n');
  });

  it('rejects an oversized SESSION TOKEN note without persisting or arming resume', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    const oversized = 'x'.repeat(MAX_SESSION_CREDENTIAL_LENGTH + 1);
    receive(`:example.test NOTE SESSION TOKEN :${oversized}`);
    receive(`:example.test NOTE SESSION MTOKEN :${oversized}`);

    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBeUndefined();
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBeUndefined();

    FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome back');
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');

    const resumed = FakeWebSocket.latest?.send.mock.calls
      .map(([line]) => line)
      .filter(line => line.startsWith('SESSION RESUME ')) ?? [];
    expect(resumed).toEqual([]);
  });

  it('accepts the NOTICE-envelope SESSION TOKEN form used by current servers', () => {
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    // Current Onyx Server delivers fresh credentials as NOTICE <nick> :SESSION TOKEN …
    // (not only the older NOTE standard-reply envelope).
    receive(':example.test NOTICE kain :SESSION TOKEN notice-local');
    receive(':example.test NOTICE kain :SESSION MTOKEN notice-mesh');

    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBe('notice-local');
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBe('notice-mesh');

    FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
    store.getState().reconnectNow();
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 001 kain :Welcome back');
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');

    expect(FakeWebSocket.latest?.send).toHaveBeenCalledWith('SESSION RESUME notice-mesh\r\n');
  });

  it('records MTOKEN expires= as tokenExpiry so portable state can purge', () => {
    // Live Onyx Server: `SESSION MTOKEN <hex> expires=<unix>` (mesh wall clock,
    // 12h portable lifetime). Without folding expires into tokenExpiry the
    // credential lingers in localStorage past the portable window.
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');

    // 1800000000 unix = 2027-01-15T08:00:00.000Z
    receive(':example.test NOTICE kain :SESSION MTOKEN mesh-with-ttl expires=1800000000');

    const creds = loadCredentials('wss://example.test', 'kain');
    expect(creds?.meshToken).toBe('mesh-with-ttl');
    expect(creds?.tokenExpiry).toBe('2027-01-15T08:00:00.000Z');

    // Malformed expires must fail closed — do not install a bare token that
    // would never purge (and must not clobber the good one above).
    receive(':example.test NOTICE kain :SESSION MTOKEN evil-token expires=not-a-number');
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBe('mesh-with-ttl');
    expect(loadCredentials('wss://example.test', 'kain')?.tokenExpiry).toBe('2027-01-15T08:00:00.000Z');
  });

  it('WARN SESSION leaves the resume credential intact (retryable mesh path)', () => {
    // Blueprint: ORIGIN_UNREACHABLE / TEMPORARILY_UNAVAILABLE / RESUME_CREDENTIAL_PRESERVED
    // are WARN (retryable) and must NOT clear the stored bearer. Only FAIL SESSION
    // is terminal.
    saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
    store.getState().connect({
      url: 'wss://example.test',
      nick: 'kain',
      password: 'remembered-secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    receive(':example.test 001 kain :Welcome to Onyx');
    receive(':example.test NOTICE kain :SESSION TOKEN local-held');
    receive(':example.test NOTICE kain :SESSION MTOKEN mesh-held expires=1800000000');

    receive(':example.test WARN SESSION ORIGIN_UNREACHABLE :origin peer is partitioned');
    receive(':example.test WARN SESSION RESUME_CREDENTIAL_PRESERVED :repeat SESSION TOKEN to replace it');

    expect(loadCredentials('wss://example.test', 'kain')?.sessionToken).toBe('local-held');
    expect(loadCredentials('wss://example.test', 'kain')?.meshToken).toBe('mesh-held');
  });

  it('ignores delayed close and error callbacks from a replaced IRC client', () => {
    store.getState().connect({ url: 'wss://old.example.test', nick: 'kain' });
    const oldSocket = FakeWebSocket.latest;
    // Capture the live handlers BEFORE the second connect destroys the client
    // and nulls the socket properties. A queued microtask or a held reference
    // can still invoke these after ownership has moved to a new client.
    const delayedClose = oldSocket?.onclose;
    const delayedError = oldSocket?.onerror;
    expect(delayedClose).toBeTypeOf('function');
    expect(delayedError).toBeTypeOf('function');

    store.getState().connect({ url: 'wss://new.example.test', nick: 'kain' });
    const currentClient = store.getState().client;
    expect(store.getState().connectionStatus).toBe('connecting');

    delayedClose?.(new CloseEvent('close', { code: 1006 }));
    delayedError?.(new Event('error'));

    // The replacement connection must keep connecting; the stale close/error
    // must not flip status, clear the new client, or surface a ghost notice.
    expect(store.getState().client).toBe(currentClient);
    expect(store.getState().status).toBe('connecting');
    expect(store.getState().connectionStatus).toBe('connecting');
    expect(store.getState().notifications).toEqual([]);
  });

  it('suppresses client JOIN/NAMES storm on reconnect when onyx/session-sync is active', () => {
    vi.useFakeTimers();
    try {
      saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');

      // Seed a live channel so a non-session-sync reconnect would rejoin it.
      receive(':kain!webchat@example JOIN #root');
      receive(':example.test 353 kain = #root :@kain alice');
      receive(':example.test 366 kain #root :End of NAMES list');
      expect(store.getState().channels.has('#root')).toBe(true);

      FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      // CAP ACK for session-sync lands before 001 on a real socket; re-arm it
      // after connect() cleared negotiatedCaps so onConnected sees the reclaim.
      store.getState().client?.negotiatedCaps.add('onyx/session-sync');
      expect(store.getState().client?.sessionSyncActive).toBe(true);

      const send = FakeWebSocket.latest?.send;
      expect(send).toBeDefined();
      send!.mockClear();

      receive(':example.test 001 kain :Welcome back');
      // hasRegistered is true → the 600 ms rejoin timer would fire without
      // the session-sync gate.
      vi.advanceTimersByTime(600);

      const postReconnectJoins = send!.mock.calls
        .map(([line]) => line)
        .filter(line => line === 'JOIN #root\r\n' || line === 'NAMES #root\r\n');
      // Server-driven session-sync owns channel reclaim; the client must not
      // storm JOIN/NAMES on top of it (multi-device continuity).
      expect(postReconnectJoins).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejoins live channels on reconnect when session-sync is not negotiated', () => {
    vi.useFakeTimers();
    try {
      saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');

      receive(':kain!webchat@example JOIN #root');
      receive(':example.test 353 kain = #root :@kain alice');
      receive(':example.test 366 kain #root :End of NAMES list');

      FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));

      const send = FakeWebSocket.latest?.send;
      expect(send).toBeDefined();
      send!.mockClear();

      receive(':example.test 001 kain :Welcome back');
      vi.advanceTimersByTime(600);

      // Without session-sync the client must re-JOIN and NAMES so a guest (or
      // a node that only has classic IRC) does not keep a ghost channel UI.
      expect(send).toHaveBeenCalledWith('JOIN #root\r\n');
      expect(send).toHaveBeenCalledWith('NAMES #root\r\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run socket A delayed rejoin work on socket B of the same client', () => {
    vi.useFakeTimers();
    try {
      store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 001 kain :Welcome to Onyx');
      receive(':kain!webchat@example JOIN #root');
      receive(':example.test 353 kain = #root :kain alice');
      receive(':example.test 366 kain #root :End of NAMES list');

      // Socket A reconnect registers and schedules its 600 ms roster work.
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 001 kain :Welcome on socket A');

      // Before A's timer fires, the same IRCClient is reused for socket B.
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      const socketBSend = FakeWebSocket.latest!.send;
      socketBSend.mockClear();
      receive(':example.test 001 kain :Welcome on socket B');
      vi.advanceTimersByTime(600);

      expect(socketBSend.mock.calls.filter(([line]) => line === 'JOIN #root\r\n')).toHaveLength(1);
      expect(socketBSend.mock.calls.filter(([line]) => line === 'NAMES #root\r\n')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs delayed 001 outbox, schedule, deep-link, and travel work exactly once for the current socket', () => {
    vi.useFakeTimers();
    try {
      const flushOutbox = vi.fn(async () => {});
      const dispatchScheduled = vi.fn();
      const travelTo = vi.fn();
      store.setState({
        flushOutbox,
        _dispatchScheduledMessages: dispatchScheduled,
        travelTo,
        pendingDeepLinkJoin: '#root',
        pendingDeepLinkAt: new Date('2026-08-14T08:00:00.000Z'),
      });

      store.getState().connect({ url: 'wss://example.test', nick: 'kain' });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 001 kain :Welcome on socket A');

      // Reuse the IRCClient before any socket-A delayed callback is due.
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      const socketBSend = FakeWebSocket.latest!.send;
      socketBSend.mockClear();
      receive(':example.test 001 kain :Welcome on socket B');

      vi.advanceTimersByTime(4_000);

      expect(flushOutbox).toHaveBeenCalledTimes(1);
      expect(dispatchScheduled).toHaveBeenCalledTimes(1);
      expect(socketBSend.mock.calls.filter(([line]) => line === 'JOIN #root\r\n')).toHaveLength(1);
      expect(travelTo).toHaveBeenCalledTimes(1);
      expect(travelTo).toHaveBeenCalledWith('#root', new Date('2026-08-14T08:00:00.000Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppresses multi-channel JOIN/NAMES storm under session-sync (multi-device)', () => {
    // Phone + desktop same account: many live rooms must not each fire a
    // client-side JOIN/NAMES pair on reconnect when the server will reclaim.
    vi.useFakeTimers();
    try {
      saveCredentials({ nick: 'kain', server: 'wss://example.test', password: 'remembered-secret' });
      store.getState().connect({
        url: 'wss://example.test',
        nick: 'kain',
        password: 'remembered-secret',
      });
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
      receive(':example.test 001 kain :Welcome to Onyx');

      for (const room of ['#root', '#staff', '#ops'] as const) {
        receive(`:kain!webchat@example JOIN ${room}`);
        receive(`:example.test 353 kain = ${room} :@kain`);
        receive(`:example.test 366 kain ${room} :End of NAMES list`);
      }
      expect([...store.getState().channels.keys()].sort()).toEqual(['#ops', '#root', '#staff']);

      FakeWebSocket.latest?.onclose?.(new CloseEvent('close', { code: 1006 }));
      store.getState().reconnectNow();
      FakeWebSocket.latest?.onopen?.(new Event('open'));
      store.getState().client?.negotiatedCaps.add('onyx/session-sync');

      const send = FakeWebSocket.latest?.send;
      expect(send).toBeDefined();
      send!.mockClear();

      receive(':example.test 001 kain :Welcome back');
      vi.advanceTimersByTime(600);

      const storm = send!.mock.calls
        .map(([line]) => line)
        .filter(
          (line: string) =>
            line.startsWith('JOIN #') || line.startsWith('NAMES #'),
        );
      expect(storm).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores delayed onConnected-driven traffic from a replaced client', () => {
    // A second connect() destroys the prior IRCClient. If a queued 001 from the
    // old socket still invokes its onConnected closure, the identity guard must
    // refuse to re-arm reconnect timers or mutate the replacement connection.
    store.getState().connect({
      url: 'wss://old.example.test',
      nick: 'kain',
      password: 'secret',
    });
    FakeWebSocket.latest?.onopen?.(new Event('open'));
    receive(':example.test 900 kain kain!webchat@example kain :You are now logged in as kain');
    // Capture the OLD client's message handler before ownership moves.
    const oldSocket = FakeWebSocket.latest;
    const oldOnMessage = oldSocket?.onmessage;
    expect(oldOnMessage).toBeTypeOf('function');

    store.getState().connect({
      url: 'wss://new.example.test',
      nick: 'kain',
      password: 'secret',
    });
    const replacement = store.getState().client;
    const newSocket = FakeWebSocket.latest;
    expect(newSocket).not.toBe(oldSocket);
    expect(store.getState().connectionStatus).toBe('connecting');

    // Stale 001 on the destroyed client must not flip the store to connected
    // under the replacement's identity.
    oldOnMessage?.(new MessageEvent('message', {
      data: ':old.example.test 001 kain :stale welcome',
    }));

    expect(store.getState().client).toBe(replacement);
    expect(store.getState().connectionStatus).toBe('connecting');
    expect(store.getState().status).toBe('connecting');
  });
});
