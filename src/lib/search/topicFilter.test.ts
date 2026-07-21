// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * topicFilter.test.ts — coverage for pure topic-aware message slicing.
 */
import { describe, expect, it } from 'vitest';

import { filterByTopic, listTopics, summarizeTopics, type TopicMessage } from '@/lib/search/topicFilter';

interface TestMessage extends TopicMessage {
  body: string;
}

function at(iso: string): Date {
  return new Date(iso);
}

describe('filterByTopic', () => {
  it('returns an empty copy for null topic when there are no messages', () => {
    const messages: readonly TestMessage[] = [];

    const result = filterByTopic(messages, null);

    expect(result).toEqual([]);
    expect(result).not.toBe(messages);
  });

  it('returns all messages as a copy when the topic is null', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Roadmap', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: null, at: at('2026-01-01T11:00:00.000Z'), body: 'loose' },
    ];

    const result = filterByTopic(messages, null);

    expect(result).toEqual(messages);
    expect(result).not.toBe(messages);
  });

  it('matches topics case-insensitively', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Roadmap', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: 'roadmap', at: at('2026-01-01T11:00:00.000Z'), body: 'second' },
      { id: 'm3', topic: 'Release', at: at('2026-01-01T12:00:00.000Z'), body: 'third' },
      { id: 'm4', topic: null, at: at('2026-01-01T13:00:00.000Z'), body: 'loose' },
    ];

    const result = filterByTopic(messages, 'ROADMAP');

    expect(result.map((message) => message.id)).toEqual(['m1', 'm2']);
  });

  it('treats whitespace as part of the topic instead of trimming it', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Roadmap', at: at('2026-01-01T10:00:00.000Z'), body: 'plain' },
      { id: 'm2', topic: ' Roadmap ', at: at('2026-01-01T11:00:00.000Z'), body: 'padded' },
    ];

    expect(filterByTopic(messages, 'Roadmap').map((message) => message.id)).toEqual(['m1']);
    expect(filterByTopic(messages, ' roadmap ').map((message) => message.id)).toEqual(['m2']);
  });

  it('can match an empty-string topic without including null-topic messages', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: '', at: at('2026-01-01T10:00:00.000Z'), body: 'empty' },
      { id: 'm2', topic: null, at: at('2026-01-01T11:00:00.000Z'), body: 'loose' },
    ];

    expect(filterByTopic(messages, '').map((message) => message.id)).toEqual(['m1']);
  });
});

describe('listTopics', () => {
  it('returns an empty list when every message is topicless', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: null, at: at('2026-01-01T10:00:00.000Z'), body: 'loose' },
      { id: 'm2', topic: null, at: at('2026-01-01T11:00:00.000Z'), body: 'also loose' },
    ];

    expect(listTopics(messages)).toEqual([]);
  });

  it('dedupes case-insensitively, preserves first casing, and orders by recency then alphabetically', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Roadmap', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: 'bug', at: at('2026-01-06T10:00:00.000Z'), body: 'second' },
      { id: 'm3', topic: 'roadmap', at: at('2026-01-07T10:00:00.000Z'), body: 'third' },
      { id: 'm4', topic: 'alpha', at: at('2026-01-06T10:00:00.000Z'), body: 'fourth' },
      { id: 'm5', topic: null, at: at('2026-01-08T10:00:00.000Z'), body: 'loose' },
    ];

    const result = listTopics(messages);

    expect(result).toEqual(['Roadmap', 'alpha', 'bug']);
  });

  it('keeps empty-string and markup-looking topics as ordinary topic labels', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: '<img src=x onerror=alert(1)>', at: at('2026-01-01T10:00:00.000Z'), body: 'markup' },
      { id: 'm2', topic: '', at: at('2026-01-02T10:00:00.000Z'), body: 'empty' },
      { id: 'm3', topic: null, at: at('2026-01-03T10:00:00.000Z'), body: 'loose' },
    ];

    expect(listTopics(messages)).toEqual(['', '<img src=x onerror=alert(1)>']);
  });
});

describe('summarizeTopics', () => {
  it('returns an empty summary for an empty message list', () => {
    expect(summarizeTopics([])).toEqual([]);
  });

  it('counts messages, keeps the latest activity, orders summaries, and excludes null topics', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Ink', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: null, at: at('2026-01-10T10:00:00.000Z'), body: 'loose' },
      { id: 'm3', topic: 'ink', at: at('2026-01-05T10:00:00.000Z'), body: 'second' },
      { id: 'm4', topic: 'beta', at: at('2026-01-04T10:00:00.000Z'), body: 'third' },
      { id: 'm5', topic: 'Alpha', at: at('2026-01-04T10:00:00.000Z'), body: 'fourth' },
    ];

    const result = summarizeTopics(messages);

    expect(
      result.map((summary) => ({
        topic: summary.topic,
        count: summary.count,
        lastAt: summary.lastAt.toISOString(),
      })),
    ).toEqual([
      { topic: 'Ink', count: 2, lastAt: '2026-01-05T10:00:00.000Z' },
      { topic: 'Alpha', count: 1, lastAt: '2026-01-04T10:00:00.000Z' },
      { topic: 'beta', count: 1, lastAt: '2026-01-04T10:00:00.000Z' },
    ]);
  });

  it('clones lastAt instead of exposing the message Date instance', () => {
    const latest = at('2026-01-05T10:00:00.000Z');
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Ink', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: 'ink', at: latest, body: 'latest' },
    ];

    const result = summarizeTopics(messages);

    expect(result[0]!.lastAt.toISOString()).toBe('2026-01-05T10:00:00.000Z');
    expect(result[0]!.lastAt).not.toBe(latest);
  });

  it('preserves first casing and counts later differently-cased duplicates', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Topic', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: 'topic', at: at('2026-01-02T10:00:00.000Z'), body: 'second' },
      { id: 'm3', topic: 'TOPIC', at: at('2026-01-03T10:00:00.000Z'), body: 'third' },
    ];

    expect(summarizeTopics(messages)).toMatchObject([{ topic: 'Topic', count: 3 }]);
  });
});
