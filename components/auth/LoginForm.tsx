'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useOnyxStore } from '@/lib/store';
import FormField from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getAuthSecret,
  type SavedCredentials,
} from '@/lib/credentials';

interface Props {
  onSwitch: () => void;
}

interface RecentServer {
  url: string;
  nick: string;
  label?: string;
}

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me:8080';

const SERVER_PRESETS = [
  { label: 'eshmaki.me', url: process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me:8080' },
  { label: 'Custom', url: '' },
];

const NICK_INVALID_RE = /[^a-zA-Z0-9\-_\[\]{}\\|`^]/;

function loadRecentServers(): RecentServer[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('ocean-recent-servers');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as RecentServer[]).slice(0, 3);
  } catch {
    return [];
  }
}

function saveRecentServer(entry: RecentServer) {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadRecentServers();
    const filtered = existing.filter(s => s.url !== entry.url);
    const next = [entry, ...filtered].slice(0, 3);
    localStorage.setItem('ocean-recent-servers', JSON.stringify(next));
  } catch {
    // ignore
  }
}

function loadSavedNick(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('ocean-saved-nick') ?? '';
  } catch {
    return '';
  }
}

const CONNECTION_STEPS = ['Connecting…', 'Authenticating…', 'Loading channels…'];

export default function LoginForm({ onSwitch }: Props) {
  const connect       = useOnyxStore(s => s.connect);
  const status        = useOnyxStore(s => s.status);
  const notifications = useOnyxStore(s => s.notifications);

  const [nick,          setNick]          = useState('');
  const [password,      setPassword]      = useState('');
  const [server,        setServer]        = useState(DEFAULT_SERVER);
  const [advanced,      setAdvanced]      = useState(false);
  const [error,         setError]         = useState('');
  const [rememberMe,    setRememberMe]    = useState(false);
  const [recentServers, setRecentServers] = useState<RecentServer[]>([]);
  const [connStep,      setConnStep]      = useState(0);
  const [activePreset,  setActivePreset]  = useState<string>('eshmaki.me');

  // Saved credentials — null means none stored
  const [savedCreds,    setSavedCreds]    = useState<SavedCredentials | null>(null);
  // true = the "Continue as…" card is shown, false = full form
  const [autoMode,      setAutoMode]      = useState(false);

  // ── Load saved credentials and recent servers on mount ──────────────────────
  useEffect(() => {
    const creds = loadCredentials();
    if (creds) {
      setSavedCreds(creds);
      setAutoMode(true);
      // Pre-fill form fields in case user dismisses the card
      setNick(creds.nick);
      setServer(creds.server);
      setRememberMe(true);
      // Don't pre-fill password — it would appear in the visible input
    }
    setRecentServers(loadRecentServers());
  }, []);

  // ── Auto-connect handler ────────────────────────────────────────────────────
  const handleAutoConnect = useCallback(() => {
    if (!savedCreds) return;
    setError('');
    connect({
      url:      savedCreds.server,
      nick:     savedCreds.nick,
      password: getAuthSecret(savedCreds),
    });
  }, [savedCreds, connect]);

  // ── Forget saved credentials ────────────────────────────────────────────────
  const handleForget = () => {
    clearCredentials();
    setSavedCreds(null);
    setAutoMode(false);
    setNick('');
    setPassword('');
    setServer(DEFAULT_SERVER);
    setRememberMe(false);
  };

  // Connection step animation
  useEffect(() => {
    if (status !== 'connecting') {
      setConnStep(0);
      return;
    }
    const interval = setInterval(() => {
      setConnStep(s => (s + 1) % CONNECTION_STEPS.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [status]);

  // Save recent server on successful connection
  useEffect(() => {
    if (status === 'connected') {
      saveRecentServer({ url: server.trim(), nick: nick.trim() });
      setRecentServers(loadRecentServers());
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastError = notifications.filter(n => n.type === 'error').at(-1);

  const nickInvalid  = nick.length > 0 && NICK_INVALID_RE.test(nick);
  const nickTooLong  = nick.length > 30;
  const nickHasSpace = nick.includes(' ');
  const nickError    = nickHasSpace
    ? 'Nickname cannot contain spaces'
    : nickInvalid
    ? 'Invalid characters in nickname'
    : nickTooLong
    ? 'Nickname too long (max 30)'
    : '';

  const handlePreset = (preset: typeof SERVER_PRESETS[number]) => {
    if (preset.url) {
      setServer(preset.url);
      setActivePreset(preset.label);
      setAdvanced(false);
    } else {
      setActivePreset('Custom');
      setAdvanced(true);
    }
  };

  const handleRecentClick = (recent: RecentServer) => {
    setNick(recent.nick);
    setServer(recent.url);
    const match = SERVER_PRESETS.find(p => p.url === recent.url);
    setActivePreset(match ? match.label : 'Custom');
    if (!match) setAdvanced(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nick.trim())   { setError('Nickname is required'); return; }
    if (nickError)      { setError(nickError); return; }
    if (!server.trim()) { setError('Server URL is required'); return; }
    setError('');

    if (rememberMe) {
      saveCredentials({
        nick:     nick.trim(),
        server:   server.trim(),
        password: password || undefined,
      });
    } else {
      clearCredentials();
    }

    connect({ url: server.trim(), nick: nick.trim(), password: password || undefined });
  };

  const loading = status === 'connecting';

  // ── Auto-reconnect card ─────────────────────────────────────────────────────
  if (autoMode && savedCreds && !loading) {
    const host = savedCreds.server.replace(/^wss?:\/\//, '').replace(/[/:].*/,'');
    const hasToken = Boolean(savedCreds.sessionToken);
    return (
      <div className="auto-reconnect">
        <div className="arc-avatar" aria-hidden="true">
          {savedCreds.nick.slice(0, 2).toUpperCase()}
        </div>
        <div className="arc-info">
          <span className="arc-nick">{savedCreds.nick}</span>
          <span className="arc-server">{host}</span>
          {hasToken && (
            <span className="arc-token-badge">Session token active</span>
          )}
        </div>
        <div className="arc-actions">
          <Button variant="primary" fullWidth onClick={handleAutoConnect}>
            Connect
          </Button>
          <button
            type="button"
            className="arc-switch"
            onClick={() => setAutoMode(false)}
          >
            Use different account
          </button>
          <button
            type="button"
            className="arc-forget"
            onClick={handleForget}
          >
            Forget me
          </button>
        </div>

        <style>{`
          .auto-reconnect {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            padding: 8px 0;
          }
          .arc-avatar {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--accent), var(--accent-hover));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            font-weight: 700;
            color: var(--bg-void);
            box-shadow: 0 0 0 3px var(--bg-elevated), 0 0 0 5px var(--accent-border);
            letter-spacing: -0.02em;
          }
          .arc-info {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            text-align: center;
          }
          .arc-nick {
            font-size: 20px;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.01em;
          }
          .arc-server {
            font-size: 13px;
            color: var(--text-muted);
          }
          .arc-token-badge {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.04em;
            color: var(--success);
            background: rgba(52,211,153,0.1);
            border: 1px solid rgba(52,211,153,0.25);
            border-radius: 4px;
            padding: 2px 8px;
            margin-top: 2px;
          }
          .arc-actions {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .arc-switch {
            background: none;
            border: none;
            font-family: inherit;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
            text-align: center;
            padding: 4px;
            transition: color var(--t-fast);
          }
          .arc-switch:hover { color: var(--text-primary); }
          .arc-forget {
            background: none;
            border: none;
            font-family: inherit;
            font-size: 12px;
            color: var(--text-muted);
            cursor: pointer;
            text-align: center;
            padding: 2px;
            transition: color var(--t-fast);
          }
          .arc-forget:hover { color: var(--danger); }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="auth-form-fields">

      {/* Recent servers */}
      {recentServers.length > 0 && (
        <div className="recent-servers">
          <span className="recent-label">Recent</span>
          <div className="recent-list">
            {recentServers.map((r, i) => (
              <button
                key={i}
                type="button"
                className="recent-chip"
                onClick={() => handleRecentClick(r)}
                disabled={loading}
              >
                <span className="recent-nick">{r.nick}</span>
                <span className="recent-url">{r.label ?? r.url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nick field */}
      <FormField label="Username" required>
        <div className="nick-wrap">
          <input
            type="text"
            placeholder="your_nick"
            value={nick}
            onChange={e => setNick(e.target.value)}
            autoComplete="username"
            autoFocus
            maxLength={32}
            className={`onyx-input${nickError ? ' onyx-input--error' : ''}`}
            disabled={loading}
          />
          <span className={`nick-count ${nick.length > 25 ? 'nick-count--warn' : ''} ${nick.length > 30 ? 'nick-count--error' : ''}`}>
            {nick.length}/30
          </span>
        </div>
        {nickError && <span className="field-hint field-hint--error">{nickError}</span>}
      </FormField>

      {/* Password field */}
      <FormField label="Password" hint="Leave blank to join as a guest">
        <div className="password-wrap">
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            className="onyx-input"
            disabled={loading}
          />
          {password.length > 0 && (
            <span className="sasl-badge">SASL PLAIN</span>
          )}
        </div>
      </FormField>

      {/* Remember me */}
      <label className="remember-row">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={e => setRememberMe(e.target.checked)}
          className="remember-checkbox"
          disabled={loading}
        />
        <span className="remember-text">Remember me</span>
      </label>

      {/* Server presets */}
      <div className="preset-row">
        <span className="preset-label">Server</span>
        <div className="preset-chips">
          {SERVER_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              className={`preset-chip ${activePreset === p.label ? 'preset-chip--active' : ''}`}
              onClick={() => handlePreset(p)}
              disabled={loading}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced / custom server */}
      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setAdvanced(a => !a)}
      >
        <span className={`advanced-arrow ${advanced ? 'open' : ''}`}>▸</span>
        Custom server URL
      </button>

      {advanced && (
        <FormField label="Server URL">
          <input
            type="text"
            placeholder="wss://server/gateway"
            value={server}
            onChange={e => { setServer(e.target.value); setActivePreset('Custom'); }}
            className="onyx-input"
            disabled={loading}
          />
        </FormField>
      )}

      {(error || lastError) && (
        <div className="auth-error">
          {error || lastError?.text}
        </div>
      )}

      {/* Connection animation */}
      {loading && (
        <div className="conn-anim">
          <div className="conn-pulse" />
          <span className="conn-step">{CONNECTION_STEPS[connStep]}</span>
          <div className="conn-dots">
            {CONNECTION_STEPS.map((_, i) => (
              <span key={i} className={`conn-dot ${i <= connStep ? 'conn-dot--active' : ''}`} />
            ))}
          </div>
        </div>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading}>
        {loading ? CONNECTION_STEPS[connStep] : 'Sign In'}
      </Button>

      <p className="switch-link">
        New here?{' '}
        <button type="button" className="link-btn" onClick={onSwitch}>
          Create an account
        </button>
      </p>

      <style>{`
        .auth-form-fields { display: flex; flex-direction: column; gap: 16px; }

        /* ── Inputs ── */
        .onyx-input {
          width: 100%;
          padding: 10px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          color: var(--text-primary);
          font-size: 15px;
          font-family: inherit;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
          box-sizing: border-box;
        }
        .onyx-input:focus {
          outline: none;
          border-color: var(--accent-border);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }
        .onyx-input:disabled { opacity: 0.5; cursor: not-allowed; }
        .onyx-input--error {
          border-color: rgba(248,113,113,0.5);
        }
        .onyx-input--error:focus {
          box-shadow: 0 0 0 3px rgba(248,113,113,0.15);
        }

        .field-hint { display: block; font-size: 12px; margin-top: 4px; }
        .field-hint--error { color: var(--danger); }

        /* ── Nick wrap ── */
        .nick-wrap { position: relative; }
        .nick-wrap .onyx-input { padding-right: 52px; }
        .nick-count {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          color: var(--text-muted);
          pointer-events: none;
          font-variant-numeric: tabular-nums;
        }
        .nick-count--warn { color: var(--gold); }
        .nick-count--error { color: var(--danger); }

        /* ── Password wrap + SASL badge ── */
        .password-wrap { position: relative; }
        .sasl-badge {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: var(--gold);
          background: var(--gold-subtle);
          border: 1px solid rgba(103,232,249,0.25);
          border-radius: 4px;
          padding: 2px 6px;
          pointer-events: none;
        }
        .password-wrap .onyx-input { padding-right: 96px; }

        /* ── Remember me ── */
        .remember-row {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          user-select: none;
        }
        .remember-checkbox {
          width: 15px;
          height: 15px;
          accent-color: var(--accent);
          cursor: pointer;
        }
        .remember-text {
          font-size: 13px;
          color: var(--text-secondary);
        }

        /* ── Recent servers ── */
        .recent-servers {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .recent-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .recent-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .recent-chip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          cursor: pointer;
          transition: border-color var(--t-fast), background var(--t-fast);
          text-align: left;
          font-family: inherit;
        }
        .recent-chip:hover {
          border-color: var(--accent-border);
          background: var(--accent-subtle);
        }
        .recent-chip:disabled { opacity: 0.4; cursor: not-allowed; }
        .recent-nick {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }
        .recent-url {
          font-size: 12px;
          color: var(--text-muted);
        }

        /* ── Server presets ── */
        .preset-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .preset-label {
          font-size: 13px;
          color: var(--text-secondary);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .preset-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .preset-chip {
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          border: 1px solid var(--border-normal);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          transition: all var(--t-fast);
        }
        .preset-chip:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
        }
        .preset-chip--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .preset-chip:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── Advanced toggle ── */
        .advanced-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          transition: color var(--t-fast);
          align-self: flex-start;
          font-family: inherit;
        }
        .advanced-toggle:hover { color: var(--text-primary); }
        .advanced-arrow {
          display: inline-block;
          transition: transform var(--t-fast);
          font-size: 11px;
        }
        .advanced-arrow.open { transform: rotate(90deg); }

        /* ── Error ── */
        .auth-error {
          padding: 10px 14px;
          background: var(--danger-subtle);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: var(--r-md);
          color: var(--danger);
          font-size: 13px;
        }

        /* ── Connection animation ── */
        .conn-anim {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-md);
        }
        .conn-pulse {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
          animation: conn-pulse-anim 1.2s ease-in-out infinite;
        }
        @keyframes conn-pulse-anim {
          0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 var(--accent-glow); }
          50% { opacity: 0.6; transform: scale(0.85); box-shadow: 0 0 0 5px transparent; }
        }
        .conn-step {
          font-size: 13px;
          color: var(--accent);
          font-weight: 500;
          flex: 1;
        }
        .conn-dots {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .conn-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--border-normal);
          transition: background var(--t-fast);
        }
        .conn-dot--active { background: var(--accent); }

        /* ── Footer links ── */
        .switch-link {
          text-align: center;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .link-btn {
          color: var(--accent);
          background: none;
          border: none;
          cursor: pointer;
          font-size: inherit;
          font-family: inherit;
        }
        .link-btn:hover { text-decoration: underline; }
      `}</style>
    </form>
  );
}
