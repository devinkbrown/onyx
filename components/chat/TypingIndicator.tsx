'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  channel: string;
}

export default function TypingIndicator({ channel }: Props) {
  const typingUsers = useOnyxStore(s => s.typingUsers);
  const ourNick     = useOnyxStore(s => s.ourNick);
  const setTyping   = useOnyxStore(s => s.setTyping);
  const channelKey  = channel.toLowerCase();
  const nickMap     = typingUsers.get(channelKey);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
  }, [channelKey, nickMap]);

  const typingEntries = useMemo(() => {
    if (!nickMap) return [];
    const lowerOurNick = ourNick.toLowerCase();
    return [...nickMap.entries()]
      .filter(([nick, expiresAt]) => nick.toLowerCase() !== lowerOurNick && expiresAt > now)
      .sort((a, b) => a[1] - b[1]);
  }, [nickMap, ourNick, now]);

  useEffect(() => {
    if (!nickMap) return;

    const current = Date.now();
    let earliest = Number.POSITIVE_INFINITY;

    for (const [nick, expiresAt] of nickMap) {
      if (expiresAt <= current) {
        setTyping(channel, nick, false);
      } else if (nick.toLowerCase() !== ourNick.toLowerCase()) {
        earliest = Math.min(earliest, expiresAt);
      }
    }

    if (!Number.isFinite(earliest)) return;
    const delay = Math.max(0, earliest - current + 16);
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [channel, nickMap, ourNick, setTyping]);

  const typing = typingEntries.map(([nick]) => nick);

  const renderText = () => {
    if (typing.length === 1) {
      return (
        <>
          <strong>{typing[0]}</strong>
          {' is typing'}
        </>
      );
    }
    if (typing.length === 2) {
      return (
        <>
          <strong>{typing[0]}</strong>
          {' and '}
          <strong>{typing[1]}</strong>
          {' are typing'}
        </>
      );
    }
    if (typing.length === 3) {
      return (
        <>
          <strong>{typing[0]}</strong>
          {', '}
          <strong>{typing[1]}</strong>
          {' and '}
          <strong>{typing[2]}</strong>
          {' are typing'}
        </>
      );
    }
    // 4+ — name the first two, summarize the rest so we never drop everyone
    return (
      <>
        <strong>{typing[0]}</strong>
        {', '}
        <strong>{typing[1]}</strong>
        {' and '}
        <strong>{typing.length - 2}</strong>
        {' others are typing'}
      </>
    );
  };

  return (
    <div className={`typing-row${typing.length > 0 ? ' typing-row--active' : ''}`} aria-live="polite" aria-atomic="true">
      {typing.length > 0 && (
        <div className="typing-indicator">
          <span className="typing-dots" aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
          <span className="typing-text">{renderText()}</span>
        </div>
      )}

      <style>{`
        .typing-row {
          min-height: 24px;
          height: 24px;
          padding: 0 var(--sp-5, 20px);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          contain: layout style;
        }

        .typing-indicator {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          font-size: var(--text-sm, .8125rem);
          color: var(--text-secondary, #7aa8c4);
          animation: typing-fade-in var(--t-surface, 220ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
        }

        .typing-text {
          font-size: var(--text-xs, .75rem);
          color: var(--text-secondary, #7aa8c4);
          line-height: 1;
        }

        .typing-text strong {
          font-weight: 700;
          color: var(--lux, #d8b96a);
        }

        .typing-dots {
          display: flex;
          align-items: center;
          gap: 3px;
        }

        @keyframes typing-bounce {
          0%, 55%, 100% { transform: translateY(0); opacity: 0.38; }
          27% { transform: translateY(-3px); opacity: 0.9; }
        }

        @keyframes typing-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--lux, #d8b96a);
          animation: typing-bounce 1.1s ease-in-out infinite;
          display: inline-block;
          opacity: 0.38;
        }
        .dot:nth-child(1) { animation-delay: 0ms; }
        .dot:nth-child(2) { animation-delay: 150ms; }
        .dot:nth-child(3) { animation-delay: 300ms; }

        @media (prefers-reduced-motion: reduce) {
          .dot,
          .typing-indicator {
            animation: none !important;
            transform: none !important;
          }
          .dot { opacity: 0.58; }
        }
      `}</style>
    </div>
  );
}
