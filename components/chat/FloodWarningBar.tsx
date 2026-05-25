'use client';

import { useEffect, useState } from 'react';

interface Props {
  visible: boolean;
  cooldownMs: number;
}

export default function FloodWarningBar({ visible, cooldownMs }: Props) {
  const [progress, setProgress] = useState(100);
  const [startTime, setStartTime] = useState<number>(0);

  useEffect(() => {
    if (!visible) {
      setProgress(100);
      return;
    }
    setStartTime(Date.now());
    setProgress(100);
  }, [visible]);

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
          animation: fwb-in 150ms ease-out;
        }
        @keyframes fwb-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fwb-body {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px 8px;
          background: rgba(239, 68, 68, 0.12);
          border-top: 1px solid rgba(239, 68, 68, 0.25);
        }
        .fwb-icon {
          font-size: 14px;
          line-height: 1;
          flex-shrink: 0;
          color: #ef4444;
        }
        .fwb-text {
          font-size: 12px;
          color: #ef4444;
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
          background: rgba(239, 68, 68, 0.15);
        }
        .fwb-progress-fill {
          height: 100%;
          background: #ef4444;
          transition: width 50ms linear;
        }
      `}</style>
    </div>
  );
}
