'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import { getNickColor } from '@/lib/nick-color';

// ── Deterministic avatar hue from nick ───────────────────────────────────────

function nickHue(nick: string): number {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash) % 360;
}

function nickInitials(nick: string): string {
  return nick.slice(0, 2).toUpperCase();
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ nick }: { nick: string }) {
  const hue = nickHue(nick);
  return (
    <span
      className="fp-avatar"
      aria-hidden
      style={{ background: `hsl(${hue},55%,38%)` }}
    >
      {nickInitials(nick)}
    </span>
  );
}

// ── Status dot ───────────────────────────────────────────────────────────────

type FriendStatus = 'online' | 'offline' | 'away';

function StatusDot({ status }: { status: FriendStatus }) {
  return (
    <span
      className={`fp-status-dot fp-status-dot--${status}`}
      aria-label={status === 'online' ? 'Online' : status === 'away' ? 'Away' : 'Offline'}
    />
  );
}

// ── Friend row ────────────────────────────────────────────────────────────────

interface FriendRowProps {
  nick: string;
  status: FriendStatus;
  note?: string;
  onOpenDM: (nick: string) => void;
  onRemove: (nick: string) => void;
}

function FriendRow({ nick, status, note, onOpenDM, onRemove }: FriendRowProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function handleRemoveClick() {
    if (confirmingRemove) {
      onRemove(nick);
      setConfirmingRemove(false);
    } else {
      setConfirmingRemove(true);
    }
  }

  useEffect(() => {
    if (!confirmingRemove) return;
    const timer = setTimeout(() => setConfirmingRemove(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingRemove]);

  return (
    <div className={`fp-row ${status === 'offline' ? 'fp-row--offline' : ''}`}>
      <div className="fp-row-avatar-wrap">
        <Avatar nick={nick} />
        <StatusDot status={status} />
      </div>
      <div className="fp-row-body">
        <span className="fp-row-nick" style={{ color: getNickColor(nick) }}>{nick}</span>
        {note
          ? <span className="fp-row-note">{note}</span>
          : <span className={`fp-row-note ${status === 'online' ? 'fp-row-note--online' : ''}`}>{status}</span>
        }
      </div>
      <div className="fp-row-actions">
        <button
          className="fp-action-btn fp-action-btn--dm"
          onClick={() => onOpenDM(nick)}
          title={`Message ${nick}`}
          aria-label={`Open DM with ${nick}`}
        >
          <DMIcon />
        </button>
        <button
          className={`fp-action-btn fp-action-btn--remove ${confirmingRemove ? 'fp-action-btn--confirm' : ''}`}
          onClick={handleRemoveClick}
          title={confirmingRemove ? 'Click again to confirm' : `Remove ${nick}`}
          aria-label={confirmingRemove ? `Confirm remove ${nick}` : `Remove ${nick} from friends`}
        >
          {confirmingRemove ? <ConfirmIcon /> : <RemoveIcon />}
        </button>
      </div>
    </div>
  );
}

// ── Block row (Blocked tab) ────────────────────────────────────────────────────

interface BlockedRowProps {
  nick: string;
  onUnblock: (nick: string) => void;
}

function BlockedRow({ nick, onUnblock }: BlockedRowProps) {
  return (
    <div className="fp-row fp-row--offline">
      <div className="fp-row-avatar-wrap">
        <Avatar nick={nick} />
        <StatusDot status="offline" />
      </div>
      <div className="fp-row-body">
        <span className="fp-row-nick" style={{ color: getNickColor(nick) }}>{nick}</span>
        <span className="fp-row-note">Blocked</span>
      </div>
      <div className="fp-row-actions fp-row-actions--always-visible">
        <button
          className="fp-unblock-btn"
          onClick={() => onUnblock(nick)}
          title={`Unblock ${nick}`}
          aria-label={`Unblock ${nick}`}
        >
          Unblock
        </button>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  sub?: string;
}

function EmptyState({ icon, title, sub }: EmptyStateProps) {
  return (
    <div className="fp-empty">
      <span className="fp-empty-icon">{icon}</span>
      <span className="fp-empty-title">{title}</span>
      {sub && <span className="fp-empty-sub">{sub}</span>}
    </div>
  );
}

// ── Add Friend tab ─────────────────────────────────────────────────────────────

interface AddFriendTabProps {
  onAdd: (nick: string) => void;
}

function AddFriendTab({ onAdd }: AddFriendTabProps) {
  const [addNick, setAddNick] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleAdd() {
    const nick = addNick.trim();
    if (!nick) return;
    onAdd(nick);
    setAddNick('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAdd();
  }

  return (
    <div className="fp-add-section">
      <h3 className="fp-add-heading">Add Friend</h3>
      <p className="fp-add-desc">You can add a friend by their IRC nick.</p>
      <div className="fp-add-row">
        <input
          ref={inputRef}
          className="fp-add-input"
          type="text"
          placeholder="Enter a nick"
          value={addNick}
          onChange={e => setAddNick(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Nickname to add as friend"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="fp-add-btn"
          onClick={handleAdd}
          disabled={!addNick.trim()}
          aria-label="Add friend"
        >
          Send Friend Request
        </button>
      </div>
      <div className="fp-add-hint">
        <InfoIcon />
        <span>Adding a friend will watch their online status with WATCH.</span>
      </div>
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'online',  label: 'Online'     },
  { id: 'all',     label: 'All'        },
  { id: 'pending', label: 'Pending'    },
  { id: 'blocked', label: 'Blocked'    },
  { id: 'add',     label: 'Add Friend' },
];

export default function FriendsPanel() {
  const friends           = useOnyxStore(s => s.friends);
  const softIgnoreList    = useOnyxStore(s => s.softIgnoreList);
  const awayNicks         = useOnyxStore(s => s.awayNicks);
  const closeFriendsPanel = useOnyxStore(s => s.closeFriendsPanel);
  const addFriend         = useOnyxStore(s => s.addFriend);
  const removeFriend      = useOnyxStore(s => s.removeFriend);
  const toggleSoftIgnore  = useOnyxStore(s => s.toggleSoftIgnore);
  const addToWatchList    = useOnyxStore(s => s.addToWatchList);
  const navigate          = useOnyxStore(s => s.navigate);

  const [tab, setTab] = useState<Tab>('online');

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFriendsPanel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeFriendsPanel]);

  const handleOpenDM = useCallback((nick: string) => {
    navigate({ kind: 'dm', nick });
    closeFriendsPanel();
  }, [navigate, closeFriendsPanel]);

  const handleRemove = useCallback((nick: string) => {
    removeFriend(nick);
  }, [removeFriend]);

  const handleUnblock = useCallback((nick: string) => {
    toggleSoftIgnore(nick);
  }, [toggleSoftIgnore]);

  const handleAddFriend = useCallback((nick: string) => {
    addFriend(nick);
    addToWatchList(nick);
    setTab('all');
  }, [addFriend, addToWatchList]);

  // Derive per-nick status from friends map + awayNicks
  function friendStatus(entry: { nick: string; online: boolean }): FriendStatus {
    if (!entry.online) return 'offline';
    if (awayNicks.has(entry.nick.toLowerCase())) return 'away';
    return 'online';
  }

  const allFriends = [...friends.values()].sort((a, b) => {
    const ao = a.online ? 0 : 1;
    const bo = b.online ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return a.nick.localeCompare(b.nick);
  });

  const onlineFriends = allFriends.filter(f => f.online);
  const onlineCount   = onlineFriends.length;

  const blockedList = [...softIgnoreList].sort((a, b) => a.localeCompare(b));

  return (
    <>
      {/* Backdrop */}
      <div className="fp-backdrop" onClick={closeFriendsPanel} aria-hidden />

      <aside
        className="fp-panel animate-fp-in"
        role="complementary"
        aria-label="Friends and contacts"
      >
        {/* Header */}
        <div className="fp-header">
          <div className="fp-header-left">
            <span className="fp-header-title">Friends</span>
            {onlineCount > 0 && (
              <span className="fp-header-badge">
                {onlineCount > 99 ? '99+' : onlineCount}
              </span>
            )}
          </div>
          <button
            className="fp-close"
            onClick={closeFriendsPanel}
            aria-label="Close friends panel"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="fp-tabs" role="tablist" aria-label="Friends tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`fp-tab ${tab === t.id ? 'fp-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="fp-body">
          {tab === 'online' && (
            onlineFriends.length === 0
              ? <EmptyState
                  icon={<OnlineIllustration />}
                  title="Nobody online yet"
                  sub="Your friends will appear here when they connect."
                />
              : <div className="fp-list">
                  {onlineFriends.map(f => (
                    <FriendRow
                      key={f.nick.toLowerCase()}
                      nick={f.nick}
                      status={friendStatus(f)}
                      note={f.note}
                      onOpenDM={handleOpenDM}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
          )}

          {tab === 'all' && (
            allFriends.length === 0
              ? <EmptyState
                  icon={<PeopleIllustration />}
                  title="No friends yet"
                  sub="Add someone using the Add Friend tab."
                />
              : <div className="fp-list">
                  {allFriends.map(f => (
                    <FriendRow
                      key={f.nick.toLowerCase()}
                      nick={f.nick}
                      status={friendStatus(f)}
                      note={f.note}
                      onOpenDM={handleOpenDM}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
          )}

          {tab === 'pending' && (
            <EmptyState
              icon={<PendingIllustration />}
              title="No pending requests"
              sub="Friend requests will appear here when you receive them."
            />
          )}

          {tab === 'blocked' && (
            blockedList.length === 0
              ? <EmptyState
                  icon={<BlockIllustration />}
                  title="Nobody blocked"
                  sub="Users you block will appear here."
                />
              : <div className="fp-list">
                  {blockedList.map(nick => (
                    <BlockedRow
                      key={nick}
                      nick={nick}
                      onUnblock={handleUnblock}
                    />
                  ))}
                </div>
          )}

          {tab === 'add' && (
            <AddFriendTab onAdd={handleAddFriend} />
          )}
        </div>
      </aside>

      <style>{`
        .fp-backdrop {
          position: fixed;
          inset: 0;
          z-index: 617;
          background: transparent;
        }

        .fp-panel {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
          width: 380px;
          z-index: 618;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex;
          flex-direction: column;
          box-shadow: -6px 0 32px rgba(0,0,0,0.4);
          overflow: hidden;
        }

        @keyframes fp-slide-in {
          from { opacity: 0; transform: translateX(28px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .animate-fp-in {
          animation: fp-slide-in 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        /* ── Header ── */
        .fp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          height: var(--header-h, 48px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .fp-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fp-header-title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--text-primary);
          text-transform: uppercase;
        }
        .fp-header-badge {
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
          padding: 2px 6px;
          border-radius: 20px;
          min-width: 18px;
          text-align: center;
          background: var(--success, #3ba55d);
          color: #fff;
        }
        .fp-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm, 4px);
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
          flex-shrink: 0;
        }
        .fp-close:hover { background: var(--bg-overlay); color: var(--text-primary); }

        /* ── Tabs ── */
        .fp-tabs {
          display: flex;
          gap: 2px;
          padding: 0 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .fp-tabs::-webkit-scrollbar { display: none; }
        .fp-tab {
          position: relative;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 12px 10px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-muted);
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          font-family: inherit;
          transition: color var(--t-fast, 150ms);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .fp-tab:hover { color: var(--text-secondary); }
        .fp-tab--active {
          color: var(--text-normal, var(--text-primary));
          border-bottom-color: var(--accent, #0ea5e9);
        }

        /* ── Body ── */
        .fp-body {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 16px;
        }
        .fp-body::-webkit-scrollbar { width: 4px; }
        .fp-body::-webkit-scrollbar-track { background: transparent; }
        .fp-body::-webkit-scrollbar-thumb { background: var(--border-normal); border-radius: 2px; }

        /* ── Friend list ── */
        .fp-list {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          padding: 8px 0;
        }

        /* ── Section label ── */
        .fp-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 12px 16px 4px;
        }

        /* ── Friend row ── */
        .fp-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 16px;
          cursor: pointer;
          transition: background var(--t-fast, 150ms);
          border-radius: 0;
        }
        .fp-row:hover { background: var(--ch-hover-bg, rgba(14,165,233,0.07)); }
        .fp-row--offline { opacity: 0.6; }

        .fp-row-avatar-wrap {
          position: relative;
          flex-shrink: 0;
        }

        .fp-avatar {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          font-size: 11px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          letter-spacing: 0.02em;
          user-select: none;
        }

        .fp-status-dot {
          position: absolute;
          bottom: -1px;
          right: -1px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid var(--bg-deep);
        }
        .fp-status-dot--online  { background: var(--success, #3ba55d); }
        .fp-status-dot--away    { background: var(--warning, #faa81a); }
        .fp-status-dot--offline { background: var(--text-muted, #72767d); }

        .fp-row-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .fp-row-nick {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fp-row-note {
          font-size: 12px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-transform: capitalize;
        }
        .fp-row-note--online { color: var(--success, #3ba55d); }

        .fp-row-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
          opacity: 0;
          transition: opacity var(--t-fast, 150ms);
        }
        .fp-row:hover .fp-row-actions { opacity: 1; }
        .fp-row-actions--always-visible { opacity: 1; }

        .fp-action-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-overlay);
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: 50%;
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
        }
        .fp-action-btn--dm:hover {
          background: color-mix(in oklch, var(--accent, #0ea5e9) 18%, transparent);
          color: var(--accent, #0ea5e9);
        }
        .fp-action-btn--remove:hover {
          background: color-mix(in oklch, var(--danger, #ed4245) 14%, transparent);
          color: var(--danger, #ed4245);
        }
        .fp-action-btn--confirm {
          background: color-mix(in oklch, var(--danger, #ed4245) 14%, transparent);
          color: var(--danger, #ed4245);
        }

        .fp-unblock-btn {
          padding: 4px 12px;
          height: 28px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          background: var(--bg-overlay);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm, 4px);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
          white-space: nowrap;
        }
        .fp-unblock-btn:hover {
          background: color-mix(in oklch, var(--success, #3ba55d) 16%, transparent);
          color: var(--success, #3ba55d);
          border-color: color-mix(in oklch, var(--success, #3ba55d) 40%, transparent);
        }

        /* ── Empty state ── */
        .fp-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          gap: 10px;
          min-height: 260px;
        }
        .fp-empty-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .fp-empty-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-secondary);
        }
        .fp-empty-sub {
          font-size: 12px;
          color: var(--text-muted);
          text-align: center;
          max-width: 240px;
          line-height: 1.55;
        }

        /* ── Add Friend tab ── */
        .fp-add-section {
          padding: 24px 20px;
          max-width: 460px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .fp-add-heading {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }
        .fp-add-desc {
          font-size: 13px;
          color: var(--text-muted);
          margin: -4px 0 0;
          line-height: 1.55;
        }
        .fp-add-row {
          display: flex;
          gap: 0;
        }
        .fp-add-input {
          flex: 1;
          padding: 10px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-right: none;
          border-radius: var(--r-md) 0 0 var(--r-md);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color var(--t-fast, 150ms), box-shadow var(--t-fast, 150ms);
        }
        .fp-add-input:focus {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }
        .fp-add-input::placeholder {
          color: var(--text-muted);
        }
        .fp-add-btn {
          padding: 0 18px;
          background: var(--accent, #0ea5e9);
          color: #fff;
          border: none;
          border-radius: 0 var(--r-md) var(--r-md) 0;
          font-size: 13px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-fast, 150ms);
          white-space: nowrap;
        }
        .fp-add-btn:hover:not(:disabled) { background: var(--accent-hover, #38bdf8); }
        .fp-add-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .fp-add-hint {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-sm, 4px);
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .fp-add-hint svg {
          flex-shrink: 0;
          margin-top: 1px;
          color: var(--accent, #0ea5e9);
        }

        @media (max-width: 480px) {
          .fp-panel { width: 100%; }
        }
      `}</style>
    </>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function DMIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3 2v-2H3a1 1 0 0 1-1-1V3zm2 1v5h2v1.4l1.4-1.4H12V4H4z" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}

function ConfirmIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7l4 4 6-6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="6" />
      <path d="M7 6v4M7 4.5v.5" />
    </svg>
  );
}

function PeopleIllustration() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="10" r="4" />
      <path d="M3 26c0-4.418 3.582-8 8-8s8 3.582 8 8" />
      <circle cx="23" cy="10" r="3" />
      <path d="M29 26c0-3.314-2.686-6-6-6" />
    </svg>
  );
}

function OnlineIllustration() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="16" cy="16" r="13" />
      <path d="M10 16l4 4 8-8" />
    </svg>
  );
}

function PendingIllustration() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="16" cy="16" r="13" />
      <path d="M16 9v8l4 4" />
    </svg>
  );
}

function BlockIllustration() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="16" cy="16" r="13" />
      <path d="M6.7 6.7l18.6 18.6" />
    </svg>
  );
}
