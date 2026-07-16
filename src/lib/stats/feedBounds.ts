// SPDX-License-Identifier: AGPL-3.0-or-later
/** Shared work/value bounds for same-origin public JSON feeds. */
export const PUBLIC_FEED_COUNT_MAX = 1_000_000_000_000;
export const PUBLIC_FEED_UNIX_SECONDS_MAX = 8_640_000_000_000;
export const PUBLIC_FEED_FRESH_MS = 2 * 60 * 1000;
export const PUBLIC_FEED_FUTURE_SKEW_MS = 5 * 60 * 1000;
export type PublicFeedFreshness = 'current' | 'stale' | 'future' | 'unknown';

export function boundedFeedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

export function boundedFeedNumber(value: unknown, max = PUBLIC_FEED_COUNT_MAX): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, max)
    : 0;
}

export function boundedFeedInteger(value: unknown, max = PUBLIC_FEED_COUNT_MAX): number {
  return Math.floor(boundedFeedNumber(value, max));
}

export function boundedUnixSeconds(value: unknown): number {
  return boundedFeedNumber(value, PUBLIC_FEED_UNIX_SECONDS_MAX);
}

export function publicFeedFreshness(generatedAtUnixSec: number, nowMs: number): PublicFeedFreshness {
  if (
    !Number.isFinite(generatedAtUnixSec)
    || generatedAtUnixSec <= 0
    || generatedAtUnixSec > PUBLIC_FEED_UNIX_SECONDS_MAX
    || !Number.isFinite(nowMs)
  ) return 'unknown';
  const ageMs = nowMs - generatedAtUnixSec * 1000;
  if (ageMs < -PUBLIC_FEED_FUTURE_SKEW_MS) return 'future';
  return ageMs <= PUBLIC_FEED_FRESH_MS ? 'current' : 'stale';
}
