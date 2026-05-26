'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

type OperTab = 'users' | 'server' | 'channels';

// ── Confirm dialog ─────────────────────────────────────────────────────────────
interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="op-confirm-overlay" role="dialog" aria-modal="true">
      <div className="op-confirm-box">
        <p className="op-confirm-msg">{message}</p>
        <div className="op-confirm-actions">
          <button className="op-btn op-btn--danger" onClick={onConfirm}>Confirm</button>
          <button className="op-btn op-btn--ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Login section ──────────────────────────────────────────────────────────────
function OperLogin({ onClose }: { onClose: () => void }) {
  const operLogin = useOnyxStore(s => s.operLogin);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = useCallback(() => {
    if (!username.trim() || !password) return;
    operLogin(username.trim(), password);
  }, [operLogin, username, password]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onClose();
  }, [handleSubmit, onClose]);

  return (
    <div className="op-login">
      <div className="op-warning-bar">
        <span className="op-warning-icon">⚠</span>
        IRC operator access grants elevated server privileges
      </div>
      <div className="op-field">
        <label className="op-label" htmlFor="oper-username">Operator username</label>
        <input
          id="oper-username"
          className="op-input"
          type="text"
          value={username}
          autoComplete="username"
          autoFocus
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Operator name"
        />
      </div>
      <div className="op-field">
        <label className="op-label" htmlFor="oper-password">Password</label>
        <input
          id="oper-password"
          className="op-input"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="••••••••"
        />
      </div>
      <button
        className="op-btn op-btn--primary op-btn--full"
        onClick={handleSubmit}
        disabled={!username.trim() || !password}
      >
        Login
      </button>
    </div>
  );
}

// ── User Actions tab ───────────────────────────────────────────────────────────
function UserActionsTab() {
  const operAction    = useOnyxStore(s => s.operAction);
  const addNotification = useOnyxStore(s => s.addNotification);

  const [targetNick, setTargetNick] = useState('');
  const [killReason,  setKillReason]  = useState('');
  const [newRealname, setNewRealname] = useState('');
  const [sajoinChan,  setSajoinChan]  = useState('');
  const [sapartChan,  setSapartChan]  = useState('');
  const [newNick,     setNewNick]     = useState('');

  const nick = targetNick.trim();

  const guard = useCallback((fn: () => void, label: string) => {
    if (!nick) { addNotification({ type: 'system', text: `${label}: target nick is required` }); return; }
    fn();
  }, [nick, addNotification]);

  return (
    <div className="op-tab-body">
      <div className="op-field">
        <label className="op-label" htmlFor="oper-target-nick">Target nick</label>
        <input
          id="oper-target-nick"
          className="op-input"
          type="text"
          value={targetNick}
          onChange={e => setTargetNick(e.target.value)}
          placeholder="nickname"
        />
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">WHOIS</h4>
        <button
          className="op-btn op-btn--accent"
          onClick={() => guard(() => operAction('WHOIS', nick), 'WHOIS')}
        >
          Look up user
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">KILL</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={killReason}
          onChange={e => setKillReason(e.target.value)}
          placeholder="Kill reason"
        />
        <button
          className="op-btn op-btn--danger"
          onClick={() => guard(() => operAction('KILL', nick, killReason || 'No reason'), 'KILL')}
        >
          Kill user
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">SETNAME</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={newRealname}
          onChange={e => setNewRealname(e.target.value)}
          placeholder="New realname"
        />
        <button
          className="op-btn op-btn--gold"
          onClick={() => guard(() => {
            if (!newRealname.trim()) { addNotification({ type: 'system', text: 'SETNAME: realname is required' }); return; }
            operAction('SETNAME', nick, newRealname.trim());
          }, 'SETNAME')}
        >
          Set realname
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">SAJOIN</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={sajoinChan}
          onChange={e => setSajoinChan(e.target.value)}
          placeholder="#channel"
        />
        <button
          className="op-btn op-btn--gold"
          onClick={() => guard(() => {
            if (!sajoinChan.trim()) { addNotification({ type: 'system', text: 'SAJOIN: channel is required' }); return; }
            operAction('SAJOIN', nick, sajoinChan.trim());
          }, 'SAJOIN')}
        >
          Force join
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">SAPART</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={sapartChan}
          onChange={e => setSapartChan(e.target.value)}
          placeholder="#channel"
        />
        <button
          className="op-btn op-btn--accent"
          onClick={() => guard(() => {
            if (!sapartChan.trim()) { addNotification({ type: 'system', text: 'SAPART: channel is required' }); return; }
            operAction('SAPART', nick, sapartChan.trim());
          }, 'SAPART')}
        >
          Force part
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">SANICK</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={newNick}
          onChange={e => setNewNick(e.target.value)}
          placeholder="New nickname"
        />
        <button
          className="op-btn op-btn--gold"
          onClick={() => guard(() => {
            if (!newNick.trim()) { addNotification({ type: 'system', text: 'SANICK: new nick is required' }); return; }
            operAction('SANICK', nick, newNick.trim());
          }, 'SANICK')}
        >
          Force nick change
        </button>
      </div>
    </div>
  );
}

