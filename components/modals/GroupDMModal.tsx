'use client';
import { useState, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';

export default function GroupDMModal() {
  const closeGroupDM    = useOnyxStore(s => s.closeGroupDM);
  const navigate        = useOnyxStore(s => s.navigate);
  const client          = useOnyxStore(s => s.client);
  const friends         = useOnyxStore(s => s.friends);
  const channels        = useOnyxStore(s => s.channels);
  const ourNick         = useOnyxStore(s => s.ourNick);
  const addNotification = useOnyxStore(s => s.addNotification);

  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  // Collect all known nicks (friends + online channel members) excluding ourselves
  const candidates = useMemo(() => {
    const set = new Set<string>();
    for (const f of friends.values()) set.add(f.nick);
    for (const ch of channels.values()) {
      for (const u of ch.users.values()) {
        if (u.nick.toLowerCase() !== ourNick.toLowerCase()) set.add(u.nick);
      }
    }
    // Remove already-selected
    for (const s of selected) set.delete(s);
    const q = query.trim().toLowerCase();
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    return q ? arr.filter(n => n.toLowerCase().includes(q)) : arr;
  }, [friends, channels, ourNick, selected, query]);

  function toggleSelect(nick: string) {
    setSelected(prev =>
      prev.includes(nick) ? prev.filter(n => n !== nick) : [...prev, nick]
    );
    setQuery('');
  }

  function removeSelected(nick: string) {
    setSelected(prev => prev.filter(n => n !== nick));
  }

  function startGroup() {
    if (selected.length < 2 || !client) return;
    const channelName = `#gdm-${Date.now()}`;
    client.sendRaw('JOIN', channelName);
    for (const nick of selected) {
      client.sendRaw('INVITE', nick, channelName);
    }
    addNotification({ type: 'system', text: `Invited ${selected.join(', ')} to group conversation` });
    navigate({ kind: 'channel', channel: channelName });
    closeGroupDM();
  }

  return (
    <div className="gdm-backdrop" onClick={closeGroupDM}>
      <div className="gdm-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal aria-label="New Group Conversation">

        <header className="gdm-header">
          <h2 className="gdm-title">New Group Conversation</h2>
          <button className="gdm-close" onClick={closeGroupDM} aria-label="Close"><svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button>
        </header>

        {/* Selected user chips */}
        {selected.length > 0 && (
          <div className="gdm-chips">
            {selected.map(nick => (
              <span className="gdm-chip" key={nick}>
                <span className="gdm-chip-avatar">{nick[0]?.toUpperCase()}</span>
                {nick}
                <button
                  className="gdm-chip-remove"
                  onClick={() => removeSelected(nick)}
                  aria-label={`Remove ${nick}`}
                ><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="gdm-search-wrap">
          <input
            className="gdm-search"
            type="text"
            placeholder="Search users…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            aria-label="Search users to add"
          />
        </div>

        {/* Results list */}
        <ul className="gdm-list" role="listbox" aria-label="User results">
          {candidates.length === 0 && (
            <li className="gdm-empty">
              {query ? 'No users found' : 'No users available'}
            </li>
          )}
          {candidates.map(nick => (
            <li key={nick} role="option" aria-selected={false}>
              <button className="gdm-item" onClick={() => toggleSelect(nick)}>
                <span className="gdm-item-avatar">{nick[0]?.toUpperCase()}</span>
                <span className="gdm-item-nick">{nick}</span>
                <span className="gdm-item-add">+</span>
              </button>
            </li>
          ))}
        </ul>

        <footer className="gdm-footer">
          <button className="gdm-cancel" onClick={closeGroupDM}>Cancel</button>
          <button
            className="gdm-start"
            disabled={selected.length < 2 || !client}
            onClick={startGroup}
          >
            Start Group
          </button>
        </footer>
      </div>

      <style>{`
        .gdm-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(3,8,16,0.72);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 900;
        }

        .gdm-panel {
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          width: min(480px, 94vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-xl);
          overflow: hidden;
          animation: scaleIn 180ms var(--ease-out) both;
        }

        .gdm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px 15px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-elevated);
        }

        .gdm-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .gdm-close {
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 15px;
          cursor: pointer;
          width: 28px;
          height: 28px;
          border-radius: var(--r-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color var(--t-fast), background var(--t-fast);
        }
        .gdm-close:hover { color: var(--text-primary); background: var(--bg-overlay); }

        /* Chips */
        .gdm-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 12px 16px 0;
          flex-shrink: 0;
        }

        .gdm-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          font-size: 12px;
          font-weight: 600;
          padding: 3px 8px 3px 4px;
          border-radius: var(--r-full);
          transition: background var(--t-fast);
        }
        .gdm-chip:hover { background: rgba(14,165,233,0.18); }

        .gdm-chip-avatar {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }

        .gdm-chip-remove {
          background: none;
          border: none;
          color: var(--accent);
          cursor: pointer;
          padding: 0;
          font-size: 11px;
          line-height: 1;
          opacity: 0.6;
          transition: opacity var(--t-fast);
        }
        .gdm-chip-remove:hover { opacity: 1; }

        /* Search */
        .gdm-search-wrap {
          padding: 12px 16px 8px;
          flex-shrink: 0;
        }

        .gdm-search {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          font-size: 14px;
          padding: 9px 14px;
          outline: none;
          transition: border-color var(--t-fast), background var(--t-fast);
          box-sizing: border-box;
          font-family: inherit;
        }
        .gdm-search::placeholder { color: var(--text-muted); }
        .gdm-search:focus {
          border-color: var(--accent-border);
          background: var(--bg-float);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }

        /* List */
        .gdm-list {
          list-style: none;
          margin: 0;
          padding: 0 8px 8px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }

        .gdm-empty {
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
          padding: 24px;
        }

        .gdm-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: none;
          border: none;
          border-radius: var(--r-sm);
          cursor: pointer;
          transition: background var(--t-fast);
          text-align: left;
          font-family: inherit;
        }
        .gdm-item:hover { background: var(--ch-hover-bg); }

        .gdm-item-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: var(--accent);
          flex-shrink: 0;
        }

        .gdm-item-nick {
          flex: 1;
          font-size: 14px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .gdm-item-add {
          color: var(--accent);
          opacity: 0.4;
          font-size: 18px;
          font-weight: 300;
          line-height: 1;
          transition: opacity var(--t-fast);
        }
        .gdm-item:hover .gdm-item-add { opacity: 0.8; }

        /* Footer */
        .gdm-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 20px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-elevated);
        }

        .gdm-cancel {
          background: none;
          border: 1px solid var(--border-normal);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 600;
          padding: 8px 18px;
          border-radius: var(--r-sm);
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-fast), color var(--t-fast);
        }
        .gdm-cancel:hover { background: var(--bg-overlay); color: var(--text-primary); }

        .gdm-start {
          background: var(--accent);
          border: none;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          padding: 8px 20px;
          border-radius: var(--r-sm);
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-fast), opacity var(--t-fast);
        }
        .gdm-start:hover:not(:disabled) { background: var(--accent-hover); }
        .gdm-start:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
