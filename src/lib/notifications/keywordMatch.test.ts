// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { keywordTokens, matchesAnyKeyword, matchesKeyword } from './keywordMatch';

describe('exact-token keyword matching', () => {
  it('matches an exact token regardless of case or trailing punctuation', () => {
    expect(matchesKeyword('URGENT deployment status', 'urgent')).toBe(true);
    expect(matchesKeyword('ping: urgent!', 'Urgent')).toBe(true);
    expect(matchesKeyword('the cat sat', 'cat')).toBe(true);
    expect(keywordTokens('on-call tonight')).toEqual(['on', 'call', 'tonight']);
    expect(matchesKeyword('on-call tonight', 'on-call')).toBe(true);
  });

  it('does not match a substring inside a longer token', () => {
    expect(matchesKeyword('category planning', 'cat')).toBe(false);
    expect(matchesKeyword('concatenate the logs', 'cat')).toBe(false);
    expect(matchesKeyword('urgently shipping', 'urgent')).toBe(false);
    expect(matchesAnyKeyword('prerelease notes', ['release'])).toBe(false);
  });

  it('matches a short phrase as consecutive tokens, not a loose substring', () => {
    expect(matchesKeyword('please review the incident term now', 'incident term')).toBe(true);
    expect(matchesKeyword('incident terminal is down', 'incident term')).toBe(false);
    expect(matchesAnyKeyword('plain hallway chatter', ['urgent', 'release'])).toBe(false);
  });
});
