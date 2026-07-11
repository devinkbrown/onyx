// SPDX-License-Identifier: AGPL-3.0-or-later
export interface QuietChannelLike {
  name: string;
  topic?: string;
  unread: number;
  highlights: number;
}

export interface QuietActivityItem {
  name: string;
  topic: string;
  lastActivity: number;
}

export interface QuietActivityOptions {
  limit?: number;
  maxAgeMs?: number;
}

const DEFAULT_LIMIT = 4;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function buildQuietActivity(
  channels: Iterable<QuietChannelLike>,
  channelLastActivity: ReadonlyMap<string, number>,
  nowMs: number,
  options: QuietActivityOptions = {},
): QuietActivityItem[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const items: QuietActivityItem[] = [];

  for (const channel of channels) {
    if (channel.unread > 0 || channel.highlights > 0) continue;

    const lastActivity = channelLastActivity.get(channel.name.toLowerCase()) ?? 0;
    if (lastActivity <= 0 || nowMs - lastActivity > maxAgeMs) continue;

    items.push({
      name: channel.name,
      topic: channel.topic?.trim() ?? '',
      lastActivity,
    });
  }

  return items
    .sort((a, b) => b.lastActivity - a.lastActivity || a.name.localeCompare(b.name))
    .slice(0, limit);
}
