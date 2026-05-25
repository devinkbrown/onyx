'use client';

import { useState, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';

type SortKey = 'members' | 'name';

const PAGE_SIZE = 50;

export default function ChannelBrowserModal() {
  const closeChannelBrowser = useOnyxStore((s) => s.closeChannelBrowser);
  const refreshChannelList = useOnyxStore((s) => s.refreshChannelList);
  const channelList = useOnyxStore((s) => s.channelList);
  const channelListLoading = useOnyxStore((s) => s.channelListLoading);
  const channels = useOnyxStore((s) => s.channels);
  const client = useOnyxStore((s) => s.client);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('members');
  const [page, setPage] = useState(1);

  const joinedKeys = useMemo(() => new Set([...channels.keys()]), [channels]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = q
      ? channelList.filter(
          (ch) =>
            ch.name.toLowerCase().includes(q) ||
            ch.topic.toLowerCase().includes(q),
        )
      : channelList;

    return [...list].sort((a, b) => {
      if (sortKey === 'members') return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [channelList, search, sortKey]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  const handleJoin = (name: string) => {
    client?.sendRaw('JOIN', name);
    closeChannelBrowser();
  };

  return (
    <div className="cbrowser-backdrop" onClick={closeChannelBrowser}>
      <div
        className="cbrowser-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Browse Channels"
      >
        {/* Header */}
        <div className="cbrowser-header">
          <div className="cbrowser-header-left">
            <GridIcon />
            <h2 className="cbrowser-title">Browse Channels</h2>
            <span className="cbrowser-count">
              {channelListLoading ? '…' : filtered.length}
            </span>
          </div>

          <div className="cbrowser-header-right">
            <div className="cbrowser-search-wrap">
              <SearchIcon />
              <input
                className="cbrowser-search"
                type="text"
                placeholder="Search channels or topics…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                autoFocus
              />
            </div>

            <button
              className="cbrowser-icon-btn"
              onClick={refreshChannelList}
              title="Refresh list"
              aria-label="Refresh channel list"
            >
              <RefreshIcon spinning={channelListLoading} />
            </button>

            <button
              className="cbrowser-icon-btn cbrowser-close"
              onClick={closeChannelBrowser}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Sort controls */}
        <div className="cbrowser-toolbar">
          <span className="cbrowser-sort-label">Sort by:</span>
          <button
            className={`cbrowser-sort-btn ${sortKey === 'members' ? 'cbrowser-sort-btn--active' : ''}`}
            onClick={() => setSortKey('members')}
          >
            Members
          </button>
          <button
            className={`cbrowser-sort-btn ${sortKey === 'name' ? 'cbrowser-sort-btn--active' : ''}`}
            onClick={() => setSortKey('name')}
          >
            Name
          </button>
        </div>

        {/* Table */}
        <div className="cbrowser-body">
          {/* Column headers */}
          <div className="cbrowser-row cbrowser-row--header">
            <span className="cbrowser-col-name">Channel</span>
            <span className="cbrowser-col-count">Members</span>
            <span className="cbrowser-col-topic">Topic</span>
            <span className="cbrowser-col-action" />
          </div>

          {/* Loading shimmer */}
          {channelListLoading && channelList.length === 0 && (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="cbrowser-row cbrowser-row--shimmer">
                  <span className="shimmer shimmer-name" />
                  <span className="shimmer shimmer-count" />
                  <span className="shimmer shimmer-topic" />
                  <span className="shimmer shimmer-btn" />
                </div>
              ))}
            </>
          )}

          {/* Empty state */}
          {!channelListLoading && filtered.length === 0 && (
            <div className="cbrowser-empty">
              {search
                ? `No channels matching "${search}"`
                : 'No channels available'}
            </div>
          )}

          {/* Channel rows */}
          {visible.map((ch) => {
            const joined = joinedKeys.has(ch.name.toLowerCase());
            return (
              <div key={ch.name} className="cbrowser-row cbrowser-row--data">
                <span className="cbrowser-col-name">
                  <span className="cbrowser-pill">{ch.name}</span>
                </span>
                <span className="cbrowser-col-count">
                  <span className="cbrowser-member-icon">👥</span>
                  {ch.count.toLocaleString()}
                </span>
                <span className="cbrowser-col-topic" title={ch.topic}>
                  {ch.topic.length > 400
                    ? ch.topic.slice(0, 400) + '…'
                    : ch.topic || (
                        <span className="cbrowser-no-topic">No topic set</span>
                      )}
                </span>
                <span className="cbrowser-col-action">
                  <button
                    className={`cbrowser-join-btn ${joined ? 'cbrowser-join-btn--joined' : ''}`}
                    onClick={() => !joined && handleJoin(ch.name)}
                    disabled={joined}
                  >
                    {joined ? 'Joined ✓' : 'Join'}
                  </button>
                </span>
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <div className="cbrowser-load-more">
              <button
                className="cbrowser-load-btn"
                onClick={() => setPage((p) => p + 1)}
              >
                Load more ({filtered.length - visible.length} remaining)
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .cbrowser-backdrop {
          position: fixed;
          inset: 0;
          z-index: 800;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 40px 16px;
          overflow-y: auto;
        }

        .cbrowser-modal {
          width: 100%;
          max-width: 900px;
          background: var(--bg-deep);
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
          max-height: calc(100vh - 80px);
        }

        /* ── Header ── */
        .cbrowser-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-elevated);
        }

        .cbrowser-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .cbrowser-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.2px;
          margin: 0;
          white-space: nowrap;
        }

        .cbrowser-count {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-float);
          border-radius: 999px;
          padding: 1px 8px;
          flex-shrink: 0;
        }

        .cbrowser-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .cbrowser-search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .cbrowser-search-wrap svg {
          position: absolute;
          left: 10px;
          color: var(--text-muted);
          pointer-events: none;
          flex-shrink: 0;
        }

        .cbrowser-search {
          width: 220px;
          padding: 7px 12px 7px 34px;
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color var(--t-fast);
        }
        .cbrowser-search:focus {
          outline: none;
          border-color: var(--accent-border);
        }
        .cbrowser-search::placeholder {
          color: var(--text-muted);
        }

        .cbrowser-icon-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          border-radius: var(--r-sm);
          color: var(--text-secondary);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .cbrowser-icon-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .cbrowser-close {
          font-size: 22px;
          line-height: 1;
          font-weight: 300;
        }

        /* ── Toolbar ── */
        .cbrowser-toolbar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 20px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .cbrowser-sort-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-right: 4px;
        }

        .cbrowser-sort-btn {
          padding: 4px 12px;
          border-radius: var(--r-full);
          border: 1px solid var(--border-subtle);
          background: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          font-family: inherit;
        }
        .cbrowser-sort-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }
        .cbrowser-sort-btn--active {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }

        /* ── Body / table ── */
        .cbrowser-body {
          flex: 1;
          overflow-y: auto;
          padding: 8px 0 16px;
        }

        /* Grid: name | count | topic | action */
        .cbrowser-row {
          display: grid;
          grid-template-columns: 200px 100px 1fr 100px;
          align-items: center;
          gap: 12px;
          padding: 8px 20px;
        }

        .cbrowser-row--header {
          padding-top: 6px;
          padding-bottom: 6px;
        }

        .cbrowser-row--header span {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
        }

        .cbrowser-row--data {
          border-radius: 6px;
          margin: 0 8px;
          transition: background var(--t-fast);
        }
        .cbrowser-row--data:hover {
          background: var(--bg-elevated);
        }

        /* Columns */
        .cbrowser-col-name {
          min-width: 0;
          overflow: hidden;
        }

        .cbrowser-pill {
          display: inline-block;
          background: var(--bg-float);
          border-radius: var(--r-sm);
          padding: 3px 8px;
          font-family: var(--font-mono, monospace);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 190px;
        }

        .cbrowser-col-count {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
        }

        .cbrowser-member-icon {
          font-size: 13px;
        }

        .cbrowser-col-topic {
          font-size: 13px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cbrowser-no-topic {
          color: var(--text-muted);
          font-style: italic;
        }

        .cbrowser-col-action {
          display: flex;
          justify-content: flex-end;
        }

        /* Join button */
        .cbrowser-join-btn {
          padding: 5px 16px;
          border-radius: var(--r-full);
          border: none;
          background: var(--accent);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity var(--t-fast), background var(--t-fast);
          white-space: nowrap;
          font-family: inherit;
        }
        .cbrowser-join-btn:hover:not(:disabled) {
          opacity: 0.88;
        }
        .cbrowser-join-btn--joined {
          background: transparent;
          color: var(--accent);
          border: 1px solid var(--accent-border);
          cursor: default;
        }

        /* Shimmer skeleton */
        .cbrowser-row--shimmer {
          border-radius: 6px;
          margin: 0 8px;
        }

        .shimmer {
          display: block;
          border-radius: 4px;
          background: linear-gradient(
            90deg,
            var(--bg-float) 25%,
            var(--bg-elevated) 50%,
            var(--bg-float) 75%
          );
          background-size: 200% 100%;
          animation: shimmer-anim 1.4s ease-in-out infinite;
        }

        @keyframes shimmer-anim {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .shimmer-name  { width: 140px; height: 28px; }
        .shimmer-count { width: 60px;  height: 20px; }
        .shimmer-topic { width: 100%;  height: 16px; }
        .shimmer-btn   { width: 56px;  height: 28px; border-radius: 999px; }

        /* Load more */
        .cbrowser-load-more {
          padding: 16px 20px;
          text-align: center;
        }

        .cbrowser-load-btn {
          padding: 8px 24px;
          border-radius: var(--r-full);
          border: 1px solid var(--border-subtle);
          background: none;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast);
          font-family: inherit;
        }
        .cbrowser-load-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* Empty state */
        .cbrowser-empty {
          padding: 48px 20px;
          text-align: center;
          color: var(--text-muted);
          font-size: 14px;
        }

        /* Responsive */
        @media (max-width: 640px) {
          .cbrowser-backdrop {
            padding: 0;
            align-items: flex-end;
          }
          .cbrowser-modal {
            max-width: 100%;
            border-radius: 12px 12px 0 0;
            max-height: 85dvh;
          }
          .cbrowser-row {
            grid-template-columns: 1fr 80px 90px;
          }
          .cbrowser-col-topic { display: none; }
          .cbrowser-search { width: 150px; }
        }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ color: 'var(--accent)', flexShrink: 0 }}
    >
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="1.5" width="6" height="6" rx="1.5" />
      <rect x="1.5" y="10.5" width="6" height="6" rx="1.5" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      style={{
        animation: spinning ? 'cbrowser-spin 0.8s linear infinite' : 'none',
      }}
    >
      <path d="M13.5 8A5.5 5.5 0 1 1 10 3.1" />
      <path d="M10 1v3h3" />
      <style>{`
        @keyframes cbrowser-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </svg>
  );
}
