'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import type { ActiveView } from '@/lib/store';
import { stripIrcFormatting } from '@/lib/ircColors';

const TIME_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface SearchResult {
  channelKey: string;
  channelName: string;
  isDm: boolean;
  message: ChatMessage;
}

interface RecentChannel {
  key: string;
  name: string;
  isDm: boolean;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function SearchOverlay() {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const closeSearchOverlay = useOnyxStore(s => s.closeSearchOverlay);
  const navigate            = useOnyxStore(s => s.navigate);
  const channels            = useOnyxStore(s => s.channels);
  const dms                 = useOnyxStore(s => s.dms);
  const activeView          = useOnyxStore(s => s.activeView);

  const debouncedQuery = useDebounce(query, 150);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build last-5 recently-visited channels heuristic from channel order
  const recentChannels: RecentChannel[] = useMemo(() => {
    const chList = [...channels.values()].slice(0, 5).map(c => ({
      key: c.name.toLowerCase(),
      name: c.name,
      isDm: false,
    }));
    const dmList = [...dms.values()].slice(0, Math.max(0, 5 - chList.length)).map(d => ({
      key: d.nick.toLowerCase(),
      name: d.nick,
      isDm: true,
    }));
    return [...chList, ...dmList];
  }, [channels, dms]);

  // Search across all channels + DMs
  const results: SearchResult[] = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2) return [];

    const hits: SearchResult[] = [];

    for (const ch of channels.values()) {
      for (const msg of ch.messages) {
        if (
          (msg.type === 'msg' || msg.type === 'action') &&
          !msg.deleted &&
          (msg.text.toLowerCase().includes(q) || msg.from.toLowerCase().includes(q))
        ) {
          hits.push({ channelKey: ch.name.toLowerCase(), channelName: ch.name, isDm: false, message: msg });
        }
      }
    }

    for (const dm of dms.values()) {
      for (const msg of dm.messages) {
        if (
          (msg.type === 'msg' || msg.type === 'action') &&
          !msg.deleted &&
          (msg.text.toLowerCase().includes(q) || msg.from.toLowerCase().includes(q))
        ) {
          hits.push({ channelKey: dm.nick.toLowerCase(), channelName: dm.nick, isDm: true, message: msg });
        }
      }
    }

