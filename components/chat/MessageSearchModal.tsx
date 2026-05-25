'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import EmptyState from '@/components/ui/EmptyState';

// ── Relative time helper ──────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 30) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}

// ── Highlight matching text ───────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: Array<{ str: string; highlighted: boolean }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = lowerText.indexOf(lowerQuery, pos);
    if (idx === -1) {
      parts.push({ str: text.slice(pos), highlighted: false });
      break;
    }
    if (idx > pos) {
      parts.push({ str: text.slice(pos, idx), highlighted: false });
    }
    parts.push({ str: text.slice(idx, idx + query.length), highlighted: true });
    pos = idx + query.length;
  }
  return (
    <>
      {parts.map((p, i) =>
        p.highlighted ? <mark key={i} className="msm-mark">{p.str}</mark> : <span key={i}>{p.str}</span>
      )}
    </>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

interface ResultRowProps {
  msg: ChatMessage;
  query: string;
  onJump: (msg: ChatMessage) => void;
}

function ResultRow({ msg, query, onJump }: ResultRowProps) {
  const ts = msg.time instanceof Date ? msg.time : new Date(msg.time);
  return (
    <div
      className="msm-result-row"
      role="button"
      tabIndex={0}
      onClick={() => onJump(msg)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onJump(msg); }}
    >
      <div className="msm-result-top">
        <span className="msm-result-nick">{msg.from}</span>
        <span className="msm-result-time">{relativeTime(ts)}</span>
      </div>
      <p className="msm-result-text">
        <HighlightedText text={msg.text} query={query} />
      </p>
    </div>
  );
}

