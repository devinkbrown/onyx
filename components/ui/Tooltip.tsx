'use client';

import { useState, useRef, useCallback } from 'react';

interface Props {
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
  children: React.ReactNode;
}

export default function Tooltip({ text, side = 'right', delay = 120, children }: Props) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  const show = useCallback(() => {
    timer.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  return (
    <span className="tooltip-wrap" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      <span
        className={`tooltip tooltip--${side}`}
        role="tooltip"
        aria-hidden={!visible}
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'none' : 'none' }}
      >
        {text}
        <span className={`tooltip-arrow tooltip-arrow--${side}`} aria-hidden />
      </span>

      <style>{`
        .tooltip-wrap { position: relative; display: inline-flex; }

        .tooltip {
          position: absolute;
          z-index: 1000;
          background: var(--bg-elevated, rgba(18,18,28,0.96));
          color: var(--text-primary, #f0f4ff);
          font-size: 12px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: 6px;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 4px 16px rgba(0,0,0,0.6);
          border: 1px solid var(--border-subtle);
          letter-spacing: 0.01em;
          line-height: 1.4;
          transition: opacity 120ms ease;
        }
        .tooltip[aria-hidden="true"] {
          transition: opacity 80ms ease;
        }

        .tooltip--right  { left: calc(100% + 10px); top: 50%; transform: translateY(-50%); }
        .tooltip--left   { right: calc(100% + 10px); top: 50%; transform: translateY(-50%); }
        .tooltip--top    { bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); }
        .tooltip--bottom { top: calc(100% + 10px); left: 50%; transform: translateX(-50%); }

        /* ── Arrows — 5px triangle ── */
        .tooltip-arrow {
          position: absolute;
          width: 0;
          height: 0;
        }
        .tooltip-arrow--right {
          right: 100%;
          top: 50%;
          transform: translateY(-50%);
          border-top: 5px solid transparent;
          border-bottom: 5px solid transparent;
          border-right: 5px solid var(--bg-elevated, rgba(18,18,28,0.96));
        }
        .tooltip-arrow--left {
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          border-top: 5px solid transparent;
          border-bottom: 5px solid transparent;
          border-left: 5px solid var(--bg-elevated, rgba(18,18,28,0.96));
        }
        .tooltip-arrow--top {
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid var(--bg-elevated, rgba(18,18,28,0.96));
        }
        .tooltip-arrow--bottom {
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 5px solid var(--bg-elevated, rgba(18,18,28,0.96));
        }
      `}</style>
    </span>
  );
}
