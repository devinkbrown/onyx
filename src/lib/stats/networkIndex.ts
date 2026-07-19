// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * networkIndex.ts — the live network pulse feed.
 *
 * Same-origin `/stats/data/index.json`, emitted by Onyx Server's chanstats engine
 * every ~30s. Shared by HomeView and the Connect screen's pulse panel.
 * Defensive normalization: the fetch 404s in dev and the shape is external —
 * consumers must always receive either `null` or a fully-typed value.
 */

import { relativeTime } from '@/lib/time/relativeTime';
import {
  boundedFeedInteger,
  boundedFeedNumber,
  boundedFeedText,
  boundedUnixSeconds,
  PUBLIC_FEED_UNIX_SECONDS_MAX,
} from './feedBounds';
import { fetchPublicJson } from './fetchPublicJson';

export const MAX_STATS_CHANNELS = 512;
export const MAX_STATS_DAYS = 366;
export const MAX_STATS_SPARK_POINTS = 64;
export const MAX_STATS_CHANNEL_LENGTH = 128;
export const MAX_STATS_TOPIC_LENGTH = 512;
const MAX_STATS_META_LENGTH = 256;

function normalizedChannel(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_STATS_CHANNEL_LENGTH) return '';
  const channel = value;
  return /^(?:#|&)[^\u0000\r\n\t ,]+$/u.test(channel) ? channel : '';
}

export type StatsChannel = {
  channel: string;
  messages: number;
  active_users: number;
  present: number;
  last_active: number;
  topic: string;
  spark: number[];
};

export type NetworkDay = {
  date: string;
  messages: number;
};

export type StatsIndex = {
  generated_at: number;
  network: string;
  node: string;
  users_online: number;
  network_days: NetworkDay[];
  channels: StatsChannel[];
  /** False when invalid, duplicate, or over-cap day rows were omitted. */
  network_days_complete: boolean;
  /** False when invalid, duplicate, or over-cap channel rows were omitted. */
  channels_complete: boolean;
};

function normalizeNetworkDays(raw: unknown): { days: NetworkDay[]; complete: boolean } {
  if (!Array.isArray(raw)) return { days: [], complete: false };
  const days: NetworkDay[] = [];
  const seenDates = new Set<string>();
  let complete = raw.length <= MAX_STATS_DAYS;
  for (const entry of raw.slice(-MAX_STATS_DAYS)) {
    if (typeof entry !== 'object' || entry === null) {
      complete = false;
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e['date'] !== 'string' || e['date'].length > 32) {
      complete = false;
      continue;
    }
    const date = e['date'];
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || seenDates.has(date)) {
      complete = false;
      continue;
    }
    seenDates.add(date);
    days.push({
      date,
      messages: boundedFeedInteger(e['messages']),
    });
  }
  return { days, complete };
}

export function normalizeIndex(raw: unknown): StatsIndex | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['channels'])) return null;
  const channels: StatsChannel[] = [];
  const seenChannels = new Set<string>();
  let channelsComplete = r['channels'].length <= MAX_STATS_CHANNELS;
  for (const entry of r['channels'].slice(0, MAX_STATS_CHANNELS)) {
    if (typeof entry !== 'object' || entry === null) {
      channelsComplete = false;
      continue;
    }
    const e = entry as Record<string, unknown>;
    const channel = normalizedChannel(e['channel']);
    const channelKey = channel.toLowerCase();
    if (!channel || seenChannels.has(channelKey)) {
      channelsComplete = false;
      continue;
    }
    seenChannels.add(channelKey);
    channels.push({
      channel,
      messages: boundedFeedInteger(e['messages']),
      active_users: boundedFeedInteger(e['active_users']),
      present: boundedFeedInteger(e['present']),
      last_active: boundedUnixSeconds(e['last_active']),
      topic: boundedFeedText(e['topic'], MAX_STATS_TOPIC_LENGTH),
      spark: Array.isArray(e['spark'])
        ? e['spark'].slice(-MAX_STATS_SPARK_POINTS).map((n) => boundedFeedNumber(n))
        : [],
    });
  }
  const networkDays = normalizeNetworkDays(r['network_days']);
  return {
    generated_at: boundedUnixSeconds(r['generated_at']),
    network: boundedFeedText(r['network'], MAX_STATS_META_LENGTH),
    node: boundedFeedText(r['node'], MAX_STATS_META_LENGTH),
    users_online: boundedFeedInteger(r['users_online']),
    network_days: networkDays.days,
    channels,
    network_days_complete: networkDays.complete,
    channels_complete: channelsComplete,
  };
}

export async function fetchStatsIndex(): Promise<StatsIndex | null> {
  return normalizeIndex(await fetchPublicJson('/stats/data/index.json'));
}

/** Compact relative time from a unix-seconds stamp. */
export function relTime(unixSec: number, nowMs: number): string {
  if (
    !Number.isFinite(unixSec)
    || unixSec <= 0
    || unixSec > PUBLIC_FEED_UNIX_SECONDS_MAX
    || !Number.isFinite(nowMs)
    || Math.abs(nowMs) > PUBLIC_FEED_UNIX_SECONDS_MAX * 1000
  ) return 'a while ago';
  return relativeTime(new Date(unixSec * 1000), new Date(nowMs));
}