// ── Server Actions tab ─────────────────────────────────────────────────────────
function ServerActionsTab() {
  const operAction = useOnyxStore(s => s.operAction);
  const [wallopsMsg,  setWallopsMsg]  = useState('');
  const [globopsMsg,  setGlobopsMsg]  = useState('');
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);

  const promptConfirm = useCallback((message: string, action: () => void) => {
    setConfirm({ message, action });
  }, []);

  return (
    <div className="op-tab-body">
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => { confirm.action(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="op-action-group">
        <h4 className="op-action-group-title">Server control</h4>
        <div className="op-btn-row">
          <button
            className="op-btn op-btn--gold"
            onClick={() => operAction('REHASH')}
          >
            REHASH
          </button>
          <button
            className="op-btn op-btn--danger"
            onClick={() => promptConfirm('Restart the IRC server?', () => operAction('RESTART'))}
          >
            RESTART
          </button>
          <button
            className="op-btn op-btn--die"
            onClick={() => promptConfirm('Shut down the IRC server? This will disconnect ALL users.', () => operAction('DIE'))}
          >
            DIE
          </button>
        </div>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">WALLOPS</h4>
        <div className="op-input-row">
          <input
            className="op-input"
            type="text"
            value={wallopsMsg}
            onChange={e => setWallopsMsg(e.target.value)}
            placeholder="Global operator notice…"
          />
          <button
            className="op-btn op-btn--gold"
            disabled={!wallopsMsg.trim()}
            onClick={() => { operAction('WALLOPS', wallopsMsg.trim()); setWallopsMsg(''); }}
          >
            Send
          </button>
        </div>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">GLOBOPS</h4>
        <div className="op-input-row">
          <input
            className="op-input"
            type="text"
            value={globopsMsg}
            onChange={e => setGlobopsMsg(e.target.value)}
            placeholder="Global ops notice…"
          />
          <button
            className="op-btn op-btn--accent"
            disabled={!globopsMsg.trim()}
            onClick={() => { operAction('GLOBOPS', globopsMsg.trim()); setGlobopsMsg(''); }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Channels tab ───────────────────────────────────────────────────────────────
function ChannelsTab() {
  const operAction      = useOnyxStore(s => s.operAction);
  const addNotification = useOnyxStore(s => s.addNotification);

  const [channel,    setChannel]    = useState('');
  const [modeStr,    setModeStr]    = useState('');
  const [topicText,  setTopicText]  = useState('');
  const [kickNick,   setKickNick]   = useState('');
  const [kickReason, setKickReason] = useState('');

  const chan = channel.trim();

  const guardChan = useCallback((fn: () => void, label: string) => {
    if (!chan) { addNotification({ type: 'system', text: `${label}: channel is required` }); return; }
    fn();
  }, [chan, addNotification]);

  return (
    <div className="op-tab-body">
      <div className="op-field">
        <label className="op-label" htmlFor="oper-channel">Target channel</label>
        <input
          id="oper-channel"
          className="op-input"
          type="text"
          value={channel}
          onChange={e => setChannel(e.target.value)}
          placeholder="#channel"
        />
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">SAMODE</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={modeStr}
          onChange={e => setModeStr(e.target.value)}
          placeholder="+m or -n etc."
        />
        <button
          className="op-btn op-btn--gold"
          onClick={() => guardChan(() => {
            if (!modeStr.trim()) { addNotification({ type: 'system', text: 'SAMODE: mode string is required' }); return; }
            operAction('SAMODE', chan, ...modeStr.trim().split(/\s+/));
          }, 'SAMODE')}
        >
          Apply modes
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">TOPIC override</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={topicText}
          onChange={e => setTopicText(e.target.value)}
          placeholder="New topic text"
        />
        <button
          className="op-btn op-btn--accent"
          onClick={() => guardChan(() => {
            if (!topicText.trim()) { addNotification({ type: 'system', text: 'TOPIC: text is required' }); return; }
            operAction('TOPIC', chan, topicText.trim());
          }, 'TOPIC')}
        >
          Set topic
        </button>
      </div>

      <div className="op-action-group">
        <h4 className="op-action-group-title">KICK</h4>
        <input
          className="op-input op-input--sm"
          type="text"
          value={kickNick}
          onChange={e => setKickNick(e.target.value)}
          placeholder="nickname to kick"
        />
        <input
          className="op-input op-input--sm"
          type="text"
          value={kickReason}
          onChange={e => setKickReason(e.target.value)}
          placeholder="Reason (optional)"
        />
        <button
          className="op-btn op-btn--danger"
          onClick={() => guardChan(() => {
            if (!kickNick.trim()) { addNotification({ type: 'system', text: 'KICK: nick is required' }); return; }
            operAction('KICK', chan, kickNick.trim(), kickReason.trim() || 'No reason');
          }, 'KICK')}
        >
          Kick user
        </button>
      </div>
    </div>
  );
}

// ── Oper Dashboard ─────────────────────────────────────────────────────────────
function OperDashboard() {
  const operUsername    = useOnyxStore(s => s.operUsername);
  const notifications   = useOnyxStore(s => s.notifications);

  const [activeTab, setActiveTab] = useState<OperTab>('users');
  const [logOpen,   setLogOpen]   = useState(false);

  // Recent server notices (system/notice type messages)
  const recentNotices = notifications
    .filter(n => n.type === 'system' || n.type === 'error')
    .slice(0, 20);

  return (
    <div className="op-dashboard">
      {/* Header */}
      <div className="op-dashboard-header">
        <span className="op-star" aria-label="Operator star">★</span>
        <span className="op-dashboard-user">{operUsername || 'IRC Operator'}</span>
        <span className="op-badge">OPER</span>
      </div>

      {/* Tabs */}
      <div className="op-tabs" role="tablist">
        {(['users', 'server', 'channels'] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={`op-tab${activeTab === tab ? ' op-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'users' ? 'User Actions' : tab === 'server' ? 'Server Actions' : 'Channels'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="op-tab-content" role="tabpanel">
        {activeTab === 'users'    && <UserActionsTab />}
        {activeTab === 'server'   && <ServerActionsTab />}
        {activeTab === 'channels' && <ChannelsTab />}
      </div>

      {/* Collapsible log */}
      <div className="op-log-section">
        <button
          className="op-log-toggle"
          onClick={() => setLogOpen(v => !v)}
          aria-expanded={logOpen}
        >
          Server notices {logOpen ? '▲' : '▼'} ({recentNotices.length})
        </button>
        {logOpen && (
          <div className="op-log-body">
            {recentNotices.length === 0
              ? <span className="op-log-empty">No recent notices</span>
              : recentNotices.map(n => (
                  <div key={n.id} className="op-log-entry">
                    <span className="op-log-time">
                      {n.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="op-log-text">{n.text}</span>
                  </div>
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function IRCOperatorPanel() {
  const isOper       = useOnyxStore(s => s.isOper);
  const closeOperPanel = useOnyxStore(s => s.closeOperPanel);

  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOperPanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeOperPanel]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) closeOperPanel();
  }, [closeOperPanel]);

  return (
    <div
      className="op-backdrop"
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={isOper ? 'IRC Operator Dashboard' : 'IRC Operator Login'}
    >
      <div className="op-panel">
        {/* Title bar */}
        <div className="op-header">
          <h2 className="op-title">
            {isOper ? 'IRC Operator Dashboard' : 'IRC Operator Login'}
          </h2>
          <button className="op-close" onClick={closeOperPanel} aria-label="Close">✕</button>
        </div>

        {/* Content */}
        <div className="op-body">
          {isOper ? <OperDashboard /> : <OperLogin onClose={closeOperPanel} />}
        </div>
      </div>

      <style>{`
        /* ── Backdrop ── */
        .op-backdrop {
          position: fixed;
          inset: 0;
          z-index: 800;
          background: rgba(3, 8, 16, 0.75);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: op-fade 160ms cubic-bezier(0.16,1,0.3,1) both;
        }

        @keyframes op-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* ── Panel ── */
        .op-panel {
          width: min(600px, 96vw);
          max-height: min(88vh, 720px);
          display: flex;
          flex-direction: column;
          background: var(--bg-deep, #06101d);
          border: 1px solid rgba(248, 185, 56, 0.22);
          border-radius: 12px;
          box-shadow:
            0 0 0 1px rgba(248, 185, 56, 0.08) inset,
            0 24px 64px rgba(0,0,0,0.72),
            0 0 40px rgba(248, 185, 56, 0.06);
          overflow: hidden;
          animation: op-rise 200ms cubic-bezier(0.16,1,0.3,1) both;
        }

        @keyframes op-rise {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* ── Header ── */
        .op-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(248, 185, 56, 0.14);
          background: rgba(248, 185, 56, 0.04);
          flex-shrink: 0;
        }

        .op-title {
          font-size: 15px;
          font-weight: 700;
          color: #f8b938;
          letter-spacing: 0.01em;
          margin: 0;
        }

        .op-close {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          color: #4a7090; font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 6px;
          transition: background 120ms, color 120ms;
        }
        .op-close:hover {
          background: rgba(255,255,255,0.06);
          color: #dff0ff;
        }

        /* ── Body ── */
        .op-body {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: rgba(248, 185, 56, 0.18) transparent;
        }
        .op-body::-webkit-scrollbar { width: 4px; }
        .op-body::-webkit-scrollbar-thumb {
          background: rgba(248, 185, 56, 0.18);
          border-radius: 2px;
        }

        /* ── Login ── */
        .op-login {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .op-warning-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: 8px;
          color: #f59e0b;
          font-size: 12.5px;
          font-weight: 500;
        }
        .op-warning-icon { font-size: 14px; flex-shrink: 0; }

        /* ── Shared form elements ── */
        .op-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .op-label {
          font-size: 11.5px;
          font-weight: 600;
          color: #4a7090;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .op-input {
          width: 100%;
          padding: 8px 12px;
          background: rgba(12, 24, 40, 0.9);
          border: 1px solid rgba(14, 165, 233, 0.2);
          border-radius: 6px;
          color: #dff0ff;
          font-size: 13px;
          outline: none;
          transition: border-color 150ms;
          box-sizing: border-box;
        }
        .op-input::placeholder { color: #2d5070; }
        .op-input:focus { border-color: rgba(248, 185, 56, 0.45); }
        .op-input--sm { flex: 1; }

        /* ── Buttons ── */
        .op-btn {
          padding: 7px 16px;
          border: none;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: filter 120ms, opacity 120ms;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .op-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .op-btn:not(:disabled):hover { filter: brightness(1.12); }
        .op-btn:not(:disabled):active { filter: brightness(0.92); }

        .op-btn--primary {
          background: #0ea5e9;
          color: #fff;
        }
        .op-btn--full {
          width: 100%;
          padding: 10px;
          font-size: 13.5px;
        }
        .op-btn--accent {
          background: rgba(14, 165, 233, 0.18);
          color: #38bdf8;
          border: 1px solid rgba(14, 165, 233, 0.3);
        }
        .op-btn--gold {
          background: rgba(248, 185, 56, 0.15);
          color: #f8b938;
          border: 1px solid rgba(248, 185, 56, 0.28);
        }
        .op-btn--danger {
          background: rgba(220, 38, 38, 0.18);
          color: #f87171;
          border: 1px solid rgba(220, 38, 38, 0.3);
        }
        .op-btn--die {
          background: rgba(220, 38, 38, 0.32);
          color: #fca5a5;
          border: 1px solid rgba(220, 38, 38, 0.55);
        }
        .op-btn--ghost {
          background: rgba(255,255,255,0.05);
          color: #7aa8c4;
          border: 1px solid rgba(255,255,255,0.1);
        }

        /* ── Dashboard ── */
        .op-dashboard {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .op-dashboard-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 20px;
          border-bottom: 1px solid rgba(248, 185, 56, 0.1);
          background: rgba(248, 185, 56, 0.04);
          flex-shrink: 0;
        }
        .op-star {
          color: #f8b938;
          font-size: 16px;
          line-height: 1;
        }
        .op-dashboard-user {
          font-size: 13.5px;
          font-weight: 700;
          color: #dff0ff;
        }
        .op-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #f8b938;
          background: rgba(248, 185, 56, 0.12);
          border: 1px solid rgba(248, 185, 56, 0.28);
          border-radius: 4px;
          padding: 2px 6px;
        }

        /* ── Tabs ── */
        .op-tabs {
          display: flex;
          gap: 2px;
          padding: 10px 20px 0;
          border-bottom: 1px solid rgba(14, 165, 233, 0.1);
          flex-shrink: 0;
        }
        .op-tab {
          padding: 7px 14px;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: #4a7090;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: color 120ms, border-color 120ms;
          margin-bottom: -1px;
        }
        .op-tab:hover { color: #7aa8c4; }
        .op-tab--active {
          color: #f8b938;
          border-bottom-color: #f8b938;
        }

        /* ── Tab content ── */
        .op-tab-content {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: rgba(14, 165, 233, 0.15) transparent;
        }
        .op-tab-content::-webkit-scrollbar { width: 4px; }
        .op-tab-content::-webkit-scrollbar-thumb {
          background: rgba(14, 165, 233, 0.15);
          border-radius: 2px;
        }

        .op-tab-body {
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .op-action-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          border-radius: 8px;
        }
        .op-action-group-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted, #3d6480);
          margin: 0;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
        }

        .op-btn-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .op-input-row {
          display: flex;
          gap: 8px;
        }

        /* ── Log ── */
        .op-log-section {
          flex-shrink: 0;
          border-top: 1px solid rgba(14, 165, 233, 0.08);
        }
        .op-log-toggle {
          width: 100%;
          padding: 8px 20px;
          background: none;
          border: none;
          color: #4a7090;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.04em;
          cursor: pointer;
          text-align: left;
          transition: color 120ms, background 120ms;
        }
        .op-log-toggle:hover {
          color: #7aa8c4;
          background: rgba(14, 165, 233, 0.04);
        }
        .op-log-body {
          max-height: 120px;
          overflow-y: auto;
          padding: 6px 20px 10px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          scrollbar-width: thin;
          scrollbar-color: rgba(14, 165, 233, 0.12) transparent;
        }
        .op-log-empty {
          color: #2d5070;
          font-size: 11.5px;
        }
        .op-log-entry {
          display: flex;
          gap: 8px;
          align-items: baseline;
        }
        .op-log-time {
          font-size: 10.5px;
          color: #3d6480;
          font-family: var(--font-mono, monospace);
          flex-shrink: 0;
        }
        .op-log-text {
          font-size: 12px;
          color: #7aa8c4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ── Confirm dialog ── */
        .op-confirm-overlay {
          position: absolute;
          inset: 0;
          background: rgba(3, 8, 16, 0.82);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          border-radius: 0;
        }
        .op-confirm-box {
          background: #0c1828;
          border: 1px solid rgba(220, 38, 38, 0.35);
          border-radius: 10px;
          padding: 24px;
          max-width: 320px;
          width: 90%;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.72);
        }
        .op-confirm-msg {
          color: #dff0ff;
          font-size: 13.5px;
          line-height: 1.5;
          margin: 0;
        }
        .op-confirm-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}
