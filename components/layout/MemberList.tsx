'use client';

import { useMemo, useState, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import SkeletonMember from '@/components/chat/SkeletonMember';
import type { ChannelUser } from '@/lib/irc/types';
import Avatar from '@/components/ui/Avatar';
import UserPopover from '@/components/ui/UserPopover';
import MemberContextMenu from '@/components/ui/MemberContextMenu';
import { getNickColor } from '@/lib/nick-color';
import EmptyState from '@/components/ui/EmptyState';
import { parseActivity, activityShort } from '@/lib/activity';

/* ── Role definitions ──────────────────────────────────────────── */

/* Ophion PREFIX=(qov).@+  — q='.', o='@', v='+'.  No 'a' or 'h'. */
const ROLE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  q: { label: 'Owner', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  o: { label: 'Op',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  v: { label: 'Voice', color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
};

const ROLE_ORDER = ['q', 'o', 'v', ''] as const;

const GROUP_LABELS: Record<string, string> = {
  q: 'Owners',
  o: 'Ops',
  v: 'Voice',
  '': 'Members',
};

type SortMode = 'role' | 'alpha' | 'online-first' | 'recent';

const SORT_LABELS: Record<SortMode, string> = {
  'role':         'By Role',
  'alpha':        'A–Z',
  'online-first': 'Online First',
  'recent':       'Recent',
};

const SORT_CYCLE: SortMode[] = ['role', 'alpha', 'online-first', 'recent'];

function getHighestRole(modes: Set<string>): string {
  for (const mode of ['q', 'o', 'v'] as const) {
    if (modes.has(mode)) return mode;
  }
  return '';
}

interface Group {
  key: string;
  label: string;
  color: string | null;
  members: ChannelUser[];
}

type PresenceState = 'online' | 'away' | 'offline';

function getPresence(user: ChannelUser): PresenceState {
  if (user.away) return 'away';
  return 'online';
}

/* ── MemberList ────────────────────────────────────────────────── */

interface CtxMenuState {
  nick: string;
  userMode: Set<string>;
  x: number;
  y: number;
}

export default function MemberList() {
  const activeView        = useOnyxStore(s => s.activeView);
  const channels          = useOnyxStore(s => s.channels);
  const memberListSort    = useOnyxStore(s => s.memberListSort);
  const setMemberListSort = useOnyxStore(s => s.setMemberListSort);
  const client            = useOnyxStore(s => s.client);
  const connectionStatus  = useOnyxStore(s => s.connectionStatus);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const channel = activeView.kind === 'channel'
    ? channels.get(activeView.channel.toLowerCase())
    : null;

  const channelName = activeView.kind === 'channel' ? activeView.channel : '';

  const handleMemberRightClick = (e: React.MouseEvent, member: ChannelUser) => {
    e.preventDefault();
    setCtxMenu({
      nick: member.nick,
      userMode: member.modes,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const allMembers = useMemo<ChannelUser[]>(() => {
    if (!channel) return [];
    return [...channel.users.values()];
  }, [channel]);

  const filteredMembers = useMemo<Set<string>>(() => {
    if (!search.trim()) return new Set<string>();
    const q = search.toLowerCase();
    return new Set(allMembers.filter(m => m.nick.toLowerCase().includes(q)).map(m => m.nick));
  }, [allMembers, search]);

  const isFiltering = search.trim().length > 0;

  const groups = useMemo<Group[]>(() => {
    if (!channel) return [];

    const members = [...channel.users.values()].filter(u =>
      !isFiltering || filteredMembers.has(u.nick)
    );

    if (memberListSort === 'alpha') {
      const sorted = [...members].sort((a, b) =>
        a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' })
      );
      return [{ key: '__all', label: 'Members', color: null, members: sorted }];
    }

    if (memberListSort === 'online-first') {
      const online = members.filter(u => !u.away).sort((a, b) =>
        a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' })
      );
      const away = members.filter(u => u.away).sort((a, b) =>
        a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' })
      );
      const result: Group[] = [];
      if (online.length > 0) result.push({ key: '__online', label: 'Online', color: '#23a55a', members: online });
      if (away.length > 0) result.push({ key: '__away', label: 'Away', color: '#f0b232', members: away });
      return result;
    }

    if (memberListSort === 'recent') {
      const sorted = [...members].sort((a, b) =>
        a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' })
      );
      return [{ key: '__all', label: 'Members', color: null, members: sorted }];
    }

    // Default: by role
    const byMode = new Map<string, ChannelUser[]>();
    for (const u of members) {
      const role = getHighestRole(u.modes);
      if (!byMode.has(role)) byMode.set(role, []);
      byMode.get(role)!.push(u);
    }

    return ROLE_ORDER
      .filter(m => byMode.has(m))
      .map(m => ({
        key:     m,
        label:   GROUP_LABELS[m] ?? 'Members',
        color:   ROLE_STYLES[m]?.color ?? null,
        members: byMode.get(m)!.sort((a, b) => {
          // Within each role: online first, then alpha
          const aAway = a.away ? 1 : 0;
          const bAway = b.away ? 1 : 0;
          if (aAway !== bAway) return aAway - bAway;
          return a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' });
        }),
      }));
  }, [channel, isFiltering, filteredMembers, memberListSort]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const cycleSortMode = () => {
    const idx = SORT_CYCLE.indexOf(memberListSort);
    const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
    setMemberListSort(next);
  };

  if (!channel) return null;

  const total = channel.users.size;
  const shown = isFiltering ? filteredMembers.size : total;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearch('');
      inputRef.current?.blur();
    }
  };

  return (
    <div className="ml-root">
      <div className="ml-header">
        <span className="ml-title">
          Members<span className="ml-title-count"> — {total}</span>
        </span>
        <div className="ml-header-actions">
          <button
            className="ml-sort-btn"
            onClick={cycleSortMode}
            title={`Sort: ${SORT_LABELS[memberListSort]}`}
            aria-label={`Sort members: ${SORT_LABELS[memberListSort]}`}
          >
            <SortIcon />
            <span className="ml-sort-label">{SORT_LABELS[memberListSort]}</span>
          </button>
        </div>
      </div>

      <div className="member-search-wrap">
        <input
          ref={inputRef}
          type="search"
          className="member-search-input"
          placeholder="Search members..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search members"
        />
        {search && (
          <button
            className="member-search-clear"
            onClick={() => { setSearch(''); inputRef.current?.focus(); }}
            aria-label="Clear search"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>
            </svg>
          </button>
        )}
        <button
          className="member-refresh-btn"
          onClick={() => { if (channelName) client?.sendRaw('WHO', channelName); }}
          title="Refresh member info (WHO)"
          aria-label="Refresh members"
        >
          ↻
        </button>
      </div>

      {isFiltering && (
        <div className="member-count" aria-live="polite">
          {shown} of {total} members
        </div>
      )}

      <div className="ml-scroll" role="list" aria-label="Channel members">
        {connectionStatus === 'connecting' ? (
          <SkeletonMember count={12} />
        ) : groups.length === 0 && isFiltering ? (
          <div className="ml-no-results">
            <SearchIcon />
            <span className="ml-no-results-title">No members matching</span>
            <span className="ml-no-results-query">&ldquo;{search}&rdquo;</span>
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No members visible"
            description="Members will appear here when you join a channel"
            size="sm"
          />
        ) : (
          groups.map(g => {
            const isCollapsed = collapsedGroups.has(g.key);
            return (
              <div key={g.key} className="ml-group">
                <button
                  className="ml-group-label ml-group-label--btn"
                  style={g.color ? { color: g.color } : undefined}
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${g.label}`}
                >
                  <span className={`ml-group-arrow${isCollapsed ? ' ml-group-arrow--collapsed' : ''}`} aria-hidden>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 2.5l2.5 3 2.5-3"/>
                    </svg>
                  </span>
                  {g.label} — {g.members.length}
                </button>
                {!isCollapsed && g.members.map(u => (
                  <MemberRow
                    key={u.nick}
                    user={u}
                    role={memberListSort === 'role' ? g.key : getHighestRole(u.modes)}
                    onContextMenu={handleMemberRightClick}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {ctxMenu && (
        <MemberContextMenu
          nick={ctxMenu.nick}
          channel={channelName}
          userMode={ctxMenu.userMode}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <style>{`
        .ml-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .ml-header {
          height: var(--header-h);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          box-sizing: border-box;
          gap: 8px;
        }

        .ml-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-secondary);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ml-title-count {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
          text-transform: none;
        }

        .ml-header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ml-sort-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          background: none;
          border: 1px solid transparent;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 10px;
          font-family: inherit;
          padding: 3px 6px;
          border-radius: var(--r-sm, 4px);
          transition: color var(--t-fast), background var(--t-fast);
          white-space: nowrap;
        }
        .ml-sort-btn:hover {
          color: var(--text-secondary);
          background: var(--bg-float);
          border-color: var(--border-subtle);
        }
        .ml-sort-btn:active {
          background: var(--accent-subtle);
          color: var(--accent);
        }

        .ml-sort-label {
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        /* Member count is now inline in the title — .ml-count removed */

        .member-search-wrap {
          padding: 8px 10px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .member-search-input {
          flex: 1;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 6px);
          min-width: 0;
          height: 30px;
          padding: 5px 28px 5px 10px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          font-family: inherit;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
          box-sizing: border-box;
        }
        .member-search-input::placeholder { color: var(--text-muted); }
        .member-search-input:focus {
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px var(--accent-subtle);
        }

        .member-search-clear {
          position: absolute;
          right: 44px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 15px;
          line-height: 1;
          padding: 2px 3px;
          border-radius: var(--r-xs);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color var(--t-fast), background var(--t-fast);
        }
        .member-search-clear:hover { color: var(--text-primary); background: var(--bg-float); }

        .member-refresh-btn {
          flex-shrink: 0;
          width: 30px;
          height: 30px;
          border-radius: var(--r-sm);
          border: 1px solid transparent;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color var(--t-fast), background var(--t-fast), border-color var(--t-fast), transform 0.35s;
          padding: 0;
        }
        .member-refresh-btn:hover {
          color: var(--text-secondary);
          background: var(--bg-float);
          border-color: var(--border-normal);
        }
        .member-refresh-btn:active { transform: rotate(180deg); }

        .member-count {
          font-size: 10px;
          color: var(--text-muted);
          padding: 4px 12px 2px;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }

        .ml-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 6px 8px 12px;
          min-height: 0;
          scrollbar-gutter: stable;
        }

        /* Group: add subtle top separator for visual rhythm */
        .ml-group {
          margin-bottom: 8px;
        }
        .ml-group + .ml-group {
          border-top: 1px solid var(--border-subtle);
          padding-top: 6px;
          margin-top: 2px;
        }

        .ml-group-label {
          padding: 8px 8px 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .ml-group-label--btn {
          display: flex;
          align-items: center;
          gap: 5px;
          width: 100%;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          user-select: none;
          border-radius: var(--r-sm, 4px);
          transition: color var(--t-fast), background var(--t-fast);
        }
        .ml-group-label--btn:hover {
          color: var(--text-secondary);
          background: var(--ch-hover-bg);
        }

        .ml-group-arrow {
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s var(--ease-out, cubic-bezier(0.16,1,0.3,1));
          opacity: 0.55;
          flex-shrink: 0;
        }
        .ml-group-arrow--collapsed { transform: rotate(-90deg); }

        .ml-no-results {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 40px 16px;
          color: var(--text-muted);
        }

        .ml-no-results-title {
          font-size: 13px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .ml-no-results-query {
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
          word-break: break-all;
          text-align: center;
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}

/* ── SearchIcon ────────────────────────────────────────────────── */

function SearchIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5l4 4" />
    </svg>
  );
}

/* ── SortIcon ──────────────────────────────────────────────────── */

function SortIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M2 3h8M3 6h6M4 9h4" />
    </svg>
  );
}

/* ── MemberRow ─────────────────────────────────────────────────── */

function MemberRow({
  user,
  role,
  onContextMenu,
}: {
  user: ChannelUser;
  role: string;
  onContextMenu: (e: React.MouseEvent, member: ChannelUser) => void;
}) {
  const roleStyle            = ROLE_STYLES[role] ?? null;
  const userProps            = useOnyxStore(s => s.userProps);
  const userActivities       = useOnyxStore(s => s.userActivities);
  const openUserProfile      = useOnyxStore(s => s.openUserProfile);
  const speakingNicks        = useOnyxStore(s => s.speakingNicks);
  const displayNameOverrides = useOnyxStore(s => s.displayNameOverrides);
  const nickProps            = userProps.get(user.nick.toLowerCase()) ?? {};
  const statusText           = nickProps.STATUS ?? nickProps.Status ?? '';
  const storedActivity       = userActivities[user.nick.toLowerCase()];
  const activity             = storedActivity ?? parseActivity(statusText);
  const presence             = getPresence(user);

  // Local-only display name override
  const displayName    = displayNameOverrides[user.nick] || user.nick;
  const hasDisplayName = displayName !== user.nick;

  const avatarStatus: 'online' | 'idle' | 'offline' =
    presence === 'away' ? 'idle' : 'online';
  const isSpeaking      = speakingNicks.has(user.nick);

  const roleLabel       = roleStyle?.label ?? 'Member';
  const presenceLabel   = presence === 'away' ? 'away' : 'online';
  const memberAriaLabel = `${hasDisplayName ? displayName : user.nick}, ${roleLabel}, ${presenceLabel}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openUserProfile(user.nick);
  };

  return (
    <UserPopover nick={user.nick}>
      <div
        className={`mr-row${user.away ? ' mr-row--away' : ''}`}
        onClick={handleClick}
        onContextMenu={e => onContextMenu(e, user)}
        role="listitem"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') handleClick(e as unknown as React.MouseEvent);
        }}
        aria-label={memberAriaLabel}
      >
        <div className="mr-avatar-wrap">
          <Avatar
            nick={user.nick}
            size={32}
            status={avatarStatus}
            speaking={isSpeaking}
          />
        </div>

        <div className="mr-text">
          <span className="mr-nick">
            <span style={{ color: getNickColor(user.nick) }} className={user.away ? 'mr-nick-away' : ''}>
              {displayName}
            </span>
            {user.away && <span className="mr-away-icon" aria-hidden>💤</span>}
          </span>
          {hasDisplayName && (
            <span className="mr-actual-nick" title={`IRC nick: ${user.nick}`}>{user.nick}</span>
          )}
          {activity
            ? (
              <span className="mr-activity">
                <span className="mr-activity-emoji" aria-hidden>{activity.emoji}</span>
                <span className="mr-activity-text">{activityShort(activity)}</span>
              </span>
            )
            : statusText
            ? <span className="mr-account">{statusText}</span>
            : user.account
            ? <span className="mr-account">{user.account}</span>
            : null
          }
        </div>

        {user.modes?.has('B') && (
          <span className="mr-bot-badge">BOT</span>
        )}


        <style>{`
          .mr-row {
            position: relative;
            display: flex;
            align-items: center;
            gap: 9px;
            min-height: 38px;
            padding: 5px 8px;
            border-radius: var(--r-sm);
            cursor: pointer;
            transition: background var(--t-fast), opacity var(--t-fast);
          }
          .mr-row:hover { background: var(--ch-hover-bg); }
          .mr-row:focus-visible {
            outline: 2px solid var(--accent-border);
            outline-offset: -1px;
          }
          /* Offline/away de-emphasis */
          .mr-row--away { opacity: 0.55; }
          .mr-row--away:hover { opacity: 0.85; }

          .mr-avatar-wrap {
            position: relative;
            flex-shrink: 0;
            width: 32px;
            height: 32px;
          }

          .mr-text {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            flex: 1;
            min-width: 0;
          }

          .mr-nick {
            font-size: 14px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            align-items: baseline;
            gap: 1px;
          }

          .mr-nick-away {
            color: var(--text-muted) !important;
            font-style: italic;
          }

          .mr-away-icon {
            font-size: 10px;
            opacity: 0.6;
            margin-left: 3px;
            font-style: normal;
          }

          .mr-account {
            font-size: 11px;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .mr-actual-nick {
            font-size: 10px;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            opacity: 0.7;
          }

          .mr-activity {
            display: flex;
            align-items: center;
            gap: 3px;
            overflow: hidden;
            min-width: 0;
          }

          .mr-activity-emoji {
            font-size: 10px;
            line-height: 1;
            flex-shrink: 0;
          }

          .mr-activity-text {
            font-size: 11px;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .mr-bot-badge {
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.06em;
            background: rgba(14, 165, 233, 0.12);
            color: var(--accent);
            border: 1px solid var(--accent-border);
            border-radius: 3px;
            padding: 1px 4px;
            margin-left: 4px;
            vertical-align: middle;
            flex-shrink: 0;
          }

        `}</style>
      </div>
    </UserPopover>
  );
}
