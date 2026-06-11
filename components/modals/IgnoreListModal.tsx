'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

export default function IgnoreListModal() {
  const ignoredUsers    = useOnyxStore(s => s.ignoredUsers);
  const ignoreUser      = useOnyxStore(s => s.ignoreUser);
  const unignoreUser    = useOnyxStore(s => s.unignoreUser);
  const closeIgnoreList = useOnyxStore(s => s.closeIgnoreList);
  const softIgnoreList  = useOnyxStore(s => s.softIgnoreList);
  const toggleSoftIgnore = useOnyxStore(s => s.toggleSoftIgnore);

  const [addNick, setAddNick] = useState('');
  const inputRef  = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAdd = useCallback(() => {
    const nick = addNick.trim();
    if (!nick) return;
    ignoreUser(nick);
    setAddNick('');
    inputRef.current?.focus();
  }, [addNick, ignoreUser]);

  const handleAddKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }, [handleAdd]);

  const sorted = [...ignoredUsers].sort((a, b) => a.localeCompare(b));
  const sortedSoftIgnore = [...softIgnoreList].sort((a, b) => a.localeCompare(b));

  return (
    <ModalShell
      onClose={closeIgnoreList}
      title="Ignored Users"
      kicker="Privacy"
      titleId="ign-modal-title"
      size="sm"
      flushBody
    >
      <div className="ign-content">
        {/* ── Section 1: IRC SILENCE (server-side) ─────────────────────────── */}
        <div className="label-caps ign-section-label">IRC SILENCE — server-side</div>
        <p className="ign-info">The server drops all messages from these users before they reach you.</p>

        {/* Add field */}
        <div className="ign-add-row">
          <div className="ign-add-wrap">
            <input
              ref={inputRef}
              className="ign-add-input"
              type="text"
              placeholder="Enter a nick to ignore…"
              value={addNick}
              onChange={e => setAddNick(e.target.value)}
              onKeyDown={handleAddKeyDown}
              aria-label="Nick to ignore"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            className={`ign-add-btn ${addNick.trim() ? 'ign-add-btn--active' : ''}`}
            onClick={handleAdd}
            disabled={!addNick.trim()}
          >
            Ignore
          </button>
        </div>

        {/* Server-side list */}
        <div className="ign-list" role="list" aria-label="Server-ignored nicks">
          {sorted.length === 0 ? (
            <p className="ign-empty">No server-ignored users.</p>
          ) : (
            sorted.map(nick => (
              <div key={nick} className="ign-row" role="listitem">
                <span className="ign-nick">{nick}</span>
                <button
                  className="ign-remove-btn"
                  onClick={() => unignoreUser(nick)}
                  aria-label={`Unignore ${nick}`}
                >
                  Unignore
                </button>
              </div>
            ))
          )}
        </div>

        {/* ── Section 2: Hidden users (local only) ─────────────────────────── */}
        <div className="ign-section-sep" role="separator" />
        <div className="label-caps ign-section-label">Hidden users — local only</div>
        <p className="ign-info">Messages from these users are hidden locally. They don&apos;t know you&apos;ve hidden them.</p>

        <div className="ign-list" role="list" aria-label="Locally hidden nicks">
          {sortedSoftIgnore.length === 0 ? (
            <p className="ign-empty">No hidden users.</p>
          ) : (
            sortedSoftIgnore.map(nick => (
              <div key={nick} className="ign-row" role="listitem">
                <span className="ign-nick">{nick}</span>
                <button
                  className="ign-remove-btn ign-remove-btn--show"
                  onClick={() => toggleSoftIgnore(nick)}
                  aria-label={`Show messages from ${nick}`}
                >
                  Show messages
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        .ign-content {
          display: flex; flex-direction: column;
          padding-bottom: var(--sp-3, 12px);
        }

        .ign-info {
          font-size: var(--text-xs, 12px); color: var(--text-muted);
          margin: var(--sp-2, 8px) var(--sp-4, 16px) 0; padding: 0;
        }

        .ign-add-row {
          display: flex; align-items: center; gap: var(--sp-2, 8px);
          padding: var(--sp-3, 12px);
        }
        .ign-add-wrap {
          flex: 1;
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          transition: border-color var(--t-control, 150ms);
        }
        .ign-add-wrap:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(14,165,233,0.12);
        }
        .ign-add-input {
          width: 100%; padding: 7px 10px;
          background: none; border: none; outline: none;
          font-size: var(--text-base, 14px); color: var(--text-primary);
          font-family: inherit;
        }
        .ign-add-input::placeholder { color: var(--text-muted); }

        .ign-add-btn {
          flex-shrink: 0;
          font-size: var(--text-sm, 13px); font-weight: 600;
          padding: 7px 14px; border-radius: var(--r-sm);
          border: 1px solid var(--border-normal);
          background: var(--elev-tint-1, var(--bg-elevated));
          color: var(--text-muted);
          cursor: default; opacity: 0.6;
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms), opacity var(--t-control, 150ms);
          white-space: nowrap;
        }
        .ign-add-btn--active {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
          opacity: 1; cursor: pointer;
        }
        .ign-add-btn--active:hover { opacity: 0.88; }
        .ign-add-btn:disabled { cursor: default; }

        .ign-list {
          overflow-y: auto; max-height: 280px;
          padding: 0 var(--sp-2, 8px) var(--sp-3, 12px);
          display: flex; flex-direction: column; gap: 1px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        .ign-empty {
          font-size: var(--text-sm, 13px); color: var(--text-muted);
          text-align: center; padding: var(--sp-5, 20px); margin: 0;
        }

        .ign-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 10px;
          border-radius: var(--r-sm);
          border: 1px solid transparent;
          transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms);
        }
        .ign-row:hover {
          background: var(--accent-subtle, rgba(14,165,233,0.05));
          border-color: var(--border-subtle);
        }

        .ign-nick {
          font-size: 13.5px; color: var(--text-primary);
          font-weight: 600;
          font-family: var(--font-mono, monospace);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .ign-remove-btn {
          flex-shrink: 0;
          font-size: 11.5px; font-weight: 600;
          padding: 3px 9px; border-radius: var(--r-xs);
          border: 1px solid rgba(248,113,113,0.25);
          background: rgba(248,113,113,0.08);
          color: var(--danger, #f87171);
          cursor: pointer;
          transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms);
        }
        .ign-remove-btn:hover {
          background: rgba(248,113,113,0.18);
          border-color: rgba(248,113,113,0.5);
        }

        .ign-remove-btn--show {
          border-color: var(--border-normal);
          background: none;
          color: var(--text-muted);
        }
        .ign-remove-btn--show:hover {
          background: var(--accent-subtle, rgba(14,165,233,0.1));
          border-color: var(--accent-border, rgba(14,165,233,0.3));
          color: var(--accent);
        }

        .ign-section-label {
          padding: var(--sp-3, 12px) var(--sp-4, 16px) var(--sp-1, 4px);
        }

        .ign-section-sep {
          height: 1px;
          background: var(--border-subtle);
          margin: 6px 12px 2px;
        }
      `}</style>
    </ModalShell>
  );
}
