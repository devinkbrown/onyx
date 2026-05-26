'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';

export default function ForwardMessageModal() {
  const forwardingMessage  = useOnyxStore(s => s.forwardingMessage);
  const setForwardingMessage = useOnyxStore(s => s.setForwardingMessage);
  const channels           = useOnyxStore(s => s.channels);
  const dms                = useOnyxStore(s => s.dms);
  const sendMessage        = useOnyxStore(s => s.sendMessage);
  const navigate           = useOnyxStore(s => s.navigate);

  const [query, setQuery]     = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setForwardingMessage(null);
    setQuery('');
    setSelected(null);
    setComment('');
  }, [setForwardingMessage]);

  // Focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [close]);

  if (!forwardingMessage) return null;

  // Build destination list: channels + DMs
  interface Destination {
    id: string;
    label: string;
    kind: 'channel' | 'dm';
  }

  const allChannels: Destination[] = Array.from(channels.values()).map(ch => ({
    id: ch.name,
    label: ch.name,
    kind: 'channel',
  }));

  const allDMs: Destination[] = Array.from(dms.values()).map(dm => ({
    id: dm.nick,
    label: dm.nick,
    kind: 'dm',
  }));

  const destinations: Destination[] = [...allChannels, ...allDMs];

  const q = query.toLowerCase();
  const filtered = q
    ? destinations.filter(d => d.label.toLowerCase().includes(q))
    : destinations;

  const handleForward = useCallback(() => {
    if (!selected || !forwardingMessage) return;
    const forwarded = `↩ Forwarded from ${forwardingMessage.from}: ${forwardingMessage.text}`;
    const text = comment.trim()
      ? `${comment.trim()}\n${forwarded}`
      : forwarded;
    sendMessage(selected, text);
    // Navigate to destination
    const dest = destinations.find(d => d.id === selected);
    if (dest) {
      if (dest.kind === 'channel') {
        navigate({ kind: 'channel', channel: dest.id });
      } else {
        navigate({ kind: 'dm', nick: dest.id });
      }
    }
    close();
  }, [selected, forwardingMessage, sendMessage, navigate, destinations, close]);

  const truncate = (text: string, max: number) =>
    text.length > max ? text.slice(0, max) + '…' : text;

  return (
    <div
      className="fwd-backdrop"
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      aria-modal="true"
      role="dialog"
      aria-label="Forward message"
    >
      <div className="fwd-modal">

        {/* Header */}
        <div className="fwd-header">
          <h2 className="fwd-title">Forward Message</h2>
          <button className="fwd-close" onClick={close} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Original message preview */}
        <div className="fwd-preview">
          <div className="fwd-preview-header">
            <Avatar nick={forwardingMessage.from} size={20} />
            <span className="fwd-preview-nick">{forwardingMessage.from}</span>
          </div>
          <p className="fwd-preview-text">
            {truncate(forwardingMessage.text, 180)}
          </p>
        </div>

        {/* Search */}
        <div className="fwd-search-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            className="fwd-search"
            type="text"
            placeholder="Search channels and DMs…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search destinations"
          />
        </div>

        {/* Destination list */}
        <div className="fwd-list" role="listbox" aria-label="Forward to">
          {filtered.length === 0 ? (
            <p className="fwd-empty">No channels or DMs found.</p>
          ) : (
            filtered.map(dest => (
              <button
                key={dest.id}
                className={`fwd-item ${selected === dest.id ? 'fwd-item--selected' : ''}`}
                role="option"
                aria-selected={selected === dest.id}
                onClick={() => setSelected(dest.id)}
              >
                <span className="fwd-item-sigil">
                  {dest.kind === 'channel' ? '#' : '@'}
                </span>
                <span className="fwd-item-label">{dest.label.replace(/^[#&@]/, '')}</span>
                {selected === dest.id && <CheckIcon />}
              </button>
            ))
          )}
        </div>

        {/* Optional comment */}
        <div className="fwd-comment-wrap">
          <label className="fwd-comment-label" htmlFor="fwd-comment">
            Add a comment <span className="fwd-comment-optional">(optional)</span>
          </label>
          <textarea
            id="fwd-comment"
            className="fwd-comment"
            placeholder="Write something before the forwarded message…"
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            maxLength={500}
            aria-label="Optional comment to prepend"
          />
        </div>

        {/* Actions */}
        <div className="fwd-footer">
          <button className="fwd-btn fwd-btn--cancel" onClick={close}>
            Cancel
          </button>
          <button
            className={`fwd-btn fwd-btn--confirm ${selected ? 'fwd-btn--confirm-active' : ''}`}
            onClick={handleForward}
            disabled={!selected}
          >
            Forward
          </button>
        </div>
      </div>

      <style>{`
        .fwd-backdrop {
          position: fixed; inset: 0; z-index: 700;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }

        .fwd-modal {
          width: 400px; max-width: 100%;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg, 12px);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
          display: flex; flex-direction: column;
          overflow: hidden;
          animation: fwd-appear 150ms var(--ease-out) both;
        }

        @keyframes fwd-appear {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Header */
        .fwd-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px 12px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .fwd-title {
          font-size: 15px; font-weight: 700; color: var(--text-primary);
          letter-spacing: -0.2px; margin: 0;
        }
        .fwd-close {
          width: 26px; height: 26px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-xs);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .fwd-close:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        /* Preview */
        .fwd-preview {
          margin: 10px 12px;
          padding: 10px 12px 10px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-left: 3px solid var(--accent-border);
          border-radius: var(--r-md);
          display: flex; flex-direction: column; gap: 6px;
        }
        .fwd-preview-header {
          display: flex; align-items: center; gap: 6px;
        }
        .fwd-preview-nick {
          font-size: 12px; font-weight: 700; color: var(--text-primary);
        }
        .fwd-preview-text {
          font-size: 13px; color: var(--text-secondary);
          line-height: 1.5; margin: 0;
          word-break: break-word;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Search */
        .fwd-search-wrap {
          display: flex; align-items: center; gap: 8px;
          margin: 4px 12px 8px;
          padding: 6px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-muted);
          transition: border-color var(--t-fast);
        }
        .fwd-search-wrap:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(14,165,233,0.12);
        }
        .fwd-search {
          flex: 1; background: none; border: none; outline: none;
          font-size: 14px; color: var(--text-primary);
          font-family: inherit;
        }
        .fwd-search::placeholder { color: var(--text-muted); }

        /* List */
        .fwd-list {
          flex: 1; overflow-y: auto; max-height: 240px;
          padding: 0 8px 8px;
          display: flex; flex-direction: column; gap: 1px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        .fwd-empty {
          font-size: 13px; color: var(--text-muted);
          text-align: center; padding: 20px; margin: 0;
        }

        .fwd-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 10px;
          border: none; background: none; cursor: pointer;
          border-radius: var(--r-sm);
          text-align: left;
          transition: background var(--t-fast);
          color: var(--text-secondary);
        }
        .fwd-item:hover { background: var(--ch-hover-bg); color: var(--text-primary); }
        .fwd-item--selected {
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .fwd-item--selected:hover { background: var(--accent-subtle); }

        .fwd-item-sigil {
          font-size: 14px; font-weight: 700; width: 16px;
          flex-shrink: 0; color: var(--text-muted);
          text-align: center;
        }
        .fwd-item--selected .fwd-item-sigil { color: var(--accent); }

        .fwd-item-label {
          flex: 1; font-size: 14px; font-weight: 500;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* Comment */
        .fwd-comment-wrap {
          padding: 4px 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          border-top: 1px solid var(--border-subtle);
        }
        .fwd-comment-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding-top: 8px;
        }
        .fwd-comment-optional {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          font-size: 11px;
        }
        .fwd-comment {
          resize: vertical;
          min-height: 52px;
          max-height: 120px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          padding: 7px 10px;
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          transition: border-color var(--t-fast);
          scrollbar-width: thin;
        }
        .fwd-comment:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(124, 90, 245, 0.12);
        }
        .fwd-comment::placeholder { color: var(--text-muted); }

        /* Footer */
        .fwd-footer {
          display: flex; justify-content: flex-end; gap: 8px;
          padding: 12px 14px;
          border-top: 1px solid var(--border-subtle);
        }

        .fwd-btn {
          font-size: 14px; font-weight: 600;
          padding: 7px 18px; border-radius: var(--r-sm);
          border: 1px solid transparent; cursor: pointer;
          transition: opacity var(--t-fast), background var(--t-fast);
        }
        .fwd-btn--cancel {
          background: var(--bg-elevated);
          border-color: var(--border-normal);
          color: var(--text-secondary);
        }
        .fwd-btn--cancel:hover { color: var(--text-primary); }
        .fwd-btn--confirm {
          background: var(--bg-elevated);
          border-color: var(--border-normal);
          color: var(--text-muted);
          opacity: 0.6; cursor: default;
        }
        .fwd-btn--confirm-active {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
          opacity: 1; cursor: pointer;
        }
        .fwd-btn--confirm-active:hover { opacity: 0.88; }
        .fwd-btn:disabled { cursor: default; }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6.5l3.5 3.5 5.5-6" />
  </svg>
);
