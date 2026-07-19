// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * topics.ts — pure parsing and aggregation for Onyx Server named conversations.
 */

export const TOPIC_TAG = 'onyx/topic';
export const TOPIC_PROP = 'onyx_server.topics';
export const MAX_TOPIC_LABEL_BYTES = 50;
export const MAX_TOPIC_REGISTRY = 64;

const TOPIC_LABEL_CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;
const textEncoder = new TextEncoder();

function topicLabelByteLength(label: string): number {
  return textEncoder.encode(label).length;
}

function topicLabelKey(label: string): string {
  return label.toLowerCase();
}

export function isValidTopicLabel(label: string): boolean {
  if (label.length === 0) return false;
  if (label.includes(',')) return false;
  if (TOPIC_LABEL_CONTROL_PATTERN.test(label)) return false;

  const byteLength = topicLabelByteLength(label);
  return byteLength >= 1 && byteLength <= MAX_TOPIC_LABEL_BYTES;
}

export function parseMessageTopic(tags: Readonly<Record<string, string | undefined>>): string | null {
  const rawLabel = tags[TOPIC_TAG];
  if (rawLabel === undefined) return null;

  const label = rawLabel.trim();
  return isValidTopicLabel(label) ? label : null;
}

export function parseTopicRegistry(propValue: string | null | undefined): string[] {
  if (!propValue) return [];

  const labels: string[] = [];
  const seen = new Set<string>();

  for (const rawLabel of propValue.split(',')) {
    if (labels.length >= MAX_TOPIC_REGISTRY) break;

    const label = rawLabel.trim();
    if (!isValidTopicLabel(label)) continue;

    const key = topicLabelKey(label);
    if (seen.has(key)) continue;

    seen.add(key);
    labels.push(label);
  }

  return labels;
}

export function topicMessageTag(label: string): Record<string, string> | null {
  return isValidTopicLabel(label) ? { [TOPIC_TAG]: label } : null;
}

export function bucketUnreadByTopic(messages: readonly { topic: string | null; unread: boolean }[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const message of messages) {
    if (!message.unread) continue;

    const topic = message.topic ?? '';
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }

  return counts;
}
