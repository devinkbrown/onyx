'use client';
import { useState, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';
import Button from '@/components/ui/Button';

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
    <ModalShell
      onClose={closeGroupDM}
      title="New Group Conversation"
      kicker="Direct messages"
      titleId="gdm-modal-title"
      size="sm"
      flushBody
      footer={
        <>
          <span className="gdm-footer-hint" aria-live="polite">
            {selected.length < 2
              ? `Add at least ${2 - selected.length} more ${2 - selected.length === 1 ? 'person' : 'people'}`
              : `${selected.length} selected`}
          </span>
          <Button variant="ghost" onClick={closeGroupDM}>Cancel</Button>
          <Button
            variant="primary"
            disabled={selected.length < 2 || !client}
            onClick={startGroup}
          >
            Start group
          </Button>
        </>
      }
    >
      <div className="gdm-content">
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
              <span className="gdm-empty-figure" aria-hidden>
                <span className="gdm-empty-ring" />
                <span className="gdm-empty-dot" />
              </span>
              <span className="gdm-empty-title">{query ? 'No matches' : 'No one to add'}</span>
              <span className="gdm-empty-sub">
                {query
                  ? `Nobody matches "${query.trim()}".`
                  : 'Add friends or join a channel to find people.'}
              </span>
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
      </div>

      <style>{`
        .gdm-content {
          display: flex;
          flex-direction: column;
          min-height: 0;
          height: 100%;
        }

        /* Chips */
        .gdm-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: var(--sp-3, 12px) var(--sp-4, 16px) 0;
          flex-shrink: 0;
        }

        .gdm-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          font-size: var(--text-xs, 12px);
          font-weight: 600;
          padding: 3px 8px 3px 4px;
          border-radius: var(--r-full);
          transition: background var(--t-control, 150ms);
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
          transition: opacity var(--t-control, 150ms);
        }
        .gdm-chip-remove:hover { opacity: 1; }
        .gdm-chip-remove:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: var(--r-xs, 3px);
          opacity: 1;
        }

        /* Search */
        .gdm-search-wrap {
          padding: var(--sp-3, 12px) var(--sp-4, 16px) var(--sp-2, 8px);
          flex-shrink: 0;
        }

        .gdm-search {
          width: 100%;
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          font-size: var(--text-base, 14px);
          padding: 9px 14px;
          outline: none;
          transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms);
          box-sizing: border-box;
          font-family: inherit;
        }
        .gdm-search::placeholder { color: var(--text-muted); }
        .gdm-search:hover {
          border-color: var(--border-normal);
        }
        .gdm-search:focus-visible {
          border-color: var(--accent);
          background: var(--bg-float);
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        /* List */
        .gdm-list {
          list-style: none;
          margin: 0;
          padding: 0 var(--sp-2, 8px) var(--sp-2, 8px);
          overflow-y: auto;
          flex: 1;
          min-height: 120px;
          max-height: 320px;
        }

        .gdm-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          text-align: center;
          color: var(--text-muted);
          padding: var(--sp-8, 32px) var(--sp-6, 24px);
        }
        .gdm-empty-figure {
          position: relative;
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          margin-bottom: var(--sp-1, 4px);
        }
        .gdm-empty-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--text-muted) 30%, transparent);
        }
        .gdm-empty-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--lux) 70%, var(--bg-deep));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .gdm-empty-title {
          font-size: var(--text-sm, 13px);
          font-weight: 600;
          color: var(--text-secondary);
        }
        .gdm-empty-sub {
          font-size: var(--text-xs, 12px);
          color: var(--text-muted);
          line-height: 1.5;
          max-width: 240px;
        }

        .gdm-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: var(--sp-2, 8px) var(--sp-3, 12px);
          background: none;
          border: none;
          border-radius: var(--r-sm);
          cursor: pointer;
          transition: background var(--t-control, 150ms);
          text-align: left;
          font-family: inherit;
        }
        .gdm-item:hover { background: var(--ch-hover-bg); }
        .gdm-item:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }

        .gdm-item-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--text-sm, 13px);
          font-weight: 700;
          color: var(--accent);
          flex-shrink: 0;
        }

        .gdm-item-nick {
          flex: 1;
          font-size: var(--text-base, 14px);
          color: var(--text-secondary);
          font-weight: 500;
        }

        .gdm-item-add {
          color: var(--accent);
          opacity: 0.4;
          font-size: 18px;
          font-weight: 300;
          line-height: 1;
          transition: opacity var(--t-control, 150ms);
        }
        .gdm-item:hover .gdm-item-add { opacity: 0.8; }

        .gdm-footer-hint {
          margin-right: auto;
          font-size: var(--text-xs, 12px);
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </ModalShell>
  );
}
