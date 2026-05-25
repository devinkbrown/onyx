'use client';
import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import { SOUNDS, setSoundsVolume, type SoundId } from '@/lib/sounds';

// ── Custom event types ─────────────────────────────────────────────────────

/** Fired when the local user sends a message. */
const EVENT_MESSAGE_SENT = 'ocean:message-sent';
/** Fired when a reaction is added to any message. */
const EVENT_REACTION_ADDED = 'ocean:reaction-added';
/** Fired when a user joins a voice channel. */
const EVENT_VOICE_JOIN = 'ocean:voice-join';
/** Fired when a user leaves a voice channel. */
const EVENT_VOICE_LEAVE = 'ocean:voice-leave';

// ── Exported helpers ───────────────────────────────────────────────────────

/** Play any sound by ID — used by settings modal test buttons. */
export function testSound(id: SoundId): void {
  SOUNDS[id]?.();
}

// ── Re-export for consumers that imported SOUNDS from here ─────────────────
export { SOUNDS };

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAudioNotifications(): void {
  const notifications = useOnyxStore(s => s.notifications);
  const soundEnabled  = useOnyxStore(s => s.soundEnabled);
  const soundVolume   = useOnyxStore(s => s.soundVolume);
  const isDndActive   = useOnyxStore(s => s.isDndActive);
  const prevCountRef  = useRef(notifications.length);

  // Sync master volume whenever the stored value changes
  useEffect(() => {
    setSoundsVolume(soundVolume);
  }, [soundVolume]);

  // Notification-driven sounds
  useEffect(() => {
    if (!soundEnabled) return;
    if (isDndActive()) return;

    const newCount = notifications.length;
    if (newCount > prevCountRef.current) {
      const latest = notifications[newCount - 1];
      if (latest?.type === 'mention') SOUNDS.mention();
      else if (latest?.type === 'dm')  SOUNDS.dm();
      else if (latest?.type === 'error') SOUNDS.error();
      else SOUNDS.notification();
    }
    prevCountRef.current = newCount;
  }, [notifications, soundEnabled, isDndActive]);

  // Custom DOM events
  useEffect(() => {
    if (!soundEnabled) return;

    function onMessageSent(): void {
      if (!isDndActive()) SOUNDS.send();
    }

    function onReactionAdded(): void {
      if (!isDndActive()) SOUNDS.pop();
    }

    function onVoiceJoin(): void {
      if (!isDndActive()) SOUNDS.voice_join();
    }

    function onVoiceLeave(): void {
      if (!isDndActive()) SOUNDS.voice_leave();
    }

    window.addEventListener(EVENT_MESSAGE_SENT, onMessageSent);
    window.addEventListener(EVENT_REACTION_ADDED, onReactionAdded);
    window.addEventListener(EVENT_VOICE_JOIN, onVoiceJoin);
    window.addEventListener(EVENT_VOICE_LEAVE, onVoiceLeave);

    return () => {
      window.removeEventListener(EVENT_MESSAGE_SENT, onMessageSent);
      window.removeEventListener(EVENT_REACTION_ADDED, onReactionAdded);
      window.removeEventListener(EVENT_VOICE_JOIN, onVoiceJoin);
      window.removeEventListener(EVENT_VOICE_LEAVE, onVoiceLeave);
    };
  }, [soundEnabled, isDndActive]);
}
