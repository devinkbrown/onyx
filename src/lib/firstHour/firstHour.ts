// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * firstHour — after-join first session for a new guest.
 *
 * Connect already queued `pendingDeepLinkJoin` and lands them on Home or the
 * requested room. This module is session memory + a durable local flag so the
 * shell can focus the composer, show at most two quiet tips, and skip a second
 * identity ritual. It is not a store slice.
 */
import { createSignal } from 'solid-js';

export const FIRST_HOUR_SEEN_KEY = 'onyx:first-hour-seen';

export type FirstHourLanding = 'home' | 'room';

export type FirstHourHandoff = {
  landing: FirstHourLanding;
  channel: string | null;
  guest: boolean;
};

export type FirstHourCoachTipId = 'home-next' | 'room-say-hi';

export type FirstHourCoachTip = {
  id: FirstHourCoachTipId;
  text: string;
};

const HOME_TIP: FirstHourCoachTip = {
  id: 'home-next',
  text: 'Browse a room, start one, or invite a friend.',
};

const ROOM_TIP: FirstHourCoachTip = {
  id: 'room-say-hi',
  text: 'Say hi — type below and press Enter.',
};

let sessionHandoff: FirstHourHandoff | null = null;
let composerFocused = false;

const [firstHourSeen, setFirstHourSeen] = createSignal(readSeenFlag());
const [handoffEpoch, setHandoffEpoch] = createSignal(0);

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readSeenFlag(): boolean {
  try {
    return hasStorage() && localStorage.getItem(FIRST_HOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function persistSeenFlag(): void {
  try {
    if (hasStorage()) localStorage.setItem(FIRST_HOUR_SEEN_KEY, '1');
  } catch {
    /* session-only */
  }
}

/** Reactive read — call from JSX / memos / effects. */
export function isFirstHourSeen(): boolean {
  return firstHourSeen();
}

/** Reactive epoch so handoff writes invalidate Solid memos. */
export function firstHourHandoffEpoch(): number {
  return handoffEpoch();
}

export function peekFirstHourHandoff(): FirstHourHandoff | null {
  return sessionHandoff;
}

export function recordFirstHourHandoff(handoff: FirstHourHandoff): void {
  const channel = handoff.channel?.trim() || null;
  sessionHandoff = {
    landing: handoff.landing,
    channel,
    guest: handoff.guest,
  };
  composerFocused = false;
  setHandoffEpoch((n) => n + 1);
}

export function markFirstHourSeen(): void {
  if (firstHourSeen()) return;
  persistSeenFlag();
  setFirstHourSeen(true);
}

export function shouldShowFirstHourHomeWelcome(input: {
  connected: boolean;
  hasRooms: boolean;
  directoryCount: number;
  recentCount: number;
}): boolean {
  return input.connected
    && !input.hasRooms
    && input.directoryCount === 0
    && input.recentCount === 0;
}

export function firstHourCoachTip(surface: FirstHourLanding): FirstHourCoachTip | null {
  if (firstHourSeen()) return null;
  const handoff = sessionHandoff;
  if (!handoff?.guest) return null;
  if (surface === 'home') return handoff.landing === 'home' ? HOME_TIP : null;
  return handoff.landing === 'room' ? ROOM_TIP : null;
}

export function firstHourComposerHint(): string | null {
  return firstHourCoachTip('room')?.text ?? null;
}

export function shouldSuppressGuestClaim(): boolean {
  if (firstHourSeen()) return false;
  return sessionHandoff?.guest === true;
}

export function shouldFocusComposer(activeChannel: string | null | undefined): boolean {
  if (composerFocused) return false;
  const handoff = sessionHandoff;
  if (!handoff || handoff.landing !== 'room' || !handoff.channel) return false;
  const channel = activeChannel?.trim();
  if (!channel) return false;
  return channel.toLowerCase() === handoff.channel.toLowerCase();
}

export function markComposerFocused(): void {
  composerFocused = true;
}

export function inviteFriendsHref(channel?: string | null): string {
  const room = channel?.trim();
  if (!room) return '/invite/';
  return `/invite/?join=${encodeURIComponent(room)}`;
}

/** Test / boundary reset. */
export function resetFirstHourForTests(): void {
  sessionHandoff = null;
  composerFocused = false;
  try {
    if (hasStorage()) localStorage.removeItem(FIRST_HOUR_SEEN_KEY);
  } catch {
    /* ignore */
  }
  setFirstHourSeen(false);
  setHandoffEpoch(0);
}
