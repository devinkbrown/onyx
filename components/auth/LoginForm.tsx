'use client';

import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
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

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me:8080';

const NICK_INVALID_RE = /[^a-zA-Z0-9\-_\[\]{}\\|`^]/;

const CONNECTION_STEPS = ['Connecting…', 'Authenticating…', 'Loading channels…'];

// ── SVG Icons ────────────────────────────────────────────────────────────────

function IconServer() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="14" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="1" y="9" width="14" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="12.5" cy="4.5" r="1" fill="currentColor" />
      <circle cx="12.5" cy="11.5" r="1" fill="currentColor" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M2.5 13.5C2.5 11.015 5.015 9 8 9s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="10.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function IconEye({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M6.5 4.2C7 4.07 7.5 4 8 4c3.5 0 6 4 6 4s-.65 1.1-1.8 2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        <path d="M4.2 5.7C2.9 6.8 2 8 2 8s2.5 4 6 4c.9 0 1.75-.24 2.5-.64" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        <path d="M6.5 9.4A2 2 0 009.4 6.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="spin-icon">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
      <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function LoginForm({ onSwitch }: Props) {
  const connect       = useOnyxStore(s => s.connect);
  const status        = useOnyxStore(s => s.status);
  const notifications = useOnyxStore(s => s.notifications);

  const [nick,          setNick]          = useState('');
  const [password,      setPassword]      = useState('');
  const [showPassword,  setShowPassword]  = useState(false);
  const [error,         setError]         = useState('');
  const [shake,         setShake]         = useState(false);
  const [rememberMe,    setRememberMe]    = useState(false);
  const [connStep,      setConnStep]      = useState(0);
  const [connectAttempted, setConnectAttempted] = useState(false);

  const nickRef = useRef<HTMLInputElement>(null);

  const [savedCreds,    setSavedCreds]    = useState<SavedCredentials | null>(null);
  const [autoMode,      setAutoMode]      = useState(false);

  // Auto-focus nick field on mount
  useEffect(() => {
    nickRef.current?.focus();
  }, []);

  // Load saved credentials on mount. Do not connect until the user clicks
  // Connect; otherwise a stale URL/token can create a WebSocket error loop
  // before the user has taken any action.
  useEffect(() => {
    const creds = loadCredentials();
    if (creds) {
      setSavedCreds(creds);
      setAutoMode(true);
      setNick(creds.nick);
      setRememberMe(true);
    }
  }, []);

  const handleAutoConnect = useCallback(() => {
    if (!savedCreds) return;
    setError('');
    setConnectAttempted(true);
    // Always use DEFAULT_SERVER so stale saved URLs don't break reconnect
    connect({
      url:      DEFAULT_SERVER,
      nick:     savedCreds.nick,
      password: getAuthSecret(savedCreds),
    });
  }, [savedCreds, connect]);

  const handleForget = () => {
    clearCredentials();
    setSavedCreds(null);
    setAutoMode(false);
    setNick('');
    setPassword('');
    setRememberMe(false);
    setConnectAttempted(false);
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

  const loading = status === 'connecting';
  const lastError = notifications.filter(n => n.type === 'error').at(-1);
  const visibleLastError = connectAttempted && !loading ? lastError : undefined;

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

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nick.trim())   { setError('Nickname is required'); triggerShake(); return; }
    if (nickError)      { setError(nickError); triggerShake(); return; }
    setError('');

    if (rememberMe) {
      saveCredentials({
        nick:     nick.trim(),
        server:   DEFAULT_SERVER,
        password: password || undefined,
      });
    } else {
      clearCredentials();
    }

    setConnectAttempted(true);
    connect({ url: DEFAULT_SERVER, nick: nick.trim(), password: password || undefined });
  };

  const hasError = Boolean(error || visibleLastError);

  // ── Auto-reconnect card ─────────────────────────────────────────────────────
  if (autoMode && savedCreds) {
    return (
      <div className="auto-reconnect">
        <div className="arc-brand" aria-hidden="true">
          <span className="arc-brand-line" />
          <span className="arc-brand-text">Ocean access</span>
          <span className="arc-brand-line" />
        </div>
        <div className="arc-avatar" aria-hidden="true">
          {savedCreds.nick.slice(0, 2).toUpperCase()}
        </div>
        <div className="arc-info">
          <span className="arc-nick">{savedCreds.nick}</span>
          <span className="arc-server">eshmaki.me</span>
        </div>
        {visibleLastError && (
          <div className="arc-error" role="alert">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{flexShrink:0,marginTop:1}}>
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M7 4v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="7" cy="10" r="0.8" fill="currentColor" />
            </svg>
            {visibleLastError.text}
          </div>
        )}

        <div className="arc-actions">
          {loading ? (
            <div className="arc-connecting">
              <IconSpinner />
              <span>{CONNECTION_STEPS[connStep]}</span>
            </div>
          ) : (
            <Button variant="primary" fullWidth onClick={handleAutoConnect} className="arc-primary">
              {visibleLastError ? 'Retry' : 'Connect'}
            </Button>
          )}
          <button
            type="button"
            className="arc-switch"
            onClick={() => {
              setAutoMode(false);
              setConnectAttempted(false);
            }}
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
            gap: 18px;
            padding: 4px 0 2px;
          }
          .arc-brand {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 10px;
            color: var(--text-muted);
            opacity: 0.86;
          }
          .arc-brand-line {
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--border-normal));
          }
          .arc-brand-line:last-child {
            background: linear-gradient(90deg, var(--border-normal), transparent);
          }
          .arc-brand-text {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0;
            text-transform: uppercase;
            color: var(--gold);
          }
          .arc-avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background:
              radial-gradient(circle at 34% 24%, rgba(255,255,255,0.32), transparent 24%),
              linear-gradient(145deg, var(--gold), var(--accent) 54%, var(--bg-overlay));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: 850;
            color: var(--bg-void);
            box-shadow:
              0 0 0 4px var(--bg-elevated),
              0 0 0 5px var(--accent-border),
              0 18px 34px rgba(0,0,0,0.42),
              0 0 30px var(--accent-glow);
            letter-spacing: 0;
            transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .auto-reconnect:hover .arc-avatar {
            transform: translateY(-2px) scale(1.02);
            filter: brightness(1.05);
          }
          .arc-info {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            text-align: center;
          }
          .arc-nick {
            font-size: 24px;
            font-weight: 850;
            color: var(--text-primary);
            letter-spacing: 0;
            line-height: 1.1;
          }
          .arc-server {
            font-size: 13px;
            color: var(--text-muted);
          }
          .arc-token-badge {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0;
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
            gap: 10px;
            padding-top: 4px;
          }
          .auto-reconnect .btn {
            height: 44px;
            border-radius: var(--r-lg);
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .auto-reconnect .btn:hover:not(:disabled) {
            transform: translateY(-1px);
            filter: brightness(1.04) drop-shadow(0 8px 20px var(--accent-glow));
          }
          .auto-reconnect .btn:active:not(:disabled) {
            transform: translateY(0) scale(0.99);
            filter: brightness(0.96);
          }
          .arc-connecting {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 12px 10px;
            font-size: 14px;
            color: var(--text-secondary);
            border: 1px solid var(--border-subtle);
            border-radius: var(--r-lg);
            background: var(--bg-base);
          }
          .arc-switch {
            background: none;
            border: none;
            font-family: inherit;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
            text-align: center;
            padding: 5px;
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .arc-switch:hover { color: var(--text-primary); transform: translateY(-1px); }
          .arc-switch:active { transform: translateY(0); opacity: 0.78; }
          .arc-forget {
            background: none;
            border: none;
            font-family: inherit;
            font-size: 12px;
            color: var(--text-muted);
            cursor: pointer;
            text-align: center;
            padding: 2px 5px;
            transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          }
          .arc-forget:hover { color: var(--danger); transform: translateY(-1px); }
          .arc-forget:active { transform: translateY(0); opacity: 0.76; }
          .arc-error {
            display: flex;
            align-items: flex-start;
            gap: 7px;
            width: 100%;
            padding: 9px 12px;
            background: rgba(248,113,113,0.07);
            border: 1px solid rgba(248,113,113,0.28);
            border-radius: var(--r-md);
            color: var(--danger);
            font-size: 12.5px;
            line-height: 1.45;
            text-align: left;
            animation: fadeIn 200ms var(--ease-out);
          }
          @media (prefers-reduced-motion: reduce) {
            .arc-avatar,
            .auto-reconnect .btn,
            .arc-switch,
            .arc-forget,
            .arc-error {
              animation: none;
              transition-duration: 0.001ms;
            }
            .auto-reconnect:hover .arc-avatar,
            .auto-reconnect .btn:hover:not(:disabled),
            .arc-switch:hover,
            .arc-forget:hover {
              transform: none;
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`auth-form-fields${shake ? ' form-shake' : ''}`} noValidate>
      <div className="login-brand">
        <div className="login-brand-mark" aria-hidden="true">
          <span className="login-brand-core" />
        </div>
        <div className="login-brand-copy">
          <span className="login-kicker">Secure relay</span>
          <h1 className="login-title">Enter the midnight</h1>
          <p className="login-subtitle">eshmaki.me IRC access</p>
        </div>
      </div>

      {/* Nick field */}
      <FormField label="Username" required>
        <div className="input-wrap">
          <span className="input-icon input-icon--left" aria-hidden="true">
            <IconUser />
          </span>
          <input
            ref={nickRef}
            id="login-nick"
            type="text"
            placeholder="your_nick"
            value={nick}
            onChange={e => {
              setNick(e.target.value);
              setError('');
              setConnectAttempted(false);
            }}
            autoComplete="username"
            maxLength={32}
            aria-describedby={nickError ? 'login-nick-error' : undefined}
            aria-invalid={nickError ? true : undefined}
            className={`onyx-input onyx-input--has-icon${nickError || (hasError && !nick.trim()) ? ' onyx-input--error' : ''}`}
            disabled={loading}
          />
          <span className={`nick-count${nick.length > 25 ? ' nick-count--warn' : ''}${nick.length > 30 ? ' nick-count--error' : ''}`}>
            {nick.length}/30
          </span>
        </div>
        {nickError && <span id="login-nick-error" className="field-hint field-hint--error" role="alert">{nickError}</span>}
      </FormField>

      {/* Password field */}
      <FormField label="Password" hint="Leave blank to join as a guest">
        <div className="input-wrap">
          <span className="input-icon input-icon--left" aria-hidden="true">
            <IconLock />
          </span>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              setError('');
              setConnectAttempted(false);
            }}
            autoComplete="current-password"
            className="onyx-input onyx-input--has-icon onyx-input--has-icon-right"
            disabled={loading}
          />
          {password.length > 0 && !showPassword && (
            <span className="sasl-badge">SASL</span>
          )}
          <button
            type="button"
            className="eye-toggle"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            <IconEye off={showPassword} />
          </button>
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

      {(error || visibleLastError) && (
        <div className="auth-error" role="alert">
          <span className="auth-error-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M7 4v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="7" cy="10" r="0.8" fill="currentColor" />
            </svg>
          </span>
          {error || visibleLastError?.text}
        </div>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading} className="login-submit">
        {loading ? (
          <span className="btn-loading-inner">
            <IconSpinner />
            {CONNECTION_STEPS[connStep]}
          </span>
        ) : 'Sign In'}
      </Button>

      <p className="switch-link">
        New here?{' '}
        <button type="button" className="link-btn" onClick={onSwitch}>
          Create an account
        </button>
      </p>

      <style>{`
        .auth-form-fields {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .login-brand {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 14px;
          padding: 2px 0 6px;
        }
        .login-brand-mark {
          width: 46px;
          height: 46px;
          border-radius: var(--r-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(145deg, color-mix(in srgb, var(--accent) 20%, var(--bg-overlay)), var(--bg-base)),
            var(--bg-base);
          border: 1px solid var(--accent-border);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.08),
            0 12px 24px rgba(0,0,0,0.28),
            0 0 26px var(--accent-glow);
          position: relative;
          overflow: hidden;
          transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .login-brand-mark::before,
        .login-brand-mark::after {
          content: '';
          position: absolute;
          inset: 8px;
          border: 1px solid var(--border-normal);
          border-radius: 50%;
          opacity: 0.74;
        }
        .login-brand-mark::after {
          inset: 15px;
          border-color: var(--gold);
          opacity: 0.5;
        }
        .login-brand-core {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--gold);
          box-shadow:
            0 0 0 5px var(--gold-subtle),
            0 0 22px var(--gold);
          z-index: 1;
        }
        .auth-form-fields:hover .login-brand-mark {
          transform: translateY(-1px) scale(1.02);
          filter: brightness(1.05);
        }
        .login-brand-copy {
          min-width: 0;
        }
        .login-kicker {
          display: block;
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
          line-height: 1.1;
          text-transform: uppercase;
          color: var(--gold);
        }
        .login-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 34px;
          font-weight: 900;
          line-height: 0.98;
          letter-spacing: 0;
        }
        .login-subtitle {
          margin: 7px 0 0;
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 550;
        }

        /* ── Shake animation on submit failure ── */
        @keyframes form-shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-5px); }
          30%       { transform: translateX(5px); }
          45%       { transform: translateX(-4px); }
          60%       { transform: translateX(4px); }
          75%       { transform: translateX(-2px); }
          90%       { transform: translateX(2px); }
        }
        .form-shake { animation: form-shake 0.55s cubic-bezier(0.36,0.07,0.19,0.97) both; }

        /* ── Input wrapper ── */
        .input-wrap {
          position: relative;
          display: flex;
          align-items: center;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .input-wrap:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
        }
        .input-wrap:focus-within {
          transform: translateY(-1px);
          filter: brightness(1.08);
        }

        /* ── Input icon ── */
        .input-icon {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          color: var(--text-muted);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 1;
        }
        .input-icon--left { left: 13px; }
        .input-wrap:focus-within .input-icon--left {
          color: var(--accent);
          transform: translateY(-50%) scale(1.04);
          filter: drop-shadow(0 0 8px var(--accent-glow));
        }

        /* ── Base input ── */
        .onyx-input {
          width: 100%;
          height: 46px;
          padding: 0 14px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-elevated) 42%, transparent), transparent),
            var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          box-sizing: border-box;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.035),
            0 1px 0 rgba(0,0,0,0.22);
        }
        .onyx-input::placeholder {
          color: var(--text-muted);
          opacity: 0.62;
        }
        .onyx-input--has-icon { padding-left: 40px; }
        .onyx-input--has-icon-right { padding-right: 80px; }
        .onyx-input--mono {
          font-family: var(--font-mono, 'ui-monospace', monospace);
          font-size: 13px;
          letter-spacing: 0;
        }

        /* Focus — accent glow ring */
        .onyx-input:focus {
          outline: none;
          background: var(--bg-elevated);
          border-color: var(--accent);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.06),
            0 0 0 1px var(--accent-border),
            0 0 0 4px var(--accent-subtle),
            0 12px 28px rgba(0,0,0,0.18);
        }
        .onyx-input:hover:not(:focus):not(:disabled) {
          border-color: var(--accent-border);
          background: var(--bg-elevated);
        }
        .onyx-input:active:not(:disabled) {
          filter: brightness(0.98);
        }
        .onyx-input:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Error state */
        .onyx-input--error {
          border-color: rgba(248,113,113,0.6);
          background: rgba(248,113,113,0.03);
        }
        .onyx-input--error:focus {
          border-color: var(--danger);
          box-shadow: 0 0 0 4px rgba(248,113,113,0.15);
        }

        .field-hint { display: block; font-size: 12px; margin-top: 5px; }
        .field-hint--error { color: var(--danger); }

        /* ── Nick character counter ── */
        .nick-count {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          color: var(--text-muted);
          pointer-events: none;
          font-variant-numeric: tabular-nums;
          opacity: 0.68;
        }
        .nick-count--warn { color: var(--gold); opacity: 1; }
        .nick-count--error { color: var(--danger); opacity: 1; }
        /* Nick field needs right padding to avoid text running under the counter */
        .input-wrap .onyx-input:not(.onyx-input--has-icon-right) { padding-right: 48px; }

        /* ── Password visibility toggle ── */
        .eye-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          z-index: 2;
          padding: 0;
        }
        .eye-toggle:hover {
          color: var(--text-secondary);
          background: rgba(14,165,233,0.08);
          transform: translateY(-50%) scale(1.04);
          filter: brightness(1.08);
        }
        .eye-toggle:active {
          transform: translateY(-50%) scale(0.96);
          filter: brightness(0.92);
        }
        .eye-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        /* SASL badge — shown when password has content and eye is hidden */
        .sasl-badge {
          position: absolute;
          right: 44px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          color: var(--gold);
          background: rgba(103,232,249,0.08);
          border: 1px solid rgba(103,232,249,0.2);
          border-radius: 3px;
          padding: 2px 5px;
          pointer-events: none;
          white-space: nowrap;
          box-shadow: 0 0 14px rgba(103,232,249,0.08);
        }

        /* ── Remember me — custom toggle ── */
        .remember-row {
          display: flex;
          align-items: center;
          gap: 9px;
          cursor: pointer;
          user-select: none;
          width: fit-content;
          padding: 2px 0 1px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .remember-row:hover {
          transform: translateY(-1px);
          filter: brightness(1.05);
        }
        /* Hide the browser checkbox; we style the label instead */
        .remember-checkbox {
          appearance: none;
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border: 1.5px solid var(--border-normal);
          border-radius: var(--r-xs);
          background: var(--bg-base);
          cursor: pointer;
          flex-shrink: 0;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          position: relative;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }
        .remember-checkbox:hover {
          border-color: var(--accent);
          filter: brightness(1.12);
        }
        .remember-checkbox:checked {
          background: var(--accent);
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(14,165,233,0.18);
        }
        /* Checkmark via clip-path on ::after */
        .remember-checkbox:checked::after {
          content: '';
          position: absolute;
          inset: 0;
          background: url("data:image/svg+xml,%3Csvg viewBox='0 0 10 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 5l2.5 2.5L8 3' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 10px no-repeat;
        }
        .remember-checkbox:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .remember-checkbox:disabled { opacity: 0.4; cursor: not-allowed; }
        .remember-text {
          font-size: 13px;
          color: var(--text-secondary);
        }
        .remember-row:has(.remember-checkbox:disabled) { opacity: 0.5; cursor: not-allowed; }

        /* ── Error banner ── */
        .auth-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(248,113,113,0.07);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: var(--r-md);
          color: var(--danger);
          font-size: 13px;
          line-height: 1.5;
          animation: fadeIn 180ms var(--ease-out);
        }
        .auth-error-icon {
          flex-shrink: 0;
          margin-top: 1px;
          display: flex;
        }

        /* ── Spinner in button ── */
        .btn-loading-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .spin-icon {
          animation: spin-anim 0.8s linear infinite;
        }
        @keyframes spin-anim {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .auth-form-fields .btn {
          height: 46px;
          border-radius: var(--r-lg);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .auth-form-fields .login-submit {
          margin-top: 2px;
          letter-spacing: 0;
          text-transform: uppercase;
          box-shadow:
            0 10px 24px rgba(0,0,0,0.34),
            0 0 0 1px rgba(255,255,255,0.09) inset,
            0 0 24px var(--accent-glow);
        }
        .auth-form-fields .login-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.05) drop-shadow(0 8px 20px var(--accent-glow));
        }
        .auth-form-fields .login-submit:active:not(:disabled) {
          transform: translateY(0) scale(0.99);
          filter: brightness(0.95);
        }

        /* ── Footer links ── */
        .switch-link {
          text-align: center;
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          padding-top: 1px;
        }
        .link-btn {
          color: var(--accent);
          background: none;
          border: none;
          cursor: pointer;
          font-size: inherit;
          font-family: inherit;
          padding: 2px 3px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .link-btn:hover {
          color: var(--text-link-hover);
          text-decoration: underline;
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .link-btn:active {
          transform: translateY(0);
          opacity: 0.76;
        }

        @media (max-width: 420px) {
          .login-brand {
            gap: 12px;
          }
          .login-brand-mark {
            width: 42px;
            height: 42px;
          }
          .login-title {
            font-size: 27px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .form-shake,
          .spin-icon,
          .auth-error {
            animation: none;
          }
          .login-brand-mark,
          .input-wrap,
          .input-icon,
          .onyx-input,
          .eye-toggle,
          .remember-row,
          .remember-checkbox,
          .auth-form-fields .btn,
          .link-btn {
            transition-duration: 0.001ms;
          }
          .auth-form-fields:hover .login-brand-mark,
          .input-wrap:hover,
          .input-wrap:focus-within,
          .input-wrap:focus-within .input-icon--left,
          .eye-toggle:hover,
          .eye-toggle:active,
          .remember-row:hover,
          .auth-form-fields .login-submit:hover:not(:disabled),
          .auth-form-fields .login-submit:active:not(:disabled),
          .link-btn:hover,
          .link-btn:active {
            transform: none;
          }
        }
      `}</style>
    </form>
  );
}
