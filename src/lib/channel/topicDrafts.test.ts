// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_TOPIC_DRAFTS_KEY,
  channelTopicDraftKey,
  loadChannelTopicDrafts,
  readChannelTopicDraft,
  sanitizeChannelTopicDrafts,
  saveChannelTopicDraft,
  saveChannelTopicDrafts,
} from './topicDrafts';

describe('channel topic drafts', () => {
  beforeEach(() => localStorage.clear());

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
  });

  it('does not persist a single blank channel draft', () => {
    saveChannelTopicDraft('   ', 'draft', 'server');

    expect(loadChannelTopicDrafts()).toEqual({});
  });
});
