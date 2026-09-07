// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopicFilterBar } from './TopicChip';
import { TopicChip } from './TopicChip';

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

  it('names split controls with the topic they affect', () => {
    const onSplit = vi.fn();
    render(() => <TopicChip label="release" onSplit={onSplit} />);
    const split = screen.getByRole('button', { name: 'Split into topic release' });
    expect(split).toHaveAttribute('title', 'Split into topic release');
    fireEvent.click(split);
    expect(onSplit).toHaveBeenCalledWith('release');
  });

  it('renders unavailable topics as clearly named, non-actionable states', () => {
    const onClick = vi.fn();
    render(() => <TopicChip label="archive" state="deleted" onClick={onClick} />);

    expect(screen.getByLabelText('archive, deleted')).toHaveTextContent('Deleted');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks loading topics busy and keeps long labels discoverable', () => {
    const label = 'a-topic-with-a-deliberately-long-label-for-small-screens';
    render(() => <TopicChip label={label} state="loading" />);
    const chip = screen.getByLabelText(`${label}, loading`);

    expect(chip).toHaveAttribute('aria-busy', 'true');
    expect(chip).toHaveAttribute('title', label);
  });
});
