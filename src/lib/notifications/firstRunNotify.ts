// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * firstRunNotify.ts — one quiet closed-tab permission ask after real chat.
 *
 * The browser prompt is never a wall on Connect. Offer it once after a real
 * send or receive (or from You → Notifications). Persist activity and dismiss
 * so a returning tab does not nag.
 */
import { createSignal, type Accessor } from 'solid-js';

import type { ChatMessage, MessageType } from '@/lib/irc/types';
import type { ClientSurface } from '@/lib/platform';

import type { DesktopNotificationPermission } from './decision';

export const NOTIFY_FIRST_RUN_ACTIVITY_KEY = 'onyx:notify-first-run-activity';
export const NOTIFY_FIRST_RUN_DISMISS_KEY = 'onyx:notify-first-run-dismissed';

const REAL_CONVERSATION_TYPES: ReadonlySet<MessageType> = new Set(['msg', 'action', 'whisper']);

export type FirstRunNotifyNote = { type: string };

export function isRealConversationMessage(message: Pick<ChatMessage, 'type'>): boolean {
  return REAL_CONVERSATION_TYPES.has(message.type);
}

export function conversationHasRealActivity(
  messages: readonly Pick<ChatMessage, 'type'>[],
): boolean {
  return messages.some(isRealConversationMessage);
}

export function inboxHasRealActivity(notes: readonly FirstRunNotifyNote[]): boolean {
  return notes.some((note) => note.type === 'mention' || note.type === 'dm');
}

export function stateHasRealConversationActivity(state: {
  channels: ReadonlyMap<string, { messages: readonly Pick<ChatMessage, 'type'>[] }>;
  dms: ReadonlyMap<string, { messages: readonly Pick<ChatMessage, 'type'>[] }>;
  notifications: readonly FirstRunNotifyNote[];
}): boolean {
  for (const channel of state.channels.values()) {
    if (conversationHasRealActivity(channel.messages)) return true;
  }
  for (const dm of state.dms.values()) {
    if (conversationHasRealActivity(dm.messages)) return true;
  }
  return inboxHasRealActivity(state.notifications);
}

export function shouldOfferFirstRunNotify(input: {
  activity: boolean;
  dismissed: boolean;
  permission: DesktopNotificationPermission;
  surface: ClientSurface;
  hostNotifications: boolean;
}): boolean {
  if (!input.activity || input.dismissed) return false;
  if (input.surface === 'zig-desktop' && !input.hostNotifications) return false;
  return input.permission === 'default';
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readFlag(key: string): boolean {
  if (!hasStorage()) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (!hasStorage()) return;
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — session-only */
  }
}

const [activityAccessor, setActivitySignal] = createSignal(readFlag(NOTIFY_FIRST_RUN_ACTIVITY_KEY));
const [dismissedAccessor, setDismissedSignal] = createSignal(readFlag(NOTIFY_FIRST_RUN_DISMISS_KEY));

export const hasNotifyActivity: Accessor<boolean> = activityAccessor;
export const isNotifyAskDismissed: Accessor<boolean> = dismissedAccessor;

export function markNotifyActivity(): void {
  if (activityAccessor()) return;
  setActivitySignal(true);
  writeFlag(NOTIFY_FIRST_RUN_ACTIVITY_KEY, true);
}

export function dismissNotifyAsk(): void {
  if (dismissedAccessor()) return;
  setDismissedSignal(true);
  writeFlag(NOTIFY_FIRST_RUN_DISMISS_KEY, true);
}

/** Test / boundary reset. */
export function resetFirstRunNotifyState(): void {
  setActivitySignal(false);
  setDismissedSignal(false);
  writeFlag(NOTIFY_FIRST_RUN_ACTIVITY_KEY, false);
  writeFlag(NOTIFY_FIRST_RUN_DISMISS_KEY, false);
}
