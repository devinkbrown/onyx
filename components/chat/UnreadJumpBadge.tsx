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
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 20;

          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 14px 6px 10px;

          background: var(--accent, #0ea5e9);
          color: #fff;
          border: none;
          border-radius: 9999px;
          cursor: pointer;

          font-size: 14px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
          box-shadow: 0 4px 16px rgba(14,165,233,0.35), 0 2px 6px rgba(0,0,0,0.3);

          animation: ujb-slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
          transition: background 120ms, box-shadow 120ms;
        }

        .ujb-pill:hover {
          background: color-mix(in srgb, var(--accent, #0ea5e9) 85%, #000 15%);
          box-shadow: 0 6px 20px rgba(14,165,233,0.45), 0 2px 8px rgba(0,0,0,0.35);
        }

        .ujb-pill--exit {
          animation: ujb-slide-down 200ms cubic-bezier(0.4, 0, 1, 1) both;
        }

        .ujb-arrow {
          font-size: 16px;
          line-height: 1;
          display: flex;
          align-items: center;
        }

        .ujb-label {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        @keyframes ujb-slide-up {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        @keyframes ujb-slide-down {
          from {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
          to {
            opacity: 0;
            transform: translateX(-50%) translateY(10px);
          }
        }
      `}</style>
    </button>
  );
}
