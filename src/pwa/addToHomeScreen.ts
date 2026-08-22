// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * addToHomeScreen — day-2 Home Screen courtesy, never a first-run gate.
 *
 * Capture `beforeinstallprompt` silently. Offer one quiet in-app sheet only
 * after real engagement (a message we sent, or a later visit with a room
 * joined). Never auto-call `prompt()`. iOS has no install prompt — copy is
 * Share → Add to Home Screen.
 */
import { createSignal, type Accessor } from 'solid-js';

import type { ChatMessage, MessageType } from '@/lib/irc/types';
import type { ClientSurface } from '@/lib/platform';

export const A2HS_DISMISS_KEY = 'onyx:a2hs-dismissed';
export const A2HS_SENT_KEY = 'onyx:a2hs-message-sent';
export const A2HS_VISIT_KEY = 'onyx:a2hs-visit';
export const A2HS_SESSION_KEY = 'onyx:a2hs-session';

export const A2HS_TITLE = 'Add Onyx to your Home Screen';
export const A2HS_IOS_LEDE = 'Open Share, then Add to Home Screen.';
export const A2HS_IOS_PUSH =
  'Notifications on iPhone work from the Home Screen web app, not from a Safari tab.';
export const A2HS_CHROMIUM_LEDE =
  'Keep Onyx with your other apps. Same rooms and messages — still the browser, closer to hand.';

const REAL_SENT_TYPES: ReadonlySet<MessageType> = new Set(['msg', 'action', 'whisper']);

export type A2hsPlatform = 'ios' | 'chromium' | 'other';

