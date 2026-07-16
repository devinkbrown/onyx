// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  formatWatchClock,
  parseWatchTogetherProp,
  WATCH_NICK_MAX_LENGTH,
  WATCH_PARTICIPANT_MAX_COUNT,
  WATCH_PROP_MAX_LENGTH,
  WATCH_SECONDS_MAX,
  WATCH_TITLE_MAX_LENGTH,
  WATCH_URL_MAX_LENGTH,
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

  it('rejects oversized room metadata before parsing it', () => {
    expect(parseWatchTogetherProp(`title=${'x'.repeat(WATCH_PROP_MAX_LENGTH)}`)).toBeNull();
  });

  it('bounds display fields, clocks, and a case-insensitive participant roster', () => {
    const longParticipant = `person-${'n'.repeat(WATCH_NICK_MAX_LENGTH)}`;
    const participants = [longParticipant, longParticipant.toUpperCase()];
    participants.push(...Array.from(
      { length: WATCH_PARTICIPANT_MAX_COUNT + 20 },
      (_, index) => `p-${index}`,
    ));
    const activity = parseWatchTogetherProp(new URLSearchParams({
      title: 't'.repeat(WATCH_TITLE_MAX_LENGTH + 20),
      url: `https://example.test/${'u'.repeat(WATCH_URL_MAX_LENGTH + 20)}`,
      host: 'h'.repeat(WATCH_NICK_MAX_LENGTH + 20),
      handoff: 'b'.repeat(WATCH_NICK_MAX_LENGTH + 20),
      position: String(WATCH_SECONDS_MAX + 1),
      duration: String(WATCH_SECONDS_MAX + 1),
      participants: participants.join(','),
    }).toString());

    expect(activity).not.toBeNull();
    expect(activity?.title).toHaveLength(WATCH_TITLE_MAX_LENGTH);
    expect(activity?.url).toHaveLength(WATCH_URL_MAX_LENGTH);
    expect(activity?.host).toHaveLength(WATCH_NICK_MAX_LENGTH);
    expect(activity?.handoffTo).toHaveLength(WATCH_NICK_MAX_LENGTH);
    expect(activity?.positionSeconds).toBeNull();
    expect(activity?.durationSeconds).toBeNull();
    expect(activity?.participants).toHaveLength(WATCH_PARTICIPANT_MAX_COUNT);
    expect(activity?.participants[0]).toHaveLength(WATCH_NICK_MAX_LENGTH);
    expect(activity?.participants[1]?.toLowerCase()).not.toBe(activity?.participants[0]?.toLowerCase());
  });
});
