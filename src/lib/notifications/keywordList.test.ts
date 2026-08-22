// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { addKeyword, normalizeKeyword, removeKeyword } from './keywordList';

describe('keyword list helpers', () => {
  it('normalizes, deduplicates, and removes a short word', () => {
    expect(normalizeKeyword('  Release ')).toBe('release');
    expect(normalizeKeyword('')).toBeNull();
    expect(normalizeKeyword('bad\u0000term')).toBeNull();

    const added = addKeyword(['urgent'], '  RELEASE ');
    expect(added).toEqual(['urgent', 'release']);
    expect(addKeyword(added, 'release')).toEqual(['urgent', 'release']);
    expect(removeKeyword(added, 'Release')).toEqual(['urgent']);
  });
});
