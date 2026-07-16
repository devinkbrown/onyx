// SPDX-License-Identifier: AGPL-3.0-or-later
import { onCleanup, onMount } from 'solid-js';

import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import { getState, selectDeviceMemoryOwner, subscribe } from '@/lib/store';
import type { Notification as StoreNotification } from '@/lib/store/store';

import {
  getDesktopNotificationPermission,
  playNotificationBeep,
  showDesktopNotification,
} from './browser';
import { calmPreset, classifyNotification, type CalmContext } from './calmMode';
import { shouldNotify } from './decision';
import { isFollowed } from './followed';

const DESKTOP_THROTTLE_MS = 6000;
const SOUND_THROTTLE_MS = 1500;
// The notification inbox retains 50 rows. Runtime-only throttle state must not
// grow beyond that user-visible window during a long-lived browser session.
const MAX_TRACKED_NOTIFICATIONS = 50;
const MAX_TRACKED_TARGETS = 50;

interface PendingDesktop {
  ids: string[];
  timer: ReturnType<typeof setTimeout>;
}

function rememberTargetTimestamp(map: Map<string, number>, key: string, at: number): void {
  // Refresh insertion order so the first entry remains the least recently
  // touched target and can be evicted deterministically.
  map.delete(key);
  map.set(key, at);
  while (map.size > MAX_TRACKED_TARGETS) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function notificationTarget(note: StoreNotification): { key: string; label: string; navigate: () => void } | null {
  if ((note.type === 'mention' || note.type === 'follow') && note.channel) {
    const channel = note.channel;
    const followedTopic = note.type === 'follow' ? note.topic?.trim() || null : null;
    return {
      key: channel.toLowerCase(),
      label: channel,
      navigate: () => {
        getState().openChannelConversation(channel, followedTopic ?? null);
      },
    };
  }

  if (note.type === 'dm' && note.from) {
    const nick = note.from;
    return {
      key: nick.toLowerCase(),
      label: nick,
      navigate: () => getState().navigate({ kind: 'dm', nick }),
    };
  }

  return null;
}

function isNotificationDndActive(): boolean {
  const state = getState();
  if (state.dndEnabled) return true;
  if (state.dndUntil !== null && Date.now() < state.dndUntil) return true;
  return state.isDndActive();
}

function focusApp(): void {
  if (typeof window === 'undefined') return;
  window.focus();
}

function titleFor(note: StoreNotification, targetLabel: string): string {
  if (note.type === 'dm') return `Direct message from ${note.from ?? targetLabel}`;
  if (note.type === 'follow') return `${note.from ?? 'Someone'} posted in ${targetLabel}`;
  return `${note.from ?? 'Someone'} mentioned you in ${targetLabel}`;
}

function bodyFor(note: StoreNotification): string {
  return note.text.length > 180 ? `${note.text.slice(0, 177)}...` : note.text;
}

function calmAllowsNotification(note: StoreNotification): boolean {
  const owner = selectDeviceMemoryOwner(getState());
  const calmContext: CalmContext = {
    isMention: note.type === 'mention',
    isDirect: note.type === 'dm',
    isFollowed: note.type === 'follow' || Boolean(
      owner
      && note.channel
      && (isFollowed(note.channel, note.topic, owner) || isFollowed(note.channel, null, owner)),
    ),
    isBoost: false,
  };
  return classifyNotification(calmPreset(), calmContext) === 'notify';
}

export function NotificationRuntime(): null {
  onMount(() => {
    const currentOwnerKey = (): string | null => {
      const owner = selectDeviceMemoryOwner(getState());
      return owner ? deviceMemoryOwnerKey(owner) : null;
    };
    let ownerKey = currentOwnerKey();
    let seen = new Set(getState().notifications.map((note) => note.id));
    const lastDesktopAt = new Map<string, number>();
    const lastSoundAt = new Map<string, number>();
    const pendingDesktop = new Map<string, PendingDesktop>();

    function clearOwnerRuntimeState(): void {
      for (const pending of pendingDesktop.values()) clearTimeout(pending.timer);
      pendingDesktop.clear();
      lastDesktopAt.clear();
      lastSoundAt.clear();
      // Existing inbox rows belong to the previous owner. Mark them observed so
      // a later notification-array update cannot replay them under the new one.
      seen = new Set(getState().notifications.map((note) => note.id));
    }

    function showNote(note: StoreNotification, count = 1): void {
      const target = notificationTarget(note);
      if (!target) return;
      const title = count > 1
        ? `${count} new alerts in ${target.label}`
        : titleFor(note, target.label);

      showDesktopNotification({
        title,
        body: bodyFor(note),
        tag: `onyx-${target.key}`,
        onClick: () => {
          focusApp();
          target.navigate();
        },
      });
      rememberTargetTimestamp(lastDesktopAt, target.key, Date.now());
    }

    function pruneTargetMaps(notes: readonly StoreNotification[]): void {
      const activeKeys = new Set(pendingDesktop.keys());
      for (const note of notes) {
        const target = notificationTarget(note);
        if (target) activeKeys.add(target.key);
      }

      for (const key of lastDesktopAt.keys()) {
        if (!activeKeys.has(key)) lastDesktopAt.delete(key);
      }
      for (const key of lastSoundAt.keys()) {
        if (!activeKeys.has(key)) lastSoundAt.delete(key);
      }
    }

    function flushPending(key: string): void {
      const pending = pendingDesktop.get(key);
      if (!pending) return;
      pendingDesktop.delete(key);

      // A queued alert can sit here for almost the full throttle window. The
      // user may enable DND or return focus to Onyx in that time, so re-run the
      // CURRENT policy rather than blindly replaying the stale decision that
      // originally queued it. Omit the previous desktop timestamp: the timer
      // itself has already served the throttle delay.
      const state = getState();
      const pendingIds = new Set(pending.ids);
      const liveNotes = state.notifications.filter((note) => {
        if (!pendingIds.has(note.id) || state.readNotificationIds.has(note.id)) return false;
        return notificationTarget(note)?.key === key && calmAllowsNotification(note);
      });
      const newest = liveNotes.at(-1);
      pruneTargetMaps(state.notifications);
      if (!newest) return;

      const decision = shouldNotify({
        kind: newest.type,
        isSelf: !!newest.from && newest.from.toLowerCase() === state.ourNick.toLowerCase(),
        muted: false,
        pushEnabled: state.pushNotificationsEnabled,
        soundEnabled: false,
        dnd: isNotificationDndActive(),
        permission: getDesktopNotificationPermission(),
        pageVisible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
        appFocused: typeof document === 'undefined' ? true : document.hasFocus(),
        nowMs: Date.now(),
        desktopThrottleMs: DESKTOP_THROTTLE_MS,
        soundThrottleMs: SOUND_THROTTLE_MS,
      });
      if (decision.desktop) showNote(newest, liveNotes.length);
    }

    function queueCoalesced(note: StoreNotification, key: string, waitMs: number): void {
      const existing = pendingDesktop.get(key);
      if (existing) {
        if (!existing.ids.includes(note.id)) existing.ids.push(note.id);
        if (existing.ids.length > MAX_TRACKED_NOTIFICATIONS) existing.ids.shift();
        pendingDesktop.delete(key);
        pendingDesktop.set(key, existing);
        return;
      }

      while (pendingDesktop.size >= MAX_TRACKED_TARGETS) {
        const oldestKey = pendingDesktop.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = pendingDesktop.get(oldestKey);
        if (oldest) clearTimeout(oldest.timer);
        pendingDesktop.delete(oldestKey);
      }
      pendingDesktop.set(key, {
        ids: [note.id],
        timer: setTimeout(() => flushPending(key), waitMs),
      });
    }

    function handleNotification(note: StoreNotification): void {
      const target = notificationTarget(note);
      if (!target) return;

      // The active calm preset governs whether this alert may surface at all,
      // before the finer-grained desktop/sound decision runs.
      //  - 'silent': omit entirely (the store already tracks the unread entry)
      //  - 'badge':  unread count only, no sound and no OS notification
      //  - 'notify': fall through to the existing full sound + desktop path
      if (!calmAllowsNotification(note)) return;

      const state = getState();
      const nowMs = Date.now();
      const decision = shouldNotify({
        kind: note.type,
        isSelf: !!note.from && note.from.toLowerCase() === state.ourNick.toLowerCase(),
        muted: false,
        pushEnabled: state.pushNotificationsEnabled,
        soundEnabled: state.soundEnabled,
        dnd: isNotificationDndActive(),
        permission: getDesktopNotificationPermission(),
        pageVisible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
        appFocused: typeof document === 'undefined' ? true : document.hasFocus(),
        nowMs,
        lastDesktopAtMs: lastDesktopAt.get(target.key),
        lastSoundAtMs: lastSoundAt.get(target.key),
        desktopThrottleMs: DESKTOP_THROTTLE_MS,
        soundThrottleMs: SOUND_THROTTLE_MS,
      });

      if (decision.sound) {
        playNotificationBeep(state.soundVolume);
        rememberTargetTimestamp(lastSoundAt, target.key, nowMs);
      }

      if (decision.desktop) {
        showNote(note);
      } else if (decision.desktopReason === 'throttled') {
        const last = lastDesktopAt.get(target.key) ?? nowMs;
        queueCoalesced(note, target.key, Math.max(250, DESKTOP_THROTTLE_MS - (nowMs - last)));
      }
    }

    // Register this before the notification listener so an atomic owner+inbox
    // update clears old timers/state before any row can be considered for output.
    const unsubscribeOwner = subscribe(
      (state) => {
        const owner = selectDeviceMemoryOwner(state);
        return owner ? deviceMemoryOwnerKey(owner) : null;
      },
      (nextOwnerKey) => {
        if (nextOwnerKey === ownerKey) return;
        ownerKey = nextOwnerKey;
        clearOwnerRuntimeState();
      },
    );

    const unsubscribe = subscribe(
      (state) => state.notifications,
      (notes) => {
        for (const note of notes) {
          if (!seen.has(note.id)) handleNotification(note);
        }
        seen = new Set(notes.map((note) => note.id));
        pruneTargetMaps(notes);
      },
    );

    onCleanup(() => {
      unsubscribeOwner();
      unsubscribe();
      clearOwnerRuntimeState();
    });
  });

  return null;
}
