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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

export default function DMPinsPanel() {
  const closeDMPins       = useOnyxStore(s => s.closeDMPins);
  const unpinDMMessage    = useOnyxStore(s => s.unpinDMMessage);
  const dmPinnedMessages  = useOnyxStore(s => s.dmPinnedMessages);
  const dmPinsNick        = useOnyxStore(s => s.dmPinsNick);

  const nick   = dmPinsNick ?? '';
  const pinned = nick ? (dmPinnedMessages.get(nick.toLowerCase()) ?? []) : [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDMPins();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeDMPins]);

  return (
    <div
      className="dmp-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closeDMPins(); }}
      aria-modal="true"
      role="dialog"
      aria-label={`Pinned messages in DM with ${nick}`}
    >
      <div className="dmp-panel animate-slide-right">

        {/* Header */}
        <div className="dmp-header">
          <div className="dmp-header-left">
            <PinIcon />
            <div className="dmp-header-text">
              <h2 className="dmp-title">Pinned Messages</h2>
              <p className="dmp-subtitle">DM with {nick}</p>
            </div>
            {pinned.length > 0 && (
              <span className="dmp-count">{pinned.length}</span>
            )}
          </div>
          <button
            className="dmp-close"
            onClick={closeDMPins}
            aria-label="Close pinned messages"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="dmp-body">
          {pinned.length === 0 ? (
            <div className="dmp-empty">
              <span className="dmp-empty-icon">📌</span>
              <p className="dmp-empty-title">No pinned messages</p>
              <p className="dmp-empty-hint">
                Right-click a message and choose &ldquo;Pin in DM&rdquo; to save
                important messages here for easy reference.
              </p>
            </div>
          ) : (
            <ul className="dmp-list" role="list">
              {[...pinned].reverse().map(msg => (
                <li key={msg.id} className="dmp-card">
                  <div className="dmp-card-header">
                    <Avatar nick={msg.from} size={24} />
                    <span className="dmp-card-nick">{msg.from}</span>
                    <time className="dmp-card-time">
                      {TIME_FMT.format(msg.time)}
                    </time>
                    <button
                      className="dmp-unpin-btn"
                      title="Unpin message"
                      onClick={() => unpinDMMessage(nick, msg.id)}
                      aria-label={`Unpin message from ${msg.from}`}
                    >
                      <UnpinIcon />
                    </button>
                  </div>
                  <p className="dmp-card-text">
                    {msg.deleted
                      ? <em className="dmp-deleted">Message deleted</em>
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
        .dmp-backdrop {
          position: fixed; inset: 0; z-index: 600;
          display: flex; align-items: stretch; justify-content: flex-end;
        }

        .dmp-panel {
          width: 320px; max-width: 95vw;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: -8px 0 40px rgba(0, 0, 0, 0.45);
        }

        .dmp-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px;
          height: var(--header-h);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .dmp-header-left {
          display: flex; align-items: center; gap: 8px;
          min-width: 0; flex: 1;
        }
        .dmp-header-text {
          display: flex; flex-direction: column; gap: 1px;
          min-width: 0;
        }
        .dmp-title {
          font-size: 14px; font-weight: 700; color: var(--text-primary);
          letter-spacing: -0.2px; margin: 0; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .dmp-subtitle {
          font-size: 11px; color: var(--text-muted); margin: 0; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .dmp-count {
          font-size: 11px; font-weight: 700;
          padding: 1px 6px; border-radius: var(--r-full);
          background: var(--accent-subtle); border: 1px solid var(--accent-border);
          color: var(--accent); flex-shrink: 0;
        }
        .dmp-close {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .dmp-close:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        .dmp-body {
          flex: 1; overflow-y: auto; padding: 12px;
          display: flex; flex-direction: column; gap: 8px;
        }

        .dmp-empty {
          display: flex; flex-direction: column; align-items: center;
          gap: 10px; padding: 40px 24px; text-align: center;
        }
        .dmp-empty-icon { font-size: 40px; }
        .dmp-empty-title {
          font-size: 16px; font-weight: 700; color: var(--text-primary);
          margin: 0;
        }
        .dmp-empty-hint {
          font-size: 13px; color: var(--text-muted);
          line-height: 1.6; margin: 0;
        }

        .dmp-list {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 8px;
        }

        .dmp-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          display: flex; flex-direction: column; gap: 7px;
          transition: border-color var(--t-fast);
        }
        .dmp-card:hover { border-color: var(--border-normal); }

        .dmp-card-header {
          display: flex; align-items: center; gap: 6px;
        }
        .dmp-card-nick {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .dmp-card-time {
          font-size: 11px; color: var(--text-muted); flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        .dmp-unpin-btn {
          width: 24px; height: 24px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          opacity: 0; transition: opacity var(--t-fast), background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .dmp-card:hover .dmp-unpin-btn { opacity: 1; }
        .dmp-unpin-btn:hover {
          background: var(--danger-subtle);
          color: var(--danger);
        }

        .dmp-card-text {
          font-size: 13px; color: var(--text-secondary);
          line-height: 1.55; margin: 0;
          word-break: break-word;
          white-space: pre-wrap;
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .dmp-deleted {
          color: var(--text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor"
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
