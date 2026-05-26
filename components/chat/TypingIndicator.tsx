'use client';

import { useEffect, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  channel: string;
}

export default function TypingIndicator({ channel }: Props) {
  const typingUsers = useOnyxStore(s => s.typingUsers);
  const ourNick     = useOnyxStore(s => s.ourNick);
  const setTyping   = useOnyxStore(s => s.setTyping);

  // Tick once per second to trigger expiry pruning and re-render
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const nickMap = typingUsers.get(channel.toLowerCase());
      if (nickMap) {
        for (const [nick, expiresAt] of nickMap) {
          if (expiresAt <= now) {
            setTyping(channel, nick, false);
          }
        }
      }
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [channel, typingUsers, setTyping]);

  const now = Date.now();
  const nickMap = typingUsers.get(channel.toLowerCase());
  const typing = nickMap
    ? [...nickMap.entries()]
        .filter(([nick, expiresAt]) =>
          nick.toLowerCase() !== ourNick.toLowerCase() && expiresAt > now,
        )
        .map(([nick]) => nick)
    : [];

  if (typing.length === 0) {
    return <div className="typing-placeholder" aria-hidden="true" />;
  }

  const renderText = () => {
    if (typing.length === 1) {
      return (
        <>
          <strong>{typing[0]}</strong>
          {' is typing…'}
        </>
      );
    }
    if (typing.length === 2) {
      return (
        <>
          <strong>{typing[0]}</strong>
          {' and '}
          <strong>{typing[1]}</strong>
          {' are typing…'}
        </>
      );
    }
    return <>{'Several people are typing…'}</>;
  };

  return (
    <div className="typing-wrap" aria-live="polite" aria-atomic="true">
      <div className="typing-indicator">
        <span className="typing-dots" aria-hidden="true">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
        <span className="typing-text">{renderText()}</span>
      </div>

      <style>{`
        .typing-placeholder {
          height: 24px;
          flex-shrink: 0;
        }

        .typing-wrap {
          height: 24px;
          padding: 0 20px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          color: var(--text-secondary, #7aa8c4);
          animation: fadeIn 180ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        .typing-text {
          font-size: 12.5px;
          color: var(--text-secondary, #7aa8c4);
          line-height: 1;
        }

        .typing-text strong {
          font-weight: 600;
          color: var(--accent, #0ea5e9);
        }

        .typing-dots {
          display: flex;
          align-items: center;
          gap: 3px;
        }

        @keyframes typing-bounce {
          0%, 55%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          27% {
            transform: translateY(-3.5px);
            opacity: 1;
          }
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--accent, #0ea5e9);
          animation: typing-bounce 1.1s ease-in-out infinite;
          display: inline-block;
          opacity: 0.4;
        }
        .dot:nth-child(1) { animation-delay: 0ms; }
        .dot:nth-child(2) { animation-delay: 150ms; }
        .dot:nth-child(3) { animation-delay: 300ms; }

        @media (prefers-reduced-motion: reduce) {
          .dot { animation: none; opacity: 0.55; }
          .typing-indicator { animation: none; }
        }
      `}</style>
    </div>
  );
}
