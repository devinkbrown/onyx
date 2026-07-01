import { describe, expect, it } from 'vitest';

import { parseJoinParam } from './deeplink';

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
});
