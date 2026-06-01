'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import Button from '@/components/ui/Button';
import Avatar from '@/components/ui/Avatar';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDialogFocus } from './useDialogFocus';
import CTCPSettingsSection from './CTCPSettingsSection';

type Tab = 'account' | 'appearance' | 'voice' | 'notifications' | 'accessibility' | 'developer' | 'streamer' | 'advanced';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'account',       label: 'Account',        icon: <UserIcon /> },
  { id: 'appearance',    label: 'Appearance',      icon: <PaletteIcon /> },
  { id: 'voice',         label: 'Voice & Audio',   icon: <VoiceIcon /> },
  { id: 'notifications', label: 'Notifications',   icon: <BellIcon /> },
  { id: 'accessibility', label: 'Accessibility',   icon: <AccessibilityIcon /> },
  { id: 'developer',     label: 'Developer',       icon: <CodeIcon /> },
  { id: 'streamer',      label: 'Streamer Mode',   icon: <StreamerIcon /> },
  { id: 'advanced',      label: 'Advanced',        icon: <GearIcon /> },
];

export default function SettingsModal() {
  const closeSettings = useOnyxStore(s => s.closeSettings);
  const settingsTab   = useOnyxStore(s => s.settingsTab);
  const [tab, setTab] = useState<Tab>(settingsTab as Tab ?? 'account');

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);
  useDialogFocus(modalRef);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeSettings]);

  const stopProp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="settings-overlay"
      onClick={closeSettings}
    >
      <div
        className="settings-modal animate-scale-in"
        onClick={stopProp}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        {/* Sidebar */}
        <nav className="settings-nav" aria-label="Settings navigation">
          <h2 id="settings-modal-title" className="settings-nav-title">Settings</h2>
          <div role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              id={`settings-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`settings-panel-${t.id}`}
              className={`settings-tab ${tab === t.id ? 'settings-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="settings-tab-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
          </div>

          <div style={{ flex: 1 }} />

          <Button
            variant="danger"
            size="sm"
            onClick={() => { useOnyxStore.getState().disconnect(); closeSettings(); }}
            fullWidth
          >
            Sign Out
          </Button>
        </nav>

        {/* Content */}
        <div
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
          className="settings-content"
        >
          <button className="settings-close" onClick={closeSettings} aria-label="Close settings">
            ✕
          </button>
          {tab === 'account'       && <AccountTab />}
          {tab === 'appearance'    && <AppearanceTab />}
          {tab === 'voice'         && <VoiceTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'accessibility' && <AccessibilityTab />}
          {tab === 'developer'     && <DeveloperTab />}
          {tab === 'streamer'      && <StreamerModeTab />}
          {tab === 'advanced'      && <AdvancedTab />}
        </div>
      </div>

      <style>{`
        @keyframes settings-scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }

        .settings-overlay {
          position: fixed; inset: 0;
          background: color-mix(in srgb, var(--bg-void, #030810) 86%, transparent);
          z-index: 500;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          animation: settings-fade-in var(--t-fast, 150ms) var(--ease-out, ease) both;
        }
        @keyframes settings-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .settings-modal {
          background:
            radial-gradient(circle at 8% 0%, var(--accent-glow, rgba(14,165,233,0.18)), transparent 34%),
            linear-gradient(135deg, var(--bg-elevated, #132131), var(--bg-base, #0c1828) 54%, var(--bg-deep, #06101d));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl, 16px);
          width: 100%; max-width: 920px;
          height: 82dvh; max-height: 640px;
          display: flex;
          overflow: hidden;
          box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.75)), var(--glow, 0 0 32px rgba(14,165,233,0.2));
          animation: settings-scale-in var(--t-normal, 260ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        .settings-nav {
          width: 232px; flex-shrink: 0;
          background: linear-gradient(180deg, var(--bg-deep, #06101d), var(--bg-void, #030810));
          padding: 26px 14px 20px;
          display: flex; flex-direction: column; gap: 4px;
          border-right: 1px solid var(--border-subtle);
          overflow-y: auto;
        }

        .settings-nav-title {
          font-size: 11px; font-weight: 800;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--gold, #67e8f9); padding: 0 12px;
          margin-bottom: 14px;
        }

        .settings-tab {
          display: flex; align-items: center; gap: 10px;
          padding: 0 12px; height: 38px;
          border-radius: var(--r-md, 8px);
          background: transparent; border: 1px solid transparent; cursor: pointer;
          text-align: left; font-size: 13px; font-weight: 500;
          color: var(--text-secondary);
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease);
          width: 100%;
          position: relative;
          overflow: hidden;
        }
        .settings-tab::before {
          content: '';
          position: absolute;
          left: 0; top: 7px; bottom: 7px;
          width: 3px; border-radius: var(--r-full);
          background: var(--gold, #67e8f9);
          opacity: 0;
          transition: opacity var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .settings-tab:hover {
          background: var(--ch-hover-bg, rgba(14,165,233,0.07));
          color: var(--text-primary);
          transform: translateX(2px);
        }
        .settings-tab--active {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          color: var(--text-primary);
          font-weight: 600;
          box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.5));
        }
        .settings-tab--active::before { opacity: 1; }
        .settings-tab:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .settings-tab-icon {
          width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          border-radius: var(--r-sm, 6px);
          opacity: 0.75;
        }
        .settings-tab--active .settings-tab-icon {
          color: var(--accent, #0ea5e9);
          background: var(--accent-subtle);
          opacity: 1;
        }

        .settings-content {
          flex: 1; overflow-y: auto; padding: 34px 38px 36px;
          position: relative;
          background: linear-gradient(180deg, color-mix(in srgb, var(--bg-base, #0c1828) 82%, transparent), var(--bg-deep, #06101d));
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .settings-content::-webkit-scrollbar { width: 4px; }
        .settings-content::-webkit-scrollbar-track { background: transparent; }
        .settings-content::-webkit-scrollbar-thumb {
          background: var(--border-normal);
          border-radius: 2px;
        }

        .settings-close {
          position: absolute; top: 18px; right: 18px;
          width: 30px; height: 30px;
          border-radius: var(--r-full); border: 1px solid var(--border-subtle);
          background: var(--bg-float);
          color: var(--text-muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; line-height: 1;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .settings-close:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
          border-color: var(--border-normal);
          transform: scale(1.04);
        }
        .settings-close:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .settings-overlay,
          .settings-modal {
            animation: none;
          }
          .settings-tab,
          .settings-tab::before,
          .settings-close {
            transition: none;
          }
          .settings-tab:hover,
          .settings-close:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

// ── Tab components ─────────────────────────────────────────────────────────────

function AccountTab() {
  const ourNick            = useOnyxStore(s => s.ourNick);
  const server             = useOnyxStore(s => s.server);
  const client             = useOnyxStore(s => s.client);
  const isIRCX             = useOnyxStore(s => s.isIRCX);
  const userProps          = useOnyxStore(s => s.userProps);
  const nickAliases        = useOnyxStore(s => s.nickAliases);
  const setNickAliases     = useOnyxStore(s => s.setNickAliases);
  const currentNickIsAlias = useOnyxStore(s => s.currentNickIsAlias);
  const selfDisplayName    = useOnyxStore(s => s.selfDisplayName);
  const setSelfDisplayName = useOnyxStore(s => s.setSelfDisplayName);

  const myProps = userProps.get(ourNick.toLowerCase()) ?? {};

  const [awayMsg,     setAwayMsg]     = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwSaved,     setPwSaved]     = useState(false);
  const [bio,         setBio]         = useState(myProps.BIO ?? '');
  const [statusProp,  setStatusProp]  = useState(myProps.STATUS ?? '');
  const [propSaved,   setPropSaved]   = useState(false);

  // Display name state
  const [displayNameVal, setDisplayNameVal] = useState(selfDisplayName);
  const [displayNameSaved, setDisplayNameSaved] = useState(false);

  const saveDisplayName = () => {
    setSelfDisplayName(displayNameVal.trim());
    setDisplayNameSaved(true);
    setTimeout(() => setDisplayNameSaved(false), 2000);
  };

  const clearDisplayName = () => {
    setSelfDisplayName('');
    setDisplayNameVal('');
    setDisplayNameSaved(true);
    setTimeout(() => setDisplayNameSaved(false), 2000);
  };

  // Nick aliases state
  const [alias0, setAlias0] = useState(nickAliases[0] ?? '');
  const [alias1, setAlias1] = useState(nickAliases[1] ?? '');
  const [alias2, setAlias2] = useState(nickAliases[2] ?? '');
  const [aliasesSaved, setAliasesSaved] = useState(false);

  const saveAliases = () => {
    setNickAliases([alias0, alias1, alias2]);
    setAliasesSaved(true);
    setTimeout(() => setAliasesSaved(false), 2000);
  };

  const setAway = () => {
    if (client) client.sendRaw('AWAY', awayMsg || 'Away');
  };
  const clearAway = () => {
    if (client) client.sendRaw('AWAY');
  };

  const changePassword = () => {
    if (!client || !newPassword.trim()) return;
    client.sendRaw('PRIVMSG', 'NickServ', `SETPASS ${newPassword}`);
    setNewPassword('');
    setPwSaved(true);
    setTimeout(() => setPwSaved(false), 3000);
  };

  const saveProfile = () => {
    if (!client) return;
    if (bio.trim())         client.sendRaw('PROP', 'me', 'BIO', bio.trim());
    if (statusProp.trim())  client.sendRaw('PROP', 'me', 'STATUS', statusProp.trim());
    setPropSaved(true);
    setTimeout(() => setPropSaved(false), 3000);
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Account</h2>

      <div className="profile-row">
        <Avatar nick={ourNick} size={64} />
        <div>
          <div className="profile-nick">{ourNick}</div>
          {server?.account
            ? <div className="profile-account">Signed in as <strong>@{server.account}</strong></div>
            : <div className="profile-account" style={{ color: 'var(--warning)' }}>Guest — sign in to save your profile</div>
          }
          <div className="profile-server">Server: {server?.network ?? '—'}</div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Display Name</h3>
        <p className="settings-hint">
          This is only visible to you — it does not change your IRC nick.
          {selfDisplayName && (
            <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
              Currently showing as &ldquo;{selfDisplayName}&rdquo;
            </span>
          )}
        </p>
        <div className="settings-row">
          <input
            className="settings-input"
            placeholder={`${ourNick} (your IRC nick)`}
            value={displayNameVal}
            onChange={e => setDisplayNameVal(e.target.value)}
            maxLength={64}
            spellCheck={false}
            autoComplete="off"
          />
          <Button size="sm" onClick={saveDisplayName}>
            {displayNameSaved ? '✓ Saved' : 'Save'}
          </Button>
          {selfDisplayName && (
            <Button size="sm" variant="ghost" onClick={clearDisplayName}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Away Status</h3>
        <div className="settings-row">
          <input
            className="settings-input"
            placeholder="Set an away message…"
            value={awayMsg}
            onChange={e => setAwayMsg(e.target.value)}
          />
          <Button size="sm" onClick={setAway}>Set Away</Button>
          <Button size="sm" variant="ghost" onClick={clearAway}>Clear</Button>
        </div>
      </div>

      {isIRCX && (
        <div className="settings-section">
          <h3 className="settings-section-title">Profile</h3>
          <p className="settings-hint">Your profile is visible to others when they hover your name.</p>
          <div className="settings-row">
            <input
              className="settings-input"
              placeholder="Status (e.g. Building stuff 🚀)"
              value={statusProp}
              onChange={e => setStatusProp(e.target.value)}
            />
          </div>
          <div className="settings-row">
            <textarea
              className="settings-input settings-textarea"
              placeholder="Bio — a few words about yourself"
              value={bio}
              onChange={e => setBio(e.target.value)}
              rows={3}
            />
          </div>
          <Button size="sm" onClick={saveProfile} disabled={!client}>
            {propSaved ? '✓ Saved' : 'Save Profile'}
          </Button>
        </div>
      )}

      <div className="settings-section">
        <h3 className="settings-section-title">Change Password</h3>
        <div className="settings-row">
          <input
            className="settings-input"
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
          />
          <Button size="sm" onClick={changePassword} disabled={!newPassword.trim()}>
            {pwSaved ? '✓ Saved' : 'Update'}
          </Button>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Nick Aliases</h3>
        <p className="settings-hint">
          Fallback nicks tried in order when your primary nick is in use.
          {currentNickIsAlias && (
            <span className="settings-alias-notice"> Currently using an alias — desired nick is unavailable.</span>
          )}
        </p>
        <div className="settings-alias-inputs">
          <input
            className="settings-input"
            placeholder="First alternative (e.g. devin_)"
            value={alias0}
            onChange={e => setAlias0(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <input
            className="settings-input"
            placeholder="Second alternative (e.g. devin__)"
            value={alias1}
            onChange={e => setAlias1(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <input
            className="settings-input"
            placeholder="Third alternative (e.g. devin___)"
            value={alias2}
            onChange={e => setAlias2(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <Button size="sm" onClick={saveAliases}>
          {aliasesSaved ? '✓ Saved' : 'Save Aliases'}
        </Button>
      </div>

      <style>{tabStyles}</style>
    </div>
  );
}

type StoreDensity = 'cozy' | 'compact' | 'spacious';

function AppearanceTab() {
  const [systemMotion] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  const messageDensity    = useOnyxStore(s => s.messageDensity);
  const setMessageDensity = useOnyxStore(s => s.setMessageDensity);
  const activeTheme       = useOnyxStore(s => s.activeTheme);
  const setTheme          = useOnyxStore(s => s.setTheme);
  const fontSize          = useOnyxStore(s => s.fontSize);
  const setFontSize       = useOnyxStore(s => s.setFontSize);
  const reducedMotion     = useOnyxStore(s => s.reducedMotion);
  const setReducedMotion  = useOnyxStore(s => s.setReducedMotion);

  const densityOptions: { value: StoreDensity; label: string; desc: string }[] = [
    { value: 'cozy',      label: 'Cozy',      desc: 'Default spacing, comfortable reading' },
    { value: 'compact',   label: 'Compact',   desc: 'Reduced padding, more messages visible' },
    { value: 'spacious',  label: 'Spacious',  desc: 'Extra breathing room between messages' },
  ];

  return (
    <div className="tab-body">
      <h2 className="tab-title">Appearance</h2>

      {/* Theme */}
      <div className="settings-section">
        <h3 className="settings-section-title">Theme</h3>
        <div className="ap-theme-grid">
          <button
            className={`ap-theme-card ${activeTheme === 'ocean' ? 'ap-theme-card--active' : ''}`}
            onClick={() => setTheme('ocean')}
            aria-pressed={activeTheme === 'ocean'}
          >
            <div className="ap-theme-preview ap-theme-preview--dark" aria-hidden />
            <div className="ap-theme-label">Dark</div>
            {activeTheme === 'ocean' && <span className="ap-theme-check">✓</span>}
          </button>

          <button
            className="ap-theme-card ap-theme-card--disabled"
            disabled
            aria-disabled="true"
            title="Coming soon"
          >
            <div className="ap-theme-preview ap-theme-preview--light" aria-hidden />
            <div className="ap-theme-label">Light</div>
            <span className="ap-theme-soon">Soon</span>
          </button>
        </div>
      </div>

      {/* Message density */}
      <div className="settings-section">
        <h3 className="settings-section-title">Message Density</h3>
        <div className="ap-density-list">
          {densityOptions.map(opt => (
            <button
              key={opt.value}
              className={`ap-density-item ${messageDensity === opt.value ? 'ap-density-item--active' : ''}`}
              onClick={() => setMessageDensity(opt.value)}
              aria-pressed={messageDensity === opt.value}
            >
              <div className="ap-density-dot" aria-hidden />
              <div>
                <div className="ap-density-name">{opt.label}</div>
                <div className="ap-density-desc">{opt.desc}</div>
              </div>
              {messageDensity === opt.value && <span className="ap-check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div className="settings-section">
        <h3 className="settings-section-title">Font Size</h3>
        <div className="ap-font-row">
          <span className="ap-font-label-sm">A</span>
          <input
            type="range"
            min={12}
            max={20}
            step={2}
            value={fontSize}
            className="ap-slider"
            aria-label="Font size"
            onChange={e => setFontSize(Number(e.target.value))}
          />
          <span className="ap-font-label-lg">A</span>
          <span className="ap-font-value">{fontSize}px</span>
        </div>
      </div>

      {/* Reduce motion */}
      <div className="settings-section">
        <h3 className="settings-section-title">Accessibility</h3>
        <div className="ap-toggle-row">
          <div>
            <div className="ap-toggle-label">Reduce motion</div>
            <div className="ap-toggle-desc">
              {systemMotion
                ? 'Your system has reduced motion enabled. Override below.'
                : 'Disable animations and transitions.'}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={reducedMotion}
            className={`ap-toggle ${reducedMotion ? 'ap-toggle--on' : ''}`}
            onClick={() => setReducedMotion(!reducedMotion)}
            aria-label="Reduce motion"
          >
            <span className="ap-toggle-thumb" aria-hidden />
          </button>
        </div>
      </div>

      <style>{tabStyles}</style>
      <style>{`
        .ap-theme-grid {
          display: flex;
          gap: 12px;
        }
        .ap-theme-card {
          flex: 1;
          max-width: 140px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px;
          border-radius: var(--r-lg);
          border: 2px solid var(--border-normal);
          background: var(--bg-elevated);
          cursor: pointer;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          position: relative;
          font-family: inherit;
        }
        .ap-theme-card:hover:not(.ap-theme-card--disabled) {
          border-color: var(--accent-border);
          background: var(--bg-overlay);
          transform: translateY(-1px);
        }
        .ap-theme-card--active {
          border-color: var(--accent) !important;
          background: var(--accent-subtle) !important;
        }
        .ap-theme-card--disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .ap-theme-preview {
          width: 80px; height: 52px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.08);
        }
        .ap-theme-preview--dark {
          background: linear-gradient(135deg, #07070a 0%, #0e0e14 50%, #1a1a2e 100%);
        }
        .ap-theme-preview--light {
          background: linear-gradient(135deg, #f5f5f7 0%, #e8e8ed 100%);
        }
        .ap-theme-label {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
        }
        .ap-theme-check {
          position: absolute; top: 8px; right: 8px;
          font-size: 12px; font-weight: 700; color: var(--accent);
        }
        .ap-theme-soon {
          position: absolute; top: 8px; right: 8px;
          font-size: 10px; font-weight: 700;
          background: var(--bg-overlay); color: var(--text-muted);
          padding: 2px 6px; border-radius: 999px;
        }

        .ap-density-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ap-density-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: var(--r-md);
          border: 1.5px solid var(--border-normal);
          background: var(--bg-elevated);
          cursor: pointer;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          font-family: inherit;
          text-align: left;
        }
        .ap-density-item:hover {
          border-color: var(--accent-border);
          background: var(--bg-overlay);
          transform: translateY(-1px);
        }
        .ap-density-item--active {
          border-color: var(--accent) !important;
          background: var(--accent-subtle) !important;
        }
        .ap-density-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--text-muted); flex-shrink: 0;
        }
        .ap-density-item--active .ap-density-dot { background: var(--accent); }
        .ap-density-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .ap-density-desc { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
        .ap-check {
          margin-left: auto;
          font-size: 14px; font-weight: 700; color: var(--accent);
        }

        .ap-font-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          border-radius: var(--r-md);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
        }
        .ap-font-label-sm { font-size: 12px; color: var(--text-muted); font-weight: 600; }
        .ap-font-label-lg { font-size: 18px; color: var(--text-secondary); font-weight: 600; }
        .ap-font-value {
          font-size: 12px; font-weight: 700; color: var(--accent);
          min-width: 32px; text-align: right;
        }
        .ap-slider {
          flex: 1;
          accent-color: var(--accent);
          cursor: pointer;
        }

        .ap-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .ap-toggle-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .ap-toggle-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }

        .ap-toggle {
          width: 44px; height: 24px;
          border-radius: 999px;
          border: none;
          background: var(--bg-overlay);
          cursor: pointer;
          position: relative;
          border: 1px solid var(--border-subtle);
          flex-shrink: 0;
          padding: 0;
        }
        .ap-toggle--on { background: var(--accent); }
        .ap-toggle-thumb {
          position: absolute;
          top: 3px; left: 3px;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: var(--text-primary);
          box-shadow: 0 1px 3px rgba(0,0,0,0.35);
          transition: transform var(--t-normal, 260ms) var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
          display: block;
        }
        .ap-toggle--on .ap-toggle-thumb { transform: translateX(20px); }
      `}</style>
    </div>
  );
}

function VoiceToggle({ on, onToggle, label, description }: {
  on: boolean;
  onToggle: () => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="vt-row">
      <div className="vt-row-text">
        <div className="vt-row-label">{label}</div>
        {description && <div className="vt-row-desc">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        className={`vt-toggle ${on ? 'vt-toggle--on' : ''}`}
        onClick={onToggle}
        aria-label={label}
      >
        <span className="vt-toggle-thumb" aria-hidden />
      </button>
    </div>
  );
}

function VoiceTab() {
  const voice            = useOnyxStore(s => s.voice);
  const setVoiceState    = useOnyxStore(s => s.setVoiceCallState);

  // Device lists
  const [audioInputs,  setAudioInputs]  = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs,  setVideoInputs]  = useState<MediaDeviceInfo[]>([]);
  const [permError,    setPermError]    = useState(false);

  // Mic level meter
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const rafRef           = useRef<number>(0);
  const testStreamRef    = useRef<MediaStream | null>(null);
  const [testing,        setTesting]    = useState(false);
  const testTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PTT binding
  const [pttListening, setPttListening] = useState(false);

  const enumerate = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter(d => d.kind === 'audioinput'));
      setAudioOutputs(devices.filter(d => d.kind === 'audiooutput'));
      setVideoInputs(devices.filter(d => d.kind === 'videoinput'));
      setPermError(false);
    } catch {
      setPermError(true);
    }
  }, []);

  // Enumerate on mount; if labels are blank the user hasn't granted mic yet
  useEffect(() => {
    enumerate().then(() => {
      // If first device has no label, we need permission
      navigator.mediaDevices.enumerateDevices().then(devs => {
        const first = devs.find(d => d.kind === 'audioinput');
        if (first && !first.label) setPermError(true);
      }).catch(() => setPermError(true));
    });
  }, [enumerate]);

  // Load PTT key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('ocean-ptt-key');
    if (saved && !voice.pushToTalkKey) {
      setVoiceState({ pushToTalkKey: saved });
    }
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Level meter draw loop
  const startMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const canvas = canvasRef.current;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!canvas) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, (avg / 128) * 100);

      const c = canvas.getContext('2d');
      if (!c) return;
      c.clearRect(0, 0, canvas.width, canvas.height);
      const barW = (canvas.width * pct) / 100;
      if (barW > 0) {
        const grad = c.createLinearGradient(0, 0, canvas.width, 0);
        grad.addColorStop(0,   '#0ea5e9');
        grad.addColorStop(0.7, '#0ea5e9');
        grad.addColorStop(1,   '#e05454');
        c.fillStyle = grad;
        c.fillRect(0, 0, barW, canvas.height);
      }
    };
    draw();
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (analyserRef.current) {
      (analyserRef.current.context as AudioContext).close().catch(() => {});
      analyserRef.current = null;
    }
  }, []);

  const stopTest = useCallback(() => {
    setTesting(false);
    stopMeter();
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(t => t.stop());
      testStreamRef.current = null;
    }
    if (testTimerRef.current) {
      clearTimeout(testTimerRef.current);
      testTimerRef.current = null;
    }
    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const c = canvas.getContext('2d');
      c?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [stopMeter]);

  const startTest = useCallback(async () => {
    if (testing) { stopTest(); return; }
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: voice.inputDeviceId ? { exact: voice.inputDeviceId } : undefined,
          noiseSuppression: voice.noiseSuppression,
          echoCancellation: voice.echoCancellation,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;
      setTesting(true);
      setPermError(false);
      // Re-enumerate now that we have permission
      await enumerate();
      startMeter(stream);
      testTimerRef.current = setTimeout(stopTest, 5000);
    } catch {
      setPermError(true);
    }
  }, [testing, voice.inputDeviceId, voice.noiseSuppression, voice.echoCancellation, enumerate, startMeter, stopTest]);

  // Cleanup on unmount
  useEffect(() => () => { stopTest(); }, [stopTest]);

  // PTT key capture
  useEffect(() => {
    if (!pttListening) return;

    const capture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const parts: string[] = [];
      if (e.ctrlKey  && e.code !== 'ControlLeft'  && e.code !== 'ControlRight')  parts.push('Ctrl');
      if (e.shiftKey && e.code !== 'ShiftLeft'    && e.code !== 'ShiftRight')    parts.push('Shift');
      if (e.altKey   && e.code !== 'AltLeft'      && e.code !== 'AltRight')      parts.push('Alt');
      if (e.metaKey  && e.code !== 'MetaLeft'     && e.code !== 'MetaRight')     parts.push('Meta');

      // Ignore bare modifiers
      const modifierCodes = ['ControlLeft','ControlRight','ShiftLeft','ShiftRight','AltLeft','AltRight','MetaLeft','MetaRight'];
      if (modifierCodes.includes(e.code)) return;

      parts.push(e.code);
      const keyStr = parts.join('+');

      setVoiceState({ pushToTalkKey: keyStr });
      localStorage.setItem('ocean-ptt-key', keyStr);
      setPttListening(false);
    };

    document.addEventListener('keydown', capture, true);
    return () => document.removeEventListener('keydown', capture, true);
  }, [pttListening, setVoiceState]);

  const formatKeyCode = (code: string): string => {
    const map: Record<string, string> = {
      Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Escape: 'Esc',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Tab: 'Tab', CapsLock: 'Caps',
    };
    if (map[code]) return map[code];
    if (code.startsWith('Key'))    return code.slice(3);
    if (code.startsWith('Digit'))  return code.slice(5);
    if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
    if (code.startsWith('F') && !isNaN(Number(code.slice(1)))) return code;
    return code;
  };

  const formatPttKey = (raw: string | null): string => {
    if (!raw) return 'None';
    return raw.split('+').map(part => {
      if (part === 'Ctrl' || part === 'Shift' || part === 'Alt' || part === 'Meta') return part;
      return formatKeyCode(part);
    }).join(' + ');
  };

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPermError(false);
      await enumerate();
    } catch {
      // Permission denied — stay in error state
    }
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Voice &amp; Audio</h2>

      {permError && (
        <div className="vt-perm-banner">
          <span className="vt-perm-icon">🎙</span>
          <div>
            <div className="vt-perm-title">Microphone access required</div>
            <div className="vt-perm-desc">Allow microphone access to configure input and output devices.</div>
          </div>
          <button className="vt-perm-btn" onClick={requestMicPermission}>Allow Access</button>
        </div>
      )}

      {/* Input Device */}
      <div className="settings-section">
        <h3 className="settings-section-title">Microphone</h3>
        <div className="vt-device-row">
          <select
            className="vt-select"
            value={voice.inputDeviceId ?? ''}
            onChange={e => setVoiceState({ inputDeviceId: e.target.value || null })}
            disabled={audioInputs.length === 0}
          >
            <option value="">Default</option>
            {audioInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
          <button className="vt-icon-btn" onClick={enumerate} title="Refresh devices" aria-label="Refresh device list">
            ↻
          </button>
        </div>

        <div className="vt-meter-row">
          <span className="vt-meter-label">Level</span>
          <div className="vt-meter-track">
            <canvas ref={canvasRef} className="vt-meter-canvas" width={260} height={12} />
          </div>
          <button
            className={`vt-test-btn ${testing ? 'vt-test-btn--active' : ''}`}
            onClick={startTest}
          >
            {testing ? 'Stop Test' : 'Test Mic'}
          </button>
        </div>
      </div>

      {/* Output Device */}
      <div className="settings-section">
        <h3 className="settings-section-title">Speaker / Headphones</h3>
        <div className="vt-device-row">
          <select
            className="vt-select"
            value={voice.outputDeviceId ?? ''}
            onChange={e => setVoiceState({ outputDeviceId: e.target.value || null })}
            disabled={audioOutputs.length === 0}
          >
            <option value="">Default</option>
            {audioOutputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
        <div className="vt-slider-row">
          <span className="vt-slider-label">Output Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={voice.outputVolume}
            className="vt-slider"
            aria-label="Output volume"
            onChange={e => setVoiceState({ outputVolume: Number(e.target.value) })}
          />
          <span className="vt-slider-value">{voice.outputVolume}%</span>
        </div>
      </div>

      {/* VAD */}
      <div className="settings-section">
        <h3 className="settings-section-title">Voice Activity Detection</h3>
        <VoiceToggle
          on={voice.vadEnabled}
          onToggle={() => setVoiceState({ vadEnabled: !voice.vadEnabled })}
          label="Voice Activity Detection"
          description="Automatically transmit when you speak, stay silent otherwise."
        />
        {voice.vadEnabled && (
          <div className="vt-slider-row" style={{ marginTop: 8 }}>
            <span className="vt-slider-label">Sensitivity</span>
            <div className="vt-sensitivity-group">
              {(['low', 'medium', 'high'] as const).map(s => (
                <button
                  key={s}
                  className={`vt-sens-btn ${voice.vadSensitivity === s ? 'vt-sens-btn--active' : ''}`}
                  onClick={() => setVoiceState({ vadSensitivity: s })}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Push to Talk */}
      <div className="settings-section">
        <h3 className="settings-section-title">Push to Talk</h3>
        <VoiceToggle
          on={voice.pushToTalk}
          onToggle={() => setVoiceState({ pushToTalk: !voice.pushToTalk })}
          label="Push to Talk"
          description="Hold a key to unmute. Overrides Voice Activity Detection."
        />
        {voice.pushToTalk && (
          <div className="vt-ptt-row">
            <div className="vt-ptt-key">
              <span className="vt-ptt-key-label">Shortcut</span>
              <span className="vt-ptt-key-value">{formatPttKey(voice.pushToTalkKey)}</span>
            </div>
            <button
              className={`vt-ptt-bind-btn ${pttListening ? 'vt-ptt-bind-btn--listening' : ''}`}
              onClick={() => setPttListening(l => !l)}
            >
              {pttListening ? 'Press any key…' : 'Change Key'}
            </button>
            {pttListening && (
              <button className="vt-ptt-cancel" onClick={() => setPttListening(false)}>Cancel</button>
            )}
          </div>
        )}
      </div>

      {/* Noise suppression + Echo cancellation */}
      <div className="settings-section">
        <h3 className="settings-section-title">Audio Processing</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <VoiceToggle
            on={voice.noiseSuppression}
            onToggle={() => setVoiceState({ noiseSuppression: !voice.noiseSuppression })}
            label="Noise Suppression"
            description="Reduces background noise during calls."
          />
          <VoiceToggle
            on={voice.echoCancellation}
            onToggle={() => setVoiceState({ echoCancellation: !voice.echoCancellation })}
            label="Echo Cancellation"
            description="Prevents your speaker audio from feeding back into your mic."
          />
        </div>
      </div>

      {/* Video */}
      <div className="settings-section">
        <h3 className="settings-section-title">Video</h3>
        <div className="vt-device-row">
          <select
            className="vt-select"
            value={voice.cameraDeviceId ?? ''}
            onChange={e => setVoiceState({ cameraDeviceId: e.target.value || null })}
            disabled={videoInputs.length === 0}
          >
            <option value="">Default camera</option>
            {videoInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
        <div className="vt-info-banner">
          <span className="vt-info-icon">🔒</span>
          Video is transmitted over the encrypted LADON protocol. No third-party relay servers are used.
        </div>
      </div>

      <style>{tabStyles}</style>
      <style>{`
        .vt-perm-banner {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px;
          background: var(--danger-subtle);
          border: 1px solid color-mix(in srgb, var(--danger) 34%, transparent);
          border-radius: var(--r-md);
          margin-bottom: 4px;
        }
        .vt-perm-icon { font-size: 20px; flex-shrink: 0; }
        .vt-perm-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .vt-perm-desc  { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .vt-perm-btn {
          margin-left: auto; flex-shrink: 0;
          padding: 6px 14px; border-radius: var(--r-sm);
          background: var(--accent); color: var(--text-primary);
          border: none; cursor: pointer; font-size: 13px; font-weight: 600;
          font-family: inherit;
          transition: opacity var(--t-fast, 150ms) var(--ease-out, ease), transform var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .vt-perm-btn:hover { opacity: 0.88; transform: translateY(-1px); }

        .vt-device-row {
          display: flex; align-items: center; gap: 8px;
        }
        .vt-select {
          flex: 1;
          height: 36px;
          padding: 0 12px; border-radius: var(--r-md);
          background: var(--bg-deep); border: 1px solid var(--border-normal);
          color: var(--text-primary); font-size: 13px; font-family: inherit;
          cursor: pointer;
          transition: filter var(--t-fast, 150ms) var(--ease-out, ease);
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23888' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          padding-right: 28px;
        }
        .vt-select:focus {
          outline: none;
          border-color: var(--accent-border);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
        }
        .vt-select:disabled { opacity: 0.45; cursor: not-allowed; }

        .vt-icon-btn {
          width: 34px; height: 34px; flex-shrink: 0;
          border-radius: var(--r-sm); border: 1px solid var(--border-subtle);
          background: var(--bg-void); color: var(--text-secondary);
          cursor: pointer; font-size: 16px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          font-family: inherit;
        }
        .vt-icon-btn:hover { background: var(--bg-elevated); color: var(--text-primary); transform: translateY(-1px); }

        .vt-meter-row {
          display: flex; align-items: center; gap: 10px; margin-top: 8px;
        }
        .vt-meter-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--text-muted); width: 34px; flex-shrink: 0;
        }
        .vt-meter-track {
          flex: 1; height: 12px;
          background: var(--bg-void); border-radius: 6px;
          border: 1px solid var(--border-subtle);
          overflow: hidden;
        }
        .vt-meter-canvas { display: block; width: 100%; height: 100%; }

        .vt-test-btn {
          flex-shrink: 0;
          padding: 5px 12px; border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-void); color: var(--text-secondary);
          cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .vt-test-btn:hover { border-color: var(--accent-border); color: var(--text-primary); transform: translateY(-1px); }
        .vt-test-btn--active {
          background: var(--danger-subtle);
          border-color: color-mix(in srgb, var(--danger) 42%, transparent);
          color: var(--danger);
        }

        .vt-slider-row {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px;
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .vt-slider-label {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
          white-space: nowrap; min-width: 104px;
        }
        .vt-slider {
          flex: 1; accent-color: var(--accent); cursor: pointer;
          height: 4px;
        }
        .vt-slider-value {
          font-size: 12px; font-weight: 700; color: var(--accent);
          min-width: 36px; text-align: right;
        }

        .vt-row {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 12px 14px;
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .vt-row-text { flex: 1; min-width: 0; }
        .vt-row-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .vt-row-desc  { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }

        .vt-toggle {
          width: 44px; height: 24px; border-radius: 999px;
          border: none; background: var(--bg-overlay);
          cursor: pointer; position: relative; flex-shrink: 0;
          border: 1px solid var(--border-subtle);
          padding: 0;
        }
        .vt-toggle--on { background: var(--accent); }
        .vt-toggle-thumb {
          position: absolute; top: 3px; left: 3px;
          width: 18px; height: 18px; border-radius: 50%;
          background: var(--text-primary);
          box-shadow: 0 1px 3px rgba(0,0,0,0.35);
          transition: transform var(--t-normal, 260ms) var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
          display: block;
        }
        .vt-toggle--on .vt-toggle-thumb { transform: translateX(20px); }

        .vt-sensitivity-group {
          display: flex; gap: 4px;
        }
        .vt-sens-btn {
          padding: 5px 14px; border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-void); color: var(--text-secondary);
          cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .vt-sens-btn:hover { border-color: var(--accent-border); color: var(--text-primary); transform: translateY(-1px); }
        .vt-sens-btn--active {
          background: var(--accent-subtle);
          border-color: var(--accent);
          color: var(--accent);
        }

        .vt-ptt-row {
          display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap;
        }
        .vt-ptt-key {
          flex: 1; display: flex; align-items: center; gap: 8px;
          padding: 8px 12px;
          background: var(--bg-void); border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
        }
        .vt-ptt-key-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--text-muted);
        }
        .vt-ptt-key-value {
          font-size: 13px; font-weight: 700; color: var(--text-primary);
          font-family: ui-monospace, monospace;
          background: var(--bg-elevated); padding: 2px 8px; border-radius: 4px;
          border: 1px solid var(--border-subtle);
        }
        .vt-ptt-bind-btn {
          padding: 7px 14px; border-radius: var(--r-sm);
          border: 1px solid var(--accent-border);
          background: var(--accent-subtle); color: var(--accent);
          cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease); white-space: nowrap;
        }
        .vt-ptt-bind-btn:hover { background: var(--accent); color: var(--text-primary); transform: translateY(-1px); }
        .vt-ptt-bind-btn--listening {
          background: var(--accent); color: var(--text-primary);
          animation: vt-pulse 1.2s ease-in-out infinite;
        }
        @keyframes vt-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
        .vt-ptt-cancel {
          padding: 7px 12px; border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: none; color: var(--text-muted);
          cursor: pointer; font-size: 12px; font-family: inherit;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .vt-ptt-cancel:hover { color: var(--text-primary); border-color: var(--border-normal); transform: translateY(-1px); }

        .vt-info-banner {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 12px 14px; margin-top: 8px;
          background: var(--accent-subtle); border-radius: var(--r-md);
          border: 1px solid var(--accent-border);
          font-size: 12px; color: var(--text-secondary); line-height: 1.5;
        }
        .vt-info-icon { flex-shrink: 0; font-size: 14px; }

        @media (prefers-reduced-motion: reduce) {
          .vt-perm-btn,
          .vt-select,
          .vt-icon-btn,
          .vt-test-btn,
          .vt-toggle-thumb,
          .vt-sens-btn,
          .vt-ptt-bind-btn,
          .vt-ptt-cancel {
            transition: none;
          }
          .vt-perm-btn:hover,
          .vt-icon-btn:hover,
          .vt-test-btn:hover,
          .vt-sens-btn:hover,
          .vt-ptt-bind-btn:hover,
          .vt-ptt-cancel:hover {
            transform: none;
          }
          .vt-ptt-bind-btn--listening {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function NotificationsTab() {
  const channelNotify                   = useOnyxStore(s => s.channelNotify);
  const setChannelNotify                = useOnyxStore(s => s.setChannelNotify);
  const desktopEnabled                  = useOnyxStore(s => s.pushNotificationsEnabled);
  const setDesktopEnabled               = useOnyxStore(s => s.setPushNotificationsEnabled);
  const soundEnabled                    = useOnyxStore(s => s.soundEnabled);
  const setSoundEnabled                 = useOnyxStore(s => s.setSoundEnabled);

  // ── Read / write localStorage prefs ─────────────────────────────────────
  const [notifLevel, setNotifLevel] = useState<'all' | 'mentions' | 'none'>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = localStorage.getItem('ocean-notif-level');
    if (stored === 'mentions' || stored === 'none') return stored;
    return 'all';
  });

  // Permission state
  const [permState, setPermState] = useState<NotificationPermission>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    return Notification.permission;
  });

  const toggleDesktop = async () => {
    if (!desktopEnabled) {
      // Enabling — request permission if needed
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        setPermState(result);
        if (result !== 'granted') return; // don't enable if denied
      }
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermState(Notification.permission);
      }
      setDesktopEnabled(true);
    } else {
      setDesktopEnabled(false);
    }
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      // Preview the sound immediately
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch { /* ignore */ }
    }
  };

  const changeLevel = (level: 'all' | 'mentions' | 'none') => {
    localStorage.setItem('ocean-notif-level', level);
    setNotifLevel(level);
  };

  // Per-channel overrides — only entries with non-default values
  const overrides = [...channelNotify.entries()];

  const permLabel =
    permState === 'granted' ? 'Granted' :
    permState === 'denied'  ? 'Blocked by browser' :
    'Not yet requested';

  return (
    <div className="tab-body">
      <h2 className="tab-title">Notifications</h2>

      {/* ── Global controls ── */}
      <div className="settings-section">
        <h3 className="settings-section-title">Global Controls</h3>

        {/* Desktop notifications toggle */}
        <div className="nt-toggle-row">
          <div className="nt-toggle-text">
            <div className="nt-toggle-label">Desktop Notifications</div>
            <div className="nt-toggle-desc">
              Show a system notification for mentions and DMs when Ocean is in the background.
              {' '}<span className={`nt-perm-badge nt-perm-badge--${permState}`}>{permLabel}</span>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={desktopEnabled}
            className={`nt-toggle ${desktopEnabled ? 'nt-toggle--on' : ''}`}
            onClick={toggleDesktop}
            aria-label="Desktop notifications"
          >
            <span className="nt-toggle-thumb" aria-hidden />
          </button>
        </div>

        {/* Sound toggle */}
        <div className="nt-toggle-row">
          <div className="nt-toggle-text">
            <div className="nt-toggle-label">Sound Effects</div>
            <div className="nt-toggle-desc">Play a subtle ping sound when you receive a mention or DM.</div>
          </div>
          <button
            role="switch"
            aria-checked={soundEnabled}
            className={`nt-toggle ${soundEnabled ? 'nt-toggle--on' : ''}`}
            onClick={toggleSound}
            aria-label="Sound effects"
          >
            <span className="nt-toggle-thumb" aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Notification level ── */}
      <div className="settings-section">
        <h3 className="settings-section-title">Notification Level</h3>
        <p className="settings-hint">Default level for all channels. Override per channel below.</p>
        <div className="nt-radio-group" role="radiogroup" aria-label="Notification level">
          {([
            { value: 'all',      label: 'All Messages',     desc: 'Notify for every message' },
            { value: 'mentions', label: 'Mentions & DMs only', desc: 'Only notify when someone mentions you or sends a DM' },
            { value: 'none',     label: 'Nothing',          desc: 'Silence all notifications (badge counts still update)' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              role="radio"
              aria-checked={notifLevel === opt.value}
              className={`nt-radio-item ${notifLevel === opt.value ? 'nt-radio-item--active' : ''}`}
              onClick={() => changeLevel(opt.value)}
            >
              <span className="nt-radio-dot" aria-hidden />
              <div>
                <div className="nt-radio-label">{opt.label}</div>
                <div className="nt-radio-desc">{opt.desc}</div>
              </div>
              {notifLevel === opt.value && <span className="nt-radio-check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Per-channel overrides ── */}
      <div className="settings-section">
        <h3 className="settings-section-title">Channel Overrides</h3>
        {overrides.length === 0 ? (
          <div className="nt-empty-state">
            <span className="nt-empty-icon">🔔</span>
            <p className="nt-empty-text">No channel overrides. All channels follow the global level.</p>
          </div>
        ) : (
          <div className="nt-overrides-table">
            {overrides.map(([channel, level]) => (
              <div key={channel} className="nt-override-row">
                <span className="nt-ch-pill"># {channel}</span>
                <select
                  className="nt-level-select"
                  value={level}
                  onChange={e => setChannelNotify(channel, e.target.value as 'all' | 'mentions' | 'none')}
                  aria-label={`Notification level for ${channel}`}
                >
                  <option value="all">All Messages</option>
                  <option value="mentions">Mentions Only</option>
                  <option value="none">Muted</option>
                </select>
                <button
                  className="nt-remove-btn"
                  onClick={() => setChannelNotify(channel, 'all')}
                  aria-label={`Remove override for ${channel}`}
                  title="Remove override"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{tabStyles}</style>
      <style>{`
        .nt-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 14px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .nt-toggle-text { flex: 1; min-width: 0; }
        .nt-toggle-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .nt-toggle-desc  { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.5; }

        .nt-perm-badge {
          display: inline-block;
          font-size: 10px; font-weight: 700;
          padding: 1px 6px; border-radius: 999px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .nt-perm-badge--granted  { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
        .nt-perm-badge--denied   { background: var(--danger-subtle); color: var(--danger); }
        .nt-perm-badge--default  { background: var(--bg-overlay); color: var(--text-muted); }

        .nt-toggle {
          width: 44px; height: 24px;
          border-radius: 999px; border: none;
          background: var(--bg-overlay);
          cursor: pointer; position: relative;
          border: 1px solid var(--border-subtle);
          flex-shrink: 0; padding: 0;
        }
        .nt-toggle--on { background: var(--accent); }
        .nt-toggle-thumb {
          position: absolute; top: 3px; left: 3px;
          width: 18px; height: 18px; border-radius: 50%;
          background: var(--text-primary);
          box-shadow: 0 1px 3px rgba(0,0,0,0.35);
          transition: transform var(--t-normal, 260ms) var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
          display: block;
        }
        .nt-toggle--on .nt-toggle-thumb { transform: translateX(20px); }

        .nt-radio-group {
          display: flex; flex-direction: column; gap: 4px;
        }
        .nt-radio-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; border-radius: var(--r-md);
          border: 1.5px solid var(--border-normal);
          background: var(--bg-elevated); cursor: pointer;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          font-family: inherit; text-align: left;
        }
        .nt-radio-item:hover {
          border-color: var(--accent-border);
          background: var(--bg-overlay);
          transform: translateY(-1px);
        }
        .nt-radio-item--active {
          border-color: var(--accent) !important;
          background: var(--accent-subtle) !important;
        }
        .nt-radio-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--text-muted); flex-shrink: 0;
        }
        .nt-radio-item--active .nt-radio-dot { background: var(--accent); }
        .nt-radio-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .nt-radio-desc  { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
        .nt-radio-check {
          margin-left: auto; font-size: 14px; font-weight: 700; color: var(--accent);
        }

        .nt-empty-state {
          display: flex; align-items: center; gap: 10px;
          padding: 16px 14px;
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px dashed var(--border-normal);
        }
        .nt-empty-icon { font-size: 18px; flex-shrink: 0; opacity: 0.5; }
        .nt-empty-text { font-size: 13px; color: var(--text-muted); line-height: 1.5; }

        .nt-overrides-table {
          display: flex; flex-direction: column; gap: 4px;
        }
        .nt-override-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .nt-ch-pill {
          font-size: 13px; font-weight: 600; color: var(--accent);
          background: var(--accent-subtle);
          padding: 2px 8px; border-radius: var(--r-full);
          flex: 1; min-width: 0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .nt-level-select {
          padding: 5px 8px; border-radius: var(--r-sm);
          background: var(--bg-void); border: 1px solid var(--border-subtle);
          color: var(--text-primary); font-size: 12px; font-family: inherit;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath fill='%23888' d='M0 0l4 5 4-5z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
          padding-right: 22px;
        }
        .nt-level-select:focus { outline: none; border-color: var(--accent-border); }
        .nt-remove-btn {
          width: 24px; height: 24px; flex-shrink: 0;
          border-radius: 50%; border: none;
          background: var(--bg-overlay); color: var(--text-muted);
          cursor: pointer; font-size: 16px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          font-family: inherit; padding: 0;
        }
        .nt-remove-btn:hover {
          background: var(--danger-subtle); color: var(--danger);
          transform: scale(1.04);
        }

        @media (prefers-reduced-motion: reduce) {
          .nt-toggle-thumb,
          .nt-radio-item,
          .nt-remove-btn {
            transition: none;
          }
          .nt-radio-item:hover,
          .nt-remove-btn:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

// ── Shared toggle row component ────────────────────────────────────────────────

function SettingsToggle({ on, onToggle, label, description, disabled }: {
  on: boolean;
  onToggle: () => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`st-toggle-row${disabled ? ' st-toggle-row--disabled' : ''}`}>
      <div className="st-toggle-text">
        <div className="st-toggle-label">{label}</div>
        {description && <div className="st-toggle-desc">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        disabled={disabled}
        className={`st-toggle ${on ? 'st-toggle--on' : ''}`}
        onClick={onToggle}
        aria-label={label}
      >
        <span className="st-toggle-thumb" aria-hidden />
      </button>
    </div>
  );
}

const sharedToggleStyles = `
  .st-toggle-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px 14px;
    background: var(--bg-elevated); border-radius: var(--r-md);
    border: 1px solid var(--border-subtle);
  }
  .st-toggle-row--disabled { opacity: 0.45; pointer-events: none; }
  .st-toggle-text { flex: 1; min-width: 0; }
  .st-toggle-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .st-toggle-desc  { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.5; }
  .st-toggle {
    width: 44px; height: 24px;
    border-radius: 999px; border: none;
    background: var(--bg-overlay);
    cursor: pointer; position: relative;
    border: 1px solid var(--border-subtle);
    flex-shrink: 0; padding: 0;
  }
  .st-toggle:disabled { cursor: not-allowed; }
  .st-toggle--on { background: var(--accent); }
  .st-toggle-thumb {
    position: absolute; top: 3px; left: 3px;
    width: 18px; height: 18px; border-radius: 50%;
    background: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0,0,0,0.35);
    transition: transform var(--t-normal, 260ms) var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
    display: block;
  }
  .st-toggle--on .st-toggle-thumb { transform: translateX(20px); }

  @media (prefers-reduced-motion: reduce) {
    .st-toggle-thumb {
      transition: none;
    }
  }
`;

// ── Accessibility Tab ──────────────────────────────────────────────────────────

function AccessibilityTab() {
  const reduceMotion        = useOnyxStore(s => s.reduceMotion);
  const setReduceMotion     = useOnyxStore(s => s.setReduceMotion);
  const highContrast        = useOnyxStore(s => s.highContrastMode);
  const setHighContrast     = useOnyxStore(s => s.setHighContrastMode);
  const compactMemberList   = useOnyxStore(s => s.compactMemberList);
  const setCompactMemberList = useOnyxStore(s => s.setCompactMemberList);
  const messageDensity      = useOnyxStore(s => s.messageDensity);
  const setMessageDensity   = useOnyxStore(s => s.setMessageDensity);
  const openKeyboardShortcuts = useOnyxStore(s => s.openKeyboardShortcuts);

  const handleReduceMotion = (v: boolean) => {
    setReduceMotion(v);
    if (typeof document !== 'undefined') {
      if (v) document.documentElement.setAttribute('data-reduce-motion', 'true');
      else   document.documentElement.removeAttribute('data-reduce-motion');
    }
  };

  const handleHighContrast = (v: boolean) => {
    setHighContrast(v);
    if (typeof document !== 'undefined') {
      if (v) document.documentElement.setAttribute('data-high-contrast', 'true');
      else   document.documentElement.removeAttribute('data-high-contrast');
    }
  };

  const densityOptions: { value: 'cozy' | 'compact' | 'spacious'; label: string; desc: string }[] = [
    { value: 'cozy',      label: 'Cozy',      desc: 'Default spacing, comfortable reading' },
    { value: 'compact',   label: 'Compact',   desc: 'Reduced padding, more messages visible' },
    { value: 'spacious',  label: 'Spacious',  desc: 'Extra breathing room between messages' },
  ];

  return (
    <div className="tab-body">
      <h2 className="tab-title">Accessibility</h2>

      <div className="settings-section">
        <h3 className="settings-section-title">Motion & Visual</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SettingsToggle
            on={reduceMotion}
            onToggle={() => handleReduceMotion(!reduceMotion)}
            label="Reduce Motion"
            description="Disables animations and transitions. Sets data-reduce-motion on the document."
          />
          <SettingsToggle
            on={highContrast}
            onToggle={() => handleHighContrast(!highContrast)}
            label="High Contrast"
            description="Strengthens border and text contrast for improved readability."
          />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Message Density</h3>
        <div className="acc-density-list">
          {densityOptions.map(opt => (
            <button
              key={opt.value}
              className={`acc-density-item ${messageDensity === opt.value ? 'acc-density-item--active' : ''}`}
              onClick={() => setMessageDensity(opt.value)}
              aria-pressed={messageDensity === opt.value}
            >
              <span className="acc-density-dot" aria-hidden />
              <div>
                <div className="acc-density-name">{opt.label}</div>
                <div className="acc-density-desc">{opt.desc}</div>
              </div>
              {messageDensity === opt.value && <span className="acc-check">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Layout</h3>
        <SettingsToggle
          on={compactMemberList}
          onToggle={() => setCompactMemberList(!compactMemberList)}
          label="Compact Member List"
          description="Shows smaller avatars and tighter spacing in the member sidebar."
        />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Keyboard</h3>
        <div className="acc-shortcut-banner">
          <div className="acc-shortcut-icon" aria-hidden>⌨</div>
          <div className="acc-shortcut-text">
            <div className="acc-shortcut-title">Keyboard Shortcuts</div>
            <div className="acc-shortcut-desc">Ocean supports keyboard navigation throughout the interface.</div>
          </div>
          <button className="acc-shortcut-btn" onClick={openKeyboardShortcuts}>
            View Shortcuts
          </button>
        </div>
      </div>

      <style>{tabStyles}</style>
      <style>{sharedToggleStyles}</style>
      <style>{`
        .acc-density-list { display: flex; flex-direction: column; gap: 4px; }
        .acc-density-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; border-radius: var(--r-md);
          border: 1.5px solid var(--border-normal);
          background: var(--bg-elevated); cursor: pointer;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          font-family: inherit; text-align: left;
        }
        .acc-density-item:hover { border-color: var(--accent-border); background: var(--bg-overlay); transform: translateY(-1px); }
        .acc-density-item--active { border-color: var(--accent) !important; background: var(--accent-subtle) !important; }
        .acc-density-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
        .acc-density-item--active .acc-density-dot { background: var(--accent); }
        .acc-density-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .acc-density-desc { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
        .acc-check { margin-left: auto; font-size: 14px; font-weight: 700; color: var(--accent); }

        .acc-shortcut-banner {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px;
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .acc-shortcut-icon { font-size: 20px; flex-shrink: 0; color: var(--accent); }
        .acc-shortcut-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .acc-shortcut-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }
        .acc-shortcut-btn {
          margin-left: auto; flex-shrink: 0;
          padding: 6px 14px; border-radius: var(--r-sm);
          background: var(--accent-subtle); color: var(--accent);
          border: 1px solid var(--accent-border); cursor: pointer;
          font-size: 13px; font-weight: 600; font-family: inherit;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
        }
        .acc-shortcut-btn:hover { background: var(--accent); color: var(--text-primary); transform: translateY(-1px); }

        @media (prefers-reduced-motion: reduce) {
          .acc-density-item,
          .acc-shortcut-btn {
            transition: none;
          }
          .acc-density-item:hover,
          .acc-shortcut-btn:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

// ── Developer Tab ──────────────────────────────────────────────────────────────

function DeveloperTab() {
  const devMode         = useOnyxStore(s => s.devMode);
  const setDevMode      = useOnyxStore(s => s.setDevMode);
  const rawLogEnabled   = useOnyxStore(s => s.rawLogEnabled);
  const setRawLogEnabled = useOnyxStore(s => s.setRawLogEnabled);
  const showRawLog      = useOnyxStore(s => s.showRawLog);
  const toggleRawLog    = useOnyxStore(s => s.toggleRawLog);

  const exportDebugLog = () => {
    const state = useOnyxStore.getState();
    const snapshot = {
      ourNick: state.ourNick,
      server: state.server,
      devMode: state.devMode,
      streamerMode: state.streamerMode,
      reduceMotion: state.reduceMotion,
      highContrastMode: state.highContrastMode,
      compactMemberList: state.compactMemberList,
      messageDensity: state.messageDensity,
      rawLogEnabled: state.rawLogEnabled,
      channels: [...state.channels.keys()],
      activeView: state.activeView,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ocean-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Developer</h2>

      <div className="settings-section">
        <h3 className="settings-section-title">Developer Mode</h3>
        <SettingsToggle
          on={devMode}
          onToggle={() => setDevMode(!devMode)}
          label="Developer Mode"
          description="Enables extra debug panels, raw IRC log capture, and verbose state info."
        />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">IRC Log</h3>
        <p className="settings-hint">
          Capture and inspect every raw line sent to and received from the server.
          Use{' '}
          <code style={{ fontSize: 12, padding: '1px 5px', background: 'var(--bg-elevated)', borderRadius: 4 }}>
            /raw
          </code>{' '}
          in any chat input to toggle the panel.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="settings-row">
            <label className="dev-checkbox-row">
              <input
                type="checkbox"
                checked={rawLogEnabled}
                disabled={!devMode}
                onChange={e => setRawLogEnabled(e.target.checked)}
              />
              <span>Show raw IRC messages</span>
            </label>
          </div>
          <div className="settings-row">
            <Button
              size="sm"
              variant={showRawLog ? 'ghost' : 'secondary'}
              onClick={toggleRawLog}
              disabled={!rawLogEnabled || !devMode}
            >
              {showRawLog ? 'Hide Log Panel' : 'Show Log Panel'}
            </Button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Export</h3>
        <p className="settings-hint">
          Downloads a JSON snapshot of current Ocean store state for debugging. No passwords or keys are included.
        </p>
        <Button size="sm" variant="secondary" onClick={exportDebugLog}>
          Export Debug Log
        </Button>
      </div>

      <style>{tabStyles}</style>
      <style>{sharedToggleStyles}</style>
      <style>{`
        .dev-checkbox-row {
          display: flex; align-items: center; gap: 8px;
          cursor: pointer; font-size: 14px; color: var(--text-primary);
          user-select: none;
        }
        .dev-checkbox-row input[type="checkbox"] {
          width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent);
        }
      `}</style>
    </div>
  );
}

// ── Streamer Mode Tab ─────────────────────────────────────────────────────────

function StreamerModeTab() {
  const streamerMode         = useOnyxStore(s => s.streamerMode);
  const setStreamerMode      = useOnyxStore(s => s.setStreamerMode);
  const blurLinks            = useOnyxStore(s => s.streamerModeBlurLinks);
  const setBlurLinks         = useOnyxStore(s => s.setStreamerModeBlurLinks);

  const handleStreamerMode = (v: boolean) => {
    setStreamerMode(v);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-streamer-mode', v ? 'true' : 'false');
    }
  };

  return (
    <div className="tab-body">
      <h2 className="tab-title">Streamer Mode</h2>

      <div className="sm-info-banner">
        <span className="sm-info-icon">📡</span>
        <p className="sm-info-text">
          Streamer Mode hides sensitive information when you&apos;re broadcasting. Toggle it on before you go live.
        </p>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Master Toggle</h3>
        <SettingsToggle
          on={streamerMode}
          onToggle={() => handleStreamerMode(!streamerMode)}
          label="Streamer Mode"
          description="Hides IP addresses, server names, and join/part events from view."
        />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Options</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SettingsToggle
            on={blurLinks}
            onToggle={() => setBlurLinks(!blurLinks)}
            label="Blur External Links"
            description="Blurs URLs in chat so they are not visible on stream. Hover to reveal."
            disabled={!streamerMode}
          />
          <SettingsToggle
            on={streamerMode}
            onToggle={() => handleStreamerMode(!streamerMode)}
            label="Hide Server Names / IPs"
            description="Masks the server URL and network name wherever they appear."
            disabled={!streamerMode}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">OBS Detection</h3>
        <div className="sm-obs-note">
          <span className="sm-obs-icon">ℹ</span>
          <p className="sm-obs-text">
            Streamer Mode automatically activates OBS detection — Ocean will watch for OBS
            window focus events and can toggle this mode on when you switch to your stream layout.
            This feature is informational only and does not require additional setup.
          </p>
        </div>
      </div>

      <style>{tabStyles}</style>
      <style>{sharedToggleStyles}</style>
      <style>{`
        .sm-info-banner {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 14px 16px;
          background: var(--accent-subtle); border-radius: var(--r-md);
          border: 1px solid var(--accent-border);
        }
        .sm-info-icon { font-size: 20px; flex-shrink: 0; }
        .sm-info-text { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0; }

        .sm-obs-note {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px;
          background: var(--bg-elevated); border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .sm-obs-icon {
          font-size: 14px; font-weight: 700; color: var(--text-muted);
          flex-shrink: 0; margin-top: 1px;
        }
        .sm-obs-text { font-size: 12px; color: var(--text-muted); line-height: 1.6; margin: 0; }
      `}</style>
    </div>
  );
}

function AdvancedTab() {
  const server          = useOnyxStore(s => s.server);
  const client          = useOnyxStore(s => s.client);
  const rawLogEnabled   = useOnyxStore(s => s.rawLogEnabled);
  const showRawLog      = useOnyxStore(s => s.showRawLog);
  const setRawLogEnabled = useOnyxStore(s => s.setRawLogEnabled);
  const toggleRawLog    = useOnyxStore(s => s.toggleRawLog);
  const ignoredUsers    = useOnyxStore(s => s.ignoredUsers);
  const ignoreUser      = useOnyxStore(s => s.ignoreUser);
  const unignoreUser    = useOnyxStore(s => s.unignoreUser);

  const [addIgnoreInput, setAddIgnoreInput] = useState('');

  const hasHistory  = client?.negotiatedCaps?.has('draft/chathistory') || client?.negotiatedCaps?.has('chathistory');
  const hasExtended = client?.isupport.IRCX;
  const hasVoice    = !!client?.isupport.LADONMEDIA;

  return (
    <div className="tab-body">
      <h2 className="tab-title">Advanced</h2>
      <div className="settings-section">
        <h3 className="settings-section-title">Connection</h3>
        <div className="kv-list">
          <div className="kv-row"><span>Server</span><code>{server?.url ?? '—'}</code></div>
          <div className="kv-row"><span>Network</span><code>{server?.network ?? '—'}</code></div>
        </div>
      </div>
      <div className="settings-section">
        <h3 className="settings-section-title">Server Capabilities</h3>
        <div className="kv-list">
          <div className="kv-row"><span>Message history</span><code>{hasHistory ? '✓ Enabled' : '—'}</code></div>
          <div className="kv-row"><span>Extended channel features</span><code>{hasExtended ? '✓ Enabled' : '—'}</code></div>
          <div className="kv-row"><span>Voice &amp; video</span><code>{hasVoice ? '✓ Enabled' : '—'}</code></div>
        </div>
      </div>
      <div className="settings-section">
        <h3 className="settings-section-title">Ignored Users</h3>
        <p className="settings-hint">Messages from ignored users will not appear in channels. DMs will show a placeholder.</p>
        {ignoredUsers.size === 0 ? (
          <div className="ign-empty">
            <span className="ign-empty-icon">🔔</span>
            <span className="ign-empty-text">No ignored users.</span>
          </div>
        ) : (
          <div className="ign-chip-list">
            {[...ignoredUsers].map(nick => (
              <div key={nick} className="ign-chip">
                <span className="ign-chip-nick">{nick}</span>
                <button
                  className="ign-chip-remove"
                  onClick={() => unignoreUser(nick)}
                  aria-label={`Unignore ${nick}`}
                  title={`Unignore ${nick}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="settings-row" style={{ marginTop: 8 }}>
          <input
            className="settings-input"
            placeholder="Add a nick to ignore…"
            value={addIgnoreInput}
            onChange={e => setAddIgnoreInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && addIgnoreInput.trim()) {
                ignoreUser(addIgnoreInput.trim());
                setAddIgnoreInput('');
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (addIgnoreInput.trim()) {
                ignoreUser(addIgnoreInput.trim());
                setAddIgnoreInput('');
              }
            }}
            disabled={!addIgnoreInput.trim()}
          >
            Ignore
          </Button>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Raw IRC Log</h3>
        <p className="settings-hint">
          Capture and inspect every raw line sent to and received from the server.
          Use <code style={{ fontSize: 12, padding: '1px 5px', background: 'var(--bg-elevated)', borderRadius: 4 }}>/raw</code> in any chat input to toggle the panel.
        </p>
        <div className="settings-row">
          <label className="adv-toggle-row">
            <input
              type="checkbox"
              checked={rawLogEnabled}
              onChange={e => setRawLogEnabled(e.target.checked)}
            />
            <span>Enable raw log capture</span>
          </label>
        </div>
        <div className="settings-row">
          <Button
            size="sm"
            variant={showRawLog ? 'ghost' : 'secondary'}
            onClick={toggleRawLog}
            disabled={!rawLogEnabled}
          >
            {showRawLog ? 'Hide Log Panel' : 'Show Log Panel'}
          </Button>
        </div>
      </div>

      <CTCPSettingsSection />
      <style>{`
        .adv-toggle-row {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 14px;
          color: var(--text-primary);
          user-select: none;
        }
        .adv-toggle-row input[type="checkbox"] {
          width: 16px; height: 16px; cursor: pointer;
          accent-color: var(--accent);
        }

        .ign-empty {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          border: 1px dashed var(--border-normal);
          font-size: 13px;
        }
        .ign-empty-icon { font-size: 16px; opacity: 0.5; }
        .ign-empty-text { color: var(--text-muted); }

        .ign-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .ign-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px 4px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-full);
          font-size: 13px;
        }
        .ign-chip-nick {
          color: var(--text-secondary);
          font-weight: 600;
        }
        .ign-chip-remove {
          width: 20px; height: 20px;
          border-radius: 50%; border: none;
          background: var(--bg-overlay); color: var(--text-muted);
          cursor: pointer; font-size: 14px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          transition: transform var(--t-fast, 150ms) var(--ease-out, ease), filter var(--t-fast, 150ms) var(--ease-out, ease), opacity var(--t-fast, 150ms) var(--ease-out, ease);
          font-family: inherit; padding: 0;
        }
        .ign-chip-remove:hover {
          background: var(--danger-subtle); color: var(--danger);
          transform: scale(1.04);
        }

        @media (prefers-reduced-motion: reduce) {
          .ign-chip-remove {
            transition: none;
          }
          .ign-chip-remove:hover {
            transform: none;
          }
        }
      `}</style>
      <style>{tabStyles}</style>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const tabStyles = `
  .tab-body { display: flex; flex-direction: column; gap: 24px; padding-right: 4px; }

  .tab-title {
    font-size: 24px; font-weight: 800; color: var(--text-primary);
    letter-spacing: 0; line-height: 1.15;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-normal);
  }

  .settings-section {
    display: flex; flex-direction: column; gap: 12px;
    padding-top: 2px;
  }

  .settings-section-title {
    font-size: 10.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--gold);
    display: flex; align-items: center; gap: 10px;
    padding-bottom: 1px;
  }
  .settings-section-title::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(to right, var(--border-subtle), transparent);
  }

  .settings-hint {
    font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;
    margin: 0;
  }

  .settings-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

  .settings-input {
    flex: 1; min-width: 180px;
    height: 38px;
    padding: 0 13px; border-radius: var(--r-md, 8px);
    background: var(--bg-base, #0c1828); border: 1px solid var(--border-normal);
    color: var(--text-primary); font-size: 13.5px; font-family: inherit;
    transition: filter var(--t-fast, 150ms) var(--ease-out, ease);
    box-sizing: border-box;
  }
  .settings-input:hover { filter: brightness(1.05); }
  .settings-input:focus {
    outline: none;
    border-color: var(--accent, #0ea5e9);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #0ea5e9) 16%, transparent);
    filter: none;
  }
  .settings-input::placeholder { color: var(--text-muted); }
  .settings-textarea {
    resize: vertical; min-height: 64px; height: auto;
    padding: 8px 12px; line-height: 1.55;
  }

  .profile-row {
    display: flex; align-items: center; gap: 20px;
    padding: 18px 20px;
    background: linear-gradient(135deg, var(--bg-float), var(--bg-elevated));
    border-radius: var(--r-lg, 12px);
    border: 1px solid var(--accent-border);
    box-shadow: var(--shadow-sm);
  }
  .profile-nick { font-size: 20px; font-weight: 700; color: var(--text-primary); }
  .profile-account { font-size: 13px; color: var(--accent); margin-top: 2px; font-weight: 500; }
  .profile-server { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

  .cmd-list { display: flex; flex-direction: column; gap: 6px; }
  .cmd-list code {
    font-size: 12.5px; padding: 7px 10px; display: block;
    background: var(--bg-elevated); border-radius: var(--r-sm);
    border: 1px solid var(--border-subtle);
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    color: var(--text-secondary);
  }

  .theme-swatch { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--bg-elevated); border-radius: var(--r-lg); }
  .theme-swatch-preview { width: 48px; height: 48px; border-radius: var(--r-md); background: linear-gradient(135deg, #06101d 0%, #0ea5e9 100%); flex-shrink: 0; }
  .theme-swatch-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .theme-badge { margin-left: auto; background: var(--accent-subtle); color: var(--accent); font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: var(--r-full); flex-shrink: 0; }

  .kv-list { display: flex; flex-direction: column; gap: 6px; }
  .kv-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 12px;
    background: var(--bg-base); border-radius: var(--r-md);
    border: 1px solid var(--border-normal);
    font-size: 13px; color: var(--text-secondary);
  }
  .kv-row code {
    font-size: 12px; font-family: ui-monospace, monospace;
    background: var(--bg-base); padding: 1px 6px; border-radius: 4px;
    color: var(--accent);
  }

  .settings-alias-inputs { display: flex; flex-direction: column; gap: 8px; }
  .settings-alias-inputs .settings-input { min-width: unset; flex: unset; width: 100%; }
  .settings-alias-notice { color: var(--warning, #fbbf24); font-weight: 600; }

  .settings-content button:focus-visible,
  .settings-content select:focus-visible,
  .settings-content input:focus-visible,
  .settings-content textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-input {
      transition: none;
    }
    .settings-input:hover {
      filter: none;
    }
  }
`;

// ── Icons ──────────────────────────────────────────────────────────────────────
function UserIcon()          { return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 13s-1 0-1-1 1-4 7-4 7 3 7 4-1 1-1 1H1z"/></svg>; }
function PaletteIcon()       { return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 0a7 7 0 1 0 0 14A7 7 0 0 0 7 0zm0 13a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm2.5-8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>; }
function VoiceIcon()         { return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z"/><path d="M3 7a4 4 0 0 0 8 0" strokeLinecap="round"/></svg>; }
function BellIcon()          { return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M8 13.5H6a1 1 0 0 0 2 0zM7 0a5 5 0 0 0-5 5v3.5L.5 10.5h13L12 8.5V5a5 5 0 0 0-5-5z"/></svg>; }
function CodeIcon()          { return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 7.5l3.147-3.146zm2.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L11.293 7.5 8.146 4.354z"/></svg>; }
function GearIcon()          { return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM5.5 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/><path fillRule="evenodd" d="M7 0a1 1 0 0 1 .95.684l.45 1.35a5.1 5.1 0 0 1 .9.52l1.4-.35a1 1 0 0 1 1.07.46l1 1.73a1 1 0 0 1-.18 1.22l-1.05.95a5.1 5.1 0 0 1 0 1.04l1.05.95a1 1 0 0 1 .18 1.22l-1 1.73a1 1 0 0 1-1.07.46l-1.4-.35a5.1 5.1 0 0 1-.9.52l-.45 1.35A1 1 0 0 1 7 14a1 1 0 0 1-.95-.684l-.45-1.35a5.1 5.1 0 0 1-.9-.52l-1.4.35a1 1 0 0 1-1.07-.46l-1-1.73a1 1 0 0 1 .18-1.22l1.05-.95a5.1 5.1 0 0 1 0-1.04l-1.05-.95a1 1 0 0 1-.18-1.22l1-1.73a1 1 0 0 1 1.07-.46l1.4.35a5.1 5.1 0 0 1 .9-.52L6.05.684A1 1 0 0 1 7 0z"/></svg>; }
function AccessibilityIcon() { return <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="2" r="1.5"/><path d="M7 4.5C4.5 4.5 2 5.5 2 6.5h10C12 5.5 9.5 4.5 7 4.5zM4.5 8l-.5 4h1l.5-2.5.5 1 .5-1L7 12l.5-2.5.5 1 .5-1L9 12h1l-.5-4h-5z"/></svg>; }
function StreamerIcon()      { return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2" width="12" height="8" rx="1.5"/><path d="M4 12h6M7 10v2" strokeLinecap="round"/><circle cx="9.5" cy="5" r="1" fill="currentColor" stroke="none"/><path d="M5 5.5h2.5" strokeLinecap="round"/></svg>; }
