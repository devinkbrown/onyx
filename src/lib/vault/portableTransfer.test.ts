import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import {
  readReviewHistory,
  recordReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import { loadComposerDrafts, saveComposerDrafts } from '@/lib/composer/drafts';
import { loadChannelTopicDrafts, saveChannelTopicDrafts } from '@/lib/channel/topicDrafts';
import { loadCredentials, saveCredentials, storeMeshToken, storeSessionToken } from '@/lib/credentials';
import { preferences, resetPreferences, setPreference } from '@/lib/prefs/preferences';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import { _resetVaultForTests, clearVault, loadRecent, saveMessages } from './historyVault';
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
    localStorage.clear();
    resetPreferences();
    setSceneMotion('animated');
  });

  it('round-trips vault rows, reviewed checkpoints, drafts, account handoffs, and preferences', async () => {
    await saveMessages('#alpha', [msg('a1', 1000, { target: '#alpha' })]);
    recordReviewHistory(review('#alpha'));
    saveCredentials({ nick: 'kain', server: 'wss://eshmaki.me', password: 'secret' });
    storeSessionToken('local-session-token', 1783500000);
    storeMeshToken('mesh-session-token');
    setPreference('density', 'compact');
    setPreference('voiceEntry', false);
    setPreference('topicTools', true);
    setPreference('highContrast', true);
    setSceneMotion('still');
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
    });
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

    const parsed = parsePortableTransfer(JSON.parse(JSON.stringify(exported)));
    expect(parsed).not.toBeNull();

    await clearVault();
    localStorage.clear();
    resetPreferences();
    setSceneMotion('animated');
    const result = await importPortableTransfer(parsed!);

    expect(result).toEqual({
      targets: 1,
      messages: 1,
      reviews: 1,
      drafts: 1,
      topicDrafts: 1,
      accountHandoffs: 1,
      preferenceHandoffs: 1,
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
  });

  it('rejects non-Onyx portable transfer files', () => {
    expect(parsePortableTransfer({ kind: 'nope', version: 1, targets: [] })).toBeNull();
  });
});
