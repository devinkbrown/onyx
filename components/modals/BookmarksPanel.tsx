'use client';

import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ModalShell from './ModalShell';

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
    <ModalShell
      onClose={closeBookmarks}
      variant="sheet"
      size="sm"
      title="Bookmarks"
      kicker="Saved messages"
      titleId="bm-panel-title"
      closeLabel="Close bookmarks"
      headerExtra={bookmarks.length > 0 ? <span className="bm-count">{bookmarks.length}</span> : undefined}
      flushBody
    >
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

      <style>{`
        .bm-count {
          font-size: var(--text-2xs, 11px); font-weight: 700;
          padding: 1px 7px; border-radius: var(--r-full);
          background: var(--gold-subtle);
          border: 1px solid color-mix(in srgb, var(--gold) 30%, transparent);
          color: var(--gold);
        }

        .bm-body {
          padding: var(--sp-3, 12px);
          display: flex; flex-direction: column; gap: var(--sp-2, 8px);
          min-height: 100%;
        }

        /* List */
        .bm-list {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 7px;
        }

        /* Card */
        .bm-card {
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 11px 12px;
          display: flex; flex-direction: column; gap: 7px;
          cursor: pointer;
          transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
          outline: none;
          position: relative;
        }
        .bm-card:hover {
          border-color: var(--gold-subtle);
          background: var(--bg-float);
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .bm-card:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .bm-card-header {
          display: flex; align-items: center; gap: 7px;
        }
        .bm-card-nick {
          font-size: var(--text-sm, 13px); font-weight: 700; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        /* Channel badge */
        .bm-card-target {
          font-size: var(--text-2xs, 11px); font-weight: 600; color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-xs);
          padding: 1px 6px;
          flex-shrink: 0;
          max-width: 100px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .bm-card-time {
          font-size: var(--text-2xs, 11px); color: var(--text-muted); flex: 1;
          text-align: right;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        /* Remove button — appears on hover */
        .bm-remove-btn {
          width: 22px; height: 22px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          opacity: 0;
          transition: opacity var(--t-control, 150ms), background var(--t-control, 150ms), color var(--t-control, 150ms);
          flex-shrink: 0;
        }
        .bm-card:hover .bm-remove-btn,
        .bm-remove-btn:focus-visible { opacity: 1; }
        .bm-remove-btn:hover {
          background: var(--danger-subtle);
          color: var(--danger);
        }

        .bm-card-text {
          font-size: var(--text-sm, 13px); color: var(--text-secondary);
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
      `}</style>
    </ModalShell>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const RemoveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2 2l8 8M10 2L2 10" />
  </svg>
);
