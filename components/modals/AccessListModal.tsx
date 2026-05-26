'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { IRCMessage } from '@/lib/irc/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type AccessLevel = 'OWNER' | 'ADMIN' | 'OP' | 'HOST' | 'VOICE' | 'DENY' | 'QUIET';

interface AccessEntry {
  mask: string;
  level: AccessLevel;
}

const ACCESS_LEVELS: AccessLevel[] = ['OWNER', 'ADMIN', 'OP', 'HOST', 'VOICE', 'DENY', 'QUIET'];

const LEVEL_COLORS: Record<AccessLevel, string> = {
  OWNER: '#67e8f9',
  ADMIN: '#a78bfa',
  OP:    '#0ea5e9',
  HOST:  '#38bdf8',
  VOICE: '#4ade80',
  DENY:  '#ef4444',
  QUIET: '#f97316',
};

const LEVEL_BG: Record<AccessLevel, string> = {
  OWNER: 'rgba(103, 232, 249, 0.1)',
  ADMIN: 'rgba(167, 139, 250, 0.1)',
  OP:    'rgba(124, 90, 245, 0.1)',
  HOST:  'rgba(56, 189, 248, 0.1)',
  VOICE: 'rgba(74, 222, 128, 0.1)',
  DENY:  'rgba(239, 68, 68, 0.1)',
  QUIET: 'rgba(249, 115, 22, 0.1)',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AccessListModal() {
  const closeAccessList = useOnyxStore(s => s.closeAccessList);
  const activeView      = useOnyxStore(s => s.activeView);
  const client          = useOnyxStore(s => s.client);

  const channelName = activeView.kind === 'channel' ? activeView.channel : '';

  const [entries, setEntries]   = useState<AccessEntry[]>([]);
  const [loading, setLoading]   = useState(false);
  const [newMask, setNewMask]   = useState('');
  const [newLevel, setNewLevel] = useState<AccessLevel>('VOICE');
  const [addError, setAddError] = useState('');

  const handlerRef = useRef<((msg: IRCMessage) => void) | null>(null);

  // ── Fetch the access list ─────────────────────────────────────────────────

  const fetchList = useCallback(() => {
    if (!client || !channelName) return;
    setLoading(true);
    setEntries([]);
    client.sendRaw('ACCESS', channelName, 'LIST');
  }, [client, channelName]);

  // ── Register numeric handler ──────────────────────────────────────────────

  useEffect(() => {
    if (!client) return;

    const handler = (msg: IRCMessage) => {
      // 775 RPL_ACCESSLIST  :server 775 ournick #channel mask level
      if (msg.command === '775') {
        const ch    = msg.params[1] ?? '';
        const mask  = msg.params[2] ?? '';
        const level = (msg.params[3] ?? '').toUpperCase() as AccessLevel;
        if (ch.toLowerCase() !== channelName.toLowerCase()) return;
        if (!mask || !ACCESS_LEVELS.includes(level)) return;
        setEntries(prev => {
          // De-duplicate by mask
          const filtered = prev.filter(e => e.mask !== mask);
          return [...filtered, { mask, level }];
        });
      }

      // 776 RPL_ACCESSLISTEND  :server 776 ournick #channel :End of access list
      if (msg.command === '776') {
        const ch = msg.params[1] ?? '';
        if (ch.toLowerCase() !== channelName.toLowerCase()) return;
        setLoading(false);
      }
    };

    handlerRef.current = handler;
    client.extraMessageHandlers.add(handler);

    // Initial fetch
    fetchList();

    return () => {
      if (handlerRef.current) {
        client.extraMessageHandlers.delete(handlerRef.current);
        handlerRef.current = null;
      }
    };
  }, [client, channelName, fetchList]);

  // ── Escape key ────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAccessList();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeAccessList]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleAdd = () => {
    const mask = newMask.trim();
    if (!mask) { setAddError('Mask is required'); return; }
    if (!client || !channelName) return;
    setAddError('');
    client.sendRaw('ACCESS', channelName, 'ADD', mask, newLevel);
    setNewMask('');
    // Refresh after a short delay so the server has time to apply
    setTimeout(fetchList, 400);
  };

  const handleRemove = (mask: string) => {
    if (!client || !channelName) return;
    client.sendRaw('ACCESS', channelName, 'DEL', mask);
    setEntries(prev => prev.filter(e => e.mask !== mask));
  };

  const displayName = channelName.replace(/^[#&]/, '');

  return (
    <div
      className="acl-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closeAccessList(); }}
    >
      <div className="acl-panel animate-slide-right">

        {/* Header */}
        <div className="acl-header">
          <div className="acl-header-left">
            <ShieldIcon />
            <div>
              <h2 className="acl-title">Access List</h2>
              <p className="acl-subtitle">#{displayName}</p>
            </div>
          </div>
          <div className="acl-header-right">
            <button
              className="acl-refresh-btn"
              onClick={fetchList}
              aria-label="Refresh access list"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
            <button className="acl-close-btn" onClick={closeAccessList} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Add entry form */}
        <div className="acl-add-form">
          <p className="acl-section-label">Add Entry</p>
          <div className="acl-add-row">
            <input
              className="acl-mask-input"
              type="text"
              placeholder="nick!user@host or nick@*"
              value={newMask}
              onChange={e => { setNewMask(e.target.value); setAddError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              aria-label="Access mask"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <select
              className="acl-level-select"
              value={newLevel}
              onChange={e => setNewLevel(e.target.value as AccessLevel)}
              aria-label="Access level"
            >
              {ACCESS_LEVELS.map(lvl => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
            <button className="acl-add-btn" onClick={handleAdd} aria-label="Add entry">
              <PlusIcon />
              Add
            </button>
          </div>
          {addError && <p className="acl-add-error">{addError}</p>}
        </div>

        {/* Divider */}
        <div className="acl-divider" />

        {/* List */}
        <div className="acl-list-area">
          <div className="acl-list-header">
            <p className="acl-section-label">
              Current Entries
              {entries.length > 0 && (
                <span className="acl-count-badge">{entries.length}</span>
              )}
            </p>
          </div>

          {loading && entries.length === 0 ? (
            <div className="acl-empty">
              <LoadingDots />
              <p>Fetching access list…</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="acl-empty">
              <ShieldEmptyIcon />
              <p>No entries in this channel&apos;s access list.</p>
            </div>
          ) : (
            <div className="acl-table-wrap">
              <table className="acl-table">
                <thead>
                  <tr>
                    <th className="acl-th acl-th-mask">Mask</th>
                    <th className="acl-th acl-th-level">Level</th>
                    <th className="acl-th acl-th-action" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.mask} className="acl-tr">
                      <td className="acl-td acl-td-mask">
                        <code className="acl-mask">{entry.mask}</code>
                      </td>
                      <td className="acl-td acl-td-level">
                        <span
                          className="acl-level-badge"
                          style={{
                            color: LEVEL_COLORS[entry.level] ?? 'var(--text-secondary)',
                            background: LEVEL_BG[entry.level] ?? 'var(--accent-subtle)',
                            borderColor: (LEVEL_COLORS[entry.level] ?? '#0ea5e9') + '44',
                          }}
                        >
                          {entry.level}
                        </span>
                      </td>
                      <td className="acl-td acl-td-action">
                        <button
                          className="acl-remove-btn"
                          onClick={() => handleRemove(entry.mask)}
                          aria-label={`Remove ${entry.mask}`}
                          title="Remove"
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .acl-backdrop {
          position: fixed; inset: 0; z-index: 710;
          background: rgba(3, 8, 16, 0.6);
          backdrop-filter: blur(4px);
          display: flex; align-items: stretch; justify-content: flex-end;
        }

        .acl-panel {
          width: 440px; max-width: 96vw;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: -8px 0 48px rgba(0, 0, 0, 0.6), -1px 0 0 var(--accent-glow);
        }

        /* ── Header ── */
        .acl-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 20px 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          gap: 12px;
        }
        .acl-header-left {
          display: flex; align-items: center; gap: 12px;
          color: var(--accent);
        }
        .acl-title {
          font-size: 16px; font-weight: 700;
          color: var(--text-primary); line-height: 1.2;
        }
        .acl-subtitle {
          font-size: 12px; color: var(--text-muted);
          margin-top: 2px;
        }
        .acl-header-right {
          display: flex; align-items: center; gap: 6px;
        }
        .acl-close-btn,
        .acl-refresh-btn {
          width: 30px; height: 30px;
          background: none; border: none; cursor: pointer;
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-secondary);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .acl-close-btn:hover,
        .acl-refresh-btn:hover {
          background: var(--bg-overlay); color: var(--text-primary);
        }

        /* ── Add form ── */
        .acl-add-form {
          padding: 16px 20px;
          flex-shrink: 0;
        }
        .acl-section-label {
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--text-muted);
          margin-bottom: 10px;
          display: flex; align-items: center; gap: 8px;
        }
        .acl-count-badge {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 18px; height: 18px; padding: 0 5px;
          background: var(--accent-subtle); border: 1px solid var(--accent-border);
          color: var(--accent); font-size: 10px; font-weight: 700;
          border-radius: 999px; font-variant-numeric: tabular-nums;
        }
        .acl-add-row {
          display: flex; gap: 8px; align-items: center;
        }
        .acl-mask-input {
          flex: 1; min-width: 0;
          height: 34px; padding: 0 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary); font-size: 13px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          outline: none;
          transition: border-color var(--t-fast), background var(--t-fast);
        }
        .acl-mask-input::placeholder { color: var(--text-muted); }
        .acl-mask-input:focus {
          border-color: var(--accent-border);
          background: var(--bg-float);
        }
        .acl-level-select {
          height: 34px; padding: 0 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary); font-size: 13px;
          font-family: inherit;
          outline: none; cursor: pointer;
          transition: border-color var(--t-fast);
          flex-shrink: 0;
        }
        .acl-level-select:focus { border-color: var(--accent-border); }
        .acl-add-btn {
          display: flex; align-items: center; gap: 5px;
          height: 34px; padding: 0 14px;
          background: var(--accent); border: none;
          border-radius: var(--r-sm);
          color: #fff; font-size: 13px; font-weight: 600;
          cursor: pointer; font-family: inherit;
          flex-shrink: 0; white-space: nowrap;
          transition: background var(--t-fast), opacity var(--t-fast);
        }
        .acl-add-btn:hover { background: var(--accent-hover); }
        .acl-add-error {
          margin-top: 8px; font-size: 12px; color: var(--danger);
        }

        /* ── Divider ── */
        .acl-divider {
          height: 1px; background: var(--border-subtle);
          flex-shrink: 0; margin: 0 20px;
        }

        /* ── List area ── */
        .acl-list-area {
          flex: 1; overflow: hidden;
          display: flex; flex-direction: column;
          padding: 16px 20px 20px;
          gap: 12px;
        }
        .acl-list-header { flex-shrink: 0; }

        .acl-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 10px; color: var(--text-muted); font-size: 13px;
          text-align: center; padding: 24px 0;
        }

        .acl-table-wrap {
          flex: 1; overflow-y: auto;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          background: var(--bg-elevated);
        }
        .acl-table {
          width: 100%; border-collapse: collapse;
          font-size: 13px;
        }
        .acl-th {
          padding: 8px 12px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.07em;
          text-transform: uppercase; color: var(--text-muted);
          border-bottom: 1px solid var(--border-subtle);
          text-align: left; background: var(--bg-float);
          position: sticky; top: 0;
        }
        .acl-th-action { width: 40px; }
        .acl-tr {
          border-bottom: 1px solid var(--border-subtle);
          transition: background var(--t-fast);
        }
        .acl-tr:last-child { border-bottom: none; }
        .acl-tr:hover { background: var(--bg-overlay); }

        .acl-td {
          padding: 9px 12px;
          vertical-align: middle;
        }
        .acl-td-action { text-align: right; }

        .acl-mask {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px; color: var(--text-secondary);
          word-break: break-all;
        }

        .acl-level-badge {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: 999px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
          border: 1px solid;
        }

        .acl-remove-btn {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          transition: background var(--t-fast), color var(--t-fast);
          margin-left: auto;
        }
        .acl-remove-btn:hover {
          background: var(--danger-subtle); color: var(--danger);
        }

        /* ── Loading dots ── */
        .acl-dots {
          display: flex; gap: 5px; align-items: center;
        }
        .acl-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--accent);
          animation: acl-pulse 1.2s ease-in-out infinite;
        }
        .acl-dot:nth-child(2) { animation-delay: 0.2s; }
        .acl-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes acl-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2L3 5v5c0 4.418 3.134 8.557 7 9 3.866-.443 7-4.582 7-9V5L10 2z" />
  </svg>
);

const ShieldEmptyIcon = () => (
  <svg width="32" height="32" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2L3 5v5c0 4.418 3.134 8.557 7 9 3.866-.443 7-4.582 7-9V5L10 2z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 1v4h4" />
    <path d="M1.5 8.5A6 6 0 1 0 3 4L1 5" />
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 1v10M1 6h10" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 3h10M4 3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M5.5 6v4M7.5 6v4M2.5 3l.8 8a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.8-8" />
  </svg>
);

function LoadingDots() {
  return (
    <div className="acl-dots">
      <div className="acl-dot" />
      <div className="acl-dot" />
      <div className="acl-dot" />
    </div>
  );
}
