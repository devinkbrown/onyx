'use client';

import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ActiveView } from '@/lib/store';

/**
 * Global keyboard shortcuts for Ocean.
 * Mount once at the app shell level.
 *
 * Ctrl+K / Ctrl+P   — open global search overlay
 * Ctrl+F            — open channel search bar (fires custom event)
 * Ctrl+,            — open settings
 * Ctrl+B            — toggle member list
 * Ctrl+Shift+F      — toggle focus mode
 * Ctrl+Shift+K      — open keyboard shortcuts modal
 * Ctrl+L            — scroll to bottom of current chat
 * Alt+Shift+Up/Down — navigate to prev/next channel with unread
 * Escape            — close any open modals (handled per-modal)
 * Alt+ArrowUp       — navigate to previous channel/DM (cycle list)
 * Alt+ArrowDown     — navigate to next channel/DM (cycle list)
 * Alt+ArrowLeft     — navigate back in channel history
 * Alt+ArrowRight    — navigate forward in channel history
 * PTT key           — push-to-talk (unmute while held, mute on release)
 */
export function useKeyboardShortcuts() {
  const openSettings          = useOnyxStore(s => s.openSettings);
  const toggleMemberList      = useOnyxStore(s => s.toggleMemberList);
  const navigate              = useOnyxStore(s => s.navigate);
  const activeView            = useOnyxStore(s => s.activeView);
  const channels              = useOnyxStore(s => s.channels);
  const dms                   = useOnyxStore(s => s.dms);
  const status                = useOnyxStore(s => s.status);
  const setVoiceCallState     = useOnyxStore(s => s.setVoiceCallState);
  const openSearchOverlay     = useOnyxStore(s => s.openSearchOverlay);
  const openKeyboardShortcuts = useOnyxStore(s => s.openKeyboardShortcuts);
  const toggleFocusMode       = useOnyxStore(s => s.toggleFocusMode);
  const markRead              = useOnyxStore(s => s.markRead);
  const markChannelRead       = useOnyxStore(s => s.markChannelRead);

  // Navigation history stack for Alt+←/→
  const historyStack  = useRef<ActiveView[]>([]);
  const historyIndex  = useRef(-1);
  const skipNextPush  = useRef(false);

  // Track activeView changes and push to history
  useEffect(() => {
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }
    if (activeView.kind === 'home') return;

    // Truncate forward history on new navigation
    historyStack.current = historyStack.current.slice(0, historyIndex.current + 1);
    historyStack.current.push(activeView);
    historyIndex.current = historyStack.current.length - 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  useEffect(() => {
    if (status !== 'connected') return;

    const handleDown = (e: KeyboardEvent) => {
      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      // ── Ctrl/Cmd + K or P → Global search overlay ────────────────────
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        openSearchOverlay();
        return;
      }

      // ── Ctrl/Cmd + F → Channel search bar ────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('ocean:channel-search'));
        return;
      }

      // ── Ctrl/Cmd + , → Settings ──────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        openSettings('account');
        return;
      }

      // ── Ctrl/Cmd + B → Toggle member list ────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleMemberList();
        return;
      }

      // ── Ctrl/Cmd + Shift + F → Toggle focus mode ─────────────────────
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // ── Ctrl/Cmd + Shift + K → Keyboard shortcuts cheatsheet ─────────
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        openKeyboardShortcuts();
        return;
      }

      // ── Ctrl/Cmd + L → Scroll to bottom of chat ──────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('ocean:scroll-bottom'));
        return;
      }

      // ── Ctrl/Cmd + / → Keyboard shortcuts cheatsheet ─────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        openKeyboardShortcuts();
        return;
      }

      // ── Push-to-Talk (unmute while key held) ─────────────────────────
      // PTT works regardless of whether a text field is focused,
      // but only while a call is active.
      const { pushToTalk, pushToTalkKey, callState } = useOnyxStore.getState().voice;
      if (
        pushToTalk &&
        pushToTalkKey &&
        callState !== 'idle' &&
        e.code === pushToTalkKey
      ) {
        e.preventDefault();
        setVoiceCallState({ muted: false });
        return;
      }

      // Skip remaining shortcuts if user is typing
      if (isTyping) return;

      // ── ? → Keyboard shortcuts cheatsheet ────────────────────────────
      if (e.key === '?') {
        e.preventDefault();
        openKeyboardShortcuts();
        return;
      }

      // ── Escape → Focus chat input (when not in a text field) ─────────
      if (e.key === 'Escape') {
        const chatInput = document.querySelector<HTMLTextAreaElement>('.chat-input-textarea');
        if (chatInput) {
          e.preventDefault();
          chatInput.focus();
        }
        return;
      }

      // ── Ctrl/Cmd + Shift + D → Toggle deafen ─────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        const { deafened } = useOnyxStore.getState().voice;
        setVoiceCallState({ deafened: !deafened });
        return;
      }

      // ── Ctrl/Cmd + Shift + M → Mark all channels and DMs as read ─────
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        // Mark all channels read
        const state = useOnyxStore.getState();
        for (const ch of state.channels.values()) {
          markRead(ch.name);
          markChannelRead(ch.name);
        }
        for (const dm of state.dms.values()) {
          markRead(dm.nick);
        }
        return;
      }

      // ── Alt + 1–9 → Jump to Nth channel in the list ──────────────────
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          const channelList = [...channels.values()];
          const target = channelList[num - 1];
          if (target) navigate({ kind: 'channel', channel: target.name });
          return;
        }
      }

      // ── Alt + Shift + ArrowUp/Down → Navigate to prev/next unread ───────
      if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();

        type NavItem =
          | { kind: 'channel'; channel: string }
          | { kind: 'dm'; nick: string };

        const allWithUnread: NavItem[] = [
          ...[...channels.values()].filter(c => c.unread > 0).map(c => ({ kind: 'channel' as const, channel: c.name })),
          ...[...dms.values()].filter(d => d.unread > 0).map(d => ({ kind: 'dm' as const, nick: d.nick })),
        ];

        if (allWithUnread.length === 0) return;

        // Find current in the unread list
        let unreadIdx = -1;
        if (activeView.kind === 'channel') {
          unreadIdx = allWithUnread.findIndex(n => n.kind === 'channel' && n.channel.toLowerCase() === activeView.channel.toLowerCase());
        } else if (activeView.kind === 'dm') {
          unreadIdx = allWithUnread.findIndex(n => n.kind === 'dm' && n.nick.toLowerCase() === activeView.nick.toLowerCase());
        }

        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const nextUnread = ((unreadIdx + dir) + allWithUnread.length) % allWithUnread.length;
        navigate(allWithUnread[nextUnread]);
        return;
      }

      // ── Alt + ArrowUp/Down → Navigate channels (cycle list) ───────────
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();

        const channelList = [...channels.values()];
        const dmList      = [...dms.values()];

        // Build a flat nav list: channels first, then DMs
        type NavItem =
          | { kind: 'channel'; channel: string }
          | { kind: 'dm'; nick: string };

        const navItems: NavItem[] = [
          ...channelList.map(c => ({ kind: 'channel' as const, channel: c.name })),
          ...dmList.map(d => ({ kind: 'dm' as const, nick: d.nick })),
        ];

        if (navItems.length === 0) return;

        // Find current index
        let idx = -1;
        if (activeView.kind === 'channel') {
          idx = navItems.findIndex(
            n => n.kind === 'channel' && n.channel.toLowerCase() === activeView.channel.toLowerCase()
          );
        } else if (activeView.kind === 'dm') {
          idx = navItems.findIndex(
            n => n.kind === 'dm' && n.nick.toLowerCase() === activeView.nick.toLowerCase()
          );
        }

        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = ((idx + dir) + navItems.length) % navItems.length;
        navigate(navItems[next]);
        return;
      }

      // ── Alt + ArrowLeft → Navigate back in channel history ────────────
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        const stack = historyStack.current;
        const idx   = historyIndex.current;
        if (idx > 0) {
          historyIndex.current = idx - 1;
          skipNextPush.current = true;
          navigate(stack[idx - 1]);
        }
        return;
      }

      // ── Alt + ArrowRight → Navigate forward in channel history ────────
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        const stack = historyStack.current;
        const idx   = historyIndex.current;
        if (idx < stack.length - 1) {
          historyIndex.current = idx + 1;
          skipNextPush.current = true;
          navigate(stack[idx + 1]);
        }
        return;
      }
    };

    const handleUp = (e: KeyboardEvent) => {
      // ── Push-to-Talk release (re-mute) ────────────────────────────────
      const { pushToTalk, pushToTalkKey, callState } = useOnyxStore.getState().voice;
      if (
        pushToTalk &&
        pushToTalkKey &&
        callState !== 'idle' &&
        e.code === pushToTalkKey
      ) {
        setVoiceCallState({ muted: true });
      }
    };

    document.addEventListener('keydown', handleDown);
    document.addEventListener('keyup',   handleUp);
    return () => {
      document.removeEventListener('keydown', handleDown);
      document.removeEventListener('keyup',   handleUp);
    };
  }, [status, openSettings, openSearchOverlay, openKeyboardShortcuts, toggleMemberList, navigate, activeView, channels, dms, setVoiceCallState, toggleFocusMode, markRead, markChannelRead]);
}
