'use client';

import { useOnyxStore } from '@/lib/store';
import type { Announcement } from '@/lib/store';

function relativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function AnnouncementItem({ ann }: { ann: Announcement }) {
  const isWallops = ann.type === 'wallops';
  return (
    <div className="ann-item">
      <div className="ann-item-header">
        <span className="ann-from-icon">{isWallops ? '⚡' : '📡'}</span>
        <span className="ann-from">{ann.from}</span>
        <span className={`ann-type-badge${isWallops ? '' : ' notice'}`}>
          {isWallops ? 'WALLOPS' : 'NOTICE'}
        </span>
        <span className="ann-time">{relativeTime(ann.time)}</span>
      </div>
      <p className="ann-text">{ann.text}</p>
    </div>
  );
}

export default function AnnouncementsPanel() {
  const announcements        = useOnyxStore(s => s.announcements);
  const closeAnnouncementsPanel = useOnyxStore(s => s.closeAnnouncementsPanel);
  const clearAnnouncements   = useOnyxStore(s => s.clearAnnouncements);

  const unread = announcements.filter(a => !a.read).length;
  const sorted = [...announcements].reverse();

  return (
    <>
      <div className="ann-panel" role="dialog" aria-label="Server Announcements" aria-modal="false">
        <div className="ann-header">
          <span className="ann-title">📢 Server Announcements</span>
          {unread > 0 && (
            <span className="ann-badge" aria-label={`${unread} unread`}>{unread}</span>
          )}
          <button
            className="ann-close"
            onClick={closeAnnouncementsPanel}
            aria-label="Close announcements"
          >
            ✕
          </button>
        </div>

        <div className="ann-list">
          {sorted.length === 0 ? (
            <p className="ann-empty">No announcements</p>
          ) : (
            sorted.map(ann => <AnnouncementItem key={ann.id} ann={ann} />)
          )}
        </div>

        {sorted.length > 0 && (
          <div className="ann-footer">
            <button className="ann-clear-btn" onClick={clearAnnouncements}>
              Clear all
            </button>
          </div>
        )}
      </div>

      <style>{`
        .ann-panel {
          position: fixed;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: min(600px, 100vw);
          max-height: 70vh;
          z-index: 60;
          display: flex;
          flex-direction: column;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-top: none;
          border-radius: 0 0 var(--r-xl, 16px) var(--r-xl, 16px);
          box-shadow: var(--shadow-xl);
          border-top: 2px solid #e8b84b;
          animation: ann-slide-down 0.25s ease;
        }
        @keyframes ann-slide-down {
          from { transform: translateX(-50%) translateY(-100%); }
          to   { transform: translateX(-50%) translateY(0); }
        }
        .ann-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .ann-title {
          font-weight: 700;
          font-size: 14px;
          color: var(--text-primary);
          flex: 1;
        }
        .ann-badge {
          background: #e8b84b;
          color: #000;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
        }
        .ann-close {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: none;
          background: var(--bg-elevated);
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-family: inherit;
          transition: background var(--t-fast), color var(--t-fast);
        }
        .ann-close:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .ann-list {
          overflow-y: auto;
          flex: 1;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ann-empty {
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
          padding: 24px 0;
          margin: 0;
        }
        .ann-item {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ann-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ann-from-icon {
          font-size: 14px;
          flex-shrink: 0;
        }
        .ann-from {
          font-weight: 700;
          font-size: 13px;
          color: var(--text-primary);
        }
        .ann-type-badge {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(232,184,75,0.15);
          color: #e8b84b;
          border: 1px solid rgba(232,184,75,0.3);
        }
        .ann-type-badge.notice {
          background: rgba(56,189,248,0.12);
          color: #38bdf8;
          border-color: rgba(56,189,248,0.25);
        }
        .ann-time {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          flex-shrink: 0;
        }
        .ann-text {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 0;
          word-break: break-word;
        }
        .ann-footer {
          padding: 10px 16px;
          border-top: 1px solid var(--border-subtle);
          display: flex;
          justify-content: flex-end;
          flex-shrink: 0;
        }
        .ann-clear-btn {
          font-size: 12px;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: color var(--t-fast);
        }
        .ann-clear-btn:hover {
          color: var(--text-secondary);
        }
      `}</style>
    </>
  );
}
