'use client';

import { useEffect, useState } from 'react';

interface ReadReceiptProps {
  /** The other person's nick in a DM */
  nick: string;
  /** Timestamp (ms) of the last message sent by the local user */
  msgTimestamp: number;
}

const storageKey = (nick: string) =>
  `ocean-dm-read-${nick.toLowerCase()}`;

function getStoredReadAt(nick: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(storageKey(nick));
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

export function updateDmReadAt(nick: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(nick), String(Date.now()));
  } catch {
    // ignore
  }
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

export default function ReadReceipt({ nick, msgTimestamp }: ReadReceiptProps) {
  const [readAt, setReadAt] = useState<number>(() => getStoredReadAt(nick));

  // Poll for localStorage updates from this session (same-tab updates fire synchronously)
  useEffect(() => {
    setReadAt(getStoredReadAt(nick));
  }, [nick]);

  // Listen for cross-tab storage events
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey(nick)) {
        setReadAt(getStoredReadAt(nick));
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [nick]);

  if (readAt <= msgTimestamp) return null;

  const seenAt = TIME_FMT.format(new Date(readAt));

  return (
    <div className="read-receipt" aria-label={`Seen by ${nick} at ${seenAt}`}>
      <span className="read-receipt__checks" aria-hidden>✓✓</span>
      <span className="read-receipt__label">Seen {seenAt}</span>
      <style>{`
        .read-receipt {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 5px;
          padding: 1px 18px 5px;
          font-size: 11px;
          color: var(--lux, #d8b96a);
          user-select: none;
          opacity: 0;
          animation: rr-fade-in 200ms var(--ease-out, ease) 120ms both;
        }
        @keyframes rr-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .read-receipt__checks {
          font-size: 13px;
          letter-spacing: -2px;
          opacity: 0.9;
          line-height: 1;
        }
        .read-receipt__label {
          opacity: 0.7;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        @media (prefers-reduced-motion: reduce) {
          .read-receipt { animation: none !important; opacity: 0.82; }
        }
      `}</style>
    </div>
  );
}
