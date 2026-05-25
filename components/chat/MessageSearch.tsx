'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';

interface Props {
  onClose: () => void;
}

// ── Filter DSL ────────────────────────────────────────────────────────────────

interface SearchFilters {
  text: string;
  from: string | null;
  inChannel: string | null;
  hasImage: boolean;
  hasLink: boolean;
  hasFile: boolean;
  before: Date | null;
  after: Date | null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseNaturalDate(s: string): Date | null {
  if (s === 'today') return startOfDay(new Date());
  if (s === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return startOfDay(d);
  }
  if (s === 'lastweek') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return startOfDay(d);
  }
  if (s === 'lastmonth') {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return startOfDay(d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseQuery(raw: string): SearchFilters {
  const filters: SearchFilters = {
    text: '',
    from: null,
    inChannel: null,
    hasImage: false,
    hasLink: false,
    hasFile: false,
    before: null,
    after: null,
  };

  const parts = raw.split(/\s+/);
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.startsWith('from:')) {
      filters.from = part.slice(5).toLowerCase();
    } else if (part.startsWith('in:')) {
      filters.inChannel = part.slice(3).toLowerCase().replace(/^#/, '');
    } else if (part === 'has:image') {
      filters.hasImage = true;
    } else if (part === 'has:link') {
      filters.hasLink = true;
    } else if (part === 'has:file') {
      filters.hasFile = true;
    } else if (part.startsWith('before:')) {
      filters.before = parseNaturalDate(part.slice(7));
    } else if (part.startsWith('after:')) {
      filters.after = parseNaturalDate(part.slice(6));
    } else {
      textParts.push(part);
    }
  }

  filters.text = textParts.join(' ').toLowerCase().trim();
  return filters;
}

function applyFilters<T extends ChatMessage>(messages: T[], filters: SearchFilters): T[] {
  return messages.filter(m => {
    if (m.type !== 'msg' && m.type !== 'action') return false;
    if (filters.from && !m.from.toLowerCase().includes(filters.from)) return false;
    if (filters.text && !m.text.toLowerCase().includes(filters.text)) return false;
    if (filters.hasImage && !/https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|avif)(\?[^\s]*)?/i.test(m.text)) return false;
    if (filters.hasLink && !/https?:\/\//.test(m.text)) return false;
    if (filters.hasFile && !/https?:\/\/\S+\.(zip|pdf|doc|docx|mp4|mp3|wav|tar|gz)/i.test(m.text)) return false;
    if (filters.before && m.time >= filters.before) return false;
    if (filters.after && m.time <= filters.after) return false;
    return true;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text: string, q: string): string {
  if (!q) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark class="srch-mark">${escapeHtml(text.slice(idx, idx + q.length))}</mark>` +
    escapeHtml(text.slice(idx + q.length))
  );
}

function hasActiveFilters(f: SearchFilters): boolean {
  return !!(f.from || f.inChannel || f.hasImage || f.hasLink || f.hasFile || f.before || f.after);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="srch-chip">
      {label}
      <button
        className="srch-chip-x"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
      >
        ×
      </button>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MessageSearch({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeView = useOnyxStore(s => s.activeView);
  const channels   = useOnyxStore(s => s.channels);
  const dms        = useOnyxStore(s => s.dms);
  const navigate   = useOnyxStore(s => s.navigate);

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const filters = useMemo(() => parseQuery(query), [query]);

  // Build the message pool to search
  const messagePool = useMemo((): Array<ChatMessage & { channelName: string }> => {
    const pool: Array<ChatMessage & { channelName: string }> = [];

    if (searchAll) {
      // All channels
      channels.forEach((ch, key) => {
        ch.messages.forEach(m => pool.push({ ...m, channelName: key }));
      });
      // All DMs
      dms.forEach((dm, key) => {
        dm.messages.forEach(m => pool.push({ ...m, channelName: `@${key}` }));
      });
      return pool;
    }

    // Specific channel via in: filter
    if (filters.inChannel) {
      const ch = channels.get(filters.inChannel);
      if (ch) {
        ch.messages.forEach(m => pool.push({ ...m, channelName: filters.inChannel! }));
      }
      return pool;
    }

    // Current view
    if (activeView.kind === 'channel') {
      const key = activeView.channel.toLowerCase();
      const ch = channels.get(key);
      if (ch) ch.messages.forEach(m => pool.push({ ...m, channelName: key }));
    } else if (activeView.kind === 'dm') {
      const key = activeView.nick.toLowerCase();
      const dm = dms.get(key);
      if (dm) dm.messages.forEach(m => pool.push({ ...m, channelName: `@${key}` }));
    }

    return pool;
  }, [searchAll, filters.inChannel, activeView, channels, dms]);

  // Apply filters and rank results
  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || (trimmed.length < 2 && !hasActiveFilters(filters))) return [];

    const matched = applyFilters(messagePool, filters);
    // newest first, capped at 100
    return matched.slice().reverse().slice(0, 100);
  }, [messagePool, filters, query]);

  // Remove a single filter token from the raw query string
  const removeFilter = useCallback((token: string) => {
    setQuery(prev =>
      prev
        .split(/\s+/)
        .filter(p => !p.toLowerCase().startsWith(token.toLowerCase()))
        .join(' ')
        .trim(),
    );
  }, []);

  const jumpToMessage = useCallback(
    (msg: ChatMessage & { channelName: string }) => {
      const ch = msg.channelName;
      if (ch.startsWith('@')) {
        navigate({ kind: 'dm', nick: ch.slice(1) });
      } else {
        navigate({ kind: 'channel', channel: ch });
      }
      window.dispatchEvent(
        new CustomEvent('ocean:jump-to-message', { detail: { id: msg.id } }),
      );
      onClose();
    },
    [navigate, onClose],
  );

  const showHint = query.trim().length < 3;

  const targetName =
    activeView.kind === 'channel'
      ? `#${activeView.channel}`
      : activeView.kind === 'dm'
      ? `@${activeView.nick}`
      : 'here';

  const activeChips: Array<{ label: string; tokenPrefix: string }> = [];
  if (filters.from) activeChips.push({ label: `from: ${filters.from}`, tokenPrefix: 'from:' });
  if (filters.inChannel) activeChips.push({ label: `in: #${filters.inChannel}`, tokenPrefix: 'in:' });
  if (filters.hasImage) activeChips.push({ label: 'has: image', tokenPrefix: 'has:image' });
  if (filters.hasLink) activeChips.push({ label: 'has: link', tokenPrefix: 'has:link' });
  if (filters.hasFile) activeChips.push({ label: 'has: file', tokenPrefix: 'has:file' });
  if (filters.before) activeChips.push({ label: `before: ${filters.before.toLocaleDateString()}`, tokenPrefix: 'before:' });
  if (filters.after) activeChips.push({ label: `after: ${filters.after.toLocaleDateString()}`, tokenPrefix: 'after:' });

  const showChips = activeChips.length > 0;
  const showCount = query.trim().length >= 2 || hasActiveFilters(filters);

  return (
    <div className="msearch-panel animate-fade-in">
      {/* Header row */}
      <div className="msearch-header">
        <SearchIcon />
        <input
          ref={inputRef}
          className="msearch-input"
          placeholder={`Search in ${targetName}…`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {showCount && (
          <span className="msearch-count">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
        )}
        <button
          className="msearch-close"
          onClick={onClose}
          aria-label="Close search"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Filter chips */}
      {showChips && (
        <div className="msearch-chips">
          {activeChips.map(chip => (
            <FilterChip
              key={chip.tokenPrefix}
              label={chip.label}
              onRemove={() => removeFilter(chip.tokenPrefix)}
            />
          ))}
        </div>
      )}

      {/* Search-all toggle */}
      <div className="msearch-options">
        <label className="msearch-toggle">
          <input
            type="checkbox"
            checked={searchAll}
            onChange={e => setSearchAll(e.target.checked)}
          />
          <span>Search all channels</span>
        </label>
      </div>

      {/* Hint */}
      {showHint && (
        <div className="msearch-hint">
          <span className="msearch-hint-label">Filters:</span>
          {['from:nick', 'in:#channel', 'has:image', 'has:link', 'has:file', 'before:2026-01-01', 'after:lastweek'].map(t => (
            <button
              key={t}
              className="msearch-hint-token"
              onClick={() => setQuery(q => (q.trim() ? `${q.trim()} ${t}` : t))}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="msearch-results">
        {!showHint && results.length === 0 && (
          <div className="msearch-empty">
            No messages match <strong>"{query}"</strong>
          </div>
        )}

        {results.map(msg => (
          <button
            key={`${msg.channelName}-${msg.id}`}
            className="msearch-result"
            onClick={() => jumpToMessage(msg)}
          >
            <div className="msearch-result-avatar" aria-hidden="true">
              {msg.from.charAt(0).toUpperCase()}
            </div>
            <div className="msearch-result-body">
              <div className="msearch-result-meta">
                <span className="msearch-result-from">{msg.from}</span>
                <time className="msearch-result-time">{TIME_FMT.format(msg.time)}</time>
                {(searchAll || filters.inChannel) && (
                  <span className="msearch-result-channel">
                    {msg.channelName.startsWith('@') ? msg.channelName : `#${msg.channelName}`}
                  </span>
                )}
              </div>
              <p
                className="msearch-result-text"
                dangerouslySetInnerHTML={{ __html: highlight(msg.text, filters.text) }}
              />
            </div>
          </button>
        ))}
      </div>

      <style>{`
        .msearch-panel {
          position: absolute;
          top: var(--header-h);
          right: 0;
          width: 440px; max-width: 95vw;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-top: none;
          border-radius: 0 0 var(--r-lg) var(--r-lg);
          box-shadow: var(--shadow-xl);
          z-index: 200;
          display: flex; flex-direction: column;
          max-height: 540px;
        }

        .msearch-header {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .msearch-input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 14px; color: var(--text-primary);
          font-family: inherit;
        }
        .msearch-input::placeholder { color: var(--text-muted); }

        .msearch-count {
          font-size: 12px; color: var(--text-muted); flex-shrink: 0;
        }

        .msearch-close {
          width: 26px; height: 26px; flex-shrink: 0;
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          transition: color var(--t-fast), background var(--t-fast);
        }
        .msearch-close:hover { color: var(--text-primary); background: var(--bg-overlay); }

        /* Filter chips */
        .msearch-chips {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 8px 14px 4px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .srch-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px;
          background: color-mix(in srgb, var(--accent) 15%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
          border-radius: 999px;
          font-size: 11px; font-weight: 500; color: var(--accent);
          white-space: nowrap;
        }

        .srch-chip-x {
          background: none; border: none; cursor: pointer;
          color: var(--accent); opacity: 0.7; padding: 0;
          font-size: 13px; line-height: 1;
          display: flex; align-items: center;
        }
        .srch-chip-x:hover { opacity: 1; }

        /* Search-all toggle */
        .msearch-options {
          padding: 6px 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .msearch-toggle {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--text-secondary); cursor: pointer;
          user-select: none;
        }
        .msearch-toggle input { accent-color: var(--accent); cursor: pointer; }

        /* Hint row */
        .msearch-hint {
          display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .msearch-hint-label {
          font-size: 11px; color: var(--text-muted); flex-shrink: 0;
        }

        .msearch-hint-token {
          background: var(--bg-overlay); border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm); padding: 2px 6px;
          font-size: 11px; color: var(--text-secondary); font-family: monospace;
          cursor: pointer; transition: background var(--t-fast), color var(--t-fast);
        }
        .msearch-hint-token:hover { background: var(--bg-float); color: var(--text-primary); }

        /* Results list */
        .msearch-results {
          overflow-y: auto; flex: 1;
        }

        .msearch-result {
          width: 100%;
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px 14px;
          border: none; border-bottom: 1px solid var(--border-subtle);
          background: none; text-align: left; cursor: pointer;
          transition: background var(--t-fast);
        }
        .msearch-result:last-child { border-bottom: none; }
        .msearch-result:hover { background: var(--ch-hover-bg); }

        .msearch-result-avatar {
          width: 28px; height: 28px; flex-shrink: 0;
          border-radius: 50%;
          background: color-mix(in srgb, var(--accent) 20%, var(--bg-overlay));
          color: var(--accent); font-size: 12px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          line-height: 1; margin-top: 1px;
        }

        .msearch-result-body { flex: 1; min-width: 0; }

        .msearch-result-meta {
          display: flex; align-items: baseline; gap: 6px; margin-bottom: 3px;
          flex-wrap: wrap;
        }
        .msearch-result-from {
          font-size: 13px; font-weight: 600; color: var(--accent);
        }
        .msearch-result-time {
          font-size: 11px; color: var(--text-muted);
        }
        .msearch-result-channel {
          font-size: 11px; color: var(--text-muted);
          background: var(--bg-overlay);
          border-radius: var(--r-sm);
          padding: 1px 5px;
          margin-left: auto;
        }

        .msearch-result-text {
          font-size: 13px; color: var(--text-secondary);
          line-height: 1.5; margin: 0;
          overflow: hidden; text-overflow: ellipsis;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }

        :global(.srch-mark),
        .srch-mark {
          background: rgba(14,165,233,0.25);
          color: var(--accent);
          border-radius: 2px;
          padding: 0 1px;
        }

        .msearch-empty {
          padding: 24px 16px; text-align: center;
          font-size: 13px; color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const SearchIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    style={{ color: 'var(--text-muted)', flexShrink: 0 }}
  >
    <path d="M11 11l3.5 3.5" strokeLinecap="round" />
    <circle cx="6.5" cy="6.5" r="5" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 13 13"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" />
  </svg>
);
