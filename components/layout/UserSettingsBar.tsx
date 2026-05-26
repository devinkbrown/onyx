'use client';

import { useState, useRef, useEffect, forwardRef } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── Expiry countdown formatter ────────────────────────────────────────────────

function formatExpiry(expiry: Date | null): string | null {
  if (!expiry) return null;
  const now = Date.now();
  if (expiry.getTime() <= now) return null;

  const diffMs = expiry.getTime() - now;
  const diffH  = diffMs / (1000 * 60 * 60);

  const timeStr = expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today   = new Date();
  const isToday = expiry.getDate() === today.getDate() &&
                  expiry.getMonth() === today.getMonth() &&
                  expiry.getFullYear() === today.getFullYear();

  if (diffH <= 24 && isToday) {
    return `until ${timeStr}`;
  }
  const dayName = expiry.toLocaleDateString([], { weekday: 'short' });
  return `until ${dayName} ${timeStr}`;
}
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';

type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

const STATUS_LABELS: Record<UserStatus, string> = {
  online:  'Online',
  idle:    'Idle',
  dnd:     'Do Not Disturb',
  offline: 'Invisible',
};

const STATUS_DESCS: Record<UserStatus, string> = {
  online:  'Available',
  idle:    'Away from keyboard',
  dnd:     'Mute all notifications',
  offline: 'Appear offline',
};

