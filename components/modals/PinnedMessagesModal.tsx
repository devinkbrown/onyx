'use client';

import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import ModalShell from './ModalShell';

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

  return (
    <ModalShell
      onClose={closePinnedMessages}
      variant="sheet"
      size="sm"
      title="Pinned Messages"
      kicker={target || 'Channel'}
      titleId="pin-panel-title"
      closeLabel="Close pinned messages"
      headerExtra={pinned.length > 0 ? <span className="pin-count">{pinned.length}</span> : undefined}
      flushBody
    >
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

      <style>{`
        .pin-count {
          font-size: var(--text-2xs, 11px); font-weight: 700;
          padding: 1px 7px; border-radius: var(--r-full);
          background: var(--accent-subtle); border: 1px solid var(--accent-border);
          color: var(--accent);
        }

        .pin-body {
          padding: var(--sp-3, 12px);
          display: flex; flex-direction: column; gap: var(--sp-2, 8px);
          min-height: 100%;
        }

        /* Empty state */
        .pin-empty {
          display: flex; flex-direction: column; align-items: center;
          gap: var(--sp-3, 12px); padding: 56px 24px; text-align: center;
          flex: 1; justify-content: center;
        }
        .pin-empty-icon {
          font-size: 36px;
          opacity: 0.5;
          filter: grayscale(0.3);
        }
        .pin-empty-title {
          font-size: var(--text-md, 15px); font-weight: 700; color: var(--text-secondary);
          margin: 0;
        }
        .pin-empty-hint {
          font-size: var(--text-sm, 13px); color: var(--text-muted);
          line-height: 1.65; margin: 0; max-width: 260px;
        }

        /* Pinned message list */
        .pin-list {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 7px;
        }

        /* Card */
        .pin-card {
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 11px 12px;
          display: flex; flex-direction: column; gap: 7px;
          transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms);
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
          transition: opacity var(--t-control, 150ms);
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
          font-size: var(--text-sm, 13px); font-weight: 700; color: var(--text-primary);
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pin-card-time {
          font-size: var(--text-2xs, 11px); color: var(--text-muted); flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        /* Unpin — red X on hover */
        .pin-unpin-btn {
          width: 22px; height: 22px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          opacity: 0;
          transition: opacity var(--t-control, 150ms), background var(--t-control, 150ms), color var(--t-control, 150ms);
          flex-shrink: 0;
        }
        .pin-card:hover .pin-unpin-btn,
        .pin-unpin-btn:focus-visible { opacity: 1; }
        .pin-unpin-btn:hover {
          background: var(--danger-subtle);
          color: var(--danger);
        }

        .pin-card-text {
          font-size: var(--text-sm, 13px); color: var(--text-secondary);
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
    </ModalShell>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

const UnpinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 15 15" fill="currentColor">
    <path d="M9.5 1a.5.5 0 0 1 .354.146l4 4a.5.5 0 0 1-.122.805L10.25 7.5l-.25 1.5-3 3-1.5-.5L4 13l-2-2 1.5-1.5-.5-1.5 3-3 1.5-.25 2.005-3.364A.5.5 0 0 1 9.5 1zM9.5 2.207 7.617 5.39a.5.5 0 0 1-.26.213L5.947 6.03l-.37 2.22-2.537 2.537.963.963 2.537-2.537 2.22-.37.427-1.41a.5.5 0 0 1 .213-.26L12.793 5.5 9.5 2.207z"/>
    <line x1="1" y1="14" x2="14" y2="1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