// ── Skeleton loading rows ─────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div key={i} className="msm-skeleton-row">
          <div className="msm-skeleton-nick msm-pulse" />
          <div className="msm-skeleton-text msm-pulse" />
        </div>
      ))}
    </>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function MessageSearchModal() {
  const closeMessageSearch  = useOnyxStore(s => s.closeMessageSearch);
  const searchMessages      = useOnyxStore(s => s.searchMessages);
  const results             = useOnyxStore(s => s.messageSearchResults);
  const query               = useOnyxStore(s => s.messageSearchQuery);
  const loading             = useOnyxStore(s => s.messageSearchLoading);
  const activeView          = useOnyxStore(s => s.activeView);
  const navigate            = useOnyxStore(s => s.navigate);

  const channel = activeView.kind === 'channel' ? activeView.channel : '';
  const channelDisplay = channel.replace(/^[#&]/, '');

  const [localQuery, setLocalQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autofocus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!localQuery.trim()) {
      // Clear results when input is empty
      searchMessages(channel, '');
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchMessages(channel, localQuery.trim());
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localQuery, channel, searchMessages]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMessageSearch();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeMessageSearch]);

  const handleClear = () => {
    setLocalQuery('');
    inputRef.current?.focus();
  };

  const handleJump = (msg: ChatMessage) => {
    // If the message is in a different channel, navigate there first
    if (channel && activeView.kind !== 'channel') {
      navigate({ kind: 'channel', channel });
    }
    // Dispatch jump event — MessageList will scroll and flash the message
    window.dispatchEvent(new CustomEvent('ocean:jump-to-message', { detail: { msgId: msg.id } }));
    closeMessageSearch();
  };

  const isEmpty = !localQuery.trim();
  const noResults = !isEmpty && !loading && results.length === 0 && query === localQuery.trim();

  return (
    <div className="msm-backdrop" onClick={closeMessageSearch} aria-modal="true" role="dialog" aria-label="Search messages">
      <div className="msm-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="msm-header">
          <div className="msm-header-title-row">
            <SearchHistIcon />
            <span className="msm-title">Search in #{channelDisplay}</span>
          </div>
          <button className="msm-close" onClick={closeMessageSearch} aria-label="Close search">
            <CloseIcon />
          </button>
        </div>

        {/* Input */}
        <div className="msm-input-wrap">
          <span className="msm-input-icon" aria-hidden="true"><SearchSmIcon /></span>
          <input
            ref={inputRef}
            className="msm-input"
            type="text"
            placeholder="Search messages…"
            value={localQuery}
            onChange={e => setLocalQuery(e.target.value)}
            aria-label="Search messages"
            autoComplete="off"
            spellCheck={false}
          />
          {localQuery && (
            <button className="msm-clear" onClick={handleClear} aria-label="Clear search">
              <ClearIcon />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="msm-results" role="list">
          {loading && <SkeletonRows />}

          {!loading && isEmpty && (
            <p className="msm-hint">Type to search messages in this channel</p>
          )}

          {noResults && (
            <EmptyState
              icon="🔍"
              title="No messages found"
              description={`No messages match "${query}"`}
              size="sm"
            />
          )}

          {!loading && !isEmpty && results.map(msg => (
            <ResultRow key={msg.id} msg={msg} query={query} onJump={handleJump} />
          ))}
        </div>
      </div>

      <style>{`
        .msm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 300;
          display: flex;
          justify-content: flex-end;
          pointer-events: none;
        }

        .msm-panel {
          pointer-events: all;
          width: 380px;
          max-width: 100vw;
          height: 100%;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          box-shadow: -8px 0 32px rgba(0,0,0,0.45);
          animation: msm-slide-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes msm-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        .msm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 16px 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .msm-header-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary);
        }

        .msm-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 260px;
        }

        .msm-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .msm-close:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .msm-input-wrap {
          position: relative;
          padding: 12px 12px 8px;
          flex-shrink: 0;
        }

        .msm-input-icon {
          position: absolute;
          left: 24px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
          align-items: center;
        }

        .msm-input {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 8px 32px 8px 36px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
        }
        .msm-input::placeholder {
          color: var(--text-muted);
        }
        .msm-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
        }

        .msm-clear {
          position: absolute;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: color var(--t-fast);
          padding: 0;
        }
        .msm-clear:hover {
          color: var(--text-primary);
        }

        .msm-results {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0 8px;
        }

        .msm-hint,
        .msm-empty {
          font-size: 13px;
          color: var(--text-muted);
          text-align: center;
          padding: 32px 20px;
          line-height: 1.5;
          margin: 0;
        }

        .msm-result-row {
          padding: 10px 16px;
          cursor: pointer;
          transition: background var(--t-fast);
          border-radius: var(--r-sm);
          margin: 0 4px;
        }
        .msm-result-row:hover {
          background: var(--bg-base);
        }

        .msm-result-top {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 2px;
        }

        .msm-result-nick {
          font-size: 13px;
          font-weight: 700;
          color: var(--accent);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .msm-result-time {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .msm-result-text {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          word-break: break-word;
          line-height: 1.45;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
        }

        .msm-mark {
          background: color-mix(in srgb, var(--accent) 28%, transparent);
          color: var(--accent);
          border-radius: 2px;
          padding: 0 1px;
          font-style: normal;
        }

        /* ── Skeleton ── */
        .msm-skeleton-row {
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .msm-skeleton-nick {
          height: 12px;
          width: 80px;
          border-radius: var(--r-sm);
          background: var(--bg-base);
        }

        .msm-skeleton-text {
          height: 12px;
          width: 90%;
          border-radius: var(--r-sm);
          background: var(--bg-base);
        }

        .msm-pulse {
          animation: msm-pulse 1.4s ease-in-out infinite;
        }

        @keyframes msm-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.9; }
        }

        @media (max-width: 480px) {
          .msm-panel { width: 100vw; }
        }
      `}</style>
    </div>
  );
}

const SearchHistIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6.5" cy="6.5" r="5" />
    <path d="M10 10L14 14" />
    <path d="M6.5 4v2.5l1.5 1" />
  </svg>
);

const SearchSmIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M9.9 9.2a5.5 5.5 0 1 0-.7.7l3.5 3.5a.5.5 0 0 0 .7-.7L9.9 9.2zM10 5.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

const ClearIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M1 1l10 10M11 1L1 11" />
  </svg>
);
