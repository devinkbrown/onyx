// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import {
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
});
