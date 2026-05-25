'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

export function usePushNotifications() {
  const ourNick = useOnyxStore(s => s.ourNick);
  const channels = useOnyxStore(s => s.channels);
  const dms = useOnyxStore(s => s.dms);
  const pushNotificationsEnabled = useOnyxStore(s => s.pushNotificationsEnabled);
  const channelNotify = useOnyxStore(s => s.channelNotify);
  const prevChannelMsgCountRef = useRef<Map<string, number>>(new Map());
  const prevDmMsgCountRef = useRef<Map<string, number>>(new Map());
  const permissionRef = useRef<NotificationPermission>('default');

  // Request permission once on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    permissionRef.current = Notification.permission;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        permissionRef.current = perm;
      });
    }
  }, []);

  const sendNotification = useCallback((title: string, body: string, tag: string) => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;  // Only notify when tabbed out
    if (!pushNotificationsEnabled) return;

    try {
      const n = new Notification(title, {
        body: body.slice(0, 120),
        tag,
        icon: '/favicon.ico',
        silent: false,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      // Auto-close after 6 seconds
      setTimeout(() => n.close(), 6000);
    } catch {
      // Notifications may fail in some browsers
    }
  }, [pushNotificationsEnabled]);

  // Watch channels for new mentions (messages containing @ourNick or @everyone/@here)
  useEffect(() => {
    if (!ourNick) return;

    channels.forEach((ch, chanName) => {
      const prevCount = prevChannelMsgCountRef.current.get(chanName) ?? 0;
      const newCount = ch.messages.length;

      if (newCount > prevCount) {
        const perChanLevel = channelNotify.get(chanName.toLowerCase()) ?? 'all';

        // Suppress all push notifications when channel is muted
        if (perChanLevel !== 'none') {
          const newMsgs = ch.messages.slice(prevCount);
          for (const msg of newMsgs) {
            if (msg.type === 'msg' && msg.from !== ourNick) {
              const textLower = msg.text.toLowerCase();
              const isNickMention = textLower.includes(ourNick.toLowerCase());
              const isChannelWide = /\@(everyone|here)\b/i.test(msg.text);
              const isMention = isNickMention || isChannelWide;

              if (perChanLevel === 'mentions' && !isMention) continue;
              if (perChanLevel === 'all' || isMention) {
                sendNotification(
                  `Mention in ${chanName}`,
                  `${msg.from}: ${msg.text}`,
                  `mention-${chanName}-${msg.id}`
                );
              }
            }
          }
        }
      }

      prevChannelMsgCountRef.current.set(chanName, newCount);
    });
  }, [channels, ourNick, sendNotification, channelNotify]);

  // Watch DMs for new messages
  useEffect(() => {
    if (!ourNick) return;

    dms.forEach((dm, nick) => {
      const prevCount = prevDmMsgCountRef.current.get(nick) ?? 0;
      const newCount = dm.messages.length;

      if (newCount > prevCount) {
        const newMsgs = dm.messages.slice(prevCount);
        for (const msg of newMsgs) {
          if (msg.type === 'msg' && msg.from !== ourNick) {
            sendNotification(
              `DM from ${msg.from}`,
              msg.text,
              `dm-${nick}-${msg.id}`
            );
          }
        }
      }

      prevDmMsgCountRef.current.set(nick, newCount);
    });
  }, [dms, ourNick, sendNotification]);
}