    // Sort newest first, cap at 100
    hits.sort((a, b) => b.message.time.getTime() - a.message.time.getTime());
    return hits.slice(0, 100);
  }, [channels, dms, debouncedQuery]);

  // Group results by channel
  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const existing = map.get(r.channelKey) ?? [];
      existing.push(r);
      map.set(r.channelKey, existing);
    }
    return map;
  }, [results]);

  // Flat list of results for keyboard nav
  const flatResults = results;

  // Reset selection on query change
  useEffect(() => {
    setSelectedIdx(0);
  }, [debouncedQuery]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-result-idx="${selectedIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const selectResult = useCallback((r: SearchResult) => {
    closeSearchOverlay();
    const view: ActiveView = r.isDm
      ? { kind: 'dm', nick: r.channelName }
      : { kind: 'channel', channel: r.channelName };
    navigate(view);
    // Scroll to the message after navigation settles
    setTimeout(() => {
      const el = document.querySelector(`[data-msg-id="${r.message.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('msg--jump-highlight');
      setTimeout(() => el?.classList.remove('msg--jump-highlight'), 2000);
    }, 120);
  }, [closeSearchOverlay, navigate]);

  const selectRecent = useCallback((r: RecentChannel) => {
    closeSearchOverlay();
    const view: ActiveView = r.isDm
      ? { kind: 'dm', nick: r.name }
      : { kind: 'channel', channel: r.name };
    navigate(view);
  }, [closeSearchOverlay, navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchOverlay();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatResults.length > 0) {
        setSelectedIdx(i => Math.min(i + 1, flatResults.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = flatResults[selectedIdx];
      if (r) selectResult(r);
    }
  }, [flatResults, selectedIdx, selectResult, closeSearchOverlay]);

  function highlightText(text: string, q: string): string {
    if (!q || q.length < 2) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, idx)) +
      `<mark class="so-mark">${escapeHtml(text.slice(idx, idx + q.length))}</mark>` +
      escapeHtml(text.slice(idx + q.length))
    );
  }

  const trimmedQuery = debouncedQuery.trim();
  const showRecent  = trimmedQuery.length < 2;
  const showResults = trimmedQuery.length >= 2;

  // Build result index map for rendering
  let globalIdx = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="so-backdrop"
        onClick={closeSearchOverlay}
        aria-hidden
      />

      {/* Panel */}
      <div
        className="so-panel animate-fade-scale"
        role="dialog"
        aria-modal
        aria-label="Global search"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="so-header">
          <SearchIcon />
          <input
            ref={inputRef}
            className="so-input"
            placeholder="Search messages across all channels…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Global search input"
          />
          {query && (
            <button
              className="so-clear"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear search"
            >
              <CloseIcon />
            </button>
          )}
          <kbd className="so-esc-hint">esc</kbd>
        </div>

        {/* Body */}
        <div className="so-body" ref={listRef}>

          {/* Recent channels (shown when idle) */}
          {showRecent && recentChannels.length > 0 && (
            <div className="so-section">
              <div className="so-section-label">Recent</div>
              {recentChannels.map(rc => (
                <button
                  key={rc.key}
                  className={`so-recent-item ${
                    activeView.kind === 'channel' && activeView.channel.toLowerCase() === rc.key
                    ? 'so-recent-item--active'
                    : activeView.kind === 'dm' && activeView.nick.toLowerCase() === rc.key
                    ? 'so-recent-item--active'
                    : ''
                  }`}
                  onClick={() => selectRecent(rc)}
                >
                  <span className="so-recent-sigil">{rc.isDm ? '@' : '#'}</span>
                  <span className="so-recent-name">{rc.isDm ? rc.name : rc.name.replace(/^[#&]/, '')}</span>
                </button>
              ))}
            </div>
          )}

          {showRecent && recentChannels.length === 0 && (
            <div className="so-empty">Join some channels to see them here</div>
          )}

          {/* Results */}
          {showResults && results.length === 0 && (
            <div className="so-empty">
              No messages found for <strong>&quot;{trimmedQuery}&quot;</strong>
            </div>
          )}

          {showResults && results.length > 0 && (
            <div className="so-section">
              <div className="so-section-label">{results.length} result{results.length !== 1 ? 's' : ''}</div>
              {[...grouped.entries()].map(([chKey, chResults]) => {
                const first = chResults[0];
                return (
                  <div key={chKey} className="so-group">
                    <div className="so-group-header">
                      <span className="so-group-sigil">{first.isDm ? '@' : '#'}</span>
                      <span className="so-group-name">
                        {first.isDm ? first.channelName : first.channelName.replace(/^[#&]/, '')}
                      </span>
                    </div>
                    {chResults.map(r => {
                      const myIdx = globalIdx++;
                      const isSelected = myIdx === selectedIdx;
                      const preview = stripIrcFormatting(r.message.text).slice(0, 120);
                      return (
                        <button
                          key={r.message.id}
                          data-result-idx={myIdx}
                          className={`so-result ${isSelected ? 'so-result--selected' : ''}`}
                          onClick={() => selectResult(r)}
                          onMouseEnter={() => setSelectedIdx(myIdx)}
                        >
                          <div className="so-result-meta">
                            <span className="so-result-from">{r.message.from}</span>
                            <time className="so-result-time">{TIME_FMT.format(r.message.time)}</time>
                          </div>
                          <p
                            className="so-result-text"
                            dangerouslySetInnerHTML={{ __html: highlightText(preview, trimmedQuery) }}
                          />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Hint when typing < 2 chars */}
          {!showRecent && !showResults && (
            <div className="so-empty">Type at least 2 characters to search</div>
          )}
        </div>

        {/* Footer hint */}
        <div className="so-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>

      <style>{`
        .so-backdrop {
          position: fixed;
          inset: 0;
          z-index: 900;
          background: rgba(3, 8, 16, 0.88);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: so-backdrop-in 160ms ease both;
        }

        @keyframes so-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .so-panel {
          position: fixed;
          top: 15vh;
          left: 50%;
          transform: translateX(-50%);
          width: 560px;
          max-width: calc(100vw - 32px);
          max-height: 70vh;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl), 0 0 0 1px var(--accent-border);
          z-index: 901;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        @keyframes fade-scale {
          from { opacity: 0; transform: translateX(-50%) scale(0.96) translateY(-6px); }
          to   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
        }
        .animate-fade-scale { animation: fade-scale 200ms var(--ease-out) both; }

        .so-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-float);
          flex-shrink: 0;
        }

        .so-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: 18px;
          color: var(--text-primary);
          font-family: inherit;
          min-width: 0;
          caret-color: var(--accent);
        }
        .so-input::placeholder { color: var(--text-muted); font-size: 15px; }

        .so-clear {
          width: 24px; height: 24px;
          background: none; border: none; cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          transition: color var(--t-fast), background var(--t-fast);
          flex-shrink: 0;
        }
        .so-clear:hover { color: var(--text-primary); background: var(--bg-overlay); }

        .so-esc-hint {
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-muted);
          background: var(--bg-overlay);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-xs);
          padding: 2px 6px;
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }

        .so-body {
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border) transparent;
        }

        .so-section {
          padding: 8px 0;
        }

        .so-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 6px 16px 4px;
        }

        .so-empty {
          padding: 32px 16px;
          text-align: center;
          font-size: 13px;
          color: var(--text-muted);
        }

        .so-recent-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          height: 48px;
          padding: 0 16px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background var(--t-fast);
          border-radius: 0;
        }
        .so-recent-item:hover { background: var(--accent-subtle); }
        .so-recent-item--active { background: var(--accent-subtle); }

        .so-recent-sigil {
          font-size: 13px;
          color: var(--text-muted);
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-float);
          border-radius: var(--r-xs);
          font-weight: 700;
        }
        .so-recent-item--active .so-recent-sigil,
        .so-recent-item:hover .so-recent-sigil { color: var(--accent); }

        .so-recent-name {
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 500;
        }
        .so-recent-item--active .so-recent-name { color: var(--accent); }

        .so-group {
          margin-bottom: 4px;
        }

        .so-group-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 16px 4px;
          position: sticky;
          top: 0;
          background: var(--bg-elevated);
          z-index: 1;
        }

        .so-group-sigil {
          font-size: 12px;
          color: var(--text-muted);
        }

        .so-group-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          letter-spacing: 0.02em;
        }

        .so-result {
          display: block;
          width: 100%;
          padding: 10px 16px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background var(--t-fast);
          border-left: 2px solid transparent;
        }
        .so-result:hover { background: var(--accent-subtle); }
        .so-result--selected {
          background: var(--accent-subtle);
          border-left: 2px solid var(--accent);
        }

        .so-result-meta {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 3px;
        }

        .so-result-from {
          font-size: 12px;
          font-weight: 700;
          color: var(--accent);
        }

        .so-result-time {
          font-size: 11px;
          color: var(--text-muted);
        }

        .so-result-text {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .so-mark {
          background: var(--accent-subtle);
          color: var(--accent);
          border-radius: 2px;
          padding: 0 2px;
          font-weight: 600;
        }

        .so-footer {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 10px 16px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
          font-size: 11px;
          color: var(--text-muted);
          background: var(--bg-deep);
        }

        .so-footer kbd {
          font-family: var(--font-mono);
          background: var(--bg-float);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-xs);
          padding: 1px 5px;
          margin-right: 3px;
          font-size: 10px;
        }

        /* Jump highlight used when navigating from global search */
        .msg--jump-highlight {
          animation: jump-pulse 2s ease-out forwards;
        }
        @keyframes jump-pulse {
          0%   { background: var(--accent-subtle); }
          100% { background: transparent; }
        }
      `}</style>
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
    <path d="M11 11l3.5 3.5" strokeLinecap="round" />
    <circle cx="6.5" cy="6.5" r="5" />
  </svg>
);

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 1l10 10M11 1L1 11" />
  </svg>
);
