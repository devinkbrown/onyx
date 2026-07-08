import { onCleanup, onMount } from 'solid-js';

import { getState, subscribe } from '@/lib/store';
import type { Notification as StoreNotification } from '@/lib/store/store';

import {
  getDesktopNotificationPermission,
  playNotificationBeep,
  showDesktopNotification,
} from './browser';
import { calmPreset, classifyNotification, type CalmContext } from './calmMode';
import { shouldNotify } from './decision';

const DESKTOP_THROTTLE_MS = 6000;
const SOUND_THROTTLE_MS = 1500;

interface PendingDesktop {
  count: number;
  last: StoreNotification;
  timer: ReturnType<typeof setTimeout>;
}

function notificationTarget(note: StoreNotification): { key: string; label: string; navigate: () => void } | null {
  if (note.type === 'mention' && note.channel) {
    const channel = note.channel;
    return {
      key: channel.toLowerCase(),
      label: channel,
      navigate: () => getState().navigate({ kind: 'channel', channel }),
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
  return `${note.from ?? 'Someone'} mentioned you in ${targetLabel}`;
}

function bodyFor(note: StoreNotification): string {
  return note.text.length > 180 ? `${note.text.slice(0, 177)}...` : note.text;
}

export function NotificationRuntime(): null {
  onMount(() => {
    let seen = new Set(getState().notifications.map((note) => note.id));
    const lastDesktopAt = new Map<string, number>();
    const lastSoundAt = new Map<string, number>();
    const pendingDesktop = new Map<string, PendingDesktop>();

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
      lastDesktopAt.set(target.key, Date.now());
    }

    function flushPending(key: string): void {
      const pending = pendingDesktop.get(key);
      if (!pending) return;
      pendingDesktop.delete(key);
      showNote(pending.last, pending.count);
    }

    function queueCoalesced(note: StoreNotification, key: string, waitMs: number): void {
      const existing = pendingDesktop.get(key);
      if (existing) {
        existing.count += 1;
        existing.last = note;
        return;
      }

      pendingDesktop.set(key, {
        count: 1,
        last: note,
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
      const calmContext: CalmContext = {
        isMention: note.type === 'mention',
        isDirect: note.type === 'dm',
        isFollowed: false,
        isBoost: false,
      };
      if (classifyNotification(calmPreset(), calmContext) !== 'notify') return;

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
        lastSoundAt.set(target.key, nowMs);
      }

      if (decision.desktop) {
        showNote(note);
      } else if (decision.desktopReason === 'throttled') {
        const last = lastDesktopAt.get(target.key) ?? nowMs;
        queueCoalesced(note, target.key, Math.max(250, DESKTOP_THROTTLE_MS - (nowMs - last)));
      }
    }

    const unsubscribe = subscribe(
      (state) => state.notifications,
      (notes) => {
        for (const note of notes) {
          if (!seen.has(note.id)) handleNotification(note);
        }
        seen = new Set(notes.map((note) => note.id));
      },
    );

    onCleanup(() => {
      unsubscribe();
      for (const pending of pendingDesktop.values()) clearTimeout(pending.timer);
      pendingDesktop.clear();
    });
  });

  return null;
}
