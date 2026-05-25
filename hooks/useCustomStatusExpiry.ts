'use client';

import { useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';

/**
 * useCustomStatusExpiry — watches the customStatusExpiry timestamp and
 * auto-clears the status when it passes.
 *
 * Runs a 60-second interval that compares now() to the stored expiry.
 * On expiry: clears customStatus + customStatusExpiry, sends AWAY to IRC.
 */
export function useCustomStatusExpiry() {
  const customStatusExpiry    = useOnyxStore(s => s.customStatusExpiry);
  const setCustomStatus       = useOnyxStore(s => s.setCustomStatus);
  const setCustomStatusExpiry = useOnyxStore(s => s.setCustomStatusExpiry);
  const client                = useOnyxStore(s => s.client);

  useEffect(() => {
    if (!customStatusExpiry) return;

    const clearExpired = () => {
      if (customStatusExpiry && customStatusExpiry.getTime() <= Date.now()) {
        setCustomStatus('');
        setCustomStatusExpiry(null);
        client?.sendRaw('AWAY'); // clear away message on IRC
      }
    };

    // Check immediately on mount (handles stale expiry from localStorage)
    clearExpired();

    const interval = setInterval(clearExpired, 60_000);
    return () => clearInterval(interval);
  }, [customStatusExpiry, setCustomStatus, setCustomStatusExpiry, client]);
}
