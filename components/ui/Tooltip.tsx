'use client';

import { useState, useRef, useCallback } from 'react';

interface Props {
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
  children: React.ReactNode;
}

export default function Tooltip({ text, side = 'right', delay = 400, children }: Props) {
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
      {visible && (
        <span className={`tooltip tooltip--${side} animate-scale-in`}>
          {text}
        </span>
      )}

      <style>{`
        .tooltip-wrap { position: relative; display: inline-flex; }
        .tooltip {
          position: absolute;
          z-index: 1000;
          background: var(--bg-overlay);
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 500;
          padding: 6px 10px;
          border-radius: var(--r-sm);
          white-space: nowrap;
          pointer-events: none;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--border-subtle);
        }
        .tooltip--right  { left: calc(100% + 8px); top: 50%; transform: translateY(-50%); }
        .tooltip--left   { right: calc(100% + 8px); top: 50%; transform: translateY(-50%); }
        .tooltip--top    { bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); }
        .tooltip--bottom { top: calc(100% + 8px); left: 50%; transform: translateX(-50%); }
      `}</style>
    </span>
  );
}
