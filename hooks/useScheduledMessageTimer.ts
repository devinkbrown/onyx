'use client';
import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

export function useScheduledMessageTimer() {
  const cancelScheduledMessage = useOnyxStore(s => s.cancelScheduledMessage);
  const sendMessage = useOnyxStore(s => s.sendMessage);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const due = useOnyxStore.getState().scheduledMessages.filter(m => m.sendAt <= now);
      for (const msg of due) {
        sendMessage(msg.channel, msg.text);
        cancelScheduledMessage(msg.id);
      }
    }, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
