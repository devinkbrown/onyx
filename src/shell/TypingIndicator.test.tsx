import { describe, expect, it } from 'vitest';
import { formatTypingLabel } from './TypingIndicator';

describe('formatTypingLabel', () => {
  it('returns empty string for no typers', () => {
    expect(formatTypingLabel([])).toBe('');
  });

  it('formats a single typer', () => {
    expect(formatTypingLabel(['aurora'])).toBe('aurora is typing');
  });

  it('formats two typers with "and"', () => {
    expect(formatTypingLabel(['aurora', 'vesper'])).toBe('aurora and vesper are typing');
  });

  it('formats three typers as a list', () => {
    expect(formatTypingLabel(['aurora', 'vesper', 'moss'])).toBe('aurora, vesper and moss are typing');
  });

  it('collapses four or more into "Several people"', () => {
    expect(formatTypingLabel(['a', 'b', 'c', 'd'])).toBe('Several people are typing');
    expect(formatTypingLabel(['a', 'b', 'c', 'd', 'e'])).toBe('Several people are typing');
  });
});
