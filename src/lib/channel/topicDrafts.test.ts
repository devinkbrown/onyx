// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_TOPIC_DRAFTS_KEY,
  MAX_CHANNEL_TOPIC_DRAFT_LENGTH,
  MAX_CHANNEL_TOPIC_DRAFTS,
  MAX_CHANNEL_TOPIC_TARGET_LENGTH,
  channelTopicDraftKey,
  clearChannelTopicDrafts,
  loadChannelTopicDrafts,
  purgeLegacyChannelTopicDrafts,
  readChannelTopicDraft,
  sanitizeChannelTopicDrafts,
  saveChannelTopicDraft,
  saveChannelTopicDrafts,
} from './topicDrafts';

describe('channel topic drafts', () => {
  beforeEach(() => localStorage.clear());

  it('isolates Alice and Bob while purging ownerless legacy topic drafts', () => {
    const alice = { serverUrl: 'wss://example.test', identity: 'Alice' };
    const bob = { serverUrl: 'wss://example.test', identity: 'bob' };
    localStorage.setItem(CHANNEL_TOPIC_DRAFTS_KEY, JSON.stringify({ '#legacy': 'legacy topic' }));

    saveChannelTopicDrafts({ '#alice': 'Alice topic' }, undefined, alice);
    saveChannelTopicDrafts({ '#bob': 'Bob topic' }, undefined, bob);

    expect(loadChannelTopicDrafts(undefined, alice)).toEqual({ '#alice': 'Alice topic' });
    expect(loadChannelTopicDrafts(undefined, bob)).toEqual({ '#bob': 'Bob topic' });
    expect(loadChannelTopicDrafts()).toEqual({});
    expect(localStorage.getItem(CHANNEL_TOPIC_DRAFTS_KEY)).toBeNull();
  });

  it('normalizes only channel targets', () => {
    expect(channelTopicDraftKey(' #Root ')).toBe('#root');
    expect(sanitizeChannelTopicDrafts({
      '#Root': 'topic draft',
      '&Ops': 'ops draft',
      alice: 'dm-ish value',
      '#empty': '',
    })).toEqual({
      '#root': 'topic draft',
      '&ops': 'ops draft',
    });
  });

  it('bounds persisted channel count, target length, and draft length', () => {
    const drafts = Object.fromEntries(
      Array.from({ length: MAX_CHANNEL_TOPIC_DRAFTS + 2 }, (_, index) => [
        `#room-${index}`,
        index === 0 ? 'x'.repeat(MAX_CHANNEL_TOPIC_DRAFT_LENGTH + 25) : `topic ${index}`,
      ]),
    );
    drafts[`#${'z'.repeat(MAX_CHANNEL_TOPIC_TARGET_LENGTH)}`] = 'oversized target';

    const sanitized = sanitizeChannelTopicDrafts(drafts);

    expect(Object.keys(sanitized)).toHaveLength(MAX_CHANNEL_TOPIC_DRAFTS);
    expect(sanitized['#room-0']).toHaveLength(MAX_CHANNEL_TOPIC_DRAFT_LENGTH);
    expect(sanitized['#room-49']).toBe('topic 49');
    expect(sanitized['#room-50']).toBeUndefined();
    expect(sanitized[`#${'z'.repeat(MAX_CHANNEL_TOPIC_TARGET_LENGTH)}`]).toBeUndefined();
  });

  it('persists and clears drafts relative to the server topic', () => {
    saveChannelTopicDraft('#Root', 'new topic', 'old topic');
    expect(readChannelTopicDraft('#root')).toBe('new topic');

    saveChannelTopicDraft('#ROOT', 'old topic', 'old topic');
    expect(readChannelTopicDraft('#root')).toBeNull();
    expect(loadChannelTopicDrafts()).toEqual({});
  });

  it('round-trips sanitized draft maps', () => {
    saveChannelTopicDrafts({ '#root': 'release train', alice: 'ignored' });
    expect(loadChannelTopicDrafts()).toEqual({ '#root': 'release train' });
  });

  it('ignores arrays, inherited properties, blank channel names, and non-string drafts', () => {
    const inherited = Object.create({ '#Inherited': 'ignored' }) as Record<string, unknown>;
    inherited['  #Root  '] = 'topic draft';
    inherited[' &Ops '] = 42;
    inherited['   '] = 'blank channel';

    expect(sanitizeChannelTopicDrafts(['#root', 'topic'])).toEqual({});
    expect(sanitizeChannelTopicDrafts(inherited)).toEqual({ '#root': 'topic draft' });
  });

  it('returns an empty draft map for corrupt JSON in storage', () => {
    localStorage.setItem(CHANNEL_TOPIC_DRAFTS_KEY, '{not json');

    expect(loadChannelTopicDrafts()).toEqual({});
  });

  it('removes storage when every saved draft is sanitized away', () => {
    localStorage.setItem(CHANNEL_TOPIC_DRAFTS_KEY, JSON.stringify({ '#root': 'stale' }));

    saveChannelTopicDrafts({ alice: 'not a channel', '#empty': '' });

    expect(localStorage.getItem(CHANNEL_TOPIC_DRAFTS_KEY)).toBeNull();
  });

  it('does not throw when storage read or write operations fail', () => {
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked read');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked write');
      }),
      removeItem: vi.fn(() => {
        throw new Error('blocked remove');
      }),
    };

    expect(loadChannelTopicDrafts(throwingStorage)).toEqual({});
    expect(() => saveChannelTopicDrafts({ '#root': 'draft' }, throwingStorage)).not.toThrow();
    expect(() => saveChannelTopicDrafts({}, throwingStorage)).not.toThrow();
    expect(purgeLegacyChannelTopicDrafts(throwingStorage)).toBe(false);
  });

  it('does not persist a single blank channel draft', () => {
    saveChannelTopicDraft('   ', 'draft', 'server');

    expect(loadChannelTopicDrafts()).toEqual({});
  });

  it('clears channel topic drafts only after verified storage readback', () => {
    saveChannelTopicDrafts({ '#root': 'release train', '&ops': 'incident draft' });

    expect(clearChannelTopicDrafts()).toEqual({ success: true, cleared: 2, remaining: 0 });
    expect(localStorage.getItem(CHANNEL_TOPIC_DRAFTS_KEY)).toBeNull();
    expect(loadChannelTopicDrafts()).toEqual({});
  });

  it('verifies an already-empty topic-draft key', () => {
    expect(clearChannelTopicDrafts()).toEqual({ success: true, cleared: 0, remaining: 0 });
  });

  it('does not report success when storage silently retains topic drafts', () => {
    saveChannelTopicDrafts({ '#root': 'keep me' });
    const retainingStorage = {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: localStorage.setItem.bind(localStorage),
      removeItem: vi.fn(),
    };

    expect(clearChannelTopicDrafts(retainingStorage)).toEqual({
      success: false,
      cleared: 0,
      remaining: 1,
    });
    expect(loadChannelTopicDrafts()).toEqual({ '#root': 'keep me' });
  });

  it('does not throw or report success when topic-draft removal fails', () => {
    saveChannelTopicDrafts({ '#root': 'keep me' });
    const throwingStorage = {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: localStorage.setItem.bind(localStorage),
      removeItem: () => { throw new Error('blocked remove'); },
    };

    expect(clearChannelTopicDrafts(throwingStorage)).toEqual({
      success: false,
      cleared: 0,
      remaining: 1,
    });
    expect(loadChannelTopicDrafts()).toEqual({ '#root': 'keep me' });
  });
});
