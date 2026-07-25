// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  assignChannel,
  createCategory,
  emptyCategoryState,
  groupChannels,
  parseCategoryState,
  unassignChannel,
} from './categories';

describe('channel categories (C5)', () => {
  it('creates, assigns, and groups channels', () => {
    let state = emptyCategoryState();
    state = createCategory(state, 'Work', 'work')!;
    state = assignChannel(state, 'work', '#ops')!;
    state = assignChannel(state, 'work', '#root')!;
    const groups = groupChannels(state, ['#root', '#lounge', '#ops']);
    expect(groups[0]?.category?.name).toBe('Work');
    expect(groups[0]?.channels).toEqual(['#ops', '#root']);
    expect(groups[1]?.category).toBeNull();
    expect(groups[1]?.channels).toEqual(['#lounge']);
  });

  it('rejects control characters and moves channel between folders', () => {
    let state = createCategory(emptyCategoryState(), 'A', 'a')!;
    state = createCategory(state, 'B', 'b')!;
    expect(createCategory(state, 'bad\nname')).toBeNull();
    state = assignChannel(state, 'a', '#x')!;
    state = assignChannel(state, 'b', '#x')!;
    expect(state.categories.find((c) => c.id === 'a')?.channels).toEqual([]);
    expect(state.categories.find((c) => c.id === 'b')?.channels).toEqual(['#x']);
    state = unassignChannel(state, '#x');
    expect(state.categories.every((c) => c.channels.length === 0)).toBe(true);
  });

  it('parses hostile input fail-closed', () => {
    expect(parseCategoryState(null).categories).toEqual([]);
    expect(parseCategoryState({ categories: [{ id: 'x', name: 'ok', channels: ['nope'] }] }).categories[0]?.channels).toEqual([]);
  });
});
