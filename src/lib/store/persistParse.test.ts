// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  parseCounterRecord,
  parseCtcpConfig,
  parseEmojiArray,
  parseFriendArray,
  normalizeCtcpVersionReply,
  parseStringArray,
  parseStringArrayRecord,
  parseStringRecord,
  parseWatchList,
} from './persistParse';

describe('parseStringArray', () => {
  it('returns [] for null / empty input', () => {
    expect(parseStringArray(null)).toEqual([]);
    expect(parseStringArray('')).toEqual([]);
  });

  it('parses a well-formed JSON string array', () => {
    expect(parseStringArray('["alpha","beta"]')).toEqual(['alpha', 'beta']);
  });

  it('returns [] for valid JSON that is not an array (the hot-path crash guard)', () => {
    // These all JSON.parse without throwing, so the old `as string[]` cast let a
    // non-array through — then `.some()` on it threw for every incoming message.
    expect(parseStringArray('{}')).toEqual([]);
    expect(parseStringArray('"x"')).toEqual([]);
    expect(parseStringArray('5')).toEqual([]);
    expect(parseStringArray('null')).toEqual([]);
    expect(parseStringArray('true')).toEqual([]);
  });

  it('drops non-string elements from a mixed array', () => {
    expect(parseStringArray('["a",5,null,"b",{},true]')).toEqual(['a', 'b']);
  });

  it('bounds item count, individual strings, and serialized input size', () => {
    expect(parseStringArray(JSON.stringify(Array.from({ length: 300 }, (_, index) => `v${index}`))))
      .toHaveLength(256);
    expect(parseStringArray(JSON.stringify(['ok', 'x'.repeat(513), 'still-ok'])))
      .toEqual(['ok', 'still-ok']);
    expect(parseStringArray(`"${'x'.repeat(512 * 1024)}"`)).toEqual([]);
  });

  it('returns [] for malformed (non-JSON) input', () => {
    expect(parseStringArray('{not json')).toEqual([]);
    expect(parseStringArray('["unterminated"')).toEqual([]);
  });

  it('never returns a value without .some/.filter (result is always an array)', () => {
    for (const raw of [null, '', '{}', '"x"', '5', 'null', 'garbage', '[1,2,3]']) {
      const out = parseStringArray(raw);
      expect(Array.isArray(out)).toBe(true);
      // The exact call that crashed the message pipeline:
      expect(() => out.some(w => w.length > 0)).not.toThrow();
    }
  });
});

describe('parseEmojiArray', () => {
  it('returns [] for null / empty input', () => {
    expect(parseEmojiArray(null)).toEqual([]);
    expect(parseEmojiArray('')).toEqual([]);
  });

  it('parses well-formed emoji records and preserves optional addedBy', () => {
    expect(
      parseEmojiArray('[{"name":"party","url":"https://x/p.png","addedBy":"kai"},{"name":"wave","url":"https://x/w.png"}]'),
    ).toEqual([
      { name: 'party', url: 'https://x/p.png', addedBy: 'kai' },
      { name: 'wave', url: 'https://x/w.png' },
    ]);
  });

  it('returns [] for valid JSON that is not an array (the add/remove crash guard)', () => {
    // `{}` / `5` / `"x"` JSON.parse without throwing; the old `as Array<...>` cast
    // let a non-array through, so the first addCustomEmoji/removeCustomEmoji call
    // — `[...prev.filter(...)]` / `prev.filter(...)` — threw and crashed the handler.
    expect(parseEmojiArray('{}')).toEqual([]);
    expect(parseEmojiArray('"x"')).toEqual([]);
    expect(parseEmojiArray('5')).toEqual([]);
    expect(parseEmojiArray('null')).toEqual([]);
    expect(parseEmojiArray('true')).toEqual([]);
  });

  it('drops elements missing a string name or url', () => {
    expect(
      parseEmojiArray('[{"name":"ok","url":"u"},5,null,{"name":"nourl"},{"url":"noname"},{"name":2,"url":"x"},"s"]'),
    ).toEqual([{ name: 'ok', url: 'u' }]);
  });

  it('drops a non-string addedBy rather than propagating a bad shape', () => {
    expect(parseEmojiArray('[{"name":"a","url":"u","addedBy":5}]')).toEqual([{ name: 'a', url: 'u' }]);
  });

  it('bounds emoji count and rejects empty or oversized display fields', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ name: `e${index}`, url: `https://x/${index}` }));
    expect(parseEmojiArray(JSON.stringify(many))).toHaveLength(256);
    expect(parseEmojiArray(JSON.stringify([
      { name: '', url: 'https://x/empty-name' },
      { name: 'x'.repeat(65), url: 'https://x/long-name' },
      { name: 'empty-url', url: '' },
      { name: 'long-url', url: 'x'.repeat(2_049) },
      { name: 'ok', url: 'https://x/ok', addedBy: 'x'.repeat(129) },
    ]))).toEqual([{ name: 'ok', url: 'https://x/ok' }]);
  });

  it('returns [] for malformed (non-JSON) input', () => {
    expect(parseEmojiArray('{not json')).toEqual([]);
    expect(parseEmojiArray('[{"name":"a"')).toEqual([]);
  });

  it('never returns a value without .filter (result is always an array)', () => {
    for (const raw of [null, '', '{}', '"x"', '5', 'null', 'garbage', '[{"name":"a","url":"u"}]']) {
      const out = parseEmojiArray(raw);
      expect(Array.isArray(out)).toBe(true);
      // The exact call that crashed the settings handler:
      expect(() => [...out.filter(e => e.name !== 'z'), { name: 'z', url: 'u' }]).not.toThrow();
    }
  });
});

