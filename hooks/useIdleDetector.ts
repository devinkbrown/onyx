'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

const DEFAULT_IDLE_MINUTES = 15;

export function useIdleDetector() {
  const client         = useOnyxStore(s => s.client);
  const status         = useOnyxStore(s => s.status);
  const setAway        = useOnyxStore(s => s.setAway);
  const unsetAway      = useOnyxStore(s => s.unsetAway);
  const idleAwayMinutes = useOnyxStore(s => s.idleAwayMinutes);
  const idleRef        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isIdleRef      = useRef(false);

  const goIdle = useCallback(() => {
    if (!client || status !== 'connected' || isIdleRef.current) return;
    isIdleRef.current = true;
    setAway('Away (idle)');
  }, [client, status, setAway]);

  const returnFromIdle = useCallback(() => {
    if (!isIdleRef.current) return;
    isIdleRef.current = false;
    if (!client || status !== 'connected') return;
    unsetAway();
  }, [client, status, unsetAway]);

  const resetTimer = useCallback(() => {
    returnFromIdle();
    clearTimeout(idleRef.current);
    const minutes = idleAwayMinutes ?? DEFAULT_IDLE_MINUTES;
    if (minutes <= 0) return;
    idleRef.current = setTimeout(goIdle, minutes * 60_000);
  }, [returnFromIdle, goIdle, idleAwayMinutes]);

  useEffect(() => {
    if (status !== 'connected') return;

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'] as const;
    events.forEach(ev => document.addEventListener(ev, resetTimer, { passive: true }));

    // Start the initial timer
    resetTimer();

    return () => {
      clearTimeout(idleRef.current);
      events.forEach(ev => document.removeEventListener(ev, resetTimer));
    };
  }, [status, resetTimer]);
}
