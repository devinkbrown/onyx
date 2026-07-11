// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMomentLink, parseAtParam, parseEventTime, parseJoinParam, parseReaderParam, parseTopicParam } from './deeplink';

const FIXED_NOW = new Date('2026-07-08T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const YEARISH_MS = 366 * DAY_MS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseJoinParam', () => {
  it('accepts a plain #channel', () => {
    expect(parseJoinParam('#root')).toBe('#root');
  });

  it('decodes a percent-encoded channel (%23 → #)', () => {
    expect(parseJoinParam('%23root')).toBe('#root');
  });

  it('accepts unicode and symbol-heavy channel names', () => {
    expect(parseJoinParam('#dev-ops.chat')).toBe('#dev-ops.chat');
    expect(parseJoinParam('%23caf%C3%A9')).toBe('#café');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(parseJoinParam(' %23root ')).toBe('#root');
  });

  it('takes the first value when the router surfaces an array', () => {
    expect(parseJoinParam(['#first', '#second'])).toBe('#first');
  });

  it('rejects a missing or empty value', () => {
    expect(parseJoinParam(null)).toBeNull();
    expect(parseJoinParam(undefined)).toBeNull();
    expect(parseJoinParam('')).toBeNull();
    expect(parseJoinParam([])).toBeNull();
  });

  it('rejects names without the # sigil', () => {
    expect(parseJoinParam('root')).toBeNull();
  });

  it('rejects a bare #', () => {
    expect(parseJoinParam('#')).toBeNull();
    expect(parseJoinParam('%23')).toBeNull();
  });

  it('rejects names longer than 63 chars after the #', () => {
    expect(parseJoinParam(`#${'a'.repeat(63)}`)).toBe(`#${'a'.repeat(63)}`);
    expect(parseJoinParam(`#${'a'.repeat(64)}`)).toBeNull();
  });

  it('rejects oversized encoded names after decoding', () => {
    expect(parseJoinParam(`%23${'x'.repeat(64)}`)).toBeNull();
  });

  it('rejects interior whitespace, commas and \\x07', () => {
    expect(parseJoinParam('#two words')).toBeNull();
    expect(parseJoinParam('%23two%20words')).toBeNull();
    expect(parseJoinParam('#a,b')).toBeNull();
    expect(parseJoinParam('#a\x07b')).toBeNull();
    expect(parseJoinParam('#tab\tname')).toBeNull();
  });

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(parseJoinParam('%23bad%')).toBeNull();
    expect(parseJoinParam('%E0%A4%A')).toBeNull();
  });

  it('rejects NUL and other C0/DEL control chars forbidden in IRC channel names', () => {
    // NUL can truncate/corrupt the downstream JOIN — it must never survive validation.
    expect(parseJoinParam('#foo\x00bar')).toBeNull();
    expect(parseJoinParam('%23foo%00bar')).toBeNull();
    expect(parseJoinParam('#foo\x01bar')).toBeNull();
    expect(parseJoinParam('#foo\x08bar')).toBeNull(); // backspace
    expect(parseJoinParam('#foo\x1bbar')).toBeNull(); // ESC
    expect(parseJoinParam('#foo\x7fbar')).toBeNull(); // DEL
  });
});

describe('parseAtParam', () => {
  it('accepts epoch seconds', () => {
    const at = parseAtParam('1751000000');
    expect(at?.getTime()).toBe(1_751_000_000_000);
  });

  it('accepts epoch milliseconds', () => {
    const at = parseAtParam('1751000000000');
    expect(at?.getTime()).toBe(1_751_000_000_000);
  });

  it('accepts an ISO-8601 datetime (encoded or plain)', () => {
    expect(parseAtParam('2026-06-30T12:00:00Z')?.toISOString()).toBe('2026-06-30T12:00:00.000Z');
    expect(parseAtParam('2026-06-30T12%3A00%3A00Z')?.toISOString()).toBe('2026-06-30T12:00:00.000Z');
  });

  it('accepts a bare ISO date', () => {
    expect(parseAtParam('2026-06-30')).toBeInstanceOf(Date);
  });

  it('accepts the exact future-slack boundary', () => {
    const at = parseAtParam(String(FIXED_NOW.getTime() + DAY_MS));

    expect(at?.toISOString()).toBe('2026-07-09T12:00:00.000Z');
  });

  it('takes the first value when the router surfaces an array', () => {
    expect(parseAtParam(['1751000000', '9'])?.getTime()).toBe(1_751_000_000_000);
  });

  it('rejects missing, empty and malformed values', () => {
    expect(parseAtParam(null)).toBeNull();
    expect(parseAtParam(undefined)).toBeNull();
    expect(parseAtParam('')).toBeNull();
    expect(parseAtParam('yesterday')).toBeNull();
    expect(parseAtParam('%E0%A4%A')).toBeNull();
    expect(parseAtParam('999999999999999')).toBeNull();
  });

  it('rejects instants before 2020 and far-future instants', () => {
    expect(parseAtParam('2019-12-31T23:59:59Z')).toBeNull();
    expect(parseAtParam('946684800')).toBeNull(); // 2000-01-01 epoch s
    expect(parseAtParam(String(FIXED_NOW.getTime() + 3 * DAY_MS))).toBeNull();
  });
});

