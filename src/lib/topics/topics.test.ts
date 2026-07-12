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

  it('counts UTF-8 bytes rather than UTF-16 code units', () => {
    const twelveEmoji = '🔥'.repeat(12);
    const thirteenEmoji = '🔥'.repeat(13);

    expect(new TextEncoder().encode(twelveEmoji).length).toBe(48);
    expect(new TextEncoder().encode(thirteenEmoji).length).toBe(52);
    expect(isValidTopicLabel(twelveEmoji)).toBe(true);
    expect(isValidTopicLabel(thirteenEmoji)).toBe(false);
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

  it('rejects a tag that only becomes over-limit after trimming whitespace', () => {
    expect(parseMessageTopic({ [TOPIC_TAG]: ` ${'界'.repeat(17)} ` })).toBeNull();
  });

  it('accepts trimmed unicode labels at the byte boundary', () => {
    const label = `${'🔥'.repeat(12)}ab`;

    expect(new TextEncoder().encode(label).length).toBe(MAX_TOPIC_LABEL_BYTES);
    expect(parseMessageTopic({ [TOPIC_TAG]: `\t${label}\n` })).toBe(label);
  });

  it('rejects adversarial labels after trimming inbound message tags', () => {
    expect(parseMessageTopic({ [TOPIC_TAG]: 'release\x00train' })).toBeNull();
    expect(parseMessageTopic({ [TOPIC_TAG]: 'release,train' })).toBeNull();
    expect(parseMessageTopic({ [TOPIC_TAG]: '\u2003' })).toBeNull();
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

  it('does not let invalid or duplicate labels consume the registry cap', () => {
    const invalidLabels = Array.from({ length: MAX_TOPIC_REGISTRY + 8 }, (_, index) => `bad\x01${index}`);
    const duplicateLabels = Array.from({ length: 5 }, () => 'Release');
    const validLabels = Array.from({ length: MAX_TOPIC_REGISTRY }, (_, index) => `topic-${index}`);

    const parsed = parseTopicRegistry([...invalidLabels, ...duplicateLabels, ...validLabels].join(','));

    expect(parsed).toHaveLength(MAX_TOPIC_REGISTRY);
    expect(parsed[0]).toBe('Release');
    expect(parsed[1]).toBe('topic-0');
    expect(parsed[MAX_TOPIC_REGISTRY - 1]).toBe(`topic-${MAX_TOPIC_REGISTRY - 2}`);
  });
});

describe('outbound topic tags', () => {
  it('builds a message tag for valid labels and null for invalid labels', () => {
    expect(topicMessageTag('release')).toEqual({ [TOPIC_TAG]: 'release' });
    expect(topicMessageTag('bad,label')).toBeNull();
  });

  it('preserves the outbound label exactly when it is already valid', () => {
    expect(topicMessageTag('Release Train')).toEqual({ [TOPIC_TAG]: 'Release Train' });
  });

  it('does not trim outbound labels before validating or emitting them', () => {
    expect(topicMessageTag(' Release Train ')).toEqual({ [TOPIC_TAG]: ' Release Train ' });
    expect(topicMessageTag(' ')).toEqual({ [TOPIC_TAG]: ' ' });
  });

  it('accepts unicode outbound labels within the shared byte limit', () => {
    const label = '🔥'.repeat(12);

    expect(topicMessageTag(label)).toEqual({ [TOPIC_TAG]: label });
  });

  it('rejects empty and adversarial outbound labels', () => {
    expect(topicMessageTag('')).toBeNull();
    expect(topicMessageTag('release\x1ftrain')).toBeNull();
    expect(topicMessageTag('release,train')).toBeNull();
    expect(topicMessageTag('🔥'.repeat(13))).toBeNull();
  });
});

describe('unread topic bucketing', () => {
  it('returns an empty map when there are no messages', () => {
    expect(Array.from(bucketUnreadByTopic([]).entries())).toEqual([]);
  });

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

  it('does not normalize topic label case while bucketing existing messages', () => {
    const counts = bucketUnreadByTopic([
      { topic: 'Release', unread: true },
      { topic: 'release', unread: true },
      { topic: 'Release', unread: true },
    ]);

    expect(Array.from(counts.entries())).toEqual([
      ['Release', 2],
      ['release', 1],
    ]);
  });

  it('collapses explicit empty-topic strings with null no-topic messages', () => {
    const counts = bucketUnreadByTopic([
      { topic: '', unread: true },
      { topic: null, unread: true },
      { topic: '', unread: false },
    ]);

    expect(Array.from(counts.entries())).toEqual([['', 2]]);
  });

  it('preserves unicode and adversarial topic strings already present on messages', () => {
    const counts = bucketUnreadByTopic([
      { topic: '🔥 incident', unread: true },
      { topic: 'bad,label', unread: true },
      { topic: 'bad,label', unread: true },
      { topic: 'control\x01topic', unread: true },
    ]);

    expect(Array.from(counts.entries())).toEqual([
      ['🔥 incident', 1],
      ['bad,label', 2],
      ['control\x01topic', 1],
    ]);
  });
});
