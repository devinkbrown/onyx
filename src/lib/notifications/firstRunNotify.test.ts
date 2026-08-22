// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIRST_RUN_NOTIFY_LEDE,
  FIRST_RUN_NOTIFY_TITLE,
  NOTIFY_FIRST_RUN_DISMISS_KEY,
  NOTIFY_FIRST_SEND_KEY,
  canClaimClosedTabPush,
  dismissNotifyAsk,
  firstRunNotifyCopy,
  hasNotifyFirstSend,
  isNotifyAskDismissed,
  markNotifyFirstSend,
  readNavigatorStandalone,
  resetFirstRunNotifyState,
  shouldOfferFirstRunNotify,
} from './firstRunNotify';

describe('first-run notify decision', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFirstRunNotifyState();
  });

  afterEach(() => {
    resetFirstRunNotifyState();
    localStorage.clear();
  });

  it('does not offer on first paint — no send yet', () => {
    const base = {
      sent: false,
      dismissed: false,
      permission: 'default' as const,
      surface: 'browser' as const,
      hostNotifications: false,
    };
    expect(shouldOfferFirstRunNotify(base)).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, sent: true })).toBe(true);
  });

  it('offers only after a send, once, when permission is still default', () => {
    const base = {
      sent: true,
      dismissed: false,
      permission: 'default' as const,
      surface: 'browser' as const,
      hostNotifications: false,
    };
    expect(shouldOfferFirstRunNotify(base)).toBe(true);
    expect(shouldOfferFirstRunNotify({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'unsupported' })).toBe(false);
  });

  it('does not ask on the Zig host when native notifications are false', () => {
    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'zig-desktop',
      hostNotifications: false,
    })).toBe(false);
    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'zig-desktop',
      hostNotifications: true,
    })).toBe(true);
  });

  it('iOS tab does not claim push; Home Screen standalone may', () => {
    expect(canClaimClosedTabPush(false)).toBe(false);
    expect(canClaimClosedTabPush(true)).toBe(true);
    expect(canClaimClosedTabPush(undefined)).toBe(true);
    expect(canClaimClosedTabPush(null)).toBe(true);

    expect(firstRunNotifyCopy(false)).toBeNull();
    expect(firstRunNotifyCopy(true)).toEqual({
      title: FIRST_RUN_NOTIFY_TITLE,
      lede: FIRST_RUN_NOTIFY_LEDE,
    });
    expect(firstRunNotifyCopy(undefined)).toEqual({
      title: FIRST_RUN_NOTIFY_TITLE,
      lede: FIRST_RUN_NOTIFY_LEDE,
    });

    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'browser',
      hostNotifications: false,
      navigatorStandalone: false,
    })).toBe(false);
    expect(shouldOfferFirstRunNotify({
      sent: true,
      dismissed: false,
      permission: 'default',
      surface: 'pwa',
      hostNotifications: false,
      navigatorStandalone: true,
    })).toBe(true);

    expect(readNavigatorStandalone({ standalone: false })).toBe(false);
    expect(readNavigatorStandalone({ standalone: true })).toBe(true);
    expect(readNavigatorStandalone({})).toBeUndefined();
  });

  it('persists first send and dismiss under onyx: keys', () => {
    expect(hasNotifyFirstSend()).toBe(false);
    expect(isNotifyAskDismissed()).toBe(false);

    markNotifyFirstSend();
    dismissNotifyAsk();

    expect(hasNotifyFirstSend()).toBe(true);
    expect(isNotifyAskDismissed()).toBe(true);
    expect(localStorage.getItem(NOTIFY_FIRST_SEND_KEY)).toBe('1');
    expect(localStorage.getItem(NOTIFY_FIRST_RUN_DISMISS_KEY)).toBe('1');

    markNotifyFirstSend();
    dismissNotifyAsk();
    expect(localStorage.getItem(NOTIFY_FIRST_SEND_KEY)).toBe('1');
  });

  it('dismissed stays dismissed', () => {
    markNotifyFirstSend();
    dismissNotifyAsk();
    expect(shouldOfferFirstRunNotify({
      sent: hasNotifyFirstSend(),
      dismissed: isNotifyAskDismissed(),
      permission: 'default',
      surface: 'browser',
      hostNotifications: false,
    })).toBe(false);
  });
});
