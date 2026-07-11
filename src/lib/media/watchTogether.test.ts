// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  formatWatchClock,
  parseWatchTogetherProp,
  watchTogetherStateLabel,
} from './watchTogether';

describe('watchTogether', () => {
  it('parses channel watch activity from room metadata', () => {
    const activity = parseWatchTogetherProp(
      'title=Demo%20Night;url=https%3A%2F%2Fexample.test%2Fv;host=alice;state=paused;position=90;duration=300;participants=alice,bob;handoff=bob',
    );

    expect(activity).toEqual({
      title: 'Demo Night',
      url: 'https://example.test/v',
      host: 'alice',
      state: 'paused',
      positionSeconds: 90,
      durationSeconds: 300,
      participants: ['alice', 'bob'],
      handoffTo: 'bob',
    });
    expect(watchTogetherStateLabel(activity!)).toBe('Paused 1:30');
  });

  it('formats clocks and handoff state compactly', () => {
    expect(formatWatchClock(null)).toBe('--:--');
    expect(formatWatchClock(3723)).toBe('1:02:03');
    expect(watchTogetherStateLabel({
      title: 'Clip',
      url: null,
      host: null,
      state: 'handoff',
      positionSeconds: null,
      durationSeconds: null,
      participants: [],
      handoffTo: 'bob',
    })).toBe('Handoff to bob');
  });
});
