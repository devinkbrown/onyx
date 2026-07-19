// SPDX-License-Identifier: AGPL-3.0-or-later
import { onCleanup, onMount } from 'solid-js';

import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import type { ChatMessage } from '@/lib/irc/types';
import { clearLinkPreviewCache } from '@/lib/preview/linkPreview';
import { getState, selectDeviceMemoryOwner, subscribe } from '@/lib/store';
import type { Notification as StoreNotification, OnyxState } from '@/lib/store/store';

import {
  getDesktopNotificationPermission,
  playNotificationBeep,
  showDesktopNotification,
  type DesktopNotificationHandle,
} from './browser';
import { calmPreset, classifyNotification, type CalmContext } from './calmMode';
import { shouldNotify } from './decision';
import { isFollowed } from './followed';
import {
  ENCRYPTED_NOTIFICATION_BODY,
  notificationBodyFor,
} from './notificationBody';

const DESKTOP_THROTTLE_MS = 6000;
const SOUND_THROTTLE_MS = 1500;
// The notification inbox retains 50 rows. Runtime-only throttle state must not
// grow beyond that user-visible window during a long-lived browser session.
const MAX_TRACKED_NOTIFICATIONS = 50;
const MAX_TRACKED_TARGETS = 50;

interface PendingDesktop {
  ids: string[];
  /** Note ids whose OS body must stay private even if the DM row is pruned. */
  privateBodyIds: Set<string>;
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

function bodyFor(note: StoreNotification, privateBody: boolean): string {
  // Fail closed: ciphertext envelopes AND decrypted E2EE DM plaintext must
  // never land on a (possibly lock-screen) OS alert body.
  if (privateBody) return ENCRYPTED_NOTIFICATION_BODY;
  return notificationBodyFor(note.text);
}

function messageMatchesNotification(message: ChatMessage, note: StoreNotification): boolean {
  if (!note.from || message.from.toLowerCase() !== note.from.toLowerCase()) return false;
  if (!message.encrypted && message.e2ee === undefined) return false;
  const body = message.encrypted ? message.plaintext : message.text;
  if (body === undefined) return false;
  // Notification rows are bounded more tightly than live messages. Prefix
  // matching preserves the privacy boundary when a decrypted body was clipped
  // before entering the inbox.
  return body === note.text || body.startsWith(note.text);
}

function hasEncryptedDirectMessageBoundary(note: StoreNotification, state: OnyxState): boolean {
  if (note.type !== 'dm' || !note.from) return false;
  const messages = state.dms.get(note.from.toLowerCase())?.messages;
  return Boolean(messages?.some((message) => messageMatchesNotification(message, note)));
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
    const activeDesktop = new Map<string, DesktopNotificationHandle>();

    function clearActiveDesktop(): void {
      for (const handle of activeDesktop.values()) handle.close();
      activeDesktop.clear();
    }

    function clearOwnerRuntimeState(): void {
      for (const pending of pendingDesktop.values()) clearTimeout(pending.timer);
      pendingDesktop.clear();
      clearActiveDesktop();
      clearLinkPreviewCache();
      lastDesktopAt.clear();
      lastSoundAt.clear();
      // Existing inbox rows belong to the previous owner. Mark them observed so
      // a later notification-array update cannot replay them under the new one.
      seen = new Set(getState().notifications.map((note) => note.id));
    }

    function showNote(note: StoreNotification, count = 1, privateBody = false): void {
      const target = notificationTarget(note);
      if (!target) return;
      const title = count > 1
        ? `${count} new alerts in ${target.label}`
        : titleFor(note, target.label);

      activeDesktop.get(target.key)?.close();
      activeDesktop.delete(target.key);
      const shownOwnerKey = ownerKey;
      let handle: DesktopNotificationHandle | null = null;
      handle = showDesktopNotification({
        title,
        body: bodyFor(note, privateBody),
        tag: `onyx-${target.key}`,
        onClick: () => {
          // Closing a browser notification and dispatching its click can race.
          // Never navigate an old owner's captured target in the new session.
          if (shownOwnerKey !== ownerKey || shownOwnerKey !== currentOwnerKey()) return;
          if (handle && activeDesktop.get(target.key) === handle) activeDesktop.delete(target.key);
          focusApp();
          target.navigate();
        },
      });
      if (handle) {
        activeDesktop.set(target.key, handle);
        while (activeDesktop.size > MAX_TRACKED_TARGETS) {
          const oldestKey = activeDesktop.keys().next().value;
          if (oldestKey === undefined) break;
          activeDesktop.get(oldestKey)?.close();
          activeDesktop.delete(oldestKey);
        }
      }
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
      if (decision.desktop) {
        // Prefer the sticky private-body mark captured at queue time so a
        // pruned DM row cannot re-open a decrypted body on the flush path.
        const privateBody = pending.privateBodyIds.has(newest.id)
          || hasEncryptedDirectMessageBoundary(newest, state);
        showNote(newest, liveNotes.length, privateBody);
      }
    }

    function queueCoalesced(
      note: StoreNotification,
      key: string,
      waitMs: number,
      privateBody: boolean,
    ): void {
      const existing = pendingDesktop.get(key);
      if (existing) {
        if (!existing.ids.includes(note.id)) existing.ids.push(note.id);
        if (privateBody) existing.privateBodyIds.add(note.id);
        if (existing.ids.length > MAX_TRACKED_NOTIFICATIONS) {
          const removedId = existing.ids.shift();
          if (removedId) existing.privateBodyIds.delete(removedId);
        }
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
        privateBodyIds: new Set(privateBody ? [note.id] : []),
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
      const privateBody = hasEncryptedDirectMessageBoundary(note, state);
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
        showNote(note, 1, privateBody);
      } else if (decision.desktopReason === 'throttled') {
        const last = lastDesktopAt.get(target.key) ?? nowMs;
        queueCoalesced(
          note,
          target.key,
          Math.max(250, DESKTOP_THROTTLE_MS - (nowMs - last)),
          privateBody,
        );
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
