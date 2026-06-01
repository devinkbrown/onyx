'use client';

import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

function _channelFromNotification(n: { channel?: string }): string | null {
  return n.channel ? n.channel.toLowerCase() : null;
}

/**
 * useNotifications
 *
 * Handles three things:
 *  1. Document title badge — updates the browser tab title with unread/mention
 *     counts so users can see activity at a glance.
 *  2. Browser push notifications — fires a desktop notification for mentions
 *     and DMs when the window does not have focus, gated by localStorage prefs.
 *  3. OS notifications — emitted from the notification store only.
 *
 * Mount once at the AppShell level.
 */
export function useNotifications() {
  const channels             = useOnyxStore(s => s.channels);
  const dms                  = useOnyxStore(s => s.dms);
  const notifications        = useOnyxStore(s => s.notifications);
  const isDndActive          = useOnyxStore(s => s.isDndActive);
  const totalUnreadMentions  = useOnyxStore(s => s.totalUnreadMentions);
  const channelNotify        = useOnyxStore(s => s.channelNotify);
  const ourNick              = useOnyxStore(s => s.ourNick);
  const pushEnabled          = useOnyxStore(s => s.pushNotificationsEnabled);
  const seenCount            = useRef(0);

  // ── Document title badge ────────────────────────────────────────────────
  useEffect(() => {
    let totalHighlights = 0;
    let totalUnread = 0;

    for (const ch of channels.values()) {
      totalHighlights += ch.highlights;
      totalUnread     += ch.unread;
    }
    for (const dm of dms.values()) {
      totalHighlights += dm.highlights;
      totalUnread     += dm.unread;
    }

    // Prefer the precise per-channel mention count when available
    const mentionCount = totalUnreadMentions > 0 ? totalUnreadMentions : totalHighlights;

    if (mentionCount > 0) {
      document.title = `(${mentionCount}) Ocean`;
    } else if (totalUnread > 0) {
      document.title = '● Ocean';
    } else {
      document.title = 'Ocean';
    }

    // ── App Badge API (PWA badge on OS dock/taskbar) ──────────────────────
    if ('setAppBadge' in navigator) {
      const badgeCount = mentionCount > 0 ? mentionCount : totalUnread;
      if (badgeCount > 0) {
        navigator.setAppBadge(Math.min(badgeCount, 99)).catch(() => undefined);
      } else {
        navigator.clearAppBadge().catch(() => undefined);
      }
    }
  }, [channels, dms, totalUnreadMentions]);

  // ── Browser notification permission ─────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (!pushEnabled) return;
    if (Notification.permission === 'default') {
      // Request lazily — only after user has interacted with the page
      const handler = () => {
        Notification.requestPermission();
        window.removeEventListener('click', handler);
      };
      window.addEventListener('click', handler, { once: true });
      return () => window.removeEventListener('click', handler);
    }
  }, [pushEnabled]);

  // ── Fire browser notifications and sounds for new mentions/DMs ──────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;

    const newOnes = notifications.slice(seenCount.current);
    seenCount.current = notifications.length;

    if (newOnes.length === 0) return;
    if (document.hasFocus()) return;
    if (isDndActive()) return;

    if (!pushEnabled) return;

    // Read filtering prefs from localStorage
    const notifLevel     = localStorage.getItem('ocean-notif-level') ?? 'all';

    for (const n of newOnes) {
      if (n.type !== 'mention' && n.type !== 'dm') continue;

      // Apply global notification level filter
      if (notifLevel === 'none') continue;
      if (notifLevel === 'mentions' && n.type !== 'mention' && n.type !== 'dm') continue;

      // Apply per-channel suppression for channel mentions
      if (n.type === 'mention') {
        const chanKey = _channelFromNotification(n);
        if (chanKey) {
          const perChanLevel = channelNotify.get(chanKey) ?? 'all';
          // Suppress entirely when muted
          if (perChanLevel === 'none') continue;
          // 'mentions' only: only deliver when our nick is actually mentioned
          if (perChanLevel === 'mentions') {
            const nickMentioned = ourNick
              ? n.text.toLowerCase().includes(ourNick.toLowerCase())
              : false;
            if (!nickMentioned) continue;
          }
        }
      }

      // Show desktop notification
      if (Notification.permission === 'granted') {
        const title = n.type === 'dm'
          ? `Ocean — DM from ${n.from ?? 'someone'}`
          : `Ocean — ${n.from ?? 'someone'} mentioned you${n.channel ? ` in ${n.channel}` : ''}`;
        try {
          const notif = new Notification(title, {
            body: n.text,
            tag: n.id,
            // icon: '/icon-192.png',  // add when we have assets
          });
          notif.onclick = () => {
            window.focus();
            notif.close();
          };
        } catch {
          // Notification API may throw in some contexts — swallow silently
        }
      }
    }
  }, [notifications, isDndActive, channelNotify, ourNick, pushEnabled]);
}
