// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_FEED_FRESH_MS,
  PUBLIC_FEED_FUTURE_SKEW_MS,
  publicFeedFreshness,
} from './feedBounds';

describe('publicFeedFreshness', () => {
  const nowMs = Date.parse('2026-07-16T12:00:00.000Z');
  const seconds = (ms: number): number => (nowMs + ms) / 1000;

  it('classifies bounded current, stale, future, and undated feeds', () => {
    expect(publicFeedFreshness(seconds(-PUBLIC_FEED_FRESH_MS), nowMs)).toBe('current');
    expect(publicFeedFreshness(seconds(-PUBLIC_FEED_FRESH_MS - 1_000), nowMs)).toBe('stale');
    expect(publicFeedFreshness(seconds(PUBLIC_FEED_FUTURE_SKEW_MS), nowMs)).toBe('current');
    expect(publicFeedFreshness(seconds(PUBLIC_FEED_FUTURE_SKEW_MS + 1_000), nowMs)).toBe('future');
    expect(publicFeedFreshness(0, nowMs)).toBe('unknown');
    expect(publicFeedFreshness(Number.POSITIVE_INFINITY, nowMs)).toBe('unknown');
  });
});