describe('parseWatchList', () => {
  it('rejects wrong roots and malformed entries', () => {
    for (const raw of [null, '', '{', '{}', 'null', '"watch"']) {
      expect(parseWatchList(raw)).toEqual([]);
    }
    expect(parseWatchList(JSON.stringify([
      null,
      7,
      { nick: '' },
      { nick: 42 },
      { nick: 'x'.repeat(129) },
      { nick: 'valid' },
    ]))).toEqual([{ nick: 'valid', online: false }]);
  });

  it('forces offline startup, validates dates, and deduplicates nicks case-insensitively', () => {
    const parsed = parseWatchList(JSON.stringify([
      { nick: 'Alice', online: true, lastSeen: '2026-07-16T01:02:03.000Z' },
      { nick: 'alice', online: true, lastSeen: '2026-07-17T01:02:03.000Z' },
      { nick: 'Bob', online: true, lastSeen: 'not-a-date' },
    ]));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      nick: 'Alice',
      online: false,
      lastSeen: new Date('2026-07-16T01:02:03.000Z'),
    });
    expect(parsed[1]).toEqual({ nick: 'Bob', online: false });
  });

  it('bounds restored watch entries and serialized size', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ nick: `nick-${index}`, online: true }));
    expect(parseWatchList(JSON.stringify(many))).toHaveLength(256);
    expect(parseWatchList(`"${'x'.repeat(512 * 1024)}"`)).toEqual([]);
  });
});

describe('bounded record parsers', () => {
  it('retains only bounded string entries from a plain record', () => {
    const parsed = parseStringRecord(JSON.stringify({
      '#valid': 'mentions',
      '#number': 7,
      '#oversized': 'x'.repeat(2_049),
      '': 'empty key',
      constructor: 'unsafe key',
    }));

    expect(parsed).toEqual({ '#valid': 'mentions' });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parseStringRecord('[]')).toEqual({});
    expect(parseStringRecord(`"${'x'.repeat(512 * 1024)}"`)).toEqual({});
  });

  it('accepts only non-negative safe integer counters', () => {
    expect(parseCounterRecord(JSON.stringify({
      wave: 4,
      string: '9',
      negative: -1,
      decimal: 1.5,
      unsafe: Number.MAX_SAFE_INTEGER + 1,
    }))).toEqual({ wave: 4 });
    expect(parseCounterRecord('null')).toEqual({});
  });

  it('filters nested string arrays and bounds each history', () => {
    const parsed = parseStringArrayRecord(JSON.stringify({
      '#valid': ['one', 2, 'two', 'x'.repeat(513)],
      '#wrong': 'not an array',
      '#many': Array.from({ length: 40 }, (_, index) => `topic-${index}`),
    }));

    expect(parsed['#valid']).toEqual(['one', 'two']);
    expect(parsed['#wrong']).toBeUndefined();
    expect(parsed['#many']).toHaveLength(32);
    expect(parseStringArrayRecord('{}')).toEqual({});
  });

  it('bounds record entry counts while preserving valid siblings', () => {
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key-${index}`, `value-${index}`]));
    expect(Object.keys(parseStringRecord(JSON.stringify(many)))).toHaveLength(256);

    const mixed = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [
      `key-${index}`,
      index % 2 === 0 ? `value-${index}` : index,
    ]));
    expect(Object.keys(parseStringRecord(JSON.stringify(mixed)))).toHaveLength(150);
  });
});

describe('structured persisted preferences', () => {
  it('recovers valid friends, resets duplicates, and bounds fields', () => {
    expect(parseFriendArray(JSON.stringify([
      { nick: 'Alice', note: 'met at #onyx', online: true },
      { nick: 'alice', note: 'duplicate' },
      { nick: 'Bob', note: 7 },
      { nick: '' },
      { nick: 'x'.repeat(129) },
      null,
    ]))).toEqual([
      { nick: 'Alice', note: 'met at #onyx' },
      { nick: 'Bob' },
    ]);
    expect(parseFriendArray('{}')).toEqual([]);
  });

  it('normalizes CTCP configuration without trusting valid JSON shape', () => {
    expect(parseCtcpConfig(JSON.stringify({
      versionReply: 'Custom\r\n\0\x01Reply',
      timeEnabled: false,
    }))).toEqual({ versionReply: 'CustomReply', timeEnabled: false });
    expect(parseCtcpConfig(JSON.stringify({ versionReply: 7, timeEnabled: 'yes' }))).toEqual({
      versionReply: 'Onyx IRC Client',
      timeEnabled: true,
    });
    expect(parseCtcpConfig('[]')).toEqual({
      versionReply: 'Onyx IRC Client',
      timeEnabled: true,
    });
    expect(normalizeCtcpVersionReply('x'.repeat(300))).toHaveLength(256);
  });
});
