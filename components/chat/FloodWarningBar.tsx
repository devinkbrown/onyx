'use client';

import { useEffect, useState } from 'react';

interface Props {
  visible: boolean;
  cooldownMs: number;
  cooldownStart: number;
}

export default function FloodWarningBar({ visible, cooldownMs, cooldownStart }: Props) {
  const [progress, setProgress] = useState(100);
  const [startTime, setStartTime] = useState<number>(0);

  useEffect(() => {
    if (!visible) {
      setProgress(100);
      return;
    }
    setStartTime(cooldownStart || Date.now());
    setProgress(100);
  }, [visible, cooldownStart]);

  useEffect(() => {
    if (!visible || startTime === 0) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.max(0, 100 - (elapsed / cooldownMs) * 100);
      setProgress(pct);
      if (pct <= 0) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [visible, startTime, cooldownMs]);

  if (!visible) return null;

  const secondsLeft = Math.max(0, (cooldownMs * (progress / 100)) / 1000);

  return (
    <div className="fwb-root" role="alert" aria-live="assertive">
      <div className="fwb-body">
        <span className="fwb-icon">⚠</span>
        <span className="fwb-text">
          Sending too fast — please wait{' '}
          <strong>{secondsLeft.toFixed(1)}s</strong>
        </span>
      </div>
      <div className="fwb-progress-track" aria-hidden="true">
        <div className="fwb-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <style>{`
        .fwb-root {
          position: relative;
          flex-shrink: 0;
          overflow: hidden;
          animation: fwb-in 180ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }
        @keyframes fwb-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fwb-body {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 16px 9px;
          background: rgba(251, 191, 36, 0.10);
          border-bottom: 1px solid rgba(251, 191, 36, 0.22);
        }
        .fwb-icon {
          font-size: 14px;
          line-height: 1;
          flex-shrink: 0;
          color: var(--warning, #fbbf24);
          filter: drop-shadow(0 0 4px rgba(251,191,36,0.5));
        }
        .fwb-text {
          font-size: 12px;
          color: var(--warning, #fbbf24);
          font-weight: 500;
          letter-spacing: 0.01em;
          line-height: 1.4;
        }
        .fwb-text strong {
          font-weight: 700;
        }
        .fwb-progress-track {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: rgba(251, 191, 36, 0.12);
        }
        .fwb-progress-fill {
          height: 100%;
          background: var(--warning, #fbbf24);
          opacity: 0.7;
          transition: width 50ms linear;
        }
      `}</style>
    </div>
  );
}
