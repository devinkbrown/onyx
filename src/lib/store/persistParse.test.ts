import { describe, it, expect } from 'vitest';
import { parseStringArray } from './persistParse';

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
