// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Bounded, room-level view of Onyx Server's public chanstats document.
 *
 * The daemon also publishes per-user and word-frequency tables. The public UI
 * deliberately does not ingest those: channel insights should describe the
 * room's rhythm, not turn a community page into a participant leaderboard.
 */

import {
  boundedFeedInteger,
  boundedFeedText,
  boundedUnixSeconds,
} from './feedBounds';
import { channelToSlug } from './channelStats';
import { fetchPublicJson } from './fetchPublicJson';

const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const MAX_DETAIL_DAYS = 60;
const MAX_DETAIL_TEXT = 128;

export type ChannelDetailTotals = {
  messages: number;
  words: number;
  activeUsers: number;
  joins: number;
  parts: number;
  quits: number;
  kicks: number;
  topicChanges: number;
};

export type ChannelDetail = {
  channel: string;
  generatedAt: number;
  firstSeen: number;
  lastActive: number;
  present: number;
  lastSpeaker: string;
  totals: ChannelDetailTotals;
  hours: number[];
  days: Array<{ date: string; messages: number }>;
  heatmap: number[][];
  busiestDay: { date: string; messages: number } | null;
  peakHour: number | null;
  complete: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validChannel(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_DETAIL_TEXT) return '';
  return /^(?:#|&)[^\u0000\r\n\t ,]+$/u.test(value) ? value : '';
}

function validDate(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : '';
}

function fixedCounts(value: unknown, length: number): { values: number[]; complete: boolean } {
  if (!Array.isArray(value) || value.length !== length) {
    return { values: Array.from({ length }, () => 0), complete: false };
  }
  return {
    values: value.map((entry) => boundedFeedInteger(entry)),
    complete: true,
  };
}

export function normalizeChannelDetail(raw: unknown, expectedChannel?: string): ChannelDetail | null {
  const root = record(raw);
  if (!root) return null;
  const channel = validChannel(root['channel']);
  if (!channel || (expectedChannel && channel.toLowerCase() !== expectedChannel.toLowerCase())) return null;

  let complete = true;
  const totals = record(root['totals']);
  if (!totals) complete = false;

  const hours = fixedCounts(root['hours'], HOURS_PER_DAY);
  complete &&= hours.complete;

  const heatmapRaw = root['heatmap'];
  const heatmap: number[][] = [];
  if (!Array.isArray(heatmapRaw) || heatmapRaw.length !== DAYS_PER_WEEK) {
    complete = false;
    for (let day = 0; day < DAYS_PER_WEEK; day += 1) heatmap.push(Array.from({ length: HOURS_PER_DAY }, () => 0));
  } else {
    for (const row of heatmapRaw) {
      const normalized = fixedCounts(row, HOURS_PER_DAY);
      complete &&= normalized.complete;
      heatmap.push(normalized.values);
    }
  }

  const days: ChannelDetail['days'] = [];
  const seenDays = new Set<string>();
  const daysRaw = root['days'];
  if (!Array.isArray(daysRaw)) {
    complete = false;
  } else {
    if (daysRaw.length > MAX_DETAIL_DAYS) complete = false;
    for (const item of daysRaw.slice(-MAX_DETAIL_DAYS)) {
      const day = record(item);
      const date = validDate(day?.['date']);
      if (!day || !date || seenDays.has(date)) {
        complete = false;
        continue;
      }
      seenDays.add(date);
      days.push({ date, messages: boundedFeedInteger(day['messages']) });
    }
  }

  const records = record(root['records']);
  const busiestRaw = record(records?.['busiest_day']);
  const busiestDate = validDate(busiestRaw?.['date']);
  const busiestDay = busiestRaw && busiestDate
    ? { date: busiestDate, messages: boundedFeedInteger(busiestRaw['messages']) }
    : null;
  const rawPeakHour = records?.['peak_hour'];
  const peakHour = typeof rawPeakHour === 'number' && Number.isInteger(rawPeakHour) && rawPeakHour >= 0 && rawPeakHour < 24
    ? rawPeakHour
    : null;
  if (!records || !busiestDay || peakHour === null) complete = false;

  return {
    channel,
    generatedAt: boundedUnixSeconds(root['generated_at']),
    firstSeen: boundedUnixSeconds(root['first_seen']),
    lastActive: boundedUnixSeconds(root['last_active']),
    present: boundedFeedInteger(root['present']),
    lastSpeaker: boundedFeedText(root['last_speaker'], MAX_DETAIL_TEXT),
    totals: {
      messages: boundedFeedInteger(totals?.['messages']),
      words: boundedFeedInteger(totals?.['words']),
      activeUsers: boundedFeedInteger(totals?.['active_users']),
      joins: boundedFeedInteger(totals?.['joins']),
      parts: boundedFeedInteger(totals?.['parts']),
      quits: boundedFeedInteger(totals?.['quits']),
      kicks: boundedFeedInteger(totals?.['kicks']),
      topicChanges: boundedFeedInteger(totals?.['topic_changes']),
    },
    hours: hours.values,
    days,
    heatmap,
    busiestDay,
    peakHour,
    complete,
  };
}

export async function fetchChannelDetail(channel: string): Promise<ChannelDetail | null> {
  const slug = channelToSlug(channel);
  if (!slug) return null;
  try {
    return normalizeChannelDetail(
      await fetchPublicJson(`/stats/data/${encodeURIComponent(slug)}.json`),
      channel,
    );
  } catch {
    return null;
  }
}
