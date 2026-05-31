'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { AuditEntry } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import type { IRCMessage } from '@/lib/irc/types';
import { useDialogFocus } from './useDialogFocus';

// ── Types ──────────────────────────────────────────────────────────────────────

type ServerTab = 'overview' | 'members' | 'roles' | 'bans' | 'invites' | 'integrations' | 'audit-log';

const TABS: { id: ServerTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',      label: 'Overview',      icon: <OverviewIcon /> },
  { id: 'members',       label: 'Members',        icon: <MembersIcon /> },
  { id: 'roles',         label: 'Roles',          icon: <RolesIcon /> },
  { id: 'bans',          label: 'Bans',           icon: <BansIcon /> },
  { id: 'invites',       label: 'Invites',        icon: <InvitesIcon /> },
  { id: 'integrations',  label: 'Integrations',   icon: <IntegrationsIcon /> },
  { id: 'audit-log',     label: 'Audit Log',      icon: <AuditLogIcon /> },
];

interface BanEntry {
  mask: string;
  setBy: string;
  channel: string;
  setAt?: string;
}

interface InviteEntry {
  id: string;
  channel: string;
  link: string;
  expiry: string;
  maxUses: string;
  createdAt: Date;
}

// ── ServerSettingsModal ────────────────────────────────────────────────────────