export type CapturedInstallPrompt = {
  preventDefault(): void;
  prompt(): Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type A2hsPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

export type A2hsNavigatorProbe = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

function hasStorage(storage: Storage | undefined): storage is Storage {
  return typeof storage !== 'undefined';
}

function readFlag(key: string, storage: Storage | undefined = fallbackLocalStorage()): boolean {
  if (!hasStorage(storage)) return false;
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean, storage: Storage | undefined = fallbackLocalStorage()): void {
  if (!hasStorage(storage)) return;
  try {
    if (value) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch {
    /* storage unavailable — session-only */
  }
}

function fallbackLocalStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

function fallbackSessionStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.sessionStorage : undefined;
}

const [dismissedAccessor, setDismissedSignal] = createSignal(readFlag(A2HS_DISMISS_KEY));
const [sentAccessor, setSentSignal] = createSignal(readFlag(A2HS_SENT_KEY));
const [returningAccessor, setReturningSignal] = createSignal(false);
const [capturedAccessor, setCapturedSignal] = createSignal<CapturedInstallPrompt | null>(null);

export const isA2hsDismissed: Accessor<boolean> = dismissedAccessor;
export const hasSentHomeScreenMessage: Accessor<boolean> = sentAccessor;
export const isReturningHomeScreenVisit: Accessor<boolean> = returningAccessor;
export const capturedInstallPrompt: Accessor<CapturedInstallPrompt | null> = capturedAccessor;

export function isRealSentMessage(message: Pick<ChatMessage, 'type'>): boolean {
  return REAL_SENT_TYPES.has(message.type);
}

export function sameNick(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

export function conversationHasSentMessage(
  messages: readonly Pick<ChatMessage, 'type' | 'from'>[],
  ourNick: string | null | undefined,
): boolean {
  if (!ourNick) return false;
  return messages.some((message) => isRealSentMessage(message) && sameNick(message.from, ourNick));
}

export function stateHasSentMessage(state: {
  ourNick: string | null | undefined;
  channels: ReadonlyMap<string, { messages: readonly Pick<ChatMessage, 'type' | 'from'>[] }>;
  dms: ReadonlyMap<string, { messages: readonly Pick<ChatMessage, 'type' | 'from'>[] }>;
}): boolean {
  if (conversationHasSentMessageFromMaps(state.channels, state.ourNick)) return true;
  return conversationHasSentMessageFromMaps(state.dms, state.ourNick);
}

function conversationHasSentMessageFromMaps(
  rooms: ReadonlyMap<string, { messages: readonly Pick<ChatMessage, 'type' | 'from'>[] }>,
  ourNick: string | null | undefined,
): boolean {
  for (const room of rooms.values()) {
    if (conversationHasSentMessage(room.messages, ourNick)) return true;
  }
  return false;
}

export function stateHasJoinedRoom(state: { channels: ReadonlyMap<string, unknown> }): boolean {
  return state.channels.size > 0;
}

export function isIosSafariLike(input: A2hsNavigatorProbe = {}): boolean {
  const ua = input.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return input.platform === 'MacIntel' && (input.maxTouchPoints ?? 0) > 1;
}

export function detectA2hsPlatform(input: A2hsNavigatorProbe = readNavigatorProbe()): A2hsPlatform {
  if (isIosSafariLike(input)) return 'ios';
  const ua = input.userAgent ?? '';
  if (/Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(ua)) return 'chromium';
  return 'other';
}

export function readNavigatorProbe(
  nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | null | undefined =
    typeof navigator !== 'undefined' ? navigator : undefined,
): A2hsNavigatorProbe {
  try {
    return {
      userAgent: nav?.userAgent ?? '',
      platform: nav?.platform ?? '',
      maxTouchPoints: nav?.maxTouchPoints ?? 0,
    };
  } catch {
    // jsdom brand-checks Navigator getters; Object.create(navigator) stubs fail.
    return { userAgent: '', platform: '', maxTouchPoints: 0 };
  }
}

export function shouldOfferAddToHomeScreen(input: {
  engaged: boolean;
  dismissed: boolean;
  standalone: boolean;
  surface: ClientSurface;
  platform: A2hsPlatform;
  hasCapturedPrompt: boolean;
}): boolean {
  if (!input.engaged || input.dismissed) return false;
  if (input.standalone || input.surface === 'pwa' || input.surface === 'zig-desktop') return false;
  if (input.hasCapturedPrompt) return true;
  return input.platform === 'ios';
}

export function hasHomeScreenEngagement(input: {
  sent: boolean;
  returning: boolean;
  joinedRoom: boolean;
}): boolean {
  return input.sent || (input.returning && input.joinedRoom);
}

export function rememberHomeScreenVisit(
  local: Storage | undefined = fallbackLocalStorage(),
  session: Storage | undefined = fallbackSessionStorage(),
): boolean {
  const alreadySession = readFlag(A2HS_SESSION_KEY, session);
  const hadVisit = readFlag(A2HS_VISIT_KEY, local);
  if (!alreadySession) {
    writeFlag(A2HS_SESSION_KEY, true, session);
    writeFlag(A2HS_VISIT_KEY, true, local);
    setReturningSignal(hadVisit);
    return hadVisit;
  }
  return returningAccessor();
}

export function markHomeScreenMessageSent(): void {
  if (sentAccessor()) return;
  setSentSignal(true);
  writeFlag(A2HS_SENT_KEY, true);
}

export function dismissAddToHomeScreen(): void {
  if (dismissedAccessor()) return;
  setDismissedSignal(true);
  writeFlag(A2HS_DISMISS_KEY, true);
}

export function captureBeforeInstallPrompt(event: CapturedInstallPrompt): void {
  event.preventDefault();
  setCapturedSignal(event);
}

export function peekCapturedInstallPrompt(): CapturedInstallPrompt | null {
  return capturedAccessor();
}

export function consumeCapturedInstallPrompt(): CapturedInstallPrompt | null {
  const event = capturedAccessor();
  setCapturedSignal(null);
  return event;
}

export function startBeforeInstallPromptCapture(
  target: EventTarget | null | undefined = typeof window !== 'undefined' ? window : undefined,
): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => {};

  const onPrompt = (event: Event): void => {
    const candidate = event as Event & Partial<CapturedInstallPrompt>;
    if (typeof candidate.preventDefault !== 'function' || typeof candidate.prompt !== 'function') {
      return;
    }
    captureBeforeInstallPrompt(candidate as CapturedInstallPrompt);
  };

  target.addEventListener('beforeinstallprompt', onPrompt);
  return () => target.removeEventListener('beforeinstallprompt', onPrompt);
}

export async function requestHomeScreenAdd(): Promise<A2hsPromptOutcome> {
  const event = consumeCapturedInstallPrompt();
  if (!event) {
    dismissAddToHomeScreen();
    return 'unavailable';
  }
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  } finally {
    dismissAddToHomeScreen();
  }
}

export function a2hsCopyFor(platform: A2hsPlatform): { lede: string; detail: string | null } {
  if (platform === 'ios') {
    return { lede: A2HS_IOS_LEDE, detail: A2HS_IOS_PUSH };
  }
  return { lede: A2HS_CHROMIUM_LEDE, detail: null };
}

/** Test / boundary reset. */
export function resetAddToHomeScreenState(): void {
  setDismissedSignal(false);
  setSentSignal(false);
  setReturningSignal(false);
  setCapturedSignal(null);
  writeFlag(A2HS_DISMISS_KEY, false);
  writeFlag(A2HS_SENT_KEY, false);
  writeFlag(A2HS_VISIT_KEY, false);
  writeFlag(A2HS_SESSION_KEY, false, fallbackSessionStorage());
}
