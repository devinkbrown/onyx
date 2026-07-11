// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { truncateEnd, truncateMiddle } from './truncateMiddle';

const hasLoneSurrogate = (value: string) => {
  for (let i = 0; i < value.length; i++) {
    const codeUnit = value.charCodeAt(i);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(i + 1);
      if (Number.isNaN(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true;
      }
      i += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
};

describe('truncateMiddle', () => {
  it('returns short strings without truncating', () => {
    expect(truncateMiddle('short nick', 20)).toBe('short nick');
  });

  it('keeps the head and tail with an ellipsis within max', () => {
    const result = truncateMiddle('https://example.com/channels/ocean/general', 18);

    expect(result.startsWith('https://')).toBe(true);
    expect(result.endsWith('/general')).toBe(true);
    expect(result).toContain('…');
    expect(result.length).toBeLessThanOrEqual(18);
  });

  it('returns an empty string when max is non-positive', () => {
    expect(truncateMiddle('anything', 0)).toBe('');
    expect(truncateMiddle('anything', -4)).toBe('');
  });

  it('returns an empty string unchanged', () => {
    expect(truncateMiddle('', 8)).toBe('');
  });

  it('returns exact-boundary strings unchanged', () => {
    expect(truncateMiddle('boundary', 8)).toBe('boundary');
  });

  it('keeps exact-fit unicode strings unchanged', () => {
    expect(truncateMiddle('ab😀', 4)).toBe('ab😀');
    expect(truncateMiddle('e\u0301x', 3)).toBe('e\u0301x');
  });

  it('does not split a surrogate-pair emoji', () => {
    const result = truncateMiddle('ab😀cd', 4);

    expect(result).toContain('…');
    expect(result.length).toBeLessThanOrEqual(4);
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('keeps zero-width-joiner emoji sequences whole', () => {
    const result = truncateMiddle('ab👩‍💻cd', 6);

    expect(result).toBe('ab…cd');
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('keeps combining marks with their base character', () => {
    const result = truncateMiddle('Cafe\u0301Runner', 8);

    expect(result).toBe('Caf…nner');
    expect(result).not.toContain('\u0301');
  });

  it('keeps surrogate pairs intact when both retained sides contain emoji', () => {
    const result = truncateMiddle('😀alpha😃omega😄', 7);

    expect(result).toBe('😀a…a😄');
    expect(result.length).toBeLessThanOrEqual(7);
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('drops an oversized emoji cluster instead of splitting it into the budget', () => {
    const result = truncateMiddle('ab👍🏽cd', 6);

    expect(result).toBe('ab…cd');
    expect(result).not.toContain('👍');
    expect(result).not.toContain('🏽');
    expect(hasLoneSurrogate(result)).toBe(false);
  });
});

describe('truncateEnd', () => {
  it('truncates the end with an ellipsis within max', () => {
    const result = truncateEnd('very-long-channel-name', 10);

    expect(result).toBe('very-long…');
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('handles very short max values', () => {
    expect(truncateEnd('abc', 1)).toBe('…');
    expect(truncateEnd('abc', 2)).toBe('a…');
  });

  it('returns an empty string when max is non-positive', () => {
    expect(truncateEnd('anything', 0)).toBe('');
    expect(truncateEnd('anything', -4)).toBe('');
  });

  it('returns an empty string unchanged', () => {
    expect(truncateEnd('', 8)).toBe('');
  });

  it('does not split a surrogate-pair emoji', () => {
    const result = truncateEnd('ab😀cd', 4);

    expect(result).toBe('ab…');
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('keeps emoji modifiers attached when they fit before the ellipsis', () => {
    const result = truncateEnd('👍🏽done', 5);

    expect(result).toBe('👍🏽…');
    expect(result.length).toBeLessThanOrEqual(5);
    expect(hasLoneSurrogate(result)).toBe(false);
  });
});
