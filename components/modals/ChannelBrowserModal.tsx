'use client';

import { useState, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

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
    <ModalShell
      onClose={closeChannelBrowser}
      title="Browse Channels"
      kicker="Discover"
      titleId="cbrowser-title"
      size="lg"
      flushBody
      headerExtra={
        <>
          <span className="cbrowser-count">
            {channelListLoading ? '…' : filtered.length}
          </span>
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
        </>
      }
    >
      {/* Sort controls */}
      <div className="cbrowser-toolbar">
        <span className="label-caps cbrowser-sort-label">Sort by:</span>
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
                <span className="cbrowser-member-pill">
                  <span className="cbrowser-member-icon">👥</span>
                  {ch.count.toLocaleString()}
                </span>
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

      <style>{`
        .cbrowser-count {
          font-size: var(--text-2xs, 11px);
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-full);
          padding: 1px 8px;
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
          width: 224px;
          height: 36px;
          padding: 0 12px 0 34px;
          background: var(--bg-void);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          font-size: var(--text-sm, 13px);
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
        }
        .cbrowser-search:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow);
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
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms);
          flex-shrink: 0;
        }
        .cbrowser-icon-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* ── Toolbar ── */
        .cbrowser-toolbar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: var(--sp-2, 8px) 18px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .cbrowser-sort-label {
          margin-right: 4px;
        }

        .cbrowser-sort-btn {
          padding: 3px 11px;
          border-radius: var(--r-full);
          border: 1px solid var(--border-subtle);
          background: none;
          cursor: pointer;
          font-size: var(--text-xs, 12px);
          font-weight: 600;
          color: var(--text-secondary);
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms), border-color var(--t-control, 150ms);
          font-family: inherit;
        }
        .cbrowser-sort-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }
        .cbrowser-sort-btn--active {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }

        /* ── Body / table ── */
        .cbrowser-body {
          flex: 1;
          min-height: 360px;
          padding: 6px 0 12px;
        }

        /* Grid: name | count | topic | action */
        .cbrowser-row {
          display: grid;
          grid-template-columns: 190px 90px 1fr 90px;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          height: 44px;
        }

        .cbrowser-row--header {
          height: 32px;
        }

        .cbrowser-row--header span {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
        }

        .cbrowser-row--data {
          border-radius: var(--r-sm);
          margin: 0 6px;
          transition: background var(--t-control, 150ms);
          position: relative;
        }
        .cbrowser-row--data:hover {
          background: var(--elev-tint-1, var(--accent-subtle));
        }
        /* Show join button only on hover */
        .cbrowser-row--data .cbrowser-join-btn:not(.cbrowser-join-btn--joined) {
          opacity: 0;
          transition: opacity var(--t-control, 150ms), background var(--t-control, 150ms);
        }
        .cbrowser-row--data:hover .cbrowser-join-btn:not(.cbrowser-join-btn--joined),
        .cbrowser-row--data:focus-within .cbrowser-join-btn:not(.cbrowser-join-btn--joined) {
          opacity: 1;
        }

        /* Columns */
        .cbrowser-col-name {
          min-width: 0;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .cbrowser-pill {
          display: inline-block;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-xs);
          padding: 2px 7px;
          font-family: var(--font-mono, monospace);
          font-size: var(--text-sm, 13px);
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 170px;
        }

        .cbrowser-col-count {
          display: flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
        }

        /* Member count pill */
        .cbrowser-member-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-float);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          padding: 2px 8px;
          font-size: var(--text-2xs, 11px);
          font-weight: 600;
          color: var(--text-muted);
        }

        .cbrowser-member-icon {
          font-size: 11px;
          line-height: 1;
        }

        .cbrowser-col-topic {
          font-size: var(--text-sm, 13px);
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cbrowser-no-topic {
          color: var(--text-muted);
          font-style: italic;
          opacity: 0.6;
        }

        .cbrowser-col-action {
          display: flex;
          justify-content: flex-end;
        }

        /* Join button */
        .cbrowser-join-btn {
          padding: 4px 14px;
          border-radius: var(--r-full);
          border: none;
          background: var(--accent);
          color: #fff;
          font-size: var(--text-xs, 12px);
          font-weight: 700;
          cursor: pointer;
          transition: opacity var(--t-control, 150ms), background var(--t-control, 150ms);
          white-space: nowrap;
          font-family: inherit;
          letter-spacing: 0.02em;
        }
        .cbrowser-join-btn:hover:not(:disabled) {
          background: var(--accent-hover);
        }
        .cbrowser-join-btn--joined {
          background: transparent;
          color: var(--accent);
          border: 1px solid var(--accent-border);
          cursor: default;
          opacity: 1 !important;
        }

        /* Shimmer skeleton */
        .cbrowser-row--shimmer {
          border-radius: var(--r-sm);
          margin: 0 6px;
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
        @media (prefers-reduced-motion: reduce) {
          .shimmer { animation: none; }
        }

        .shimmer-name  { width: 140px; height: 24px; border-radius: var(--r-xs); }
        .shimmer-count { width: 60px;  height: 20px; border-radius: var(--r-full); }
        .shimmer-topic { width: 100%;  height: 14px; }
        .shimmer-btn   { width: 56px;  height: 24px; border-radius: var(--r-full); }

        /* Load more */
        .cbrowser-load-more {
          padding: var(--sp-3, 12px) 18px;
          text-align: center;
        }

        .cbrowser-load-btn {
          padding: 7px 20px;
          border-radius: var(--r-full);
          border: 1px solid var(--border-normal);
          background: none;
          color: var(--text-secondary);
          font-size: var(--text-sm, 13px);
          font-weight: 500;
          cursor: pointer;
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms), border-color var(--t-control, 150ms);
          font-family: inherit;
        }
        .cbrowser-load-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
          border-color: var(--accent-border);
        }

        /* Empty state */
        .cbrowser-empty {
          padding: 48px 20px;
          text-align: center;
          color: var(--text-muted);
          font-size: var(--text-base, 14px);
          line-height: 1.6;
        }

        /* Responsive */
        @media (max-width: 640px) {
          .cbrowser-row {
            grid-template-columns: 1fr 70px 80px;
          }
          .cbrowser-col-topic { display: none; }
          .cbrowser-search { width: 150px; }
        }
      `}</style>
    </ModalShell>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

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