export default function UserSettingsBar() {
  const ourNick           = useOnyxStore(s => s.ourNick);
  const server            = useOnyxStore(s => s.server);
  const voice             = useOnyxStore(s => s.voice);
  const userStatus        = useOnyxStore(s => s.userStatus);
  const setUserStatus     = useOnyxStore(s => s.setUserStatus);
  const openSettings      = useOnyxStore(s => s.openSettings);
  const setVoiceCallState = useOnyxStore(s => s.setVoiceCallState);
  const client            = useOnyxStore(s => s.client);
  const customStatus          = useOnyxStore(s => s.customStatus);
  const customStatusExpiry    = useOnyxStore(s => s.customStatusExpiry);
  const openCustomStatus      = useOnyxStore(s => s.openCustomStatus);
  const openDndModal      = useOnyxStore(s => s.openDndModal);
  const isDndActive       = useOnyxStore(s => s.isDndActive);
  const dndEnabled        = useOnyxStore(s => s.dndEnabled);
  const focusMode         = useOnyxStore(s => s.focusMode);
  const toggleFocusMode   = useOnyxStore(s => s.toggleFocusMode);
  const selfDisplayName    = useOnyxStore(s => s.selfDisplayName);
  const setSelfDisplayName = useOnyxStore(s => s.setSelfDisplayName);

  const [editingSelfName, setEditingSelfName] = useState(false);
  const [selfNameInput, setSelfNameInput]     = useState('');
  const selfNameInputRef = useRef<HTMLInputElement>(null);

  const displayedNick = selfDisplayName || ourNick || '—';
  const hasSelfOverride = selfDisplayName !== '';

  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const quickSettingsRef = useRef<HTMLDivElement>(null);
  const quickSettingsBtnRef = useRef<HTMLButtonElement>(null);

  // Close QuickSettings on outside click
  useEffect(() => {
    if (!showQuickSettings) return;
    const handler = (e: MouseEvent) => {
      if (
        quickSettingsRef.current && !quickSettingsRef.current.contains(e.target as Node) &&
        quickSettingsBtnRef.current && !quickSettingsBtnRef.current.contains(e.target as Node)
      ) {
        setShowQuickSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showQuickSettings]);

  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const statusPickerRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef    = useRef<HTMLButtonElement>(null);

  // Close status picker on outside click
  useEffect(() => {
    if (!showStatusPicker) return;
    const handler = (e: MouseEvent) => {
      if (
        statusPickerRef.current && !statusPickerRef.current.contains(e.target as Node) &&
        avatarBtnRef.current && !avatarBtnRef.current.contains(e.target as Node)
      ) {
        setShowStatusPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStatusPicker]);

  // Close on Escape
  useEffect(() => {
    if (!showStatusPicker) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowStatusPicker(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showStatusPicker]);

  const account = server?.account ?? null;

  const toggleMute = () => {
    const next = !voice.muted;
    setVoiceCallState({ muted: next });
    if (voice.callState === 'idle') {
      client?.sendRaw('AWAY', next ? 'AFK' : '');
    }
  };

  const toggleDeafen = () => {
    setVoiceCallState({ deafened: !voice.deafened });
  };

  const isMuted    = voice.muted;
  const isDeafened = voice.deafened;

  const subLabel = account
    ? `@${account}`
    : STATUS_LABELS[userStatus];

  return (
    <div className="user-bar">
      {/* Status picker popup */}
      {showStatusPicker && (
        <div className="status-picker" ref={statusPickerRef} role="menu">
          <div className="status-picker-title">Set status</div>
          {(Object.keys(STATUS_LABELS) as UserStatus[]).map(s => (
            <button
              key={s}
              className={`status-option ${userStatus === s ? 'status-option--active' : ''}`}
              role="menuitem"
              onClick={() => { setUserStatus(s); setShowStatusPicker(false); }}
            >
              <span className="status-dot" data-status={s} />
              <span className="status-option-label">{STATUS_LABELS[s]}</span>
              <span className="status-option-desc">{STATUS_DESCS[s]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Identity — avatar opens status picker, text opens account settings */}
      <div className="user-bar-identity">
        <button
          ref={avatarBtnRef}
          className="user-bar-avatar-btn"
          onClick={() => setShowStatusPicker(v => !v)}
          aria-label="Set status"
          aria-haspopup="menu"
          aria-expanded={showStatusPicker}
        >
          <Avatar nick={ourNick} size={32} status={userStatus} />
        </button>
        <div className="user-bar-text-group">
          {editingSelfName ? (
            <div className="user-bar-selfname-edit">
              <input
                ref={selfNameInputRef}
                className="user-bar-selfname-input"
                value={selfNameInput}
                onChange={e => setSelfNameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = selfNameInput.trim();
                    setSelfDisplayName(v);
                    setEditingSelfName(false);
                  }
                  if (e.key === 'Escape') setEditingSelfName(false);
                }}
                placeholder={ourNick}
                maxLength={64}
                autoFocus
                aria-label="Your display name"
              />
              <button
                className="user-bar-selfname-save"
                onClick={() => {
                  const v = selfNameInput.trim();
                  setSelfDisplayName(v);
                  setEditingSelfName(false);
                }}
              >✓</button>
            </div>
          ) : (
            <div className="user-bar-nick-row">
              <button
                className="user-bar-text-btn"
                onClick={() => openSettings('account')}
                aria-label="Open account settings"
              >
                <span className="user-bar-nick">{displayedNick}</span>
                {hasSelfOverride && (
                  <span className="user-bar-actual-nick">({ourNick})</span>
                )}
                <span className="user-bar-sub">{subLabel}</span>
              </button>
              <button
                className="user-bar-edit-name-btn"
                onClick={() => { setSelfNameInput(selfDisplayName); setEditingSelfName(true); }}
                aria-label="Edit display name"
                title="Set your local display name"
              >
                ✏️
              </button>
            </div>
          )}
          {customStatus ? (
            <button
              className="user-bar-custom-status"
              onClick={openCustomStatus}
              title="Edit status"
              aria-label="Edit custom status"
            >
              <span className="user-bar-status-text">
                {customStatus.slice(0, 30)}{customStatus.length > 30 ? '…' : ''}
              </span>
              {formatExpiry(customStatusExpiry) && (
                <span className="user-bar-status-expiry">
                  {formatExpiry(customStatusExpiry)}
                </span>
              )}
            </button>
          ) : (
            <button
              className="user-bar-set-status-btn"
              onClick={openCustomStatus}
              aria-label="Set a custom status"
            >
              Set status…
            </button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="user-bar-actions">
        <Tooltip text={isMuted ? 'Unmute' : 'Mute'} side="top">
          <button
            className={`user-bar-btn ${isMuted ? 'user-bar-btn--active user-bar-btn--warn' : ''}`}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            onClick={toggleMute}
          >
            {isMuted ? <MicOffIcon /> : <MicIcon />}
          </button>
        </Tooltip>

        <Tooltip text={isDeafened ? 'Undeafen' : 'Deafen'} side="top">
          <button
            className={`user-bar-btn ${isDeafened ? 'user-bar-btn--active user-bar-btn--warn' : ''}`}
            aria-label={isDeafened ? 'Undeafen' : 'Deafen'}
            onClick={toggleDeafen}
          >
            {isDeafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
          </button>
        </Tooltip>

        <Tooltip text={dndEnabled ? 'Do Not Disturb (on)' : 'Do Not Disturb'} side="top">
          <button
            className={`user-bar-btn ${dndEnabled ? 'user-bar-btn--dnd-active' : ''}`}
            aria-label={dndEnabled ? 'Do Not Disturb is on' : 'Do Not Disturb'}
            aria-pressed={dndEnabled}
            onClick={openDndModal}
          >
            <MoonSvgIcon active={isDndActive()} />
          </button>
        </Tooltip>

        <Tooltip text={focusMode ? 'Exit focus mode' : 'Focus mode (Ctrl+Shift+F)'} side="top">
          <button
            className={`user-bar-btn ${focusMode ? 'user-bar-btn--focus-active' : ''}`}
            aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}
            aria-pressed={focusMode}
            onClick={toggleFocusMode}
          >
            <FocusModeIcon />
          </button>
        </Tooltip>

        <div style={{ position: 'relative' }}>
          <Tooltip text="Quick settings" side="top">
            <button
              ref={quickSettingsBtnRef}
              className={`user-bar-btn ${showQuickSettings ? 'user-bar-btn--active-soft' : ''}`}
              aria-label="Quick settings"
              aria-expanded={showQuickSettings}
              onClick={() => setShowQuickSettings(v => !v)}
            >
              <QuickGearIcon />
            </button>
          </Tooltip>
          {showQuickSettings && (
            <QuickSettingsPanel
              ref={quickSettingsRef}
              onClose={() => setShowQuickSettings(false)}
              openSettings={openSettings}
            />
          )}
        </div>

        <Tooltip text="Settings" side="top">
          <button
            className="user-bar-btn"
            aria-label="Settings"
            onClick={() => openSettings('account')}
          >
            <GearIcon />
          </button>
        </Tooltip>
      </div>

      <style>{`
        .user-bar {
          height: 52px;
          display: flex;
          align-items: center;
          padding: 0 8px;
          gap: 2px;
          background: var(--bg-void);
          border-top: 1px solid var(--border-subtle);
          box-shadow: 0 -1px 0 var(--border-subtle);
          flex-shrink: 0;
          position: relative;
        }

        /* ── Status picker ── */
        .status-picker {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 8px;
          width: 220px;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          padding: 6px;
          z-index: 500;
          animation: sp-pop 120ms var(--ease-out) both;
        }
        @keyframes sp-pop {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .status-picker-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 4px 8px 6px;
        }
        .status-option {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 8px;
          border-radius: var(--r-sm);
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background var(--t-fast);
        }
        .status-option:hover { background: var(--ch-hover-bg); }
        .status-option--active { background: var(--accent-subtle); }

        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-dot[data-status="online"]  { background: var(--status-online); }
        .status-dot[data-status="idle"]    { background: var(--status-idle); }
        .status-dot[data-status="dnd"]     { background: var(--status-dnd); }
        .status-dot[data-status="offline"] { background: var(--status-offline); }

        .status-option-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          flex-shrink: 0;
        }
        .status-option-desc {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ── Identity area ── */
        .user-bar-identity {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
          min-width: 0;
        }

        .user-bar-avatar-btn {
          flex-shrink: 0;
          background: none;
          border: none;
          cursor: pointer;
          padding: 1px;
          border-radius: var(--r-full);
          transition: background 150ms var(--ease-out), box-shadow 150ms var(--ease-out);
          display: flex;
          align-items: center;
        }
        .user-bar-avatar-btn:hover {
          background: var(--ch-hover-bg);
          box-shadow: 0 0 0 2px var(--accent-border);
        }
        .user-bar-avatar-btn:focus-visible {
          outline: 2px solid var(--accent-border);
          outline-offset: 2px;
        }

        /* ── Text group (nick + custom status stacked) ── */
        .user-bar-text-group {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
          gap: 1px;
        }

        .user-bar-text-btn {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
          padding: 2px 6px;
          border-radius: var(--r-sm);
          cursor: pointer;
          border: none;
          background: none;
          text-align: left;
          transition: background var(--t-fast);
        }
        .user-bar-text-btn:hover { background: var(--ch-hover-bg); }
        .user-bar-text-btn:focus-visible {
          outline: 2px solid var(--accent-border);
          outline-offset: 1px;
        }

        .user-bar-nick {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.25;
        }

        .user-bar-sub {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.25;
        }

        /* ── Nick row with edit pencil ── */
        .user-bar-nick-row {
          display: flex;
          align-items: center;
          gap: 2px;
          min-width: 0;
        }

        .user-bar-nick-row .user-bar-text-btn {
          flex: 1;
          min-width: 0;
        }

        .user-bar-actual-nick {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
          opacity: 0.7;
        }

        .user-bar-edit-name-btn {
          flex-shrink: 0;
          background: none;
          border: none;
          cursor: pointer;
          padding: 2px 3px;
          border-radius: var(--r-sm);
          opacity: 0;
          transition: opacity var(--t-fast), background var(--t-fast);
          font-size: 11px;
          line-height: 1;
        }
        .user-bar:hover .user-bar-edit-name-btn { opacity: 0.7; }
        .user-bar-edit-name-btn:hover { opacity: 1 !important; background: var(--bg-elevated); }

        /* ── Inline self-name editor ── */
        .user-bar-selfname-edit {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 4px;
          min-width: 0;
        }

        .user-bar-selfname-input {
          flex: 1;
          min-width: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-sm);
          padding: 3px 7px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          font-family: inherit;
        }
        .user-bar-selfname-input::placeholder { color: var(--text-muted); }

        .user-bar-selfname-save {
          flex-shrink: 0;
          background: var(--accent);
          border: none;
          border-radius: var(--r-sm);
          padding: 3px 7px;
          font-size: 12px;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-fast);
        }
        .user-bar-selfname-save:hover { background: var(--accent-hover, color-mix(in srgb, var(--accent) 85%, #fff)); }

        /* ── Custom status display ── */
        .user-bar-custom-status {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
          padding: 0 6px;
          border: none;
          background: none;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          border-radius: var(--r-sm);
          transition: color var(--t-fast);
          max-width: 100%;
        }
        .user-bar-custom-status:hover .user-bar-status-text { color: var(--text-secondary); }

        .user-bar-status-text {
          font-size: 10px;
          font-style: italic;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
          transition: color var(--t-fast);
        }

        .user-bar-status-expiry {
          font-size: 9px;
          color: var(--accent);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
          opacity: 0.75;
          font-variant-numeric: tabular-nums;
        }

        /* ── Set status button ── */
        .user-bar-set-status-btn {
          font-size: 10px;
          color: var(--text-muted);
          padding: 0 6px;
          border: none;
          background: none;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          border-radius: var(--r-sm);
          transition: color var(--t-fast);
          white-space: nowrap;
          line-height: 1.3;
        }
        .user-bar-set-status-btn:hover { color: var(--accent); }

        /* ── Action buttons ── */
        .user-bar-actions {
          display: flex;
          align-items: center;
          gap: 1px;
          flex-shrink: 0;
        }

        .user-bar-btn {
          width: 30px; height: 30px;
          border-radius: var(--r-sm);
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-secondary);
          opacity: 0.65;
          transition: background 150ms var(--ease-out), color 150ms var(--ease-out), opacity 150ms var(--ease-out);
          flex-shrink: 0;
        }
        .user-bar-btn svg { width: 16px; height: 16px; }
        .user-bar-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
          opacity: 1;
        }
        .user-bar-btn--active {
          color: var(--danger);
          opacity: 1;
          background: rgba(237,66,69,0.1);
        }
        .user-bar-btn--warn:hover {
          background: rgba(237,66,69,0.15);
          color: var(--danger);
          opacity: 1;
        }
        .user-bar-btn--dnd-active { color: #f5a812; opacity: 1; }
        .user-bar-btn--dnd-active:hover { background: rgba(245,168,18,0.12); color: #f5a812; opacity: 1; }
        .user-bar-btn--focus-active { color: var(--accent); opacity: 1; }
        .user-bar-btn--focus-active:hover { background: var(--accent-subtle); color: var(--accent); opacity: 1; }
        .user-bar-btn--active-soft { background: var(--ch-hover-bg); color: var(--text-primary); opacity: 1; }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" strokeLinejoin="round" />
      <path d="M4 7a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M8 11v2.5" strokeLinecap="round" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" strokeLinejoin="round" />
      <path d="M4 7a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M8 11v2.5" strokeLinecap="round" />
      <path d="M2 2l12 12" strokeLinecap="round" stroke="var(--danger)" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3a5 5 0 0 0-5 5v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0V8a6 6 0 1 1 12 0v5a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2h1V8a5 5 0 0 0-5-5z"/>
    </svg>
  );
}

function HeadphonesOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3a5 5 0 0 0-5 5v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0V8a6 6 0 1 1 12 0v5a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2h1V8a5 5 0 0 0-5-5z" fill="currentColor" />
      <path d="M2 2l12 12" strokeLinecap="round" stroke="var(--danger)" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M7.068.727c.243-.97 1.62-.97 1.864 0l.071.286a.96.96 0 0 0 1.622.434l.205-.211c.695-.719 1.888-.03 1.613.931l-.08.284a.96.96 0 0 0 1.187 1.187l.283-.081c.96-.275 1.65.918.931 1.613l-.211.205a.96.96 0 0 0 .434 1.622l.286.071c.97.243.97 1.62 0 1.864l-.286.071a.96.96 0 0 0-.434 1.622l.211.205c.719.695.03 1.888-.931 1.613l-.284-.08a.96.96 0 0 0-1.187 1.187l.081.283c.275.96-.918 1.65-1.613.931l-.205-.211a.96.96 0 0 0-1.622.434l-.071.286c-.243.97-1.62.97-1.864 0l-.071-.286a.96.96 0 0 0-1.622-.434l-.205.211c-.695.719-1.888.03-1.613-.931l.08-.284a.96.96 0 0 0-1.186-1.187l-.284.081c-.96.275-1.65-.918-.931-1.613l.211-.205a.96.96 0 0 0-.434-1.622l-.286-.071c-.97-.243-.97-1.62 0-1.864l.286-.071a.96.96 0 0 0 .434-1.622l-.211-.205c-.719-.695-.03-1.888.931-1.613l.284.08a.96.96 0 0 0 1.187-1.186l-.081-.284c-.275-.96.918-1.65 1.613-.931l.205.211a.96.96 0 0 0 1.622-.434l.071-.286zM8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
    </svg>
  );
}

function MoonSvgIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 16 16"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M13.5 10.5a6 6 0 1 1-8-8 4.5 4.5 0 1 0 8 8z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FocusModeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="1" y="1" width="5" height="5" rx="1" opacity="0.4" />
      <rect x="10" y="1" width="5" height="5" rx="1" opacity="0.4" />
      <rect x="1" y="10" width="5" height="5" rx="1" opacity="0.4" />
      <rect x="10" y="10" width="5" height="5" rx="1" opacity="0.4" />
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function QuickGearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
      <path fillRule="evenodd" d="M6.6 1.2a.75.75 0 0 1 .74-.63h1.32a.75.75 0 0 1 .74.63l.16.97a5.07 5.07 0 0 1 .84.49l.94-.36a.75.75 0 0 1 .9.32l.66 1.14a.75.75 0 0 1-.16.96l-.77.63c.02.2.03.4.03.59 0 .19-.01.39-.03.58l.77.63a.75.75 0 0 1 .16.96l-.66 1.14a.75.75 0 0 1-.9.32l-.94-.36c-.26.18-.54.34-.84.49l-.16.97a.75.75 0 0 1-.74.63H7.34a.75.75 0 0 1-.74-.63l-.16-.97a5.07 5.07 0 0 1-.84-.49l-.94.36a.75.75 0 0 1-.9-.32l-.66-1.14a.75.75 0 0 1 .16-.96l.77-.63A5.08 5.08 0 0 1 4 8c0-.19.01-.39.03-.58l-.77-.63a.75.75 0 0 1-.16-.96l.66-1.14a.75.75 0 0 1 .9-.32l.94.36c.26-.18.54-.34.84-.49l.16-.97zm.9 2.3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>
    </svg>
  );
}

// ── Quick Settings Panel ───────────────────────────────────────────────────────

interface QuickSettingsPanelProps {
  onClose: () => void;
  openSettings: (tab?: string) => void;
}

const ACCENT_PRESETS = [
  { label: 'Sky',    value: '#0ea5e9' },
  { label: 'Violet', value: '#7c5af5' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Rose',   value: '#f43f5e' },
  { label: 'Amber',  value: '#f59e0b' },
  { label: 'Cyan',   value: '#06b6d4' },
];

const QuickSettingsPanel = forwardRef<HTMLDivElement, QuickSettingsPanelProps>(
  function QuickSettingsPanel({ onClose, openSettings }, ref) {
    const userStatus      = useOnyxStore(s => s.userStatus);
    const setUserStatus   = useOnyxStore(s => s.setUserStatus);
    const soundEnabled    = useOnyxStore(s => s.soundEnabled);
    const setSoundEnabled = useOnyxStore(s => s.setSoundEnabled);
    const activeTheme     = useOnyxStore(s => s.activeTheme);
    const setTheme        = useOnyxStore(s => s.setTheme);
    const messageDensity  = useOnyxStore(s => s.messageDensity);
    const setMessageDensity = useOnyxStore(s => s.setMessageDensity);
    const accentColor     = useOnyxStore(s => s.accentColor);
    const setAccentColor  = useOnyxStore(s => s.setAccentColor);

    const THEMES = ['ocean', 'midnight', 'forest', 'ember', 'arctic'] as const;

    // Close on Escape
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
      <div ref={ref} className="qs-panel" role="dialog" aria-label="Quick settings">
        {/* Status */}
        <div className="qs-section">
          <div className="qs-label">Status</div>
          <div className="qs-row">
            {(['online', 'idle', 'dnd'] as const).map(s => (
              <button
                key={s}
                className={`qs-btn ${userStatus === s ? 'qs-btn--active' : ''}`}
                onClick={() => { setUserStatus(s); }}
                aria-pressed={userStatus === s}
              >
                <span className="qs-status-dot" data-status={s} />
                {s === 'online' ? 'Online' : s === 'idle' ? 'Idle' : 'DND'}
              </button>
            ))}
          </div>
        </div>

        {/* Sound */}
        <div className="qs-section">
          <div className="qs-label">Sound</div>
          <div className="qs-row">
            <button
              className={`qs-btn qs-btn--full ${soundEnabled ? 'qs-btn--active' : ''}`}
              onClick={() => setSoundEnabled(!soundEnabled)}
              aria-pressed={soundEnabled}
            >
              {soundEnabled ? 'Sound on' : 'Sound off'}
            </button>
          </div>
        </div>

        {/* Density */}
        <div className="qs-section">
          <div className="qs-label">Density</div>
          <div className="qs-row">
            {(['cozy', 'compact'] as const).map(d => (
              <button
                key={d}
                className={`qs-btn ${messageDensity === d ? 'qs-btn--active' : ''}`}
                onClick={() => setMessageDensity(d)}
                aria-pressed={messageDensity === d}
              >
                {d === 'cozy' ? 'Cozy' : 'Compact'}
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="qs-section">
          <div className="qs-label">Theme</div>
          <div className="qs-row qs-row--wrap">
            {THEMES.map(t => (
              <button
                key={t}
                className={`qs-theme-dot qs-theme-${t} ${activeTheme === t ? 'qs-theme-dot--active' : ''}`}
                onClick={() => setTheme(t)}
                aria-label={`Theme: ${t}`}
                aria-pressed={activeTheme === t}
                title={t.charAt(0).toUpperCase() + t.slice(1)}
              />
            ))}
          </div>
        </div>

        {/* Accent color */}
        <div className="qs-section">
          <div className="qs-label">Accent</div>
          <div className="qs-row">
            {ACCENT_PRESETS.map(p => (
              <button
                key={p.value}
                className={`qs-color-dot ${accentColor === p.value ? 'qs-color-dot--active' : ''}`}
                style={{ background: p.value }}
                onClick={() => setAccentColor(p.value)}
                aria-label={`Accent: ${p.label}`}
                title={p.label}
              />
            ))}
          </div>
        </div>

        {/* Full settings link */}
        <div className="qs-section qs-section--footer">
          <button
            className="qs-full-settings"
            onClick={() => { openSettings('account'); onClose(); }}
          >
            Full settings
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5h6M5 2l3 3-3 3"/>
            </svg>
          </button>
        </div>

        <style>{`
          .qs-panel {
            position: absolute;
            bottom: calc(100% + 8px);
            left: 0;
            width: 240px;
            background: var(--bg-float);
            border: 1px solid var(--border-normal);
            border-radius: var(--r-lg);
            padding: 10px;
            box-shadow: var(--shadow-xl);
            z-index: 500;
            animation: qs-in 140ms var(--ease-out) both;
          }
          @keyframes qs-in {
            from { opacity: 0; transform: translateY(6px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
          .qs-section {
            margin-bottom: 8px;
          }
          .qs-section:last-child { margin-bottom: 0; }
          .qs-section--footer {
            padding-top: 8px;
            border-top: 1px solid var(--border-subtle);
            margin-top: 4px;
          }
          .qs-label {
            font-size: 10px;
            font-weight: 700;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin-bottom: 5px;
          }
          .qs-row {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .qs-row--wrap {
            flex-wrap: wrap;
          }
          .qs-btn {
            flex: 1;
            padding: 4px 6px;
            border-radius: var(--r-sm);
            border: 1px solid var(--border-subtle);
            background: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            text-align: center;
            transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            white-space: nowrap;
          }
          .qs-btn:hover {
            border-color: var(--border-normal);
            color: var(--text-primary);
          }
          .qs-btn--active {
            border-color: var(--accent-border);
            background: var(--accent-subtle);
            color: var(--accent);
          }
          .qs-btn--full { flex: unset; width: 100%; }
          .qs-status-dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            flex-shrink: 0;
          }
          .qs-status-dot[data-status="online"]  { background: var(--status-online); }
          .qs-status-dot[data-status="idle"]    { background: var(--status-idle); }
          .qs-status-dot[data-status="dnd"]     { background: var(--status-dnd); }
          .qs-theme-dot {
            width: 20px; height: 20px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            transition: border-color var(--t-fast), transform var(--t-fast);
          }
          .qs-theme-dot:hover { transform: scale(1.15); }
          .qs-theme-dot--active { border-color: white; }
          .qs-theme-ocean   { background: #0ea5e9; }
          .qs-theme-midnight { background: #0ea5e9; }
          .qs-theme-forest  { background: #22c55e; }
          .qs-theme-ember   { background: #f97316; }
          .qs-theme-arctic  { background: #58a6ff; }
          .qs-color-dot {
            width: 20px; height: 20px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            transition: border-color var(--t-fast), transform var(--t-fast);
            flex-shrink: 0;
          }
          .qs-color-dot:hover { transform: scale(1.15); }
          .qs-color-dot--active { border-color: white; }
          .qs-full-settings {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 5px 6px;
            border-radius: var(--r-sm);
            border: none;
            background: none;
            color: var(--text-secondary);
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
            transition: background var(--t-fast), color var(--t-fast);
          }
          .qs-full-settings:hover {
            background: var(--ch-hover-bg);
            color: var(--text-primary);
          }
        `}</style>
      </div>
    );
  }
);
