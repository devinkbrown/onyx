// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  listEqualsBy,
  scheduledEventItemEqual,
  quietActivityItemEqual,
  scheduledEventsListEqual,
  quietActivityListEqual,
  catchUpItemEqual,
  awayDigestEqual,
} from './digestStability';
import type { ScheduledEventItem } from './scheduledEvents';
import type { QuietActivityItem } from './quietActivity';
import type { CatchUpItem } from './catchUp';
import type { AwayDigest } from './awayDigest';

function event(over: Partial<ScheduledEventItem> = {}): ScheduledEventItem {
  return { channel: '#root', at: 1_000, title: 'Standup', live: false, ...over };
}

function quiet(over: Partial<QuietActivityItem> = {}): QuietActivityItem {
  return { name: '#lounge', topic: 'chill', lastActivity: 5_000, ...over };
}

describe('listEqualsBy', () => {
  it('returns true for the same reference without comparing items', () => {
    const list = [event()];
    let calls = 0;
    const result = listEqualsBy(list, list, () => {
      calls += 1;
      return true;
    });
    expect(result).toBe(true);
    expect(calls).toBe(0);
  });

  it('returns false when lengths differ', () => {
    expect(listEqualsBy([event()], [], scheduledEventItemEqual)).toBe(false);
  });

  it('returns true when every item is equal by value', () => {
    expect(
      listEqualsBy([event()], [event()], scheduledEventItemEqual),
    ).toBe(true);
  });

  it('returns false at the first differing item', () => {
    expect(
      listEqualsBy(
        [event(), event({ channel: '#a' })],
        [event(), event({ channel: '#b' })],
        scheduledEventItemEqual,
      ),
    ).toBe(false);
  });
});

describe('scheduledEventItemEqual', () => {
  it('treats identical fields as equal across fresh objects', () => {
    expect(scheduledEventItemEqual(event(), event())).toBe(true);
  });

  it('detects a live-flag flip', () => {
    expect(scheduledEventItemEqual(event({ live: false }), event({ live: true }))).toBe(false);
  });

  it('detects a changed start time or title or channel', () => {
    expect(scheduledEventItemEqual(event(), event({ at: 2_000 }))).toBe(false);
    expect(scheduledEventItemEqual(event(), event({ title: 'Retro' }))).toBe(false);
    expect(scheduledEventItemEqual(event(), event({ channel: '#dev' }))).toBe(false);
  });
});

describe('quietActivityItemEqual', () => {
  it('treats identical fields as equal across fresh objects', () => {
    expect(quietActivityItemEqual(quiet(), quiet())).toBe(true);
  });

  it('detects a changed last-activity, topic, or name', () => {
    expect(quietActivityItemEqual(quiet(), quiet({ lastActivity: 6_000 }))).toBe(false);
    expect(quietActivityItemEqual(quiet(), quiet({ topic: 'loud' }))).toBe(false);
    expect(quietActivityItemEqual(quiet(), quiet({ name: '#other' }))).toBe(false);
  });
});

describe('list equality wrappers', () => {
  it('scheduledEventsListEqual is stable across a no-op clock tick', () => {
    // Two independently-built arrays as a memo would produce on successive ticks.
    const prev = [event({ channel: '#a' }), event({ channel: '#b', at: 2_000 })];
    const next = [event({ channel: '#a' }), event({ channel: '#b', at: 2_000 })];
    expect(scheduledEventsListEqual(prev, next)).toBe(true);
  });

  it('scheduledEventsListEqual flags an event going live', () => {
    const prev = [event({ live: false })];
    const next = [event({ live: true })];
    expect(scheduledEventsListEqual(prev, next)).toBe(false);
  });

  it('quietActivityListEqual is stable across a no-op clock tick', () => {
    const prev = [quiet({ name: '#a' }), quiet({ name: '#b', lastActivity: 9_000 })];
    const next = [quiet({ name: '#a' }), quiet({ name: '#b', lastActivity: 9_000 })];
    expect(quietActivityListEqual(prev, next)).toBe(true);
  });

  it('quietActivityListEqual flags a dropped item', () => {
    const prev = [quiet({ name: '#a' }), quiet({ name: '#b' })];
    const next = [quiet({ name: '#a' })];
    expect(quietActivityListEqual(prev, next)).toBe(false);
  });
});

describe('awayDigest stability', () => {
  const item = (over: Partial<CatchUpItem> = {}): CatchUpItem => ({
    key: `c:${(over.name ?? '#room').toLowerCase()}`,
    kind: 'channel',
    name: over.name ?? '#room',
    target: over.target ?? over.name ?? '#room',
    unread: 3,
    highlights: 0,
    followed: false,
    lastActivity: 1_000,
    ...over,
  });

  const dig = (over: Partial<AwayDigest> = {}): AwayDigest => ({
    attention: [],
    followed: [],
    quiet: [],
    totalUnread: 0,
    totalMentions: 0,
    empty: true,
    ...over,
  });

  it('catchUpItemEqual ignores name/target churn but tracks unread', () => {
    expect(catchUpItemEqual(item(), item())).toBe(true);
    expect(catchUpItemEqual(item(), item({ unread: 4 }))).toBe(false);
    expect(catchUpItemEqual(item(), item({ highlights: 1 }))).toBe(false);
  });

  it('awayDigestEqual is stable when only relative-time context would change', () => {
    const a = dig({ attention: [item({ name: '#x' })], totalUnread: 3, empty: false });
    const b = dig({ attention: [item({ name: '#x' })], totalUnread: 3, empty: false });
    expect(awayDigestEqual(a, b)).toBe(true);
  });

  it('awayDigestEqual flags a row moving tiers', () => {
    const a = dig({ attention: [item({ name: '#x' })], empty: false });
    const b = dig({ followed: [item({ name: '#x' })], empty: false });
    expect(awayDigestEqual(a, b)).toBe(false);
  });

  it('awayDigestEqual flags an unread delta', () => {
    const a = dig({ quiet: [item({ unread: 2 })], totalUnread: 2, empty: false });
    const b = dig({ quiet: [item({ unread: 5 })], totalUnread: 5, empty: false });
    expect(awayDigestEqual(a, b)).toBe(false);
  });
});
