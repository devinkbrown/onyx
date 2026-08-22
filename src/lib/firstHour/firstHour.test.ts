// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIRST_HOUR_SEEN_KEY,
  firstHourCoachTip,
  firstHourComposerHint,
  inviteFriendsHref,
  isFirstHourSeen,
  markComposerFocused,
  markFirstHourSeen,
  peekFirstHourHandoff,
  recordFirstHourHandoff,
  resetFirstHourForTests,
  shouldFocusComposer,
  shouldShowFirstHourHomeWelcome,
  shouldSuppressGuestClaim,
} from './firstHour';

beforeEach(() => {
  resetFirstHourForTests();
});

afterEach(() => {
  resetFirstHourForTests();
});

describe('firstHour handoff', () => {
  it('records a room landing from Connect without touching a store', () => {
    recordFirstHourHandoff({ landing: 'room', channel: '#lounge', guest: true });
    expect(peekFirstHourHandoff()).toEqual({
      landing: 'room',
      channel: '#lounge',
      guest: true,
    });
  });

  it('records an empty-room Home landing', () => {
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    expect(peekFirstHourHandoff()).toEqual({
      landing: 'home',
      channel: null,
      guest: true,
    });
  });
});

describe('firstHour Home welcome', () => {
  it('shows the short welcome only on an empty connected Home', () => {
    expect(shouldShowFirstHourHomeWelcome({
      connected: true,
      hasRooms: false,
      directoryCount: 0,
      recentCount: 0,
    })).toBe(true);
  });

  it('does not invent activity when rooms or a directory already exist', () => {
    expect(shouldShowFirstHourHomeWelcome({
      connected: true,
      hasRooms: true,
      directoryCount: 0,
      recentCount: 0,
    })).toBe(false);
    expect(shouldShowFirstHourHomeWelcome({
      connected: true,
      hasRooms: false,
      directoryCount: 3,
      recentCount: 0,
    })).toBe(false);
    expect(shouldShowFirstHourHomeWelcome({
      connected: false,
      hasRooms: false,
      directoryCount: 0,
      recentCount: 0,
    })).toBe(false);
  });
});

describe('firstHour coach tips', () => {
  it('offers at most one home tip and one room tip', () => {
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    expect(firstHourCoachTip('home')).toEqual({
      id: 'home-next',
      text: 'Browse a room, start one, or invite a friend.',
    });
    expect(firstHourCoachTip('room')).toBeNull();

    recordFirstHourHandoff({ landing: 'room', channel: '#root', guest: true });
    expect(firstHourCoachTip('room')?.id).toBe('room-say-hi');
    expect(firstHourCoachTip('home')).toBeNull();
    expect(firstHourComposerHint()).toBe('Say hi — type below and press Enter.');
  });

  it('never shows tips after the local seen flag is set', () => {
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    markFirstHourSeen();
    expect(isFirstHourSeen()).toBe(true);
    expect(localStorage.getItem(FIRST_HOUR_SEEN_KEY)).toBe('1');
    expect(firstHourCoachTip('home')).toBeNull();
    expect(firstHourComposerHint()).toBeNull();
  });

  it('does not coach a signed-in return', () => {
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: false });
    expect(firstHourCoachTip('home')).toBeNull();
    expect(shouldSuppressGuestClaim()).toBe(false);
  });

  it('hides guest-claim ritual until first-hour is finished', () => {
    recordFirstHourHandoff({ landing: 'room', channel: '#general', guest: true });
    expect(shouldSuppressGuestClaim()).toBe(true);
    markFirstHourSeen();
    expect(shouldSuppressGuestClaim()).toBe(false);
  });
});

describe('firstHour composer focus', () => {
  it('focuses once when the joined room becomes active', () => {
    recordFirstHourHandoff({ landing: 'room', channel: '#General', guest: true });
    expect(shouldFocusComposer('#general')).toBe(true);
    markComposerFocused();
    expect(shouldFocusComposer('#general')).toBe(false);
  });

  it('does not focus Home or a different room', () => {
    recordFirstHourHandoff({ landing: 'home', channel: null, guest: true });
    expect(shouldFocusComposer('#lounge')).toBe(false);
    recordFirstHourHandoff({ landing: 'room', channel: '#lounge', guest: true });
    expect(shouldFocusComposer('#other')).toBe(false);
  });
});

describe('inviteFriendsHref', () => {
  it('uses the existing invite route, with a room when one is known', () => {
    expect(inviteFriendsHref(null)).toBe('/invite/');
    expect(inviteFriendsHref('#root')).toBe('/invite/?join=%23root');
  });
});
