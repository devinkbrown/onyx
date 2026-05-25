'use client';

import { useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function BookmarksPanel() {
  const closeBookmarks  = useOnyxStore(s => s.closeBookmarks);
  const bookmarks       = useOnyxStore(s => s.bookmarks);
  const removeBookmark  = useOnyxStore(s => s.removeBookmark);
  const navigate        = useOnyxStore(s => s.navigate);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBookmarks();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeBookmarks]);

  const handleCardClick = (msg: ChatMessage) => {
    // Navigate to the bookmarked message's target
    const isChannel = msg.target.startsWith('#') || msg.target.startsWith('&');
    if (isChannel) {
      navigate({ kind: 'channel', channel: msg.target });
    } else {
      navigate({ kind: 'dm', nick: msg.target });
    }
    // Fire jump-to-message so MessageList scrolls to this specific message
    window.dispatchEvent(
      new CustomEvent('ocean:jump-to-message', { detail: { msgId: msg.id } })
    );
    closeBookmarks();
  };

  return (
    <div
      className="bm-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closeBookmarks(); }}
      aria-modal="true"
      role="dialog"
      aria-label="Bookmarks"
    >
      <div className="bm-panel animate-slide-right">

        {/* Header */}
        <div className="bm-header">
          <div className="bm-header-left">
            <BookmarkIcon />
            <h2 className="bm-title">Bookmarks</h2>
            {bookmarks.length > 0 && (
              <span className="bm-count">{bookmarks.length}</span>
            )}
          </div>
          <button
            className="bm-close"
            onClick={closeBookmarks}
            aria-label="Close bookmarks"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="bm-body">
          {bookmarks.length === 0 ? (
            <EmptyState
              icon="🔖"
              title="No bookmarks yet"
              description="Right-click any message to bookmark it"
              size="md"
            />
          ) : (
            <ul className="bm-list" role="list">
              {[...bookmarks].reverse().map(msg => (
                <li
                  key={msg.id}
                  className="bm-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`Go to message from ${msg.from}`}
                  onClick={() => handleCardClick(msg)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleCardClick(msg);
                    }
                  }}
                >
                  <div className="bm-card-header">
                    <Avatar nick={msg.from} size={24} />
                    <span className="bm-card-nick">{msg.from}</span>
                    <span className="bm-card-target">
                      {msg.target.startsWith('#') || msg.target.startsWith('&')
                        ? msg.target
                        : `@${msg.target}`}
                    </span>
                    <time className="bm-card-time">
                      {TIME_FMT.format(msg.time)}
                    </time>
                    <button
                      className="bm-remove-btn"
                      title="Remove bookmark"
                      onClick={e => {
                        e.stopPropagation();
                        removeBookmark(msg.id);
                      }}
                      aria-label={`Remove bookmark for message from ${msg.from}`}
                    >
                      <RemoveIcon />
                    </button>
                  </div>
                  <p className="bm-card-text">
                    {msg.deleted
                      ? <em className="bm-deleted">Message deleted</em>
                      : msg.text
                    }
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{`
        .bm-backdrop {
          position: fixed; inset: 0; z-index: 640;
          display: flex; align-items: stretch; justify-content: flex-end;
        }

        .bm-panel {
          width: 380px; max-width: 95vw;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: -8px 0 40px rgba(0, 0, 0, 0.45);
        }

        /* Header */
        .bm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px;
          height: var(--header-h);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .bm-header-left {
          display: flex; align-items: center; gap: 8px;
        }
        .bm-title {
          font-size: 15px; font-weight: 700; color: var(--text-primary);
          letter-spacing: -0.2px;
        }
        .bm-count {
          font-size: 11px; font-weight: 700;
          padding: 1px 6px; border-radius: var(--r-full);
          background: var(--gold-subtle, rgba(232,184,75,0.12));
          border: 1px solid rgba(232,184,75,0.3);
          color: var(--gold);
        }
        .bm-close {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .bm-close:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        /* Body */
        .bm-body {
          flex: 1; overflow-y: auto; padding: 12px;
          display: flex; flex-direction: column; gap: 8px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        /* List */
        .bm-list {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 8px;
        }

        /* Card */
        .bm-card {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 10px 12px;
          display: flex; flex-direction: column; gap: 7px;
          cursor: pointer;
          transition: border-color var(--t-fast), background var(--t-fast);
          outline: none;
        }
        .bm-card:hover { border-color: var(--border-normal); background: var(--bg-float); }
        .bm-card:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .bm-card-header {
          display: flex; align-items: center; gap: 6px;
        }
        .bm-card-nick {
          font-size: 13px; font-weight: 700; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .bm-card-target {
          font-size: 11px; color: var(--text-muted);
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-xs);
          padding: 0 4px;
          flex-shrink: 0;
          max-width: 80px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .bm-card-time {
          font-size: 11px; color: var(--text-muted); flex: 1;
          text-align: right;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .bm-remove-btn {
          width: 22px; height: 22px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          opacity: 0; transition: opacity var(--t-fast), background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .bm-card:hover .bm-remove-btn { opacity: 1; }
        .bm-remove-btn:hover {
          background: var(--danger-subtle);
          color: var(--danger);
        }

        .bm-card-text {
          font-size: 13px; color: var(--text-secondary);
          line-height: 1.55; margin: 0;
          word-break: break-word;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          white-space: pre-wrap;
        }

        .bm-deleted {
          color: var(--text-muted);
          font-style: italic;
        }

        @keyframes slide-right {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .animate-slide-right { animation: slide-right 180ms var(--ease-out) both; }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const BookmarkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
    style={{ color: 'var(--gold)', flexShrink: 0 }}>
    <path d="M2 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.777.416L7 10.101l-4.223 2.815A.5.5 0 0 1 2 12.5V2zm1 0v9.566l3.723-2.482a.5.5 0 0 1 .554 0L11 11.566V2H3z"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

const RemoveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2 2l8 8M10 2L2 10" />
  </svg>
);
