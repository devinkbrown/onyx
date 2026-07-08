/**
 * topicFilter.ts — pure topic slicing helpers for topic-aware message views.
 *
 * Keeps forum-style topic lists independent from the store and full message
 * model; callers only need to satisfy this small structural shape.
 */

export interface TopicMessage {
  id: string;
  topic: string | null;
  at: Date;
}

export interface TopicSummary {
  topic: string;
  count: number;
  lastAt: Date;
}

interface TopicBucket {
  topic: string;
  count: number;
  lastAt: Date;
}

function normalizeTopic(topic: string): string {
  return topic.toLowerCase();
}

function compareTopicsAsc(left: string, right: string): number {
  const normalizedOrder = normalizeTopic(left).localeCompare(normalizeTopic(right));
  if (normalizedOrder !== 0) return normalizedOrder;
  return left.localeCompare(right);
}

function compareSummaries(left: TopicSummary, right: TopicSummary): number {
  const activityOrder = right.lastAt.getTime() - left.lastAt.getTime();
  if (activityOrder !== 0) return activityOrder;
  return compareTopicsAsc(left.topic, right.topic);
}

export function filterByTopic<T extends TopicMessage>(messages: readonly T[], topic: string | null): T[] {
  if (topic === null) return [...messages];
  const normalizedTopic = normalizeTopic(topic);
  return messages.filter((message) => message.topic !== null && normalizeTopic(message.topic) === normalizedTopic);
}

export function listTopics<T extends TopicMessage>(messages: readonly T[]): string[] {
  return summarizeTopics(messages).map((summary) => summary.topic);
}

export function summarizeTopics<T extends TopicMessage>(messages: readonly T[]): TopicSummary[] {
  const buckets = new Map<string, TopicBucket>();

  for (const message of messages) {
    if (message.topic === null) continue;

    const key = normalizeTopic(message.topic);
    const existing = buckets.get(key);
    const messageTime = message.at.getTime();
    const lastAt =
      existing && existing.lastAt.getTime() >= messageTime ? existing.lastAt : new Date(messageTime);

    buckets.set(key, {
      topic: existing?.topic ?? message.topic,
      count: (existing?.count ?? 0) + 1,
      lastAt,
    });
  }

  return Array.from(buckets.values(), (bucket): TopicSummary => ({
    topic: bucket.topic,
    count: bucket.count,
    lastAt: new Date(bucket.lastAt.getTime()),
  })).sort(compareSummaries);
}
