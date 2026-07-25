// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { formatAttentionTitle } from './AttentionTitleRuntime';

describe('formatAttentionTitle', () => {
  it('returns the base title with no attention', () => {
    expect(formatAttentionTitle(0)).toBe('Onyx');
    expect(formatAttentionTitle(-1)).toBe('Onyx');
  });

  it('prefixes a bounded mention count', () => {
    expect(formatAttentionTitle(3)).toBe('(3) Onyx');
    expect(formatAttentionTitle(1500)).toBe('(999) Onyx');
  });
});
