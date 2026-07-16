// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import {
  readReviewHistory,
  recordReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import { follow, followed, isFollowed, unfollow } from '@/lib/notifications/followed';
import { loadComposerDrafts, saveComposerDrafts } from '@/lib/composer/drafts';
import { loadChannelTopicDrafts, saveChannelTopicDrafts } from '@/lib/channel/topicDrafts';
import { loadCredentials, saveCredentials, storeMeshToken, storeSessionToken } from '@/lib/credentials';
import { preferences, resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { loadDMPins, saveDMPins } from '@/lib/dmPins';
import {
  loadFriends,
  loadWatchList,
  saveFriends,
  saveWatchList,
} from '@/lib/contactPresenceMemory';
import { loadUserNotes, saveUserNotes } from '@/lib/userNotes';
import {
  emptyIdentityProfileMemory,
  loadIdentityProfileMemory,
  saveIdentityProfileMemory,
} from '@/lib/identityProfileMemory';
import { loadTopicHistory, saveTopicHistory } from '@/lib/topics/topicHistory';
import {
  emptyChannelNavigationMemory,
  loadChannelNavigationMemory,
  saveChannelNavigationMemory,
} from '@/lib/channelNavigationMemory';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import {
  MAX_TOPIC_READ_ENTRIES,
  markTopicRead,
  readTopicReadLedger,
  readTopicReadMarker,
  subscribeTopicReadLedger,
} from '@/lib/topics/topicReadLedger';
import {
  _resetVaultForTests,
  clearVault,
  getRetentionPolicy,
  loadRecent,
  saveMessages,
  setRetentionPolicy,
} from './historyVault';
import {
  RETENTION_POLICY_STORAGE_KEY,
  writeRetentionPolicy,
} from './retentionPolicy';
import {
  _resetSavedSearchesForTests,
  clearSavedSearches,
  listSearches,
  saveSearch,
} from './savedSearches';
import {
  exportPortableTransfer,
  importPortableTransfer,
  parsePortableTransfer,
} from './portableTransfer';

function msg(id: string, time: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    time: new Date(time),
    from: 'kain',
    text: `hello ${id}`,
    type: 'msg',
    target: '#room',
    ...over,
  } as ChatMessage;
}

function review(target: string): ReviewHistoryEntry {
  return {
    target,
    name: target,
    kind: target.startsWith('#') ? 'channel' : 'dm',
    firstMessageId: `${target}-first`,
    firstAt: '2026-07-09T00:00:00.000Z',
    reviewedAt: '2026-07-09T00:05:00.000Z',
    messageCount: 4,
    mentionCount: 1,
    preview: `review ${target}`,
  };
}

