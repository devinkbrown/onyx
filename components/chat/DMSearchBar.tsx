'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  nick: string;
  onClose: () => void;
}

export default function DMSearchBar({ nick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const messages = useOnyxStore(s => s.dms.get(nick.toLowerCase())?.messages ?? []);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return messages.filter(m => m.type === 'msg' && m.text.toLowerCase().includes(q));
  }, [messages, query]);

  useEffect(() => {
    setCursor(0);
  }, [results.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function highlightMatch(text: string, q: string) {
    if (!q.trim()) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="dmsb-mark">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  function formatTime(d: Date) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const hasCursor = results.length > 0;

  return (
    <div className="dmsb-root" role="search" aria-label="Search DM messages">
      <div className="dmsb-bar">
        <SearchIcon />
        <input
          ref={inputRef}
          className="dmsb-input"
          type="text"
          placeholder="Search messages…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search DM messages"
        />
        {query.trim() && (
          <span className="dmsb-count" aria-live="polite">
            {results.length === 0 ? 'No results' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
          </span>
        )}
        {hasCursor && (
          <>
            <button
              className="dmsb-nav-btn"
              aria-label="Previous result"
              onClick={() => setCursor(c => Math.max(0, c - 1))}
              disabled={cursor === 0}
            >
              <svg width="9" height="9" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M1.5 5.5l2.5-3 2.5 3"/>
              </svg>
            </button>
            <button
              className="dmsb-nav-btn"
              aria-label="Next result"
              onClick={() => setCursor(c => Math.min(results.length - 1, c + 1))}
              disabled={cursor >= results.length - 1}
            >
              <svg width="9" height="9" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M1.5 2.5l2.5 3 2.5-3"/>
              </svg>
            </button>
          </>
        )}
        <button className="dmsb-close-btn" onClick={onClose} aria-label="Close search">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>
          </svg>
        </button>
      </div>

      {query.trim() && results.length > 0 && (
        <ul className="dmsb-results" role="listbox">
          {results.map((msg, idx) => (
            <li
              key={msg.id}
              className={`dmsb-result-item ${idx === cursor ? 'dmsb-result-item--focused' : ''}`}
              role="option"
              aria-selected={idx === cursor}
              onClick={() => {
                setCursor(idx);
                document.getElementById(`msg-${msg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              <span className="dmsb-result-from">{msg.from}</span>
              <span className="dmsb-result-time">{formatTime(msg.time)}</span>
              <span className="dmsb-result-text">
                {highlightMatch(msg.text.length > 120 ? msg.text.slice(0, 120) + '…' : msg.text, query)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && results.length === 0 && (
        <p className="dmsb-empty">No messages match &ldquo;{query}&rdquo;</p>
      )}

      <style>{`
        .dmsb-root {
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          animation: dmsb-slide-in 0.15s ease both;
        }
        @keyframes dmsb-slide-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dmsb-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
        }
        .dmsb-input {
          flex: 1;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          font-size: 13px;
          padding: 5px 10px;
          outline: none;
          min-width: 0;
        }
        .dmsb-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-border);
        }
        .dmsb-count {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .dmsb-nav-btn {
          width: 24px; height: 24px;
          background: none; border: 1px solid var(--border-subtle);
          border-radius: var(--r-xs);
          color: var(--text-secondary);
          cursor: pointer; font-size: 10px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: background var(--t-fast), color var(--t-fast);
        }
        .dmsb-nav-btn:hover:not(:disabled) { background: var(--ch-hover-bg); color: var(--text-primary); }
        .dmsb-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .dmsb-close-btn {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          color: var(--text-secondary); font-size: 14px;
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: background var(--t-fast), color var(--t-fast);
        }
        .dmsb-close-btn:hover { background: var(--ch-hover-bg); color: var(--text-primary); }
        .dmsb-results {
          list-style: none; margin: 0; padding: 4px 8px 8px;
          max-height: 240px; overflow-y: auto;
        }
        .dmsb-result-item {
          display: flex; align-items: baseline; gap: 8px;
          padding: 5px 8px; border-radius: var(--r-sm);
          cursor: pointer;
          transition: background var(--t-fast);
        }
        .dmsb-result-item:hover, .dmsb-result-item--focused {
          background: var(--ch-hover-bg);
        }
        .dmsb-result-from {
          font-size: 12px; font-weight: 600; color: var(--accent);
          white-space: nowrap; flex-shrink: 0;
        }
        .dmsb-result-time {
          font-size: 11px; color: var(--text-muted);
          white-space: nowrap; flex-shrink: 0;
        }
        .dmsb-result-text {
          font-size: 13px; color: var(--text-secondary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          flex: 1; min-width: 0;
        }
        .dmsb-mark {
          background: var(--accent-subtle);
          color: var(--accent);
          border-radius: 2px;
          padding: 0 1px;
        }
        .dmsb-empty {
          padding: 8px 16px 12px;
          font-size: 13px; color: var(--text-muted);
          font-style: italic;
          margin: 0;
        }
      `}</style>
    </div>
  );
}

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
  </svg>
);
