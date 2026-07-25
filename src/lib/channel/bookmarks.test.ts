// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { isBookmarked, parseBookmarks, sortWithBookmarks, toggleBookmark } from './bookmarks';

describe('channel bookmarks', () => {
  it('toggles and sorts favorites first', () => {
    let list = toggleBookmark([], '#root');
    list = toggleBookmark(list, '#ops');
    expect(isBookmarked(list, '#Root')).toBe(true);
    list = toggleBookmark(list, '#root');
    expect(isBookmarked(list, '#root')).toBe(false);
    list = toggleBookmark([], '#ops');
    expect(sortWithBookmarks(['#z', '#ops', '#a'], list)).toEqual(['#ops', '#a', '#z']);
  });

  it('rejects hostile channel names', () => {
    expect(parseBookmarks(['evil\n', 'nope', '#ok'])).toEqual(['#ok']);
  });
});
