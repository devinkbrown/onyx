'use client';

import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

/**
 * usePresence — detects browser media session activity and publishes it
 * to the IRC server via IRCX PROP * ACTIVITY.
 *
 * - Polls navigator.mediaSession every 10 seconds while music is playing.
 * - Clears the ACTIVITY prop when playback stops.
 */
export function usePresence() {
  const client    = useOnyxStore(s => s.client);
  const isIRCX    = useOnyxStore(s => s.isIRCX);
  const setCustomStatus = useOnyxStore(s => s.setCustomStatus);
  const lastActivityRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('mediaSession' in navigator)) return;

    const checkMedia = () => {
      const meta  = navigator.mediaSession?.metadata;
      const state = navigator.mediaSession?.playbackState;

      if (meta && state === 'playing') {
        const title  = meta.title ?? '';
        const artist = meta.artist ?? '';
        const activity = artist
          ? `🎵 ${title} — ${artist}`
          : `🎵 ${title}`;

        if (activity === lastActivityRef.current) return;
        lastActivityRef.current = activity;

        if (client && isIRCX) {
          client.sendRaw('PROP', '*', 'ACTIVITY', activity);
        }
      } else {
        // Playback stopped — clear activity
        if (lastActivityRef.current !== '') {
          lastActivityRef.current = '';
          if (client && isIRCX) {
            client.sendRaw('PROP', '*', 'ACTIVITY', '');
          }
        }
      }
    };

    const interval = setInterval(checkMedia, 10_000);
    // Also run immediately
    checkMedia();

    return () => clearInterval(interval);
  }, [client, isIRCX, setCustomStatus]);
}
