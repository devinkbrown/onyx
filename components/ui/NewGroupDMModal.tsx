'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';

interface Props {
  onClose: () => void;
}

const MAX_USERS = 9;

export default function NewGroupDMModal({ onClose }: Props) {
  const channels = useOnyxStore(s => s.channels);
  const ourNick  = useOnyxStore(s => s.ourNick);
  const client   = useOnyxStore(s => s.client);
  const navigate = useOnyxStore(s => s.navigate);

  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Collect all known users across all channels, excluding ourselves
  const allUsers = useMemo(() => {
    const seen = new Map<string, { nick: string; away: boolean }>();
    for (const ch of channels.values()) {
      for (const [, user] of ch.users) {
        if (user.nick.toLowerCase() === ourNick.toLowerCase()) continue;
        const key = user.nick.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, { nick: user.nick, away: user.away ?? false });
        }
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.nick.toLowerCase().localeCompare(b.nick.toLowerCase()),
    );
  }, [channels, ourNick]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allUsers;
    const q = search.trim().toLowerCase();
    return allUsers.filter(u => u.nick.toLowerCase().includes(q));
  }, [allUsers, search]);

  const toggle = (nick: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(nick)) {
        next.delete(nick);
      } else {
        if (next.size >= MAX_USERS) return prev; // cap at 9
        next.add(nick);
      }
      return next;
    });
  };

  const generateChannelName = (nicks: string[]): string => {
    const parts = [ourNick, ...nicks]
      .map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean)
      .slice(0, 4); // keep name reasonable
    return `#dm-${parts.join('-')}`;
  };

  const handleCreate = () => {
    if (selected.size < 2 || !client) return;
    setCreating(true);

    const nicks = [...selected];
    const channelName = generateChannelName(nicks);

    // JOIN the generated channel
    client.sendRaw('JOIN', channelName);

    // INVITE each selected nick after a brief delay to let JOIN settle
    setTimeout(() => {
      for (const nick of nicks) {
        client.sendRaw('INVITE', nick, channelName);
      }
      navigate({ kind: 'channel', channel: channelName });
      onClose();
    }, 400);
  };

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  const atMax     = selected.size >= MAX_USERS;
  const canCreate = selected.size >= 2;

  return (
    <div className="ngdm-overlay" onClick={onClose}>
      <div className="ngdm-modal animate-scale-in" onClick={stopProp} role="dialog" aria-modal="true" aria-label="New Group DM">

        {/* Header */}
        <div className="ngdm-header">
          <h2 className="ngdm-title">New Group DM</h2>
          <button className="ngdm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Selected chips */}
        {selected.size > 0 && (
          <div className="ngdm-chips">
            {[...selected].map(nick => (
              <span key={nick} className="ngdm-chip">
                <Avatar nick={nick} size={18} />
                {nick}
                <button
                  className="ngdm-chip-remove"
                  onClick={() => toggle(nick)}
                  aria-label={`Remove ${nick}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="ngdm-search-row">
          <input
            ref={inputRef}
            className="ngdm-search"
            placeholder="Search users…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>

        {atMax && (
          <div className="ngdm-warning">
            Maximum {MAX_USERS} users per group DM.
          </div>
        )}

        {/* User list */}
        <div className="ngdm-list" role="listbox" aria-label="Select users" aria-multiselectable="true">
          {filtered.length === 0 ? (
            <div className="ngdm-empty">
              {allUsers.length === 0
                ? 'No users visible — join a channel first.'
                : 'No users match your search.'}
            </div>
          ) : (
            filtered.map(user => {
              const isSelected = selected.has(user.nick);
              const isDisabled = !isSelected && atMax;
              return (
                <button
                  key={user.nick}
                  role="option"
                  aria-selected={isSelected}
                  className={`ngdm-user-row ${isSelected ? 'ngdm-user-row--selected' : ''} ${isDisabled ? 'ngdm-user-row--disabled' : ''}`}
                  onClick={() => !isDisabled && toggle(user.nick)}
                  disabled={isDisabled}
                >
                  <span className="ngdm-checkbox" aria-hidden>
                    {isSelected ? '✓' : ''}
                  </span>
                  <Avatar
                    nick={user.nick}
                    size={32}
                    status={user.away ? 'offline' : 'online'}
                  />
                  <span className="ngdm-user-nick">{user.nick}</span>
                  <span
                    className="ngdm-user-status-dot"
                    style={{ background: user.away ? 'var(--status-offline)' : 'var(--status-online)' }}
                    aria-hidden
                  />
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="ngdm-footer">
          <span className="ngdm-count-label">
            {selected.size} / {MAX_USERS} selected
          </span>
          <div className="ngdm-footer-actions">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!canCreate || creating}
              loading={creating}
              onClick={handleCreate}
            >
              Create
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        .ngdm-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.7);
          z-index: 600;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          backdrop-filter: blur(4px);
        }

        .ngdm-modal {
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          width: 100%; max-width: 400px;
          max-height: 80dvh;
          display: flex; flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-xl);
        }

        .ngdm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 20px 0;
          flex-shrink: 0;
        }

        .ngdm-title {
          font-size: 17px; font-weight: 700;
          color: var(--text-primary); letter-spacing: -0.2px;
        }

        .ngdm-close {
          width: 28px; height: 28px;
          border-radius: 50%; border: none;
          background: var(--bg-elevated); color: var(--text-muted);
          cursor: pointer; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          transition: background 100ms, color 100ms;
        }
        .ngdm-close:hover { background: var(--bg-overlay); color: var(--text-primary); }

        .ngdm-chips {
          display: flex; flex-wrap: wrap; gap: 6px;
          padding: 12px 20px 0;
          flex-shrink: 0;
        }

        .ngdm-chip {
          display: inline-flex; align-items: center; gap: 5px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          padding: 3px 8px 3px 5px;
          font-size: 13px; font-weight: 600; color: var(--accent);
        }

        .ngdm-chip-remove {
          background: none; border: none; cursor: pointer;
          color: var(--accent); font-size: 16px; line-height: 1;
          padding: 0; display: flex; align-items: center;
          opacity: 0.7; transition: opacity 100ms;
        }
        .ngdm-chip-remove:hover { opacity: 1; }

        .ngdm-search-row {
          padding: 12px 20px 0;
          flex-shrink: 0;
        }

        .ngdm-search {
          width: 100%;
          padding: 8px 12px; border-radius: var(--r-md);
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          color: var(--text-primary); font-size: 14px; font-family: inherit;
          box-sizing: border-box;
        }
        .ngdm-search:focus { outline: none; border-color: var(--accent-border); }
        .ngdm-search::placeholder { color: var(--text-muted); }

        .ngdm-warning {
          margin: 8px 20px 0;
          padding: 8px 12px;
          border-radius: var(--r-sm);
          background: rgba(232,184,75,0.1);
          border: 1px solid rgba(232,184,75,0.3);
          font-size: 12px; font-weight: 600;
          color: var(--gold, #e8b84b);
          flex-shrink: 0;
        }

        .ngdm-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 12px;
          display: flex; flex-direction: column; gap: 2px;
        }

        .ngdm-empty {
          text-align: center; padding: 24px;
          font-size: 13px; color: var(--text-muted);
        }

        .ngdm-user-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: var(--r-md);
          background: none; border: none; cursor: pointer;
          text-align: left; width: 100%;
          transition: background 100ms;
          font-family: inherit;
        }
        .ngdm-user-row:hover:not(.ngdm-user-row--disabled) {
          background: var(--ch-hover-bg);
        }
        .ngdm-user-row--selected {
          background: var(--accent-subtle) !important;
        }
        .ngdm-user-row--disabled {
          opacity: 0.4; cursor: not-allowed;
        }

        .ngdm-checkbox {
          width: 18px; height: 18px; flex-shrink: 0;
          border-radius: var(--r-sm);
          border: 2px solid var(--border-normal);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #fff;
          background: transparent;
          transition: background 100ms, border-color 100ms;
        }
        .ngdm-user-row--selected .ngdm-checkbox {
          background: var(--accent);
          border-color: var(--accent);
        }

        .ngdm-user-nick {
          flex: 1; font-size: 14px; font-weight: 600;
          color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .ngdm-user-status-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }

        .ngdm-footer {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px;
          padding: 14px 20px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .ngdm-count-label {
          font-size: 12px; color: var(--text-muted);
        }

        .ngdm-footer-actions {
          display: flex; gap: 8px;
        }

        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in { animation: scale-in 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both; }
      `}</style>
    </div>
  );
}