describe('parseTopicParam', () => {
  it('accepts trimmed named-conversation labels', () => {
    expect(parseTopicParam(' release train ')).toBe('release train');
    expect(parseTopicParam('release%20train')).toBe('release train');
  });

  it('rejects empty, comma-separated, control, and oversized labels', () => {
    expect(parseTopicParam('')).toBeNull();
    expect(parseTopicParam('a,b')).toBeNull();
    expect(parseTopicParam('bad%0Aline')).toBeNull();
    expect(parseTopicParam('x'.repeat(51))).toBeNull();
  });

  it('enforces the topic byte limit after decoding', () => {
    expect(parseTopicParam('é'.repeat(25))).toBe('é'.repeat(25));
    expect(parseTopicParam('é'.repeat(26))).toBeNull();
    expect(parseTopicParam('%C3%A9'.repeat(26))).toBeNull();
  });
});

describe('parseReaderParam', () => {
  it('accepts explicit reader flags', () => {
    expect(parseReaderParam('1')).toBe(true);
    expect(parseReaderParam('true')).toBe(true);
    expect(parseReaderParam('reader')).toBe(true);
    expect(parseReaderParam(' READER ')).toBe(true);
  });

  it('ignores absent or falsey reader flags', () => {
    expect(parseReaderParam(null)).toBe(false);
    expect(parseReaderParam('0')).toBe(false);
    expect(parseReaderParam('false')).toBe(false);
  });

  it('uses the first repeated reader flag value', () => {
    expect(parseReaderParam(['reader', '0'])).toBe(true);
    expect(parseReaderParam(['0', 'reader'])).toBe(false);
  });
});

describe('buildMomentLink', () => {
  it('builds the canonical app time-travel URL for a channel moment', () => {
    expect(
      buildMomentLink(
        '#root',
        new Date('2026-07-08T18:30:00.000Z'),
        'https://onyx.example/stats?from=old#pulse',
      ),
    ).toBe('https://onyx.example/app?join=%23root&at=2026-07-08T18%3A30%3A00.000Z');
  });

  it('round-trips the channel and moment through URL search params', () => {
    const moment = new Date('2026-07-08T18:30:00.000Z');
    const link = buildMomentLink('#ops-room', moment, 'https://onyx.example/app?utm=drop');
    const params = new URL(link).searchParams;

    expect(parseJoinParam(params.get('join'))).toBe('#ops-room');
    expect(parseAtParam(params.get('at'))?.toISOString()).toBe(moment.toISOString());
  });

  it('tolerates unknown query params beside join and at', () => {
    const params = new URLSearchParams('utm_source=newsletter&join=%23root&ignored=%25&at=2026-06-30T12%3A00%3A00Z');

    expect(parseJoinParam(params.get('join'))).toBe('#root');
    expect(parseAtParam(params.get('at'))?.toISOString()).toBe('2026-06-30T12:00:00.000Z');
  });
});

describe('parseEventTime', () => {
  it('accepts a near-future ISO time and epoch seconds', () => {
    const iso = new Date(FIXED_NOW.getTime() + 3 * DAY_MS).toISOString();
    expect(parseEventTime(iso)?.toISOString()).toBe(iso);
    const sec = Math.floor(FIXED_NOW.getTime() / 1000) + 3600;
    expect(parseEventTime(String(sec))?.getTime()).toBe(sec * 1000);
  });

  it('accepts exact scheduling window boundaries', () => {
    const skewBoundary = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000);
    const maxFuture = new Date(FIXED_NOW.getTime() + YEARISH_MS);

    expect(parseEventTime(skewBoundary.toISOString())?.toISOString()).toBe(skewBoundary.toISOString());
    expect(parseEventTime(maxFuture.toISOString())?.toISOString()).toBe(maxFuture.toISOString());
  });

  it('rejects past instants and moments over a year out', () => {
    expect(parseEventTime('2000-01-01T00:00:00Z')).toBeNull();
    const twoYears = new Date(FIXED_NOW.getTime() + 2 * YEARISH_MS).toISOString();
    expect(parseEventTime(twoYears)).toBeNull();
  });

  it('rejects empty and malformed input', () => {
    expect(parseEventTime('')).toBeNull();
    expect(parseEventTime(null)).toBeNull();
    expect(parseEventTime('someday')).toBeNull();
  });
});
