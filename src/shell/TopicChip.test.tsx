// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopicFilterBar } from './TopicChip';

afterEach(cleanup);

describe('TopicFilterBar', () => {
  it('exposes topic filters as a labelled group of toggle buttons', () => {
    const onSelect = vi.fn();
    render(() => (
      <TopicFilterBar
        topics={['release']}
        active="release"
        unreadCounts={new Map([['release', 2]])}
        onSelect={onSelect}
      />
    ));

    const group = screen.getByRole('group', { name: 'Topic filters' });
    const all = screen.getByRole('button', { name: 'All' });
    const release = screen.getByRole('button', { name: /release/i });

    expect(group.getAttribute('role')).toBe('group');
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(release.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(all);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('matches the active topic case-insensitively like message filtering', () => {
    render(() => (
      <TopicFilterBar
        topics={['RoadMap']}
        active="roadmap"
        onSelect={() => undefined}
      />
    ));

    expect(screen.getByRole('button', { name: /RoadMap/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
