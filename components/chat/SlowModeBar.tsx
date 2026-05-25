'use client';

import { useEffect, useRef, useState } from 'react';

interface SlowModeBarProps {
  seconds: number;
  lastSentAt?: number;
  onCountdownEnd?: () => void;
}

export default function SlowModeBar({ seconds, lastSentAt, onCountdownEnd }: SlowModeBarProps) {
  const [remaining, setRemaining] = useState(0);
  const animKeyRef = useRef(0);

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
        <span className="slowmode-text">
          {remaining.toFixed(0) === '0' ? 'Ready' : `${remaining.toFixed(0)}s remaining`}
        </span>
      ) : (
        <span className="slowmode-text">
          Slow mode: send a message every {seconds}s
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
          gap: 6px;
          padding: 5px 16px 7px;
          background: var(--bg-elevated, #1e1e2e);
          flex-shrink: 0;
          overflow: hidden;
        }

        .slowmode-icon {
          font-size: 13px;
          line-height: 1;
          flex-shrink: 0;
        }

        .slowmode-text {
          font-size: 12px;
          color: var(--text-secondary, #8b8fa8);
          font-weight: 500;
          letter-spacing: 0.01em;
          line-height: 1.4;
          flex: 1;
        }

        .slowmode-progress-track {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--border-subtle, rgba(255,255,255,0.06));
        }

        .slowmode-progress-fill {
          height: 100%;
          background: var(--accent, #7c5af5);
          transform-origin: right center;
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
