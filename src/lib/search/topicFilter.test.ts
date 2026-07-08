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
});

describe('listTopics', () => {
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
});

describe('summarizeTopics', () => {
  it('counts messages, keeps the latest activity, orders summaries, and excludes null topics', () => {
    const messages: readonly TestMessage[] = [
      { id: 'm1', topic: 'Sumi', at: at('2026-01-01T10:00:00.000Z'), body: 'first' },
      { id: 'm2', topic: null, at: at('2026-01-10T10:00:00.000Z'), body: 'loose' },
      { id: 'm3', topic: 'sumi', at: at('2026-01-05T10:00:00.000Z'), body: 'second' },
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
      { topic: 'Sumi', count: 2, lastAt: '2026-01-05T10:00:00.000Z' },
      { topic: 'Alpha', count: 1, lastAt: '2026-01-04T10:00:00.000Z' },
      { topic: 'beta', count: 1, lastAt: '2026-01-04T10:00:00.000Z' },
    ]);
  });
});
