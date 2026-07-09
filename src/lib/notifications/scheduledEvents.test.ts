import { describe, expect, test } from 'vitest';
import {
  collectScheduledEvents,
  eventCountdown,
  parseScheduledEvent,
  scheduledEventVisible,
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
