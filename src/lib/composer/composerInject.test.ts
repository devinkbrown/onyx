// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  formatMentionInsert,
  formatQuoteInsert,
  mergeComposerInsert,
  sanitizeComposerFragment,
} from './composerInject';

describe('composerInject', () => {
  it('sanitizes control characters and bounds length', () => {
    expect(sanitizeComposerFragment('hi\u0000there\n')).toBe('hithere');
    expect(sanitizeComposerFragment('a'.repeat(500)).length).toBe(400);
  });

  it('formats multi-line quotes with attribution body', () => {
    expect(formatQuoteInsert('Alice', 'hello\nworld')).toBe('> hello\n> world\n\n');
  });

  it('formats empty quote as attribution stub', () => {
    expect(formatQuoteInsert('Bob', '  ')).toBe('> (Bob)\n\n');
  });

  it('formats @mention with trailing space', () => {
    expect(formatMentionInsert('kain')).toBe('@kain ');
  });

  it('merges append / prefix / replace', () => {
    expect(mergeComposerInsert('hi', 'there', 'append')).toEqual({
      text: 'hi there',
      caret: 8,
    });
    expect(mergeComposerInsert('body', '@x ', 'prefix')).toEqual({
      text: '@x body',
      caret: 3,
    });
    expect(mergeComposerInsert('old', 'new', 'replace')).toEqual({
      text: 'new',
      caret: 3,
    });
  });
});
