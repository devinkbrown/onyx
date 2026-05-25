'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';

interface Props {
  onClose(): void;
  /** Called with matched message IDs so the message list can apply highlight/dim classes */
  onResults(matchIds: Set<string>, focusedId: string | null): void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function ChannelSearchBar({ onClose, onResults }: Props) {
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeView = useOnyxStore(s => s.activeView);
  const channels   = useOnyxStore(s => s.channels);
  const dms        = useOnyxStore(s => s.dms);

  const debouncedQuery = useDebounce(query, 200);

  // Current channel messages
  const messages: ChatMessage[] = useMemo(() => {
    if (activeView.kind === 'channel') {
      return channels.get(activeView.channel.toLowerCase())?.messages ?? [];
    }
    if (activeView.kind === 'dm') {
      return dms.get(activeView.nick.toLowerCase())?.messages ?? [];
    }
    return [];
  }, [activeView, channels, dms]);

  // Filter matches
  const matches = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return messages.filter(
      m =>
        (m.type === 'msg' || m.type === 'action') &&
        (m.text.toLowerCase().includes(q) || m.from.toLowerCase().includes(q)),
    );
  }, [messages, debouncedQuery]);

  // Clamp focusIdx when matches change
  useEffect(() => {
    setFocusIdx(0);
  }, [debouncedQuery]);

  // Notify parent of results
  useEffect(() => {
    if (matches.length === 0) {
      onResults(new Set(), null);
      return;
    }
    const ids = new Set(matches.map(m => m.id));
    const focused = matches[focusIdx]?.id ?? null;
    onResults(ids, focused);
  }, [matches, focusIdx, onResults]);

  // Scroll focused message into view
  useEffect(() => {
    const id = matches[focusIdx]?.id;
    if (!id) return;
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusIdx, matches]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keyboard: Escape closes, arrows navigate
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(i => (i - 1 + matches.length) % Math.max(matches.length, 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(i => (i + 1) % Math.max(matches.length, 1));
    }
  }, [onClose, matches.length]);

  const channelName =
    activeView.kind === 'channel' ? activeView.channel :
    activeView.kind === 'dm'      ? `@${activeView.nick}` :
    'here';

  const total = matches.length;
  const current = total > 0 ? focusIdx + 1 : 0;

  return (
    <div className="csb-bar animate-slide-down" role="search" aria-label="Search in channel">
      <SearchIcon />
      <input
        ref={inputRef}
        className="csb-input"
        placeholder={`Search in ${channelName}…`}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search messages"
      />

      {query.trim().length >= 2 && (
        <span className="csb-count" aria-live="polite">
          {total === 0 ? 'No results' : `${current} of ${total}`}
        </span>
      )}

      {total > 1 && (
        <>
          <button
            className="csb-nav-btn"
            onClick={() => setFocusIdx(i => (i - 1 + total) % total)}
            aria-label="Previous match"
            title="Previous match (↑)"
          >
            <ChevronUpIcon />
          </button>
          <button
            className="csb-nav-btn"
            onClick={() => setFocusIdx(i => (i + 1) % total)}
            aria-label="Next match"
            title="Next match (↓)"
          >
            <ChevronDownIcon />
          </button>
        </>
      )}

      <button className="csb-close" onClick={onClose} aria-label="Close search">
        <CloseIcon />
      </button>

      <style>{`
        .csb-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-normal);
          flex-shrink: 0;
        }

        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down { animation: slide-down 160ms var(--ease-out) both; }

        .csb-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          min-width: 0;
        }
        .csb-input::placeholder { color: var(--text-muted); }

        .csb-count {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .csb-nav-btn {
          width: 26px; height: 26px;
          background: none; border: none; cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .csb-nav-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .csb-close {
          width: 26px; height: 26px;
          background: none; border: none; cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .csb-close:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
    <path d="M11 11l3.5 3.5" strokeLinecap="round" />
    <circle cx="6.5" cy="6.5" r="5" />
  </svg>
);

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 1l10 10M11 1L1 11" />
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8.5l4-4 4 4" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 4.5l4 4 4-4" />
  </svg>
);
