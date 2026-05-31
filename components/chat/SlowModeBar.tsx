'use client';

import { useEffect, useState } from 'react';

interface SlowModeBarProps {
  seconds: number;
  lastSentAt?: number;
  onCountdownEnd?: () => void;
}

export default function SlowModeBar({ seconds, lastSentAt, onCountdownEnd }: SlowModeBarProps) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!lastSentAt || lastSentAt <= 0) {
      setRemaining(0);
      return;
    }

    const tick = () => {
      const elapsed = (Date.now() - lastSentAt) / 1000;
      const rem = Math.max(0, seconds - elapsed);
      setRemaining(rem);
      if (rem <= 0) {
        onCountdownEnd?.();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastSentAt, seconds, onCountdownEnd]);

  const inCooldown = remaining > 0;
  // Increment animation key when a new cooldown starts so the keyframe restarts
  const animKey = lastSentAt ?? 0;

  return (
    <div className="slowmode-bar" role="status" aria-live="polite">
      <span className="slowmode-icon">⏱</span>
      {inCooldown ? (
        <>
          <span className="slowmode-text">Slow mode active</span>
          <span className="slowmode-countdown">{remaining.toFixed(0)}s</span>
        </>
      ) : (
        <span className="slowmode-text">
          Slow mode: send every {seconds}s
        </span>
      )}

      <div className="slowmode-progress-track">
        {inCooldown && (
          <div
            className="slowmode-progress-fill"
            key={animKey}
            style={{ animationDuration: `${seconds}s` }}
          />
        )}
      </div>

      <style>{`
        .slowmode-bar {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px 9px;
          background: rgba(251, 191, 36, 0.06);
          border-top: 1px solid rgba(251, 191, 36, 0.15);
          flex-shrink: 0;
          overflow: hidden;
        }

        .slowmode-icon {
          font-size: 13px;
          line-height: 1;
          flex-shrink: 0;
          color: var(--warning, #fbbf24);
        }

        .slowmode-text {
          font-size: 12px;
          color: rgba(251, 191, 36, 0.85);
          font-weight: 500;
          letter-spacing: 0.01em;
          line-height: 1.4;
          flex: 1;
        }

        /* Large monospace countdown */
        .slowmode-countdown {
          font-family: var(--font-mono, monospace);
          font-size: 13px;
          font-weight: 700;
          color: var(--warning, #fbbf24);
          letter-spacing: -0.02em;
          flex-shrink: 0;
          min-width: 36px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .slowmode-progress-track {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: rgba(251, 191, 36, 0.12);
        }

        .slowmode-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, rgba(251,191,36,0.5), var(--warning, #fbbf24));
          transform-origin: left center;
          animation: slowmode-drain linear forwards;
        }

        @keyframes slowmode-drain {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
