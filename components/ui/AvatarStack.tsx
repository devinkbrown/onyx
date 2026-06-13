'use client';

import { getNickColor } from '@/lib/nick-color';

interface Props {
  nicks: string[];
  max?: number;
}

function nickInitial(nick: string): string {
  const clean = nick.replace(/^[~@+.]+/, '');
  return clean.slice(0, 1).toUpperCase();
}

export default function AvatarStack({ nicks, max = 5 }: Props) {
  const visible = nicks.slice(0, max);
  const overflow = Math.max(0, nicks.length - visible.length);
  if (visible.length === 0) return null;

  return (
    <span className="avatar-stack" aria-label={`Participants: ${nicks.join(', ')}`} data-testid="avatar-stack">
      {visible.map((nick, i) => (
        <span
          key={nick}
          className="avatar-stack-item"
          title={nick}
          style={{
            background: getNickColor(nick),
            zIndex: visible.length - i,
            marginLeft: i === 0 ? 0 : -8,
          }}
          aria-hidden
        >
          {nickInitial(nick)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="avatar-stack-overflow" aria-hidden>
          +{overflow}
        </span>
      )}

      <style>{`
        .avatar-stack {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
        }
        .avatar-stack-item {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          border: 2px solid var(--bg-deep, #06101d);
          position: relative;
          flex-shrink: 0;
          user-select: none;
          letter-spacing: 0.01em;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.24));
          transition: transform var(--t-micro, 120ms) var(--ease-out, ease), z-index 0s;
        }
        .avatar-stack-item:hover {
          transform: translateY(-2px) scale(1.08);
          z-index: 10 !important;
        }
        /* +N overflow badge */
        .avatar-stack-overflow {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
          color: var(--text-secondary);
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 2px solid var(--bg-deep, #06101d);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.24));
          margin-left: -8px;
          flex-shrink: 0;
          user-select: none;
          letter-spacing: -0.02em;
        }
        @media (prefers-reduced-motion: reduce) {
          .avatar-stack-item { transition-duration: 1ms; }
          .avatar-stack-item:hover { transform: none; }
        }
      `}</style>
    </span>
  );
}
