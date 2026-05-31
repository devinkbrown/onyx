'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useDialogFocus } from './useDialogFocus';

type ActionTab = 'actions' | 'banlist' | 'auditlog';
type AuditFilter = 'all' | 'kick' | 'ban' | 'mode';

const ACTION_BADGE_COLOR: Record<string, string> = {
  KICK: '#f87171',
  BAN: '#fb923c',
  UNBAN: '#34d399',
  MUTE: '#a78bfa',
  TEMPBAN: '#fb923c',
  'GRANT +v': '#4ade80',
  'GRANT +o': '#818cf8',
  'TAKE +o': '#f472b6',
  MODE: '#64748b',
};

export default function ModerationPanel() {
  const closeModerationPanel = useOnyxStore(s => s.closeModerationPanel);
  const activeView           = useOnyxStore(s => s.activeView);
  const client               = useOnyxStore(s => s.client);
  const channels             = useOnyxStore(s => s.channels);
  const moderationLog        = useOnyxStore(s => s.moderationLog);
  const banList              = useOnyxStore(s => s.banList);
  const fetchBanList         = useOnyxStore(s => s.fetchBanList);

  const channel = activeView.kind === 'channel' ? activeView.channel : '';
  const channelKey = channel.toLowerCase();
  const channelBans = banList.get(channelKey) ?? [];

  const [tab, setTab] = useState<ActionTab>('actions');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [slowSecs, setSlowSecs] = useState('5');
  const [tempBanMins, setTempBanMins] = useState('10');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');

  const tempBanTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const panelRef        = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);

  // Fetch ban list when switching to that tab
  useEffect(() => {
    if (tab === 'banlist' && channel) {
      fetchBanList(channel);
    }
  }, [tab, channel, fetchBanList]);

  // Clean up temp-ban timers on unmount
  useEffect(() => {
    const timers = tempBanTimerRef.current;
    return () => { timers.forEach(t => clearTimeout(t)); };
  }, []);

  const nickToMask = (nick: string) =>
    nick.includes('!') || nick.includes('@') || nick.includes('*') ? nick : `${nick}!*@*`;

  const send = (cmd: string, ...args: string[]) => {
    client?.sendRaw(cmd, ...args);
  };

  const handleKick = () => {
    if (!target || !channel) return;
    send('KICK', channel, target, reason || 'No reason given');
    setTarget('');
    setReason('');
  };

  const handleBan = () => {
    if (!target || !channel) return;
    send('MODE', channel, '+b', nickToMask(target));
    setTarget('');
  };

  const handleKickBan = () => {
    if (!target || !channel) return;
    const mask = nickToMask(target);
    send('MODE', channel, '+b', mask);
    send('KICK', channel, target, reason || 'No reason given');
    setTarget('');
    setReason('');
  };

  const handleMute = () => {
    if (!target || !channel) return;
    send('MODE', channel, '+q', nickToMask(target));
    setTarget('');
  };

  const handleTempBan = () => {
    if (!target || !channel) return;
    const mask = nickToMask(target);
    const mins = parseInt(tempBanMins, 10) || 10;
    send('MODE', channel, '+b', mask);
    const timer = setTimeout(() => {
      client?.sendRaw('MODE', channel, '-b', mask);
      tempBanTimerRef.current.delete(mask);
    }, mins * 60 * 1000);
    tempBanTimerRef.current.set(mask, timer);
    setTarget('');
  };

  const handleUnban = (mask?: string) => {
    const m = mask ?? nickToMask(target);
    if (!m || !channel) return;
    send('MODE', channel, '-b', m);
    if (!mask) setTarget('');
  };

  const handleGrantV = () => {
    if (!target || !channel) return;
    send('MODE', channel, '+v', target);
    setTarget('');
  };

  const handleGrantO = () => {
    if (!target || !channel) return;
    send('MODE', channel, '+o', target);
    setTarget('');
  };

  const handleTakeO = () => {
    if (!target || !channel) return;
    send('MODE', channel, '-o', target);
    setTarget('');
  };

  const handleSlowMode = () => {
    if (!channel) return;
    const secs = parseInt(slowSecs, 10) || 5;
    send('MODE', channel, `+z`, String(secs));
  };

  const filteredLog = auditFilter === 'all'
    ? moderationLog
    : moderationLog.filter(e => {
        if (auditFilter === 'kick') return e.action === 'KICK';
        if (auditFilter === 'ban') return e.action === 'BAN' || e.action === 'UNBAN';
        if (auditFilter === 'mode') return !['KICK', 'BAN', 'UNBAN'].includes(e.action);
        return true;
      });

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="modpanel-overlay">
      <div className="modpanel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="modpanel-title">
        {/* Header */}
        <div className="modpanel-header">
          <div className="modpanel-header-left">
            <ShieldIcon />
            <span id="modpanel-title" className="modpanel-title">
              Channel Moderation
              {channel && <span className="modpanel-chan"> — {channel}</span>}
            </span>
          </div>
          <button
            className="modpanel-close"
            onClick={closeModerationPanel}
            aria-label="Close moderation panel"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="modpanel-tabs" role="tablist">
          {(['actions', 'banlist', 'auditlog'] as ActionTab[]).map(t => (
            <button
              key={t}
              className={`modpanel-tab${tab === t ? ' modpanel-tab--active' : ''}`}
              onClick={() => setTab(t)}
              role="tab"
              aria-selected={tab === t}
            >
              {t === 'actions' ? 'Actions' : t === 'banlist' ? 'Ban List' : 'Audit Log'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="modpanel-body">

          {/* ── Actions tab ──────────────────────────────────────────────── */}
          {tab === 'actions' && (
            <div className="modpanel-actions-wrap">
              <div className="modpanel-field-row">
                <label className="modpanel-label" htmlFor="mod-target">Target (nick or mask)</label>
                <input
                  id="mod-target"
                  className="modpanel-input"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  placeholder="nick or nick!*@*"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="modpanel-field-row">
                <label className="modpanel-label" htmlFor="mod-reason">Reason</label>
                <input
                  id="mod-reason"
                  className="modpanel-input"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Optional reason"
                  autoComplete="off"
                />
              </div>

              <div className="modpanel-actions-grid">
                <button className="modpanel-action modpanel-action--danger" onClick={handleKick} disabled={!target}>
                  <span className="modpanel-action-icon">🚪</span>
                  <span>Kick</span>
                </button>
                <button className="modpanel-action modpanel-action--warn" onClick={handleBan} disabled={!target}>
                  <span className="modpanel-action-icon">🔨</span>
                  <span>Ban</span>
                </button>
                <button className="modpanel-action modpanel-action--danger" onClick={handleKickBan} disabled={!target}>
                  <span className="modpanel-action-icon">⛔</span>
                  <span>Kick + Ban</span>
                </button>
                <button className="modpanel-action modpanel-action--muted" onClick={handleMute} disabled={!target}>
                  <span className="modpanel-action-icon">🔇</span>
                  <span>Mute</span>
                </button>
                <button className="modpanel-action modpanel-action--ok" onClick={() => handleUnban()} disabled={!target}>
                  <span className="modpanel-action-icon">✅</span>
                  <span>Unban</span>
                </button>
                <button className="modpanel-action modpanel-action--voice" onClick={handleGrantV} disabled={!target}>
                  <span className="modpanel-action-icon">🎤</span>
                  <span>Grant +v</span>
                </button>
                <button className="modpanel-action modpanel-action--op" onClick={handleGrantO} disabled={!target}>
                  <span className="modpanel-action-icon">⭐</span>
                  <span>Grant +o</span>
                </button>
                <button className="modpanel-action modpanel-action--deop" onClick={handleTakeO} disabled={!target}>
                  <span className="modpanel-action-icon" aria-hidden>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>
                    </svg>
                  </span>
                  <span>Take +o</span>
                </button>
              </div>

              <div className="modpanel-subsection">
                <span className="modpanel-sublabel">Temp ban (auto-unban after)</span>
                <div className="modpanel-tempban-row">
                  <input
                    className="modpanel-input modpanel-input--sm"
                    type="number"
                    min="1"
                    max="1440"
                    value={tempBanMins}
                    onChange={e => setTempBanMins(e.target.value)}
                    aria-label="Temp ban minutes"
                  />
                  <span className="modpanel-sublabel-unit">min</span>
                  <button
                    className="modpanel-action modpanel-action--warn modpanel-action--inline"
                    onClick={handleTempBan}
                    disabled={!target}
                  >
                    Temp Ban
                  </button>
                </div>
              </div>

              <div className="modpanel-subsection">
                <span className="modpanel-sublabel">Slow mode (seconds between messages)</span>
                <div className="modpanel-tempban-row">
                  <input
                    className="modpanel-input modpanel-input--sm"
                    type="number"
                    min="1"
                    max="3600"
                    value={slowSecs}
                    onChange={e => setSlowSecs(e.target.value)}
                    aria-label="Slow mode seconds"
                  />
                  <span className="modpanel-sublabel-unit">sec</span>
                  <button
                    className="modpanel-action modpanel-action--op modpanel-action--inline"
                    onClick={handleSlowMode}
                  >
                    Set Slow Mode
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Ban list tab ──────────────────────────────────────────────── */}
          {tab === 'banlist' && (
            <div className="modpanel-banlist-wrap">
              {channelBans.length === 0 ? (
                <p className="modpanel-empty">No bans on {channel}.</p>
              ) : (
                <ul className="modpanel-banlist">
                  {channelBans.map((ban, i) => (
                    <li className="modpanel-ban-entry" key={`${ban.mask}-${i}`}>
                      <div className="modpanel-ban-main">
                        <span className="modpanel-ban-mask">{ban.mask}</span>
                        <div className="modpanel-ban-meta">
                          {ban.setBy && <span>by {ban.setBy}</span>}
                          {ban.setAt && <span>{formatDate(ban.setAt * 1000)}</span>}
                        </div>
                      </div>
                      <button
                        className="modpanel-unban-btn"
                        onClick={() => handleUnban(ban.mask)}
                        aria-label={`Remove ban on ${ban.mask}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="modpanel-refresh-btn"
                onClick={() => fetchBanList(channel)}
              >
                Refresh
              </button>
            </div>
          )}

          {/* ── Audit log tab ─────────────────────────────────────────────── */}
          {tab === 'auditlog' && (
            <div className="modpanel-audit-wrap">
              <div className="modpanel-audit-filters">
                {(['all', 'kick', 'ban', 'mode'] as AuditFilter[]).map(f => (
                  <button
                    key={f}
                    className={`modpanel-filter-btn${auditFilter === f ? ' modpanel-filter-btn--active' : ''}`}
                    onClick={() => setAuditFilter(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              {filteredLog.length === 0 ? (
                <p className="modpanel-empty">No moderation actions recorded yet.</p>
              ) : (
                <ul className="modpanel-audit-list">
                  {filteredLog.map((entry, i) => (
                    <li className="modpanel-audit-entry" key={`${entry.timestamp}-${i}`}>
                      <span className="modpanel-audit-time">{formatTime(entry.timestamp)}</span>
                      <span
                        className="modpanel-audit-badge"
                        style={{ background: ACTION_BADGE_COLOR[entry.action] ?? '#64748b' }}
                      >
                        {entry.action}
                      </span>
                      <span className="modpanel-audit-by">{entry.by}</span>
                      <span className="modpanel-audit-arrow">→</span>
                      <span className="modpanel-audit-target">{entry.target}</span>
                      {entry.channel && (
                        <span className="modpanel-audit-chan">{entry.channel}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

        </div>
      </div>

      <style>{`
        .modpanel-overlay {
          position: fixed;
          inset: 0;
          z-index: 800;
          display: flex;
          align-items: flex-start;
          justify-content: flex-end;
          pointer-events: none;
        }

        .modpanel {
          pointer-events: all;
          width: 380px;
          max-width: 100vw;
          height: 100%;
          max-height: 100dvh;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modpanel-slide-in 180ms var(--ease-out) both;
        }

        @keyframes modpanel-slide-in {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }

        .modpanel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          gap: 8px;
        }

        .modpanel-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .modpanel-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .modpanel-chan {
          color: var(--accent);
          font-weight: 600;
        }

        .modpanel-close {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .modpanel-close:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* Tabs */
        .modpanel-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .modpanel-tab {
          flex: 1;
          padding: 10px 0;
          background: none; border: none; cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          border-bottom: 2px solid transparent;
          transition: color var(--t-fast), border-color var(--t-fast);
        }
        .modpanel-tab:hover { color: var(--text-secondary); }
        .modpanel-tab--active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }

        /* Body */
        .modpanel-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-subtle) transparent;
        }

        /* Actions tab */
        .modpanel-actions-wrap {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .modpanel-field-row {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .modpanel-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
        }

        .modpanel-input {
          background: var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          font-size: 13px;
          padding: 7px 10px;
          outline: none;
          transition: border-color var(--t-fast);
          width: 100%;
          box-sizing: border-box;
        }
        .modpanel-input:focus {
          border-color: var(--accent);
        }
        .modpanel-input--sm {
          width: 72px;
        }

        .modpanel-actions-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .modpanel-action {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 12px;
          border: none;
          border-radius: var(--r-sm);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity var(--t-fast), filter var(--t-fast);
        }
        .modpanel-action:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .modpanel-action:not(:disabled):hover {
          filter: brightness(1.12);
        }

        .modpanel-action--danger  { background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }
        .modpanel-action--warn    { background: rgba(251, 146, 60, 0.15);  color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.3); }
        .modpanel-action--muted   { background: rgba(167, 139, 250, 0.15); color: #a78bfa; border: 1px solid rgba(167, 139, 250, 0.3); }
        .modpanel-action--ok      { background: rgba(52, 211, 153, 0.15);  color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3); }
        .modpanel-action--voice   { background: rgba(74, 222, 128, 0.15);  color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }
        .modpanel-action--op      { background: rgba(129, 140, 248, 0.15); color: #818cf8; border: 1px solid rgba(129, 140, 248, 0.3); }
        .modpanel-action--deop    { background: rgba(244, 114, 182, 0.15); color: #f472b6; border: 1px solid rgba(244, 114, 182, 0.3); }

        .modpanel-action--inline {
          padding: 7px 14px;
        }

        .modpanel-action-icon {
          font-size: 15px;
          line-height: 1;
        }

        .modpanel-subsection {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 4px;
          border-top: 1px solid var(--border-subtle);
        }

        .modpanel-sublabel {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
        }

        .modpanel-sublabel-unit {
          font-size: 12px;
          color: var(--text-muted);
        }

        .modpanel-tempban-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* Ban list tab */
        .modpanel-banlist-wrap {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .modpanel-banlist {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .modpanel-ban-entry {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 9px 12px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          transition: border-color var(--t-fast), background var(--t-fast);
        }
        .modpanel-ban-entry:hover {
          background: var(--bg-elevated);
          border-color: var(--border-normal);
        }

        .modpanel-ban-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .modpanel-ban-mask {
          font-size: 12.5px;
          font-family: var(--font-mono, monospace);
          color: var(--danger, #f87171);
          word-break: break-all;
          font-weight: 500;
        }

        .modpanel-ban-meta {
          display: flex;
          gap: 8px;
          font-size: 11px;
          color: var(--text-muted);
          font-family: var(--font-mono, monospace);
        }

        .modpanel-unban-btn {
          flex-shrink: 0;
          padding: 4px 10px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.25);
          border-radius: var(--r-sm);
          color: var(--danger, #f87171);
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: background var(--t-fast), border-color var(--t-fast);
          white-space: nowrap;
        }
        .modpanel-unban-btn:hover {
          background: rgba(248, 113, 113, 0.2);
          border-color: rgba(248, 113, 113, 0.45);
        }

        .modpanel-refresh-btn {
          align-self: flex-start;
          padding: 6px 14px;
          background: var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast);
        }
        .modpanel-refresh-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* Audit log tab */
        .modpanel-audit-wrap {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .modpanel-audit-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .modpanel-filter-btn {
          padding: 4px 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full, 9999px);
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
        }
        .modpanel-filter-btn:hover {
          color: var(--text-secondary);
          background: var(--ch-hover-bg);
        }
        .modpanel-filter-btn--active {
          background: rgba(14, 165, 233, 0.12);
          border-color: rgba(14, 165, 233, 0.4);
          color: var(--accent);
        }

        .modpanel-audit-list {
          list-style: none;
          margin: 0; padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .modpanel-audit-entry {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          font-size: 12px;
          flex-wrap: wrap;
        }

        .modpanel-audit-time {
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .modpanel-audit-badge {
          padding: 2px 7px;
          border-radius: var(--r-full, 9999px);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          color: #000;
          flex-shrink: 0;
        }

        .modpanel-audit-by {
          color: var(--accent);
          font-weight: 600;
          flex-shrink: 0;
        }

        .modpanel-audit-arrow {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .modpanel-audit-target {
          color: var(--text-primary);
          font-family: monospace;
          min-width: 0;
          word-break: break-all;
        }

        .modpanel-audit-chan {
          color: var(--text-muted);
          font-size: 11px;
          flex-shrink: 0;
        }

        .modpanel-empty {
          font-size: 13px;
          color: var(--text-muted);
          font-style: italic;
          text-align: center;
          padding: 32px 0;
          margin: 0;
        }

        @media (max-width: 480px) {
          .modpanel { width: 100vw; }
        }
      `}</style>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--accent)', flexShrink: 0 }}>
      <path d="M5.338 1.59a61.44 61.44 0 0 0-2.837.856.481.481 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.725 10.725 0 0 0 2.287 2.233c.346.244.652.42.893.533.12.057.218.095.293.118a.55.55 0 0 0 .101.025.615.615 0 0 0 .1-.025c.076-.023.174-.061.294-.118.24-.113.547-.29.893-.533a10.726 10.726 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524zM5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.775 11.775 0 0 1-2.517 2.453 7.159 7.159 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7.158 7.158 0 0 1-1.048-.625 11.777 11.777 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 62.456 62.456 0 0 1 5.072.56z"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 1l12 12M13 1L1 13" />
    </svg>
  );
}
