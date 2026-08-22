// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';

import {
  NOTIFY_FIRST_RUN_ACTIVITY_KEY,
  NOTIFY_FIRST_RUN_DISMISS_KEY,
  conversationHasRealActivity,
  dismissNotifyAsk,
  hasNotifyActivity,
  inboxHasRealActivity,
  isNotifyAskDismissed,
  isRealConversationMessage,
  markNotifyActivity,
  resetFirstRunNotifyState,
  shouldOfferFirstRunNotify,
  stateHasRealConversationActivity,
} from './firstRunNotify';

function message(type: ChatMessage['type']): Pick<ChatMessage, 'type'> {
  return { type };
}

describe('first-run notify decision', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFirstRunNotifyState();
  });

  afterEach(() => {
    resetFirstRunNotifyState();
    localStorage.clear();
  });

  it('treats chat, action, and whisper as real activity — not join or system', () => {
    expect(isRealConversationMessage(message('msg'))).toBe(true);
    expect(isRealConversationMessage(message('action'))).toBe(true);
    expect(isRealConversationMessage(message('whisper'))).toBe(true);
    expect(isRealConversationMessage(message('join'))).toBe(false);
    expect(isRealConversationMessage(message('part'))).toBe(false);
    expect(isRealConversationMessage(message('system'))).toBe(false);
    expect(isRealConversationMessage(message('topic'))).toBe(false);
    expect(conversationHasRealActivity([message('join'), message('msg')])).toBe(true);
    expect(conversationHasRealActivity([message('join'), message('part')])).toBe(false);
  });

  it('treats mention and DM inbox rows as received activity', () => {
    expect(inboxHasRealActivity([{ type: 'system' }])).toBe(false);
    expect(inboxHasRealActivity([{ type: 'mention' }])).toBe(true);
    expect(inboxHasRealActivity([{ type: 'dm' }])).toBe(true);
  });

  it('finds real activity across rooms, DMs, or the inbox', () => {
    expect(stateHasRealConversationActivity({
      channels: new Map([['#room', { messages: [message('join')] }]]),
      dms: new Map(),
      notifications: [],
    })).toBe(false);

    expect(stateHasRealConversationActivity({
      channels: new Map([['#room', { messages: [message('msg')] }]]),
      dms: new Map(),
      notifications: [],
    })).toBe(true);

    expect(stateHasRealConversationActivity({
      channels: new Map(),
      dms: new Map([['bob', { messages: [message('msg')] }]]),
      notifications: [],
    })).toBe(true);

    expect(stateHasRealConversationActivity({
      channels: new Map(),
      dms: new Map(),
      notifications: [{ type: 'mention' }],
    })).toBe(true);
  });

  it('offers the quiet ask only after real activity, once, when permission is still default', () => {
    const base = {
      activity: true,
      dismissed: false,
      permission: 'default' as const,
      surface: 'browser' as const,
      hostNotifications: false,
    };
    expect(shouldOfferFirstRunNotify(base)).toBe(true);
    expect(shouldOfferFirstRunNotify({ ...base, activity: false })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldOfferFirstRunNotify({ ...base, permission: 'unsupported' })).toBe(false);
  });

  it('does not ask on the Zig host when native notifications are false', () => {
    expect(shouldOfferFirstRunNotify({
      activity: true,
      dismissed: false,
      permission: 'default',
      surface: 'zig-desktop',
      hostNotifications: false,
    })).toBe(false);
    expect(shouldOfferFirstRunNotify({
      activity: true,
      dismissed: false,
      permission: 'default',
      surface: 'zig-desktop',
      hostNotifications: true,
    })).toBe(true);
  });

  it('persists activity and dismiss under onyx: keys', () => {
    expect(hasNotifyActivity()).toBe(false);
    expect(isNotifyAskDismissed()).toBe(false);

    markNotifyActivity();
    dismissNotifyAsk();

    expect(hasNotifyActivity()).toBe(true);
    expect(isNotifyAskDismissed()).toBe(true);
    expect(localStorage.getItem(NOTIFY_FIRST_RUN_ACTIVITY_KEY)).toBe('1');
    expect(localStorage.getItem(NOTIFY_FIRST_RUN_DISMISS_KEY)).toBe('1');

    markNotifyActivity();
    dismissNotifyAsk();
    expect(localStorage.getItem(NOTIFY_FIRST_RUN_ACTIVITY_KEY)).toBe('1');
  });
});
