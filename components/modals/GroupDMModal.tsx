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
          <button className="gdm-close" onClick={closeGroupDM} aria-label="Close">✕</button>
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
                >✕</button>
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
          background: var(--bg-deep, #06101d);
          border: 1px solid rgba(14,165,233,0.18);
          border-radius: 14px;
          width: min(480px, 94vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(14,165,233,0.06);
          overflow: hidden;
        }

        .gdm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }

        .gdm-title {
          font-size: 16px;
          font-weight: 700;
          color: #e2eaf4;
          margin: 0;
        }

        .gdm-close {
          background: none;
          border: none;
          color: rgba(226,234,244,0.4);
          font-size: 16px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: color 150ms, background 150ms;
        }
        .gdm-close:hover { color: #e2eaf4; background: rgba(255,255,255,0.07); }

        /* Chips */
        .gdm-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 12px 24px 0;
          flex-shrink: 0;
        }

        .gdm-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(14,165,233,0.15);
          border: 1px solid rgba(14,165,233,0.3);
          color: var(--accent, #0ea5e9);
          font-size: 13px;
          font-weight: 600;
          padding: 3px 8px 3px 4px;
          border-radius: 20px;
        }

        .gdm-chip-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(14,165,233,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }

        .gdm-chip-remove {
          background: none;
          border: none;
          color: rgba(14,165,233,0.6);
          cursor: pointer;
          padding: 0;
          font-size: 11px;
          line-height: 1;
          transition: color 150ms;
        }
        .gdm-chip-remove:hover { color: var(--accent, #0ea5e9); }

        /* Search */
        .gdm-search-wrap {
          padding: 12px 24px;
          flex-shrink: 0;
        }

        .gdm-search {
          width: 100%;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: #e2eaf4;
          font-size: 14px;
          padding: 10px 14px;
          outline: none;
          transition: border-color 150ms, background 150ms;
          box-sizing: border-box;
        }
        .gdm-search::placeholder { color: rgba(226,234,244,0.35); }
        .gdm-search:focus {
          border-color: rgba(14,165,233,0.4);
          background: rgba(255,255,255,0.07);
        }

        /* List */
        .gdm-list {
          list-style: none;
          margin: 0;
          padding: 0 8px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }

        .gdm-empty {
          text-align: center;
          color: rgba(226,234,244,0.35);
          font-size: 13px;
          padding: 20px;
        }

        .gdm-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          background: none;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 120ms;
          text-align: left;
        }
        .gdm-item:hover { background: rgba(14,165,233,0.09); }

        .gdm-item-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(14,165,233,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: var(--accent, #0ea5e9);
          flex-shrink: 0;
        }

        .gdm-item-nick {
          flex: 1;
          font-size: 14px;
          color: rgba(226,234,244,0.9);
          font-weight: 500;
        }

        .gdm-item-add {
          color: rgba(14,165,233,0.5);
          font-size: 18px;
          font-weight: 300;
          line-height: 1;
        }

        /* Footer */
        .gdm-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 24px;
          border-top: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }

        .gdm-cancel {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          color: rgba(226,234,244,0.7);
          font-size: 13px;
          font-weight: 600;
          padding: 8px 18px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 150ms;
        }
        .gdm-cancel:hover { background: rgba(255,255,255,0.1); }

        .gdm-start {
          background: var(--accent, #0ea5e9);
          border: none;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          padding: 8px 20px;
          border-radius: 8px;
          cursor: pointer;
          transition: opacity 150ms, filter 150ms;
        }
        .gdm-start:hover:not(:disabled) { filter: brightness(1.1); }
        .gdm-start:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