describe('portableTransfer', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    localStorage.clear();
    resetPreferences();
    setSceneMotion('animated');
    setRetentionPolicy(null);
    for (const key of followed()) unfollow(key);
  });

  it('round-trips vault rows, reviewed checkpoints, drafts, saved searches, followed state, account handoffs, and preferences', async () => {
    await saveMessages('#alpha', [msg('a1', Date.now(), { target: '#alpha' })]);
    recordReviewHistory(review('#alpha'));
    saveCredentials({ nick: 'kain', server: 'wss://eshmaki.me', password: 'secret' });
    storeSessionToken('local-session-token', 1783500000);
    storeMeshToken('mesh-session-token');
    setPreference('density', 'compact');
    setPreference('voiceEntry', false);
    setPreference('topicTools', true);
    setPreference('highContrast', true);
    setSceneMotion('still');
    setRetentionPolicy({ keep: 1000, maxAgeDays: 90 });
    writeRetentionPolicy({ keep: 1000, maxAgeDays: 90 });
    follow('#alpha');
    follow('#alpha', 'Roadmap');
    markTopicRead('#Alpha', 'Roadmap', {
      id: 'topic-read-a1',
      time: new Date(1_500),
      text: 'topic cursor plaintext must not transfer',
      password: 'topic-cursor-secret',
    });
    await saveSearch({ label: 'Roadmap decisions', query: 'when did we decide', mode: 'hybrid' });
    saveComposerDrafts({
      '#alpha': 'room draft',
      alice: 'dm draft should stay local',
    });
    saveChannelTopicDrafts({
      '#alpha': 'topic moderation draft',
      alice: 'ignored non-channel topic draft',
    });

    const exported = await exportPortableTransfer();
    expect(exported.targets).toHaveLength(1);
    expect(exported.reviewHistory.map((entry) => entry.target)).toEqual(['#alpha']);
    expect(exported.composerDrafts).toEqual({ '#alpha': 'room draft' });
    expect(exported.channelTopicDrafts).toEqual({ '#alpha': 'topic moderation draft' });
    expect(exported.preferenceHandoff).toMatchObject({
      preferences: {
        density: 'compact',
        voiceEntry: false,
        topicTools: true,
        highContrast: true,
      },
      sceneMotion: 'still',
      retentionPolicy: { keep: 1000, maxAgeDays: 90 },
    });
    expect(exported.followedConversations).toEqual(['#alpha', '#alpha/roadmap']);
    expect(exported.topicReadCursors).toEqual([{
      channel: '#alpha',
      topic: 'roadmap',
      lastReadMessageId: 'topic-read-a1',
      lastReadAt: 1_500,
    }]);
    expect(exported.savedSearches).toEqual([
      expect.objectContaining({
        label: 'Roadmap decisions',
        query: 'when did we decide',
        mode: 'hybrid',
      }),
    ]);
    expect(exported.accountHandoffs).toEqual([
      {
        nick: 'kain',
        server: 'wss://eshmaki.me',
        savedAt: expect.any(String),
        active: true,
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain('secret');
    expect(JSON.stringify(exported)).not.toContain('local-session-token');
    expect(JSON.stringify(exported)).not.toContain('mesh-session-token');
    expect(JSON.stringify(exported)).not.toContain('topic cursor plaintext');
    expect(JSON.stringify(exported)).not.toContain('topic-cursor-secret');

    const parsed = parsePortableTransfer(JSON.parse(JSON.stringify(exported)));
    expect(parsed).not.toBeNull();

    await clearVault();
    await clearSavedSearches();
    localStorage.clear();
    resetPreferences();
    setSceneMotion('animated');
    setRetentionPolicy(null);
    localStorage.removeItem(RETENTION_POLICY_STORAGE_KEY);
    for (const key of followed()) unfollow(key);
    const result = await importPortableTransfer(parsed!);

    expect(result).toEqual({
      targets: 1,
      messages: 1,
      reviews: 1,
      drafts: 1,
      topicDrafts: 1,
      accountHandoffs: 1,
      preferenceHandoffs: 1,
      followedConversations: 2,
      topicReadCursors: 1,
      savedSearches: 1,
    });
    expect((await loadRecent('#alpha')).map((message) => message.id)).toEqual(['a1']);
    expect(readReviewHistory().map((entry) => entry.target)).toEqual(['#alpha']);
    expect(loadComposerDrafts()).toEqual({ '#alpha': 'room draft' });
    expect(loadChannelTopicDrafts()).toEqual({ '#alpha': 'topic moderation draft' });
    expect(loadCredentials()).toMatchObject({
      nick: 'kain',
      server: 'wss://eshmaki.me',
    });
    expect(loadCredentials()?.password).toBeUndefined();
    expect(loadCredentials()?.sessionToken).toBeUndefined();
    expect(loadCredentials()?.meshToken).toBeUndefined();
    expect(preferences()).toMatchObject({
      density: 'compact',
      voiceEntry: false,
      topicTools: true,
      highContrast: true,
    });
    expect(sceneMotion()).toBe('still');
    expect(getRetentionPolicy()).toEqual({ keep: 1000, maxAgeDays: 90 });
    expect(JSON.parse(localStorage.getItem(RETENTION_POLICY_STORAGE_KEY) ?? '')).toEqual({
      keep: 1000,
      maxAgeDays: 90,
    });
    expect(isFollowed('#alpha')).toBe(true);
    expect(isFollowed('#alpha', 'roadmap')).toBe(true);
    expect(readTopicReadMarker('#alpha', 'roadmap')).toEqual({
      channel: '#alpha',
      topic: 'roadmap',
      lastReadMessageId: 'topic-read-a1',
      lastReadAt: 1_500,
    });
    expect(await listSearches()).toEqual([
      expect.objectContaining({
        label: 'Roadmap decisions',
        query: 'when did we decide',
        mode: 'hybrid',
      }),
    ]);
  });

  it('exports and imports only the selected account device-memory namespace', async () => {
    const alice = { serverUrl: 'wss://portable.example/ws', identity: 'alice' } as const;
    const bob = { serverUrl: 'wss://portable.example/ws', identity: 'bob' } as const;
    await saveMessages('#alice', [msg('alice-row', 1_000, { target: '#alice' })], alice);
    await saveMessages('#bob', [msg('bob-row', 2_000, { target: '#bob' })], bob);
    await saveMessages('#legacy', [msg('legacy-row', 3_000, { target: '#legacy' })]);
    recordReviewHistory(review('#alice'), alice);
    recordReviewHistory(review('#bob'), bob);
    recordReviewHistory(review('#legacy'));
    saveComposerDrafts({ '#alice': 'alice room plaintext' }, undefined, alice);
    saveComposerDrafts({ '#bob': 'bob room plaintext' }, undefined, bob);
    saveComposerDrafts({ '#legacy': 'legacy room plaintext' });
    saveChannelTopicDrafts({ '#alice': 'alice topic plaintext' }, undefined, alice);
    saveChannelTopicDrafts({ '#bob': 'bob topic plaintext' }, undefined, bob);
    saveChannelTopicDrafts({ '#legacy': 'legacy topic plaintext' });
    await saveSearch({ label: 'Alice search', query: 'alice search plaintext', mode: 'exact' }, alice);
    await saveSearch({ label: 'Bob search', query: 'bob search plaintext', mode: 'exact' }, bob);
    await saveSearch({ label: 'Legacy search', query: 'legacy search plaintext', mode: 'exact' });
    follow('#alice-follow', 'roadmap', alice);
    follow('#bob-follow', 'release', bob);
    follow('#legacy-follow');
    markTopicRead('#alice', 'roadmap', { id: 'alice-cursor', time: new Date(4_000) }, alice);
    markTopicRead('#bob', 'release', { id: 'bob-cursor', time: new Date(5_000) }, bob);
    markTopicRead('#legacy', 'archive', { id: 'legacy-cursor', time: new Date(6_000) });
    saveDMPins(new Map([['trev', [msg('alice-private-pin', 7_000, {
      target: 'alice',
      encrypted: true,
      text: 'TSUMUGI1 alice-pin-ciphertext',
      plaintext: 'Alice pinned decrypted plaintext',
    })]]]), alice);

    const exported = await exportPortableTransfer(alice);
    const serialized = JSON.stringify(exported);

    expect(exported.targets.map((entry) => entry.target)).toEqual(['#alice']);
    expect(exported.reviewHistory.map((entry) => entry.target)).toEqual(['#alice']);
    expect(exported.composerDrafts).toEqual({ '#alice': 'alice room plaintext' });
    expect(exported.channelTopicDrafts).toEqual({ '#alice': 'alice topic plaintext' });
    expect(exported.savedSearches).toEqual([
      expect.objectContaining({ label: 'Alice search', query: 'alice search plaintext' }),
    ]);
    expect(exported.followedConversations).toEqual(['#alice-follow/roadmap']);
    expect(exported.topicReadCursors).toEqual([{
      channel: '#alice',
      topic: 'roadmap',
      lastReadMessageId: 'alice-cursor',
      lastReadAt: 4_000,
    }]);
    expect(serialized).not.toContain('bob room plaintext');
    expect(serialized).not.toContain('legacy room plaintext');
    expect(serialized).not.toContain('bob search plaintext');
    expect(serialized).not.toContain('legacy search plaintext');
    expect(serialized).not.toContain('#bob-follow');
    expect(serialized).not.toContain('#legacy-follow');
    expect(serialized).not.toContain('bob-cursor');
    expect(serialized).not.toContain('legacy-cursor');
    expect(serialized).not.toContain('alice-private-pin');
    expect(serialized).not.toContain('alice-pin-ciphertext');
    expect(serialized).not.toContain('Alice pinned decrypted plaintext');

    const imported = await importPortableTransfer(exported, bob);

    expect(imported).toMatchObject({
      targets: 1,
      messages: 1,
      reviews: 1,
      drafts: 1,
      topicDrafts: 1,
      followedConversations: 1,
      topicReadCursors: 1,
    });
    expect((await loadRecent('#alice', 50, bob)).map((message) => message.id)).toEqual(['alice-row']);
    expect(readReviewHistory(bob).map((entry) => entry.target)).toContain('#alice');
    expect(loadComposerDrafts(undefined, bob)).toMatchObject({ '#alice': 'alice room plaintext' });
    expect(loadChannelTopicDrafts(undefined, bob)).toMatchObject({ '#alice': 'alice topic plaintext' });
    expect(await listSearches(bob)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Alice search', query: 'alice search plaintext' }),
    ]));
    expect(isFollowed('#alice-follow', 'roadmap', bob)).toBe(true);
    expect(isFollowed('#bob-follow', 'release', bob)).toBe(true);
    expect(isFollowed('#legacy-follow', null, bob)).toBe(false);
    expect(readTopicReadMarker('#alice', 'roadmap', bob)?.lastReadMessageId).toBe('alice-cursor');
    expect(readTopicReadMarker('#bob', 'release', bob)?.lastReadMessageId).toBe('bob-cursor');
    expect(readTopicReadMarker('#legacy', 'archive', bob)).toBeNull();
    expect(readReviewHistory(alice).map((entry) => entry.target)).toEqual(['#alice']);
  });

  it('rejects non-Onyx portable transfer files', () => {
    expect(parsePortableTransfer({ kind: 'nope', version: 1, targets: [] })).toBeNull();
  });

  it('keeps older portable snapshots compatible when saved searches are absent', () => {
    const parsed = parsePortableTransfer({
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-09T00:00:00.000Z',
      targets: [],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.savedSearches).toEqual([]);
    expect(parsed?.topicReadCursors).toEqual([]);
    expect(parsed?.preferenceHandoff).toBeNull();
  });

  it('sanitizes and bounds malformed portable topic cursors without retaining extra data', () => {
    const topicReadCursors = Array.from(
      { length: MAX_TOPIC_READ_ENTRIES + 8 },
      (_, index) => ({
        channel: ' #ROOM ',
        topic: ` Topic ${index} `,
        lastReadMessageId: `m-${index}`,
        lastReadAt: index + 1,
        text: `cursor-plaintext-${index}`,
        sessionToken: `cursor-secret-${index}`,
      }),
    );
    topicReadCursors.push({
      channel: '#bad room',
      topic: 'invalid',
      lastReadMessageId: 'bad',
      lastReadAt: 100_000,
      text: 'cursor-plaintext-invalid',
      sessionToken: 'cursor-secret-invalid',
    });

    const parsed = parsePortableTransfer({
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-09T00:00:00.000Z',
      targets: [],
      topicReadCursors,
    });

    expect(parsed?.topicReadCursors).toHaveLength(MAX_TOPIC_READ_ENTRIES);
    expect(parsed?.topicReadCursors[0]).toEqual({
      channel: '#room',
      topic: `topic ${MAX_TOPIC_READ_ENTRIES + 7}`,
      lastReadMessageId: `m-${MAX_TOPIC_READ_ENTRIES + 7}`,
      lastReadAt: MAX_TOPIC_READ_ENTRIES + 8,
    });
    expect(JSON.stringify(parsed?.topicReadCursors)).not.toContain('cursor-plaintext');
    expect(JSON.stringify(parsed?.topicReadCursors)).not.toContain('cursor-secret');
  });

  it('merges portable topic cursors without regressing local state and publishes reconciliation', async () => {
    markTopicRead('#room', 'release', { id: 'local-newer', time: new Date(300) });
    const listener = vi.fn();
    const stop = subscribeTopicReadLedger(listener);
    const parsed = parsePortableTransfer({
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-09T00:00:00.000Z',
      targets: [],
      topicReadCursors: [
        { channel: '#ROOM', topic: 'RELEASE', lastReadMessageId: 'import-older', lastReadAt: 200 },
        { channel: '#room', topic: 'roadmap', lastReadMessageId: 'import-new', lastReadAt: 400 },
      ],
    });

    const result = await importPortableTransfer(parsed!);

    expect(result.topicReadCursors).toBe(1);
    expect(readTopicReadMarker('#room', 'release')?.lastReadMessageId).toBe('local-newer');
    expect(readTopicReadMarker('#room', 'roadmap')?.lastReadMessageId).toBe('import-new');
    expect(readTopicReadLedger()).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('applies imported retention before writing portable vault rows', async () => {
    setRetentionPolicy({ keep: 3 });
    await saveMessages('#alpha', [
      msg('a1', 1000, { target: '#alpha' }),
      msg('a2', 2000, { target: '#alpha' }),
      msg('a3', 3000, { target: '#alpha' }),
    ]);
    const exported = await exportPortableTransfer();
    expect(exported.preferenceHandoff).not.toBeNull();
    exported.preferenceHandoff!.retentionPolicy = { keep: 1 };

    await clearVault();
    setRetentionPolicy(null);
    const result = await importPortableTransfer(exported);

    // Success counters describe rows that survived the destination policy, not
    // the three attempted writes that were immediately pruned to one.
    expect(result.messages).toBe(1);
    expect((await loadRecent('#alpha')).map((message) => message.id)).toEqual(['a3']);
    expect(getRetentionPolicy()).toEqual({ keep: 1 });
  });

  it('does not retain vault rows when the imported preference disables local history', async () => {
    const owner = { serverUrl: 'wss://portable.example/ws', identity: 'alice' } as const;
    await saveMessages('#alpha', [msg('a1', 1000, { target: '#alpha' })]);
    saveDMPins(new Map([['trev', [msg('private-pin', 2_000, {
      target: 'alice',
      encrypted: true,
      text: 'TSUMUGI1 private-pin-ciphertext',
      plaintext: 'pinned decrypted plaintext',
    })]]]), owner);
    const exported = await exportPortableTransfer();
    expect(exported.preferenceHandoff).not.toBeNull();
    exported.preferenceHandoff!.preferences.localHistory = false;

    const result = await importPortableTransfer(exported);

    expect(result.messages).toBe(0);
    expect(preferences().localHistory).toBe(false);
    expect(await loadRecent('#alpha')).toEqual([]);
    expect(loadDMPins(owner)).toEqual(new Map());
  });

  it('keeps private friend and WATCH rosters device-only', async () => {
    const owner = { serverUrl: 'wss://portable.example/ws', identity: 'alice' } as const;
    saveFriends(new Map([[
      'portable-private-friend',
      { nick: 'portable-private-friend', online: false, note: 'portable-private-note' },
    ]]), owner);
    saveWatchList([{ nick: 'portable-private-watch', online: false }], owner);
    saveUserNotes(new Map([['portable-private-user', 'portable private user note']]), owner);
    saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      customStatus: 'portable private status',
      selfBio: 'portable private profile draft',
    }, owner);

    const exported = await exportPortableTransfer(owner);
    const serialized = JSON.stringify(exported);

    expect(serialized).not.toContain('portable-private-friend');
    expect(serialized).not.toContain('portable-private-note');
    expect(serialized).not.toContain('portable-private-watch');
    expect(serialized).not.toContain('portable-private-user');
    expect(serialized).not.toContain('portable private user note');
    expect(serialized).not.toContain('portable private status');
    expect(serialized).not.toContain('portable private profile draft');

    // "Clear local history" erases transcripts, not the user's contact book.
    expect(await clearVault()).toBe(true);
    expect([...loadFriends(owner).keys()]).toEqual(['portable-private-friend']);
    expect(loadWatchList(owner).map((entry) => entry.nick)).toEqual(['portable-private-watch']);
    expect(loadUserNotes(owner)).toEqual(new Map([['portable-private-user', 'portable private user note']]));
    expect(loadIdentityProfileMemory(owner)).toMatchObject({
      customStatus: 'portable private status',
      selfBio: 'portable private profile draft',
    });
  });

  it('keeps topic text history out of portable transfer and clears every owner with local history', async () => {
    const alice = { serverUrl: 'wss://portable.example/ws', identity: 'alice' } as const;
    const bob = { serverUrl: 'wss://portable.example/ws', identity: 'bob' } as const;
    saveTopicHistory({ '#alice-private': ['Alice confidential topic'] }, alice);
    saveTopicHistory({ '#bob-private': ['Bob confidential topic'] }, bob);

    const serialized = JSON.stringify(await exportPortableTransfer(alice));
    expect(serialized).not.toContain('Alice confidential topic');
    expect(serialized).not.toContain('Bob confidential topic');

    expect(await clearVault()).toBe(true);
    expect(loadTopicHistory(alice)).toEqual({});
    expect(loadTopicHistory(bob)).toEqual({});
  });

  it('keeps channel navigation device-only and retains it across clear local history', async () => {
    const alice = { serverUrl: 'wss://portable.example/ws', identity: 'alice' } as const;
    const bob = { serverUrl: 'wss://portable.example/ws', identity: 'bob' } as const;
    saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set(['#alice-private-navigation']),
    }, alice);
    saveChannelNavigationMemory({
      ...emptyChannelNavigationMemory(),
      pinnedChannels: new Set(['#bob-private-navigation']),
    }, bob);

    const serialized = JSON.stringify(await exportPortableTransfer(alice));
    expect(serialized).not.toContain('#alice-private-navigation');
    expect(serialized).not.toContain('#bob-private-navigation');

    expect(await clearVault()).toBe(true);
    expect(loadChannelNavigationMemory(alice).pinnedChannels).toEqual(new Set(['#alice-private-navigation']));
    expect(loadChannelNavigationMemory(bob).pinnedChannels).toEqual(new Set(['#bob-private-navigation']));
  });

  it('rejects a local-history-disabled import when the privacy clear does not commit', async () => {
    await saveMessages('#alpha', [msg('keep', 1000, { target: '#alpha' })]);
    const exported = await exportPortableTransfer();
    exported.preferenceHandoff!.preferences.localHistory = false;
    exported.reviewHistory = [review('#not-imported')];
    exported.composerDrafts = { '#not-imported': 'must not merge after a failed clear' };

    const realClear = IDBObjectStore.prototype.clear;
    const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
      this: IDBObjectStore,
    ): IDBRequest<undefined> {
      const request = realClear.call(this);
      if (this.name === 'outbox') this.transaction.abort();
      return request;
    });

    try {
      await expect(importPortableTransfer(exported)).rejects.toThrow(
        'Could not clear device-local history',
      );
      expect((await loadRecent('#alpha')).map((message) => message.id)).toEqual(['keep']);
      expect(readReviewHistory()).toEqual([]);
      expect(loadComposerDrafts()).toEqual({});
    } finally {
      clear.mockRestore();
    }
  });
});
