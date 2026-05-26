'use client';

import { useState, useEffect } from 'react';

interface UnreadJumpBadgeProps {
  count: number;
  onClick: () => void;
}

export default function UnreadJumpBadge({ count, onClick }: UnreadJumpBadgeProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (count > 0) {
      setExiting(false);
      setVisible(true);
    } else {
      if (visible) {
        setExiting(true);
        const t = setTimeout(() => {
          setVisible(false);
          setExiting(false);
        }, 200);
        return () => clearTimeout(t);
      }
    }
  }, [count, visible]);

  if (!visible) return null;

  const label = `${count} new message${count === 1 ? '' : 's'}`;

  return (
    <button
      className={`ujb-pill${exiting ? ' ujb-pill--exit' : ''}`}
      onClick={onClick}
      aria-live="polite"
      aria-label={`${label} — click to scroll to bottom`}
    >
      <span className="ujb-arrow" aria-hidden="true">↓</span>
      <span className="ujb-label">{label}</span>

      <style>{`
        .ujb-pill {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 20;

          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px 7px 12px;

          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: 9999px;
          cursor: pointer;

          font-size: 13px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
          box-shadow:
            0 4px 20px rgba(0,0,0,0.4),
            0 0 0 1px rgba(255,255,255,0.12) inset,
            0 0 16px var(--accent-glow, rgba(14,165,233,0.35));

          animation: ujb-bounce-in 280ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275)) both;
          transition: background 120ms, box-shadow 120ms, transform 120ms;
        }

        .ujb-pill:hover {
          background: var(--accent-hover, var(--accent));
          box-shadow:
            0 6px 24px rgba(0,0,0,0.45),
            0 0 0 1px rgba(255,255,255,0.14) inset,
            0 0 22px var(--accent-glow, rgba(14,165,233,0.45));
          transform: translateX(-50%) translateY(-1px);
        }

        .ujb-pill:active {
          transform: translateX(-50%) scale(0.96);
        }

        .ujb-pill--exit {
          animation: ujb-slide-down 200ms cubic-bezier(0.4, 0, 1, 1) both;
        }

        .ujb-arrow {
          font-size: 15px;
          line-height: 1;
          display: flex;
          align-items: center;
          opacity: 0.9;
        }

        .ujb-label {
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        @keyframes ujb-bounce-in {
          0%   { opacity: 0; transform: translateX(-50%) translateY(14px) scale(0.88); }
          60%  { opacity: 1; transform: translateX(-50%) translateY(-3px) scale(1.04); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
        }

        @keyframes ujb-slide-down {
          from {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateX(-50%) translateY(10px) scale(0.93);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ujb-pill { animation: none; }
          .ujb-pill--exit { animation: none; opacity: 0; }
        }
      `}</style>
    </button>
  );
}
