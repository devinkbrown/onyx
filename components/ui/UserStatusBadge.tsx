'use client';

import { useOnyxStore } from '@/lib/store';

/* ── Types ─────────────────────────────────────────────────────── */

type StatusDotSize = 'sm' | 'md' | 'lg';
type StatusValue   = 'online' | 'idle' | 'dnd' | 'offline';

const DOT_PX: Record<StatusDotSize, number> = {
  sm: 8,
  md: 10,
  lg: 12,
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
          border: 2px solid var(--bg-void, #030810);
          position: absolute;
          bottom: -1px;
          right: -1px;
        }

        .sdot--online {
          background: var(--status-online-solid, #23a55a);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
        }

        /* idle — solid amber, no animation */
        .sdot--idle {
          background: var(--status-idle-solid, #f0b232);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
        }

        /* dnd — red with horizontal bar */
        .sdot--dnd {
          background: var(--status-dnd-solid, #f04747);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
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
          background: var(--status-offline-solid, #80848e);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
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
      type="button"
      onClick={openAwayModal}
      aria-haspopup="dialog"
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
          background: var(--elev-tint-1, transparent);
          border: none;
          cursor: pointer;
          border-radius: var(--r-xs, 4px) var(--r-md, 8px) var(--r-xs, 4px) var(--r-sm, 6px);
          width: 100%;
          text-align: left;
          transition: background var(--t-fast);
        }
        .usb-root:hover {
          background: var(--ch-hover-bg);
        }

        .usb-dot-wrap {
          position: relative;
          width: 8px;
          height: 8px;
          flex-shrink: 0;
        }

        .usb-dot {
          position: absolute;
          inset: 0;
          border-radius: 50%;
        }

        /* online */
        .usb-dot--online {
          background: var(--status-online-solid, #23a55a);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
        }

        /* idle/away */
        .usb-dot--idle {
          background: var(--status-idle-solid, #f0b232);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
        }

        /* dnd */
        .usb-dot--dnd {
          background: var(--status-dnd-solid, #f04747);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
        }

        /* offline */
        .usb-dot--offline {
          background: var(--status-offline-solid, #80848e);
          transition: background var(--t-surface, 300ms) var(--ease-out, ease);
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
