// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * topics.test.ts — behavior coverage for Orochi named-conversation parsing.
 */
import { describe, expect, it } from 'vitest';

import {
  bucketUnreadByTopic,
  isValidTopicLabel,
  MAX_TOPIC_LABEL_BYTES,
  MAX_TOPIC_REGISTRY,
  parseMessageTopic,
  parseTopicRegistry,
  TOPIC_TAG,
  topicMessageTag,
} from './topics';

describe('topic label validation', () => {
  it('accepts labels up to the 50-byte UTF-8 boundary', () => {
    const fiftyByteLabel = '界'.repeat(16) + 'ab';
    const overLimitLabel = '界'.repeat(17);

    expect(new TextEncoder().encode(fiftyByteLabel).length).toBe(MAX_TOPIC_LABEL_BYTES);
    expect(isValidTopicLabel(fiftyByteLabel)).toBe(true);
    expect(isValidTopicLabel(overLimitLabel)).toBe(false);
  });

  it('rejects commas, controls, and empty labels', () => {
    expect(isValidTopicLabel('ops,incident')).toBe(false);
    expect(isValidTopicLabel('ops\nincident')).toBe(false);
    expect(isValidTopicLabel('ops\x7fincident')).toBe(false);
    expect(isValidTopicLabel('')).toBe(false);
  });
});

describe('message topic parsing', () => {
  it('returns a trimmed valid topic label from the Orochi tag', () => {
    expect(parseMessageTopic({ [TOPIC_TAG]: '  release ' })).toBe('release');
  });

  it('returns null for missing or invalid tags', () => {
    expect(parseMessageTopic({})).toBeNull();
    expect(parseMessageTopic({ [TOPIC_TAG]: 'bad,label' })).toBeNull();
    expect(parseMessageTopic({ [TOPIC_TAG]: '   ' })).toBeNull();
  });
});

describe('topic registry parsing', () => {
  it('splits, trims, drops invalid labels, and deduplicates case-insensitively', () => {
    const overLimitLabel = '界'.repeat(17);
    const labels = parseTopicRegistry(` alpha, Beta,alpha, beta ,bad\x01label,${overLimitLabel}, Gamma `);

    expect(labels).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('caps registries to the maximum number of labels', () => {
    const labels = Array.from({ length: MAX_TOPIC_REGISTRY + 4 }, (_, index) => `topic-${index}`);
    const parsed = parseTopicRegistry(labels.join(','));

    expect(parsed).toHaveLength(MAX_TOPIC_REGISTRY);
    expect(parsed[0]).toBe('topic-0');
    expect(parsed[MAX_TOPIC_REGISTRY - 1]).toBe(`topic-${MAX_TOPIC_REGISTRY - 1}`);
  });

  it('returns an empty registry for missing values', () => {
    expect(parseTopicRegistry(null)).toEqual([]);
    expect(parseTopicRegistry(undefined)).toEqual([]);
    expect(parseTopicRegistry('')).toEqual([]);
  });
});

describe('outbound topic tags', () => {
  it('builds a message tag for valid labels and null for invalid labels', () => {
    expect(topicMessageTag('release')).toEqual({ [TOPIC_TAG]: 'release' });
    expect(topicMessageTag('bad,label')).toBeNull();
  });
});

describe('unread topic bucketing', () => {
  it('counts unread messages by topic and uses an empty key for no-topic messages', () => {
    const counts = bucketUnreadByTopic([
      { topic: 'release', unread: true },
      { topic: 'release', unread: false },
      { topic: 'triage', unread: true },
      { topic: null, unread: true },
      { topic: null, unread: true },
      { topic: 'release', unread: true },
    ]);

    expect(Array.from(counts.entries())).toEqual([
      ['release', 2],
      ['triage', 1],
      ['', 2],
    ]);
  });
});
