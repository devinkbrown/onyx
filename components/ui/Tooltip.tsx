'use client';

import { useState, useRef, useCallback } from 'react';

interface Props {
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
  children: React.ReactNode;
}

export default function Tooltip({ text, side = 'right', delay = 300, children }: Props) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timer.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  return (
    <span className="tooltip-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      <span
        className={`tooltip tooltip--${side}${visible ? ' tooltip--visible' : ''}`}
        role="tooltip"
        aria-hidden={!visible}
      >
        {text}
        <span className={`tooltip-arrow tooltip-arrow--${side}`} aria-hidden />
      </span>

      <style>{`
        .tooltip-wrap { position: relative; display: inline-flex; }

        .tooltip {
          position: absolute;
          z-index: var(--z-popover, 100);
          background: var(--elev-tint-2, rgba(18,18,28,0.96));
          color: var(--text-primary, #f0f4ff);
          font-size: var(--text-xs, 0.75rem);
          font-weight: 600;
          padding: var(--sp-1, 4px) var(--sp-3, 12px);
          border-radius: var(--r-sm, 6px) var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 12px);
          white-space: nowrap;
          pointer-events: none;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 18px 48px rgba(0,0,0,.38));
          border: 1px solid var(--border-subtle, rgba(255,255,255,.12));
          letter-spacing: 0;
          line-height: 1.4;
          opacity: 0;
          transition:
            opacity var(--t-micro, 90ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            transform var(--t-micro, 90ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
        }
        .tooltip--visible { opacity: 1; }

        .tooltip--right  { left: calc(100% + var(--sp-3, 12px)); top: 50%; transform: translate3d(-4px,-50%,0); }
        .tooltip--right.tooltip--visible { transform: translate3d(0,-50%,0); }
        .tooltip--left   { right: calc(100% + var(--sp-3, 12px)); top: 50%; transform: translate3d(4px,-50%,0); }
        .tooltip--left.tooltip--visible { transform: translate3d(0,-50%,0); }
        .tooltip--top    { bottom: calc(100% + var(--sp-3, 12px)); left: 50%; transform: translate3d(-50%,4px,0); }
        .tooltip--top.tooltip--visible { transform: translate3d(-50%,0,0); }
        .tooltip--bottom { top: calc(100% + var(--sp-3, 12px)); left: 50%; transform: translate3d(-50%,-4px,0); }
        .tooltip--bottom.tooltip--visible { transform: translate3d(-50%,0,0); }

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
          border-right: 5px solid var(--elev-tint-2, rgba(18,18,28,0.96));
        }
        .tooltip-arrow--left {
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          border-top: 5px solid transparent;
          border-bottom: 5px solid transparent;
          border-left: 5px solid var(--elev-tint-2, rgba(18,18,28,0.96));
        }
        .tooltip-arrow--top {
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid var(--elev-tint-2, rgba(18,18,28,0.96));
        }
        .tooltip-arrow--bottom {
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 5px solid var(--elev-tint-2, rgba(18,18,28,0.96));
        }

        @media (prefers-reduced-motion: reduce) {
          .tooltip {
            transition-duration: 1ms;
          }
        }
      `}</style>
    </span>
  );
}
