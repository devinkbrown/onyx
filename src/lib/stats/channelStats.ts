// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * channelStats.ts — per-channel telemetry for the presence heatline.
 *
 * Fetches the channel's own stats file (`/stats/data/<slug>.json`, emitted by
 * Onyx Server's chanstats engine) and normalizes the 24-hour activity histogram.
 * The slug MUST match the server's `slugify` byte-for-byte or the file 404s —
 * this is the same contract proven in onyx-stats/src/lib/slug.ts.
 */

import { boundedFeedInteger, boundedUnixSeconds, PUBLIC_FEED_COUNT_MAX } from './feedBounds';
import { fetchPublicJson } from './fetchPublicJson';

const MAX_SLUG_BYTES = 128;
// IRC channel sigils the server strips (a single leading one).
const STRIP_SIGILS = new Set([0x23 /* # */, 0x26 /* & */, 0x2b /* + */, 0x21 /* ! */]);

/**
 * Channel → data slug, byte-faithful to the server (`chanstats.zig slugify`):
 * strip one leading sigil; per-UTF-8-byte lowercase ASCII, keep [a-z0-9._-]
 * else '_'; neutralise a leading dot; cap 128 bytes.
 */
export function channelToSlug(channel: string): string {
  if (!channel) return '';
  const bytes = new TextEncoder().encode(channel);
  if (bytes.length === 0) return '';
  let start = 0;
  if (STRIP_SIGILS.has(bytes[0]!)) start = 1;
  if (start >= bytes.length) return '';
  const limit = Math.min(bytes.length, start + MAX_SLUG_BYTES);
  let out = '';
  for (let i = start; i < limit; i++) {
    let b = bytes[i]!;
    if (b >= 0x41 && b <= 0x5a) b += 0x20;
    const safe =
      (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x2e || b === 0x2d || b === 0x5f;
    out += safe ? String.fromCharCode(b) : '_';
  }
  if (out.length === 0) return '';
  if (out.charCodeAt(0) === 0x2e) out = `_${out.slice(1)}`;
  return out;
}

export type ChannelPulse = {
  /** 24 UTC-hour message counts (index 0 = 00:00 UTC). */
  hours: number[];
  /** All-time total messages recorded for the channel. */
  total: number;
  /** Live roster count when the export includes it. */
  present: number;
  /** Unix seconds of last recorded public activity, or 0. */
  lastActive: number;
};

function normalizeHours(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== 24) return null;
  return raw.map((n) => boundedFeedInteger(n));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The channel's 24-hour activity histogram, or null when there's no stats file
 * (a fresh/quiet channel, or a dev server with no /stats). Never throws.
 */
export async function fetchChannelPulse(channel: string): Promise<ChannelPulse | null> {
  const slug = channelToSlug(channel);
  if (!slug) return null;
  try {
    const raw = await fetchPublicJson(`/stats/data/${encodeURIComponent(slug)}.json`);
    if (!isRecord(raw)) return null;
    const hours = normalizeHours(raw['hours']);
    if (!hours) return null;
    const totals = raw['totals'];
    const reportedTotal = isRecord(totals) ? totals['messages'] : undefined;
    const total = typeof reportedTotal === 'number' && Number.isFinite(reportedTotal) && reportedTotal >= 0
      ? boundedFeedInteger(reportedTotal)
      : Math.min(hours.reduce((a, b) => a + b, 0), PUBLIC_FEED_COUNT_MAX);
    return {
      hours,
      total,
      present: boundedFeedInteger(raw['present']),
      lastActive: boundedUnixSeconds(raw['last_active']),
    };
  } catch {
    return null;
  }
}
