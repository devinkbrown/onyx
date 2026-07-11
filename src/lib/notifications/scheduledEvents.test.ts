// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import {
  collectScheduledEvents,
  eventCountdown,
  parseScheduledEvent,
  scheduledEventVisible,
  scheduledEventsEqual,
} from './scheduledEvents';

const channel = (name: string) => ({ name });

describe('parseScheduledEvent', () => {
  test('parses <unix>|<title>', () => {
    expect(parseScheduledEvent('1780000000|Community call')).toEqual({
      at: 1780000000,
      title: 'Community call',
    });
  });

  test('rejects malformed props', () => {
    for (const raw of ['', 'notime|', '|title', 'abc|title', '123']) {
      expect(parseScheduledEvent(raw)).toBeNull();
    }
  });
});

describe('scheduledEventsEqual', () => {
  test('two null events are equal (both "no event")', () => {
    expect(scheduledEventsEqual(null, null)).toBe(true);
  });

  test('a fresh object with identical fields is equal (defeats reference churn)', () => {
    const a = parseScheduledEvent('1780000000|Community call');
    const b = parseScheduledEvent('1780000000|Community call');
    expect(a).not.toBe(b); // distinct references, as the store selector produces
    expect(scheduledEventsEqual(a, b)).toBe(true);
  });

  test('differing time or title is not equal', () => {
    const base = { at: 1780000000, title: 'Call' };
    expect(scheduledEventsEqual(base, { at: 1780000001, title: 'Call' })).toBe(false);
    expect(scheduledEventsEqual(base, { at: 1780000000, title: 'Sync' })).toBe(false);
  });

  test('null vs set is not equal (event appearing/clearing still updates)', () => {
    const event = { at: 1780000000, title: 'Call' };
    expect(scheduledEventsEqual(null, event)).toBe(false);
    expect(scheduledEventsEqual(event, null)).toBe(false);
  });
});

describe('scheduled event timing', () => {
  test('keeps events visible until one hour after start', () => {
    const event = { at: 2000, title: 'Office hours' };
    expect(scheduledEventVisible(event, 2000 * 1000 + 59 * 60 * 1000)).toBe(true);
    expect(scheduledEventVisible(event, 2000 * 1000 + 61 * 60 * 1000)).toBe(false);
  });

  test('formats countdown labels', () => {
    expect(eventCountdown({ at: 10, title: 'Now' }, 10_000)).toBe('happening now');
    expect(eventCountdown({ at: 70, title: 'Soon' }, 10_000)).toBe('in 1 min');
    expect(eventCountdown({ at: 3 * 60 * 60, title: 'Later' }, 0)).toBe('in 3h');
    expect(eventCountdown({ at: 3 * 24 * 60 * 60, title: 'Days' }, 0)).toBe('in 3d');
  });

  test('a sub-minute future event never reads "in 0 min"', () => {
    // 20s in the future: delta > 0, so the event has NOT started (not live, no
    // Join button). Math.round(20000 / 60000) floors to 0, so the old code
    // rendered "in 0 min" — a positive countdown that reads as "now".
    expect(eventCountdown({ at: 100, title: 'Imminent' }, 80_000)).toBe('in 1 min');
    // 1ms in the future is still upcoming, not "happening now".
    expect(eventCountdown({ at: 100, title: 'Imminent' }, 99_999)).toBe('in 1 min');
    // 0 and past deltas remain "happening now".
    expect(eventCountdown({ at: 100, title: 'Imminent' }, 100_000)).toBe('happening now');
  });
});

describe('collectScheduledEvents', () => {
  test('collects visible room events and sorts live first, then soonest', () => {
    const now = 2_000_000;
    const props = new Map([
      ['#live', { 'ocean.event': `${Math.floor(now / 1000) - 30}|Live room` }],
      ['#soon', { 'ocean.event': `${Math.floor(now / 1000) + 600}|Soon room` }],
      ['#later', { 'ocean.event': `${Math.floor(now / 1000) + 3600}|Later room` }],
      ['#bad', { 'ocean.event': 'nope' }],
    ]);

    const out = collectScheduledEvents(
      [channel('#later'), channel('#bad'), channel('#soon'), channel('#live')],
      props,
      now,
    );

    expect(out.map((event) => event.channel)).toEqual(['#live', '#soon', '#later']);
    expect(out[0]?.live).toBe(true);
  });

  test('drops expired events and honors the limit', () => {
    const now = 2_000_000;
    const expired = Math.floor((now - 2 * 60 * 60 * 1000) / 1000);
    const props = new Map([
      ['#expired', { 'ocean.event': `${expired}|Old room` }],
      ['#a', { 'ocean.event': `${Math.floor(now / 1000) + 100}|A` }],
      ['#b', { 'ocean.event': `${Math.floor(now / 1000) + 200}|B` }],
    ]);

    const out = collectScheduledEvents(
      [channel('#expired'), channel('#a'), channel('#b')],
      props,
      now,
      1,
    );

    expect(out).toHaveLength(1);
    expect(out[0]?.channel).toBe('#a');
  });
});
