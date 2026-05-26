'use client';

import { useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function PinnedMessagesModal() {
  const closePinnedMessages = useOnyxStore(s => s.closePinnedMessages);
  const unpinMessage        = useOnyxStore(s => s.unpinMessage);
  const pinnedMessages      = useOnyxStore(s => s.pinnedMessages);
  const activeView          = useOnyxStore(s => s.activeView);

  const target = activeView.kind === 'channel' ? activeView.channel : '';
  const pinned = target ? (pinnedMessages.get(target.toLowerCase()) ?? []) : [];

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePinnedMessages();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closePinnedMessages]);

  return (
    <div
      className="pin-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closePinnedMessages(); }}
      aria-modal="true"
      role="dialog"
      aria-label="Pinned Messages"
    >
      <div className="pin-panel animate-slide-right">

        {/* Header */}
        <div className="pin-header">
          <div className="pin-header-left">
            <PinIcon />
            <h2 className="pin-title">Pinned Messages</h2>
            {pinned.length > 0 && (
              <span className="pin-count">{pinned.length}</span>
            )}
          </div>
          <button
            className="pin-close"
            onClick={closePinnedMessages}
            aria-label="Close pinned messages"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="pin-body">
          {pinned.length === 0 ? (
            <div className="pin-empty">
              <span className="pin-empty-icon">📌</span>
              <p className="pin-empty-title">No pinned messages</p>
              <p className="pin-empty-hint">
                Hover over a message and click the pin icon to pin important
                messages here for easy reference.
              </p>
            </div>
          ) : (
            <ul className="pin-list" role="list">
              {[...pinned].reverse().map(msg => (
                <li key={msg.id} className="pin-card">
                  <div className="pin-card-header">
                    <Avatar nick={msg.from} size={24} />
                    <span className="pin-card-nick">{msg.from}</span>
                    <time className="pin-card-time">
                      {TIME_FMT.format(msg.time)}
                    </time>
                    <button
                      className="pin-unpin-btn"
                      title="Unpin message"
                      onClick={() => unpinMessage(target, msg.id)}
                      aria-label={`Unpin message from ${msg.from}`}
                    >
                      <UnpinIcon />
                    </button>
                  </div>
                  <p className="pin-card-text">
                    {msg.deleted
                      ? <em className="pin-deleted">Message deleted</em>
                      : truncate(msg.text, 220)
                    }
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{`
        .pin-backdrop {
          position: fixed; inset: 0; z-index: 600;
          display: flex; align-items: stretch; justify-content: flex-end;
        }

        .pin-panel {
          width: 360px; max-width: 95vw;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: -12px 0 48px rgba(0, 0, 0, 0.55), -1px 0 0 var(--border-subtle);
        }

        /* Header */
        .pin-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px;
          height: var(--header-h, 48px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-elevated);
        }
        .pin-header-left {
          display: flex; align-items: center; gap: 8px;
        }
        .pin-title {
          font-size: 14px; font-weight: 700; color: var(--text-primary);
          letter-spacing: -0.1px;
        }
        .pin-count {
          font-size: 11px; font-weight: 700;
          padding: 1px 7px; border-radius: var(--r-full);
          background: var(--accent-subtle); border: 1px solid var(--accent-border);
          color: var(--accent);
        }
        .pin-close {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .pin-close:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        /* Body */
        .pin-body {
          flex: 1; overflow-y: auto; padding: 12px;
          display: flex; flex-direction: column; gap: 8px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        /* Empty state */
        .pin-empty {
          display: flex; flex-direction: column; align-items: center;
          gap: 12px; padding: 56px 24px; text-align: center;
          flex: 1; justify-content: center;
        }
        .pin-empty-icon {
          font-size: 36px;
          opacity: 0.5;
          filter: grayscale(0.3);
        }
        .pin-empty-title {
          font-size: 15px; font-weight: 700; color: var(--text-secondary);
          margin: 0;
        }
        .pin-empty-hint {
          font-size: 13px; color: var(--text-muted);
          line-height: 1.65; margin: 0; max-width: 260px;
        }

        /* Pinned message list */
        .pin-list {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 7px;
        }

        /* Card */
        .pin-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 11px 12px;
          display: flex; flex-direction: column; gap: 7px;
          transition: border-color var(--t-fast), background var(--t-fast);
          position: relative;
        }
        .pin-card::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 2px;
          background: var(--accent);
          border-radius: var(--r-xs) 0 0 var(--r-xs);
          opacity: 0;
          transition: opacity var(--t-fast);
        }
        .pin-card:hover {
          border-color: var(--border-normal);
          background: var(--bg-float);
        }
        .pin-card:hover::before { opacity: 1; }

        .pin-card-header {
          display: flex; align-items: center; gap: 7px;
        }
        .pin-card-nick {
          font-size: 13px; font-weight: 700; color: var(--text-primary);
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pin-card-time {
          font-size: 11px; color: var(--text-muted); flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        /* Unpin — red X on hover */
        .pin-unpin-btn {
          width: 22px; height: 22px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          opacity: 0;
          transition: opacity var(--t-fast), background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .pin-card:hover .pin-unpin-btn { opacity: 1; }
        .pin-unpin-btn:hover {
          background: var(--danger-subtle);
          color: var(--danger);
        }

        .pin-card-text {
          font-size: 13px; color: var(--text-secondary);
          line-height: 1.55; margin: 0;
          word-break: break-word;
          white-space: pre-wrap;
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .pin-deleted {
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

const PinIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor"
    style={{ color: 'var(--accent)', flexShrink: 0 }}>
    <path d="M9.5 1a.5.5 0 0 1 .354.146l4 4a.5.5 0 0 1-.122.805L10.25 7.5l-.25 1.5-3 3-1.5-.5L4 13l-2-2 1.5-1.5-.5-1.5 3-3 1.5-.25 2.005-3.364A.5.5 0 0 1 9.5 1zM9.5 2.207 7.617 5.39a.5.5 0 0 1-.26.213L5.947 6.03l-.37 2.22-2.537 2.537.963.963 2.537-2.537 2.22-.37.427-1.41a.5.5 0 0 1 .213-.26L12.793 5.5 9.5 2.207z"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

const UnpinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 15 15" fill="currentColor">
    <path d="M9.5 1a.5.5 0 0 1 .354.146l4 4a.5.5 0 0 1-.122.805L10.25 7.5l-.25 1.5-3 3-1.5-.5L4 13l-2-2 1.5-1.5-.5-1.5 3-3 1.5-.25 2.005-3.364A.5.5 0 0 1 9.5 1zM9.5 2.207 7.617 5.39a.5.5 0 0 1-.26.213L5.947 6.03l-.37 2.22-2.537 2.537.963.963 2.537-2.537 2.22-.37.427-1.41a.5.5 0 0 1 .213-.26L12.793 5.5 9.5 2.207z"/>
    <line x1="1" y1="14" x2="14" y2="1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
