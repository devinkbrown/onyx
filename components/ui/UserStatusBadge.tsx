'use client';

import { useOnyxStore } from '@/lib/store';

/* ── Types ─────────────────────────────────────────────────────── */

type StatusDotSize = 'sm' | 'md' | 'lg';
type StatusValue   = 'online' | 'idle' | 'dnd' | 'offline';

const DOT_PX: Record<StatusDotSize, number> = {
  sm: 10,
  md: 12,
  lg: 14,
};

/* ── StatusDot — pure presentational ───────────────────────────── */

export function StatusDot({
  status,
  size = 'md',
}: {
  status: StatusValue;
  size?: StatusDotSize;
}) {
  const px = DOT_PX[size];

  return (
    <span
      className={`sdot sdot--${status}`}
      style={{ width: px, height: px }}
      aria-hidden
    >
      {status === 'dnd' && (
        <span className="sdot-dnd-bar" aria-hidden />
      )}

      <style>{`
        .sdot {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          flex-shrink: 0;
          border: 2px solid var(--bg-deep, #0d0d12);
          position: absolute;
          bottom: -1px;
          right: -1px;
        }

        /* online — solid green + subtle pulse glow */
        .sdot--online {
          background: #22c55e;
          animation: sdot-online-glow 2.5s ease-in-out infinite;
        }

        @keyframes sdot-online-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          50%       { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
        }

        /* idle — solid amber, no animation */
        .sdot--idle {
          background: #f59e0b;
        }

        /* dnd — red with horizontal bar */
        .sdot--dnd {
          background: #ef4444;
        }

        .sdot-dnd-bar {
          display: block;
          width: 55%;
          height: 2px;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 1px;
        }

        /* offline — gray, muted */
        .sdot--offline {
          background: #4b5563;
          opacity: 0.6;
        }
      `}</style>
    </span>
  );
}

/* ── UserStatusBadge — interactive button for the bottom bar ───── */

export default function UserStatusBadge() {
  const isAway        = useOnyxStore(s => s.isAway);
  const awayMessage   = useOnyxStore(s => s.awayMessage);
  const openAwayModal = useOnyxStore(s => s.openAwayModal);

  const status: StatusValue = isAway ? 'idle' : 'online';

  const statusText = isAway
    ? `Away${awayMessage ? `: ${awayMessage.slice(0, 28)}${awayMessage.length > 28 ? '…' : ''}` : ''}`
    : 'Online';

  return (
    <button
      className="usb-root"
      onClick={openAwayModal}
      aria-label={`Status: ${statusText}. Click to change.`}
    >
      <span className="usb-dot-wrap">
        <span className={`usb-dot usb-dot--${status}`} aria-hidden />
      </span>
      <span className="usb-text">{statusText}</span>

      <style>{`
        .usb-root {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          background: none;
          border: none;
          cursor: pointer;
          border-radius: var(--r-sm, 4px);
          width: 100%;
          text-align: left;
          transition: background var(--t-fast);
        }
        .usb-root:hover {
          background: var(--ch-hover-bg);
        }

        .usb-dot-wrap {
          position: relative;
          width: 12px;
          height: 12px;
          flex-shrink: 0;
        }

        .usb-dot {
          position: absolute;
          inset: 0;
          border-radius: 50%;
        }

        /* online */
        .usb-dot--online {
          background: #22c55e;
          animation: usb-online-glow 2.5s ease-in-out infinite;
        }

        @keyframes usb-online-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          50%       { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
        }

        /* idle/away */
        .usb-dot--idle {
          background: #f59e0b;
        }

        .usb-text {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .usb-root:hover .usb-text {
          color: var(--text-primary);
        }
      `}</style>
    </button>
  );
}
