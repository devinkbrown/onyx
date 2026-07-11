// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseStringArray, parseEmojiArray } from './persistParse';

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
