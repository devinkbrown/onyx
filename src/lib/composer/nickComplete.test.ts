// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  applyNickCompletion,
  cycleNickCompletion,
  nickTokenAt,
  rankNickCompletions,
} from './nickComplete';

describe('nickComplete', () => {
  it('extracts a bare nick token before the caret', () => {
    expect(nickTokenAt('hey al', 6)).toEqual({
      start: 4,
      end: 6,
      at: false,
      query: 'al',
    });
  });

  it('extracts an @-mention token', () => {
    expect(nickTokenAt('hi @Ka', 6)).toEqual({
      start: 3,
      end: 6,
      at: true,
      query: 'Ka',
    });
  });

  it('does not steal slash-command completion', () => {
    expect(nickTokenAt('/jo', 3)).toBeNull();
  });

  it('ranks prefix matches with case-sensitive preference then shorter nicks', () => {
    expect(rankNickCompletions('al', ['alice', 'AL', 'bob', 'Alex'])).toEqual([
      'alice', // case-sensitive prefix of "al"
      'AL',
      'Alex',
    ]);
  });

  it('applies completion with trailing space and @', () => {
    expect(applyNickCompletion('hi @Ka', {
      start: 3,
      end: 6,
      at: true,
      query: 'Ka',
    }, 'kain')).toEqual({
      text: 'hi @kain ',
      caret: 9,
    });
  });

  it('cycles through matches on repeated Tab', () => {
    const nicks = ['alice', 'alex', 'albert'];
    const first = cycleNickCompletion('al', 2, nicks, -1);
    expect(first?.matches[0]).toBe('alex'); // shortest among case-sensitive "al*"
    expect(first?.text).toBe('alex ');
    const again = cycleNickCompletion('al', 2, nicks, first!.index);
    expect(again?.text).toBe('alice ');
    expect(again?.index).toBe(1);
  });
});