export default function ServerSettingsModal() {
  const closeServerSettings = useOnyxStore(s => s.closeServerSettings);
  const [tab, setTab] = useState<ServerTab>('overview');
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="ss-overlay" onClick={closeServerSettings}>
      <div
        className="ss-modal animate-scale-in"
        onClick={stopProp}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-modal-title"
      >
        {/* Sidebar */}
        <nav className="ss-nav">
          <h2 id="ss-modal-title" className="ss-nav-title">Server Settings</h2>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? 'settings-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="settings-tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="ss-content">
          <button className="ss-close" onClick={closeServerSettings} aria-label="Close server settings">
            ✕
          </button>
          {tab === 'overview'     && <OverviewTab />}
          {tab === 'members'      && <MembersTab />}
          {tab === 'roles'        && <RolesTab />}
          {tab === 'bans'         && <BansTab />}
          {tab === 'invites'      && <InvitesTab />}
          {tab === 'integrations' && <IntegrationsTab />}
          {tab === 'audit-log'    && <AuditLogTab />}
        </div>
      </div>

      <style>{`
        .ss-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.75);
          z-index: 500;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .ss-modal {
          background: var(--bg-2, var(--bg-elevated));
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          width: 100%; max-width: 860px;
          height: 85dvh; max-height: 680px;
          display: flex;
          overflow: hidden;
          box-shadow: var(--shadow-xl);
        }

        .ss-nav {
          width: 200px; flex-shrink: 0;
          background: var(--bg-void);
          padding: 24px 10px;
          display: flex; flex-direction: column; gap: 2px;
          border-right: 1px solid var(--border-subtle);
        }

        .ss-nav-title {
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--text-muted); padding: 0 8px;
          margin-bottom: 8px;
        }

        .settings-tab {
          display: flex; align-items: center; gap: 10px;
          padding: 0 10px; height: 30px;
          border-radius: var(--r-sm);
          background: none; border: none;
          border-left: 2px solid transparent;
          cursor: pointer;
          text-align: left; font-size: 13.5px; font-weight: 500;
          color: var(--text-secondary);
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          width: 100%;
        }
        .settings-tab:hover { background: var(--ch-hover-bg); color: var(--text-primary); }
        .settings-tab--active {
          background: var(--accent-subtle);
          color: var(--accent);
          border-left-color: var(--accent);
        }
        .settings-tab-icon { width: 18px; display: flex; align-items: center; flex-shrink: 0; }

        .ss-content {
          flex: 1; overflow-y: auto; padding: 32px;
          position: relative;
        }

        .ss-close {
          position: absolute; top: 16px; right: 16px;
          width: 28px; height: 28px;
          border-radius: 50%; border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          color: var(--text-muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 600; line-height: 1;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
        }
        .ss-close:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }

        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in { animation: scale-in 180ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both; }
      `}</style>
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────────────

function OverviewTab() {
  const networkName   = useOnyxStore(s => s.networkName);
  const channels      = useOnyxStore(s => s.channels);
  const server        = useOnyxStore(s => s.server);
  const client        = useOnyxStore(s => s.client);
  const disconnect    = useOnyxStore(s => s.disconnect);
  const partChannel   = useOnyxStore(s => s.partChannel);
  const closeServerSettings = useOnyxStore(s => s.closeServerSettings);

  // Deduplicate members across channels
  const allNicks = new Set<string>();
  let voiceChannelCount = 0;
  for (const ch of channels.values()) {
    if (ch.modes.includes('V')) voiceChannelCount++;
    for (const u of ch.users.values()) allNicks.add(u.nick.toLowerCase());
  }

  const region = (client?.isupport as unknown as Record<string, unknown>)?.REGION as string | undefined;

  const handleLeaveAll = () => {
    for (const ch of channels.values()) {
      partChannel(ch.name);
    }
    closeServerSettings();
  };

  const handleDisconnect = () => {
    disconnect();
    closeServerSettings();
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Overview</h2>

      {/* Server info banner */}
      <div className="ss-server-banner">
        <div className="ss-server-icon" style={{ background: server?.icon ?? 'var(--accent)' }}>
          {networkName.slice(0, 2).toUpperCase()}
        </div>
        <div className="ss-server-info">
          <div className="ss-server-name">{networkName}</div>
          <div className="ss-server-url">{server?.url ?? '—'}</div>
        </div>
        {region && (
          <span className="ss-region-badge">{region}</span>
        )}
      </div>

      <div className="ss-info-note">
        Server name and identity are set by the IRC network. Contact your server administrator to change them.
      </div>

      {/* Stats */}
      <div className="ss-section">
        <h3 className="ss-section-title">Quick Stats</h3>
        <div className="ss-stats-grid">
          <div className="ss-stat-card">
            <div className="ss-stat-value">{channels.size}</div>
            <div className="ss-stat-label">Channels</div>
          </div>
          <div className="ss-stat-card">
            <div className="ss-stat-value">{allNicks.size}</div>
            <div className="ss-stat-label">Members</div>
          </div>
          <div className="ss-stat-card">
            <div className="ss-stat-value">{voiceChannelCount}</div>
            <div className="ss-stat-label">Voice Channels</div>
          </div>
        </div>
      </div>

      {/* Channel list */}
      {channels.size > 0 && (
        <div className="ss-section">
          <h3 className="ss-section-title">Joined Channels</h3>
          <div className="ss-channel-list">
            {[...channels.values()].map(ch => (
              <div key={ch.name} className="ss-channel-row">
                <span className="ss-channel-hash">#</span>
                <span className="ss-channel-name">{ch.name.replace(/^[#&]/, '')}</span>
                <span className="ss-channel-members">{ch.users.size} members</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div className="ss-section ss-danger-zone">
        <h3 className="ss-section-title ss-danger-title">Danger Zone</h3>
        <div className="ss-danger-row">
          <div>
            <div className="ss-danger-label">Leave all channels</div>
            <div className="ss-danger-desc">Part every channel you are currently in.</div>
          </div>
          <Button variant="danger" size="sm" onClick={handleLeaveAll}>Leave All</Button>
        </div>
        <div className="ss-danger-row">
          <div>
            <div className="ss-danger-label">Disconnect from server</div>
            <div className="ss-danger-desc">Close the connection to this IRC network.</div>
          </div>
          <Button variant="danger" size="sm" onClick={handleDisconnect}>Disconnect</Button>
        </div>
      </div>

      <style>{ssSharedStyles}</style>
      <style>{`
        .ss-server-banner {
          display: flex; align-items: center; gap: 16px;
          padding: 20px; border-radius: var(--r-lg);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          margin-bottom: 4px;
        }
        .ss-server-icon {
          width: 52px; height: 52px; border-radius: var(--r-md);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 800; color: #fff;
          flex-shrink: 0;
          letter-spacing: 0.04em;
        }
        .ss-server-info { flex: 1; min-width: 0; }
        .ss-server-name { font-size: 18px; font-weight: 700; color: var(--text-primary); }
        .ss-server-url  { font-size: 12px; color: var(--text-muted); margin-top: 2px; font-family: monospace; }

        .ss-region-badge {
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
          background: var(--accent-subtle); color: var(--accent);
          padding: 4px 10px; border-radius: var(--r-full);
          border: 1px solid var(--accent-border);
          flex-shrink: 0;
        }

        .ss-info-note {
          font-size: 12px; color: var(--text-muted);
          padding: 8px 12px;
          background: var(--bg-void);
          border-radius: var(--r-sm);
          border-left: 3px solid var(--border-normal);
          line-height: 1.5;
        }

        .ss-stats-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
        }
        .ss-stat-card {
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          border-radius: var(--r-lg); padding: 16px;
          text-align: center;
        }
        .ss-stat-value {
          font-size: 28px; font-weight: 800; color: var(--accent);
          letter-spacing: -1px;
        }
        .ss-stat-label {
          font-size: 11px; font-weight: 600; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-top: 4px;
        }

        .ss-channel-list { display: flex; flex-direction: column; gap: 4px; }
        .ss-channel-row {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: var(--r-sm);
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          font-size: 13px;
        }
        .ss-channel-hash { color: var(--text-muted); font-size: 15px; font-weight: 500; }
        .ss-channel-name { flex: 1; font-weight: 500; color: var(--text-primary); }
        .ss-channel-members { font-size: 12px; color: var(--text-muted); }

        .ss-danger-zone {
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: var(--r-lg);
          padding: 16px;
          background: rgba(239,68,68,0.04);
        }
        .ss-danger-title { color: #ef4444 !important; }
        .ss-danger-row {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid rgba(239,68,68,0.12);
        }
        .ss-danger-row:last-child { border-bottom: none; padding-bottom: 0; }
        .ss-danger-row:first-of-type { padding-top: 0; }
        .ss-danger-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .ss-danger-desc  { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
      `}</style>
    </div>
  );
}

// ── Members Tab ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function MembersTab() {
  const channels  = useOnyxStore(s => s.channels);
  const client    = useOnyxStore(s => s.client);
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(0);

  // Collect unique members with their channels
  const memberMap = new Map<string, { nick: string; account: string | undefined; channels: string[] }>();
  for (const ch of channels.values()) {
    for (const u of ch.users.values()) {
      const key = u.nick.toLowerCase();
      const existing = memberMap.get(key);
      if (existing) {
        existing.channels.push(ch.name);
      } else {
        memberMap.set(key, { nick: u.nick, account: u.account, channels: [ch.name] });
      }
    }
  }

  const allMembers = [...memberMap.values()].sort((a, b) => a.nick.localeCompare(b.nick));

  const filtered = search.trim()
    ? allMembers.filter(m =>
        m.nick.toLowerCase().includes(search.toLowerCase()) ||
        (m.account ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : allMembers;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageMembers = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Reset page on search change
  useEffect(() => { setPage(0); }, [search]);

  const kickMember = (nick: string, memberChannels: string[]) => {
    if (!client) return;
    for (const ch of memberChannels) {
      client.sendRaw('KICK', ch, nick, 'Kicked by server admin');
    }
  };

  const banMember = (nick: string, memberChannels: string[]) => {
    if (!client) return;
    for (const ch of memberChannels) {
      client.sendRaw('MODE', ch, '+b', `${nick}!*@*`);
    }
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Members</h2>

      <div className="ss-members-header">
        <span className="ss-members-count">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</span>
        <input
          className="ss-search"
          type="search"
          placeholder="Search by nick or account…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search members"
        />
      </div>

      <div className="ss-members-table">
        <div className="ss-table-head">
          <div className="ss-col-member">Member</div>
          <div className="ss-col-account">Account</div>
          <div className="ss-col-channels">Channels</div>
          <div className="ss-col-actions">Actions</div>
        </div>

        {pageMembers.length === 0 ? (
          <div className="ss-empty">No members match your search.</div>
        ) : (
          pageMembers.map((m, i) => (
            <div key={m.nick} className={`ss-table-row ${i % 2 === 1 ? 'ss-table-row--alt' : ''}`}>
              <div className="ss-col-member">
                <Avatar nick={m.nick} size={28} />
                <span className="ss-member-nick">{m.nick}</span>
              </div>
              <div className="ss-col-account">
                {m.account
                  ? <span className="ss-account-badge">@{m.account}</span>
                  : <span className="ss-no-account">—</span>}
              </div>
              <div className="ss-col-channels">
                <div className="ss-channel-tags">
                  {m.channels.slice(0, 3).map(ch => (
                    <span key={ch} className="ss-channel-tag">{ch.replace(/^[#&]/, '')}</span>
                  ))}
                  {m.channels.length > 3 && (
                    <span className="ss-channel-tag ss-channel-tag--more">+{m.channels.length - 3}</span>
                  )}
                </div>
              </div>
              <div className="ss-col-actions">
                <button
                  className="ss-action-btn ss-action-btn--warn"
                  onClick={() => kickMember(m.nick, m.channels)}
                  title={`Kick ${m.nick} from all channels`}
                  disabled={!client}
                >
                  Kick
                </button>
                <button
                  className="ss-action-btn ss-action-btn--danger"
                  onClick={() => banMember(m.nick, m.channels)}
                  title={`Ban ${m.nick} from all channels`}
                  disabled={!client}
                >
                  Ban
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="ss-pagination">
          <button
            className="ss-page-btn"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </button>
          <span className="ss-page-info">Page {page + 1} of {totalPages}</span>
          <button
            className="ss-page-btn"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </button>
        </div>
      )}

      <style>{ssSharedStyles}</style>
      <style>{`
        .ss-members-header {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          margin-bottom: 4px;
        }
        .ss-members-count {
          font-size: 13px; color: var(--text-muted); font-weight: 500; flex-shrink: 0;
        }
        .ss-search { flex: 1; max-width: 280px; }

        .ss-members-table {
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          overflow: hidden;
        }

        .ss-table-head {
          display: grid;
          grid-template-columns: 1fr 140px 160px 110px;
          gap: 0;
          padding: 10px 16px;
          background: var(--bg-void);
          border-bottom: 1px solid var(--border-subtle);
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--text-muted);
        }
        .ss-table-row {
          display: grid;
          grid-template-columns: 1fr 140px 160px 110px;
          gap: 0;
          padding: 10px 16px;
          align-items: center;
          border-bottom: 1px solid var(--border-subtle);
          transition: background var(--t-fast);
        }
        .ss-table-row:last-child { border-bottom: none; }
        .ss-table-row--alt { background: rgba(255,255,255,0.02); }
        .ss-table-row:hover { background: var(--ch-hover-bg); }

        .ss-col-member  { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .ss-col-account { display: flex; align-items: center; }
        .ss-col-channels { display: flex; align-items: center; }
        .ss-col-actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

        .ss-member-nick {
          font-size: 14px; font-weight: 600; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ss-account-badge {
          font-size: 12px; font-weight: 600; color: var(--accent);
          background: var(--accent-subtle); padding: 2px 8px;
          border-radius: var(--r-full);
        }
        .ss-no-account { font-size: 12px; color: var(--text-muted); }

        .ss-channel-tags { display: flex; flex-wrap: wrap; gap: 4px; }
        .ss-channel-tag {
          font-size: 11px; font-weight: 600;
          background: var(--bg-overlay); color: var(--text-secondary);
          padding: 2px 6px; border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
        }
        .ss-channel-tag--more {
          color: var(--text-muted);
        }

        .ss-action-btn {
          font-size: 11px; font-weight: 700;
          padding: 4px 10px; border-radius: var(--r-sm);
          border: 1px solid transparent; cursor: pointer;
          transition: background var(--t-fast), opacity var(--t-fast);
          font-family: inherit;
        }
        .ss-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ss-action-btn--warn {
          background: rgba(251,191,36,0.1); color: #fbbf24;
          border-color: rgba(251,191,36,0.25);
        }
        .ss-action-btn--warn:hover:not(:disabled) {
          background: rgba(251,191,36,0.2);
        }
        .ss-action-btn--danger {
          background: rgba(239,68,68,0.1); color: #ef4444;
          border-color: rgba(239,68,68,0.25);
        }
        .ss-action-btn--danger:hover:not(:disabled) {
          background: rgba(239,68,68,0.2);
        }

        .ss-empty {
          padding: 32px; text-align: center;
          font-size: 14px; color: var(--text-muted);
        }

        .ss-pagination {
          display: flex; align-items: center; justify-content: center; gap: 16px;
          padding-top: 8px;
        }
        .ss-page-btn {
          font-size: 13px; font-weight: 600;
          padding: 6px 14px; border-radius: var(--r-sm);
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          color: var(--text-secondary); cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast);
          font-family: inherit;
        }
        .ss-page-btn:hover:not(:disabled) { background: var(--bg-overlay); color: var(--text-primary); }
        .ss-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ss-page-info { font-size: 13px; color: var(--text-muted); }
      `}</style>
    </div>
  );
}

// ── Bans Tab ───────────────────────────────────────────────────────────────────

function BansTab() {
  const channels = useOnyxStore(s => s.channels);
  const client   = useOnyxStore(s => s.client);
  const [bans, setBans]       = useState<BanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const pendingChannels = useRef(new Set<string>());

  useEffect(() => {
    if (!client) { setLoading(false); return; }

    const channelList = [...channels.keys()];
    if (channelList.length === 0) { setLoading(false); return; }

    pendingChannels.current = new Set(channelList);

    const handler = (msg: IRCMessage) => {
      const { command, params } = msg;

      if (command === '367') {
        // :server 367 ournick #channel mask [setby [setat]]
        const ch   = params[1] ?? '';
        const mask = params[2] ?? '';
        const setBy = params[3] ?? '';
        const setAt = params[4] ?? '';
        if (mask) {
          setBans(prev => {
            const exists = prev.some(b => b.channel === ch && b.mask === mask);
            if (exists) return prev;
            return [...prev, { mask, setBy, channel: ch, setAt }];
          });
        }
      }

      if (command === '368') {
        // End of ban list for a channel
        const ch = params[1] ?? '';
        pendingChannels.current.delete(ch.toLowerCase());
        if (pendingChannels.current.size === 0) setLoading(false);
      }
    };

    client.extraMessageHandlers.add(handler);

    // Request ban lists
    for (const ch of channelList) {
      client.sendRaw('MODE', ch, 'b');
    }

    // Safety fallback — stop spinner after 5s even if server doesn't respond
    const fallback = setTimeout(() => setLoading(false), 5000);

    return () => {
      client.extraMessageHandlers.delete(handler);
      clearTimeout(fallback);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unban = (ban: BanEntry) => {
    if (!client) return;
    client.sendRaw('MODE', ban.channel, '-b', ban.mask);
    setBans(prev => prev.filter(b => !(b.channel === ban.channel && b.mask === ban.mask)));
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Bans</h2>

      {loading ? (
        <div className="ss-loading">Fetching ban lists from server…</div>
      ) : bans.length === 0 ? (
        <div className="ss-empty-state">
          <div className="ss-empty-icon">
            <BansIcon />
          </div>
          <div className="ss-empty-label">No active bans</div>
          <div className="ss-empty-sub">No users are banned across your channels.</div>
        </div>
      ) : (
        <>
          <div className="ss-bans-count">{bans.length} active ban{bans.length !== 1 ? 's' : ''}</div>
          <div className="ss-members-table">
            <div className="ss-ban-head">
              <div>Mask</div>
              <div>Channel</div>
              <div>Set by</div>
              <div></div>
            </div>
            {bans.map((ban, i) => (
              <div key={`${ban.channel}:${ban.mask}`} className={`ss-ban-row ${i % 2 === 1 ? 'ss-table-row--alt' : ''}`}>
                <div className="ss-ban-mask">{ban.mask}</div>
                <div>
                  <span className="ss-channel-tag">{ban.channel.replace(/^[#&]/, '')}</span>
                </div>
                <div className="ss-ban-setby">{ban.setBy || '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="ss-action-btn ss-action-btn--danger"
                    onClick={() => unban(ban)}
                    disabled={!client}
                  >
                    Unban
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <style>{ssSharedStyles}</style>
      <style>{`
        .ss-loading {
          padding: 40px; text-align: center;
          font-size: 14px; color: var(--text-muted);
          font-style: italic;
        }
        .ss-bans-count {
          font-size: 13px; color: var(--text-muted); font-weight: 500;
        }
        .ss-ban-head {
          display: grid;
          grid-template-columns: 1fr 120px 120px 80px;
          gap: 0;
          padding: 10px 16px;
          background: var(--bg-void);
          border-bottom: 1px solid var(--border-subtle);
          border-radius: var(--r-lg) var(--r-lg) 0 0;
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--text-muted);
        }
        .ss-ban-row {
          display: grid;
          grid-template-columns: 1fr 120px 120px 80px;
          gap: 0;
          padding: 10px 16px;
          align-items: center;
          border-bottom: 1px solid var(--border-subtle);
          transition: background var(--t-fast);
          font-size: 13px;
        }
        .ss-ban-row:last-child { border-bottom: none; }
        .ss-ban-row:hover { background: var(--ch-hover-bg); }
        .ss-ban-mask {
          font-family: monospace; font-size: 12px;
          color: var(--text-primary); overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .ss-ban-setby { font-size: 12px; color: var(--text-muted); }

        .ss-empty-state {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 10px;
          padding: 64px 32px;
          color: var(--text-muted);
        }
        .ss-empty-icon {
          width: 48px; height: 48px;
          border-radius: var(--r-lg);
          background: var(--bg-elevated);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          border: 1px solid var(--border-normal);
        }
        .ss-empty-label {
          font-size: 16px; font-weight: 700; color: var(--text-secondary);
        }
        .ss-empty-sub {
          font-size: 13px; color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

// ── Invites Tab ────────────────────────────────────────────────────────────────

const EXPIRY_OPTIONS = [
  { value: '24h',   label: '24 hours' },
  { value: '7d',    label: '7 days' },
  { value: 'never', label: 'Never' },
];

const MAX_USES_OPTIONS = [
  { value: '10',        label: '10 uses' },
  { value: '50',        label: '50 uses' },
  { value: 'unlimited', label: 'Unlimited' },
];

let _inviteCounter = 0;

function InvitesTab() {
  const channels    = useOnyxStore(s => s.channels);
  const server      = useOnyxStore(s => s.server);

  const [selectedChannel, setSelectedChannel] = useState('');
  const [expiry,   setExpiry]   = useState('24h');
  const [maxUses,  setMaxUses]  = useState('10');
  const [invites,  setInvites]  = useState<InviteEntry[]>([]);
  const [copied,   setCopied]   = useState<string | null>(null);

  const channelList = [...channels.keys()];

  // Default to first channel if not set
  useEffect(() => {
    if (!selectedChannel && channelList.length > 0) {
      setSelectedChannel(channelList[0]);
    }
  }, [channelList, selectedChannel]);

  const serverHost = server?.url
    ? (() => {
        try {
          return new URL(server.url).hostname;
        } catch {
          return server.url;
        }
      })()
    : 'irc.example.com';

  const generateInvite = () => {
    if (!selectedChannel) return;
    const id = `inv-${Date.now()}-${++_inviteCounter}`;
    const channel = selectedChannel.startsWith('#') ? selectedChannel : `#${selectedChannel}`;
    const link = `irc://${serverHost}/${encodeURIComponent(channel)}`;
    setInvites(prev => [
      { id, channel, link, expiry, maxUses, createdAt: new Date() },
      ...prev,
    ]);
  };

  const copyLink = useCallback((id: string, link: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(c => c === id ? null : c), 2000);
    });
  }, []);

  const removeInvite = (id: string) => {
    setInvites(prev => prev.filter(inv => inv.id !== id));
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Invites</h2>

      {/* Generate form */}
      <div className="ss-section">
        <h3 className="ss-section-title">Generate Invite Link</h3>
        <div className="ss-invite-form">
          <div className="ss-form-field">
            <label className="ss-form-label">Channel</label>
            <select
              className="ss-select"
              value={selectedChannel}
              onChange={e => setSelectedChannel(e.target.value)}
              disabled={channelList.length === 0}
            >
              {channelList.length === 0
                ? <option value="">No channels joined</option>
                : channelList.map(ch => (
                    <option key={ch} value={ch}>{ch}</option>
                  ))
              }
            </select>
          </div>

          <div className="ss-form-field">
            <label className="ss-form-label">Expires after</label>
            <select className="ss-select" value={expiry} onChange={e => setExpiry(e.target.value)}>
              {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="ss-form-field">
            <label className="ss-form-label">Max uses</label>
            <select className="ss-select" value={maxUses} onChange={e => setMaxUses(e.target.value)}>
              {MAX_USES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <Button size="sm" onClick={generateInvite} disabled={!selectedChannel}>
            Generate Link
          </Button>
        </div>
      </div>

      {/* Generated invites */}
      <div className="ss-section">
        <h3 className="ss-section-title">Active Invites ({invites.length})</h3>

        {invites.length === 0 ? (
          <div className="ss-invite-empty">
            No invite links generated yet. Create one above.
          </div>
        ) : (
          <div className="ss-invite-list">
            {invites.map(inv => (
              <div key={inv.id} className="ss-invite-card">
                <div className="ss-invite-meta">
                  <span className="ss-channel-tag">{inv.channel.replace(/^[#&]/, '')}</span>
                  <span className="ss-invite-detail">
                    {inv.expiry === 'never' ? 'No expiry' : `Expires: ${inv.expiry}`}
                  </span>
                  <span className="ss-invite-detail">
                    {inv.maxUses === 'unlimited' ? 'Unlimited uses' : `${inv.maxUses} uses`}
                  </span>
                </div>
                <div className="ss-invite-link-row">
                  <code className="ss-invite-link">{inv.link}</code>
                  <button
                    className={`ss-copy-btn ${copied === inv.id ? 'ss-copy-btn--done' : ''}`}
                    onClick={() => copyLink(inv.id, inv.link)}
                    aria-label="Copy invite link"
                  >
                    {copied === inv.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    className="ss-remove-btn"
                    onClick={() => removeInvite(inv.id)}
                    aria-label="Remove invite"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{ssSharedStyles}</style>
      <style>{`
        .ss-invite-form {
          display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap;
        }
        .ss-form-field {
          display: flex; flex-direction: column; gap: 6px;
        }
        .ss-form-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--text-muted);
        }
        .ss-select {
          height: 36px;
          padding: 0 12px; border-radius: var(--r-md);
          background: var(--bg-deep); border: 1px solid var(--border-normal);
          color: var(--text-primary); font-size: 13px; font-family: inherit;
          cursor: pointer; min-width: 120px;
          box-sizing: border-box;
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        .ss-select:focus {
          outline: none;
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }

        .ss-invite-empty {
          padding: 24px; text-align: center;
          font-size: 13px; color: var(--text-muted);
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px dashed var(--border-normal);
        }

        .ss-invite-list { display: flex; flex-direction: column; gap: 8px; }
        .ss-invite-card {
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          border-radius: var(--r-md); padding: 12px 14px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .ss-invite-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ss-invite-detail {
          font-size: 11px; color: var(--text-muted); font-weight: 500;
        }

        .ss-invite-link-row {
          display: flex; align-items: center; gap: 8px;
        }
        .ss-invite-link {
          flex: 1; font-size: 12px; font-family: monospace;
          color: var(--text-secondary);
          background: var(--bg-void); padding: 6px 10px;
          border-radius: var(--r-sm); border: 1px solid var(--border-subtle);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .ss-copy-btn {
          font-size: 12px; font-weight: 700;
          padding: 5px 12px; border-radius: var(--r-sm);
          background: var(--accent-subtle); color: var(--accent);
          border: 1px solid var(--accent-border); cursor: pointer;
          transition: background var(--t-fast);
          font-family: inherit; flex-shrink: 0;
        }
        .ss-copy-btn:hover { background: var(--bg-overlay); }
        .ss-copy-btn--done { background: rgba(34,197,94,0.15); color: #22c55e; border-color: rgba(34,197,94,0.35); }

        .ss-remove-btn {
          width: 26px; height: 26px;
          border-radius: var(--r-sm);
          background: none; border: 1px solid var(--border-subtle);
          color: var(--text-muted); cursor: pointer;
          font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .ss-remove-btn:hover {
          background: rgba(239,68,68,0.1); color: #ef4444;
          border-color: rgba(239,68,68,0.3);
        }
      `}</style>
    </div>
  );
}

// ── Integrations Tab ───────────────────────────────────────────────────────────

function IntegrationsTab() {
  const channels = useOnyxStore(s => s.channels);

  // Collect bot users (mode +B) across all channels
  const bots: { nick: string; channels: string[] }[] = [];
  const botMap = new Map<string, string[]>();
  for (const ch of channels.values()) {
    for (const u of ch.users.values()) {
      if (u.modes.has('B')) {
        const key = u.nick.toLowerCase();
        const list = botMap.get(key) ?? [];
        botMap.set(key, [...list, ch.name]);
      }
    }
  }
  for (const [, data] of botMap.entries()) {
    const nick = data[0];
    bots.push({ nick, channels: data });
  }

  return (
    <div className="tab-body">
      <h2 className="tab-title">Integrations</h2>

      {/* Webhooks */}
      <div className="ss-section">
        <h3 className="ss-section-title">Webhooks</h3>
        <div className="ss-integration-card ss-integration-card--soon">
          <div className="ss-integration-icon">
            <WebhookIcon />
          </div>
          <div className="ss-integration-body">
            <div className="ss-integration-name">Webhooks</div>
            <div className="ss-integration-desc">
              Send automated messages to channels from external services. Webhooks will be available in a future update.
            </div>
          </div>
          <span className="ss-soon-badge">Coming Soon</span>
        </div>
      </div>

      {/* Bots */}
      <div className="ss-section">
        <h3 className="ss-section-title">Bots</h3>
        {bots.length === 0 ? (
          <div className="ss-integration-card ss-integration-card--soon">
            <div className="ss-integration-icon">
              <BotIcon />
            </div>
            <div className="ss-integration-body">
              <div className="ss-integration-name">No Bots Detected</div>
              <div className="ss-integration-desc">
                Users with bot mode (+B) in your channels will appear here.
              </div>
            </div>
          </div>
        ) : (
          <div className="ss-bot-list">
            {bots.map(bot => (
              <div key={bot.nick} className="ss-bot-card">
                <Avatar nick={bot.nick} size={32} />
                <div className="ss-bot-info">
                  <div className="ss-bot-nick">{bot.nick}</div>
                  <div className="ss-channel-tags">
                    {bot.channels.slice(0, 4).map(ch => (
                      <span key={ch} className="ss-channel-tag">{ch.replace(/^[#&]/, '')}</span>
                    ))}
                    {bot.channels.length > 4 && (
                      <span className="ss-channel-tag ss-channel-tag--more">+{bot.channels.length - 4}</span>
                    )}
                  </div>
                </div>
                <span className="ss-bot-badge">Bot</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{ssSharedStyles}</style>
      <style>{`
        .ss-integration-card {
          display: flex; align-items: flex-start; gap: 14px;
          padding: 18px; border-radius: var(--r-lg);
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
        }
        .ss-integration-card--soon {
          opacity: 0.75;
        }
        .ss-integration-icon {
          width: 40px; height: 40px; flex-shrink: 0;
          border-radius: var(--r-md);
          background: var(--bg-overlay);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
        }
        .ss-integration-body { flex: 1; min-width: 0; }
        .ss-integration-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .ss-integration-desc {
          font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;
        }
        .ss-soon-badge {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
          background: var(--bg-overlay); color: var(--text-muted);
          padding: 3px 8px; border-radius: var(--r-full);
          border: 1px solid var(--border-subtle);
          flex-shrink: 0; align-self: flex-start;
        }

        .ss-bot-list { display: flex; flex-direction: column; gap: 8px; }
        .ss-bot-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px;
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
        }
        .ss-bot-info { flex: 1; min-width: 0; }
        .ss-bot-nick { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .ss-bot-badge {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
          background: rgba(124,90,245,0.15); color: var(--accent);
          padding: 3px 8px; border-radius: var(--r-full);
          border: 1px solid var(--accent-border);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

// ── Audit Log Tab ──────────────────────────────────────────────────────────────

type AuditFilter = 'all' | 'moderation' | 'mode' | 'topic' | 'members';

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const AUDIT_TYPE_ICON: Record<AuditEntry['type'], string> = {
  kick:   '🚫',
  ban:    '⛔',
  unban:  '✅',
  mode:   '🔧',
  topic:  '📝',
  join:   '👋',
  part:   '👋',
  nick:   '📛',
  invite: '✉️',
};

function auditTypeLabel(type: AuditEntry['type']): string {
  switch (type) {
    case 'kick':   return 'kicked';
    case 'ban':    return 'banned';
    case 'unban':  return 'unbanned';
    case 'mode':   return 'changed mode';
    case 'topic':  return 'changed topic';
    case 'join':   return 'joined';
    case 'part':   return 'left';
    case 'nick':   return 'renamed to';
    case 'invite': return 'invited';
  }
}

function matchesAuditFilter(entry: AuditEntry, filter: AuditFilter): boolean {
  switch (filter) {
    case 'all':        return true;
    case 'moderation': return entry.type === 'kick' || entry.type === 'ban' || entry.type === 'unban';
    case 'mode':       return entry.type === 'mode';
    case 'topic':      return entry.type === 'topic';
    case 'members':    return entry.type === 'join' || entry.type === 'part' || entry.type === 'nick' || entry.type === 'invite';
  }
}

function AuditLogTab() {
  const auditLog = useOnyxStore(s => s.auditLog);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to top (newest) on first open
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  const filtered = auditLog.filter(entry => {
    if (!matchesAuditFilter(entry, filter)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        entry.actor.toLowerCase().includes(q) ||
        (entry.target ?? '').toLowerCase().includes(q) ||
        (entry.detail ?? '').toLowerCase().includes(q) ||
        (entry.channel ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const FILTERS: { id: AuditFilter; label: string }[] = [
    { id: 'all',        label: 'All' },
    { id: 'moderation', label: 'Moderation' },
    { id: 'mode',       label: 'Mode Changes' },
    { id: 'topic',      label: 'Topic' },
    { id: 'members',    label: 'Members' },
  ];

  return (
    <div className="tab-body">
      <h2 className="tab-title">Audit Log</h2>

      <div className="al-controls">
        <div className="al-filters">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={`al-filter-btn ${filter === f.id ? 'al-filter-btn--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="ss-search"
          type="search"
          placeholder="Search by actor, target, or detail…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search audit log"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="al-empty">
          {auditLog.length === 0
            ? 'No moderation actions recorded yet.'
            : 'No entries match your search.'}
        </div>
      ) : (
        <div className="al-list" ref={listRef}>
          {filtered.map(entry => (
            <div key={entry.id} className="al-entry">
              <span className="al-icon">{AUDIT_TYPE_ICON[entry.type]}</span>
              <div className="al-body">
                <div className="al-text">
                  <strong className="al-actor">{entry.actor}</strong>
                  {' '}
                  <span className="al-action">{auditTypeLabel(entry.type)}</span>
                  {entry.target && (
                    <>{' '}<strong className="al-target">{entry.target}</strong></>
                  )}
                  {entry.channel && (
                    <>{' '}in <span className="al-channel-pill">{entry.channel.replace(/^[#&]/, '')}</span></>
                  )}
                  {entry.detail && (
                    <span className="al-detail"> — {entry.detail}</span>
                  )}
                </div>
                <span className="al-time">{formatRelative(entry.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{ssSharedStyles}</style>
      <style>{`
        .al-controls {
          display: flex; flex-direction: column; gap: 10px;
        }
        .al-filters {
          display: flex; gap: 6px; flex-wrap: wrap;
        }
        .al-filter-btn {
          font-size: 12px; font-weight: 600;
          padding: 5px 12px; border-radius: var(--r-full);
          background: var(--bg-elevated); border: 1px solid var(--border-normal);
          color: var(--text-secondary); cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          font-family: inherit;
        }
        .al-filter-btn:hover { background: var(--ch-hover-bg); color: var(--text-primary); }
        .al-filter-btn--active {
          background: var(--accent-subtle); color: var(--accent);
          border-color: var(--accent-border);
        }

        .al-empty {
          padding: 48px 24px; text-align: center;
          font-size: 14px; color: var(--text-muted);
          background: var(--bg-elevated); border-radius: var(--r-lg);
          border: 1px dashed var(--border-normal);
        }

        .al-list {
          display: flex; flex-direction: column; gap: 2px;
          max-height: 420px; overflow-y: auto;
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          padding: 4px;
        }

        .al-entry {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px 12px; border-radius: var(--r-md);
          transition: background var(--t-fast);
        }
        .al-entry:hover { background: var(--ch-hover-bg); }

        .al-icon {
          font-size: 16px; flex-shrink: 0;
          width: 24px; text-align: center;
          margin-top: 1px;
        }

        .al-body {
          flex: 1; min-width: 0;
          display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
        }

        .al-text {
          font-size: 13px; color: var(--text-secondary);
          line-height: 1.5; flex: 1; min-width: 0;
        }
        .al-actor {
          font-weight: 700; color: var(--text-primary);
        }
        .al-action {
          color: var(--text-muted);
        }
        .al-target {
          font-weight: 700; color: var(--accent);
        }
        .al-channel-pill {
          display: inline-block;
          font-size: 11px; font-weight: 600;
          background: var(--bg-overlay); color: var(--text-secondary);
          padding: 1px 6px; border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          vertical-align: middle;
        }
        .al-detail {
          color: var(--text-muted); font-size: 12px;
        }

        .al-time {
          font-size: 11px; color: var(--text-muted);
          white-space: nowrap; flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const ssSharedStyles = `
  .tab-body { display: flex; flex-direction: column; gap: 24px; }
  .tab-title { font-size: 22px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.3px; }

  .ss-section { display: flex; flex-direction: column; gap: 10px; }
  .ss-section-title {
    font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--text-muted);
    display: flex; align-items: center; gap: 10px;
  }
  .ss-section-title::after {
    content: ''; flex: 1; height: 1px; background: var(--border-subtle);
  }

  .ss-search {
    height: 36px;
    padding: 0 12px; border-radius: var(--r-md);
    background: var(--bg-deep); border: 1px solid var(--border-normal);
    color: var(--text-primary); font-size: 13px; font-family: inherit;
    box-sizing: border-box;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }
  .ss-search:focus {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .ss-channel-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .ss-channel-tag {
    font-size: 11px; font-weight: 600;
    background: var(--bg-overlay); color: var(--text-secondary);
    padding: 2px 6px; border-radius: var(--r-sm);
    border: 1px solid var(--border-subtle);
  }
  .ss-channel-tag--more { color: var(--text-muted); }

  .ss-action-btn {
    font-size: 11px; font-weight: 700;
    padding: 4px 10px; border-radius: var(--r-sm);
    border: 1px solid transparent; cursor: pointer;
    transition: background var(--t-fast), opacity var(--t-fast);
    font-family: inherit;
  }
  .ss-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .ss-action-btn--warn {
    background: rgba(251,191,36,0.1); color: #fbbf24;
    border-color: rgba(251,191,36,0.25);
  }
  .ss-action-btn--warn:hover:not(:disabled) { background: rgba(251,191,36,0.2); }
  .ss-action-btn--danger {
    background: rgba(239,68,68,0.1); color: #ef4444;
    border-color: rgba(239,68,68,0.25);
  }
  .ss-action-btn--danger:hover:not(:disabled) { background: rgba(239,68,68,0.2); }

  .ss-members-table {
    border: 1px solid var(--border-normal);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  .ss-table-row--alt { background: rgba(14, 165, 233, 0.025); }
`;

// ── RolesTab ───────────────────────────────────────────────────────────────────

const IRC_ROLES = [
  { mode: 'q', symbol: '~', label: 'Owner',    color: '#e8b84b', description: 'Channel founders and owners — full control' },
  { mode: 'o', symbol: '@', label: 'Operator', color: '#0ea5e9', description: 'Channel operators — manage messages, kick, ban' },
  { mode: 'v', symbol: '+', label: 'Voice',    color: '#23a55a', description: 'Voiced users — can speak in moderated channels' },
  { mode:  '', symbol: '',  label: 'Member',   color: '#9ca3af', description: 'Regular channel members' },
] as const;

function RolesTab() {
  const activeView = useOnyxStore(s => s.activeView);
  const channels   = useOnyxStore(s => s.channels);

  const channel = activeView.kind === 'channel'
    ? channels.get(activeView.channel.toLowerCase())
    : null;

  function countRole(mode: string): number {
    if (!channel) return 0;
    if (!mode) {
      return Array.from(channel.users.values()).filter(u =>
        !u.modes.has('q') && !u.modes.has('o') &&
        !u.modes.has('h') && !u.modes.has('v')
      ).length;
    }
    return Array.from(channel.users.values()).filter(u => u.modes.has(mode)).length;
  }

  return (
    <div className="roles-tab">
      <h3 className="roles-heading">Channel Roles</h3>
      <p className="roles-description">
        Roles in Ocean map directly to IRC channel modes.
        These are set with the <code>MODE</code> command.
      </p>
      {!channel && (
        <p className="roles-no-channel">Select a channel to see role membership counts.</p>
      )}
      <div className="roles-list">
        {IRC_ROLES.map(role => (
          <div key={role.mode || 'member'} className="role-card" style={{ borderLeftColor: role.color }}>
            <div className="role-color-dot" style={{ background: role.color }}>
              {role.symbol && <span className="role-symbol">{role.symbol}</span>}
            </div>
            <div className="role-info">
              <div className="role-name-row">
                <span className="role-name">{role.label}</span>
                {role.mode && (
                  <code className="role-mode-badge">+{role.mode}</code>
                )}
              </div>
              <span className="role-desc">{role.description}</span>
            </div>
            <div className="role-count">
              {countRole(role.mode)} member{countRole(role.mode) !== 1 ? 's' : ''}
            </div>
          </div>
        ))}
      </div>
      <style>{`
        .roles-tab { padding: 24px; }
        .roles-heading {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.1em; color: var(--text-muted);
          display: flex; align-items: center; gap: 10px;
          margin: 0 0 8px;
        }
        .roles-heading::after { content: ''; flex: 1; height: 1px; background: var(--border-subtle); }
        .roles-description { color: var(--text-muted); font-size: 13px; margin: 0 0 20px; line-height: 1.5; }
        .roles-no-channel { color: var(--text-muted); font-style: italic; margin-bottom: 16px; }
        .roles-list { display: flex; flex-direction: column; gap: 0; border: 1px solid var(--border-subtle); border-radius: var(--r-lg); overflow: hidden; }
        .role-card {
          display: flex; align-items: center; gap: 14px;
          padding: 12px 16px;
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
          border-left: 3px solid transparent;
          transition: background 150ms ease, border-left-color 150ms ease;
        }
        .role-card:last-child { border-bottom: none; }
        .role-card:hover { background: var(--ch-hover-bg); }
        .role-color-dot {
          width: 10px; height: 10px; border-radius: 50%;
          flex-shrink: 0;
        }
        .role-symbol { display: none; }
        .role-info { flex: 1; min-width: 0; }
        .role-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
        .role-name { font-weight: 600; font-size: 14px; color: var(--text-primary); }
        .role-mode-badge {
          font-size: 11px; padding: 1px 6px; border-radius: 4px;
          background: var(--bg-deep); color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          font-family: monospace;
        }
        .role-desc { font-size: 12px; color: var(--text-muted); }
        .role-count { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function OverviewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="1" width="5" height="5" rx="1" />
      <rect x="8" y="1" width="5" height="5" rx="1" />
      <rect x="1" y="8" width="5" height="5" rx="1" />
      <rect x="8" y="8" width="5" height="5" rx="1" />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M5 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM0 12s-.5 0-.5-.5S0 9 5 9s5.5 2 5.5 2.5-.5.5-.5.5H0z" />
      <path d="M9.5 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM14 11.5c0 .5-.5.5-.5.5H8.5c.3-.5.5-1.2.5-2 0-.6-.2-1.2-.6-1.7C9.2 8.1 10 8 10.5 8c3.5 0 3.5 1.5 3.5 3.5z" opacity=".6" />
    </svg>
  );
}

function BansIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="6" />
      <path d="M2.5 2.5l9 9" strokeLinecap="round" />
    </svg>
  );
}

function InvitesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M1 2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-2 2-2-2H2a1 1 0 0 1-1-1V2z" opacity=".7" />
      <path d="M7 4v5M4.5 6.5L7 4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IntegrationsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9.5 1H12a1 1 0 0 1 1 1v2.5M4.5 13H2a1 1 0 0 1-1-1v-2.5M13 9.5V12a1 1 0 0 1-1 1h-2.5M1 4.5V2a1 1 0 0 1 1-1h2.5" strokeLinecap="round" />
      <rect x="4" y="4" width="6" height="6" rx="1" />
    </svg>
  );
}

function WebhookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 3a7 7 0 1 0 0 14A7 7 0 0 0 10 3z" />
      <path d="M10 7v3l2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <rect x="3" y="7" width="14" height="10" rx="2" opacity=".8" />
      <circle cx="7" cy="12" r="1.5" fill="var(--bg-deep)" />
      <circle cx="13" cy="12" r="1.5" fill="var(--bg-deep)" />
      <path d="M8 15.5h4" stroke="var(--bg-deep)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M10 7V4M8 4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AuditLogIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="3" width="12" height="14" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h4" strokeLinecap="round" />
    </svg>
  );
}

function RolesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1L9.5 5.5H14L10.5 8.5L12 13L8 10.5L4 13L5.5 8.5L2 5.5H6.5L8 1Z"/>
    </svg>
  );
}
