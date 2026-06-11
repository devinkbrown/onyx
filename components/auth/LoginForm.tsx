'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import {
  clearCredentials,
  getAuthSecret,
  loadCredentials,
  saveCredentials,
  type SavedCredentials,
} from '@/lib/credentials';

interface Props {
  onSwitch: () => void;
}

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me:8080';
const NICK_INVALID_RE = /[^a-zA-Z0-9\-_\[\]{}\\|`^]/;
const CONNECTION_STEPS = ['Opening link', 'Checking SASL', 'Loading channels'];

function validWsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function serverLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function LoginForm({ onSwitch }: Props) {
  const connect = useOnyxStore(s => s.connect);
  const status = useOnyxStore(s => s.status);
  const notifications = useOnyxStore(s => s.notifications);

  const [nick, setNick] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [connStep, setConnStep] = useState(0);
  const [connectAttempted, setConnectAttempted] = useState(false);
  const [savedCreds, setSavedCreds] = useState<SavedCredentials | null>(null);
  const [autoMode, setAutoMode] = useState(false);

  const nickRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nickRef.current?.focus();
    const creds = loadCredentials();
    if (creds) {
      setSavedCreds(creds);
      setAutoMode(true);
      setNick(creds.nick);
      setRememberMe(true);
    }
  }, []);

  useEffect(() => {
    if (status !== 'connecting') {
      setConnStep(0);
      return;
    }

    const interval = setInterval(() => {
      setConnStep(step => (step + 1) % CONNECTION_STEPS.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [status]);

  const loading = status === 'connecting';
  const lastError = notifications.filter(n => n.type === 'error').at(-1);
  const visibleLastError = connectAttempted && !loading ? lastError : undefined;

  const nickInvalid = nick.length > 0 && NICK_INVALID_RE.test(nick);
  const nickError = nick.includes(' ')
    ? 'Nickname cannot contain spaces'
    : nickInvalid
    ? 'Nickname has unsupported characters'
    : nick.length > 30
    ? 'Nickname is too long'
    : '';
  const hasError = Boolean(error || visibleLastError);

  const triggerShake = () => {
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
  };

  const clearAttemptState = () => {
    setError('');
    setConnectAttempted(false);
  };

  const handleAutoConnect = useCallback(() => {
    if (!savedCreds) return;

    const savedServer = validWsUrl(savedCreds.server);
    if (!savedServer) {
      setError('Saved server URL is invalid');
      setConnectAttempted(true);
      triggerShake();
      return;
    }

    setError('');
    setConnectAttempted(true);
    connect({
      url: savedServer,
      nick: savedCreds.nick,
      password: getAuthSecret(savedCreds),
    });
  }, [connect, savedCreds]);

  const handleForget = () => {
    clearCredentials();
    setSavedCreds(null);
    setAutoMode(false);
    setNick('');
    setPassword('');
    setRememberMe(false);
    setConnectAttempted(false);
    nickRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!nick.trim()) {
      setError('Nickname is required');
      triggerShake();
      return;
    }

    if (nickError) {
      setError(nickError);
      triggerShake();
      return;
    }

    const cleanNick = nick.trim();
    if (rememberMe) {
      saveCredentials({
        nick: cleanNick,
        server: DEFAULT_SERVER,
        password: password || undefined,
      });
    } else {
      clearCredentials();
    }

    setError('');
    setConnectAttempted(true);
    connect({ url: DEFAULT_SERVER, nick: cleanNick, password: password || undefined });
  };

  if (autoMode && savedCreds) {
    return (
      <div className={`auth-form auth-form--auto${shake ? ' auth-form--shake' : ''}`} data-testid="login-saved-account">
        <div className="saved-card elev-2">
          <div className="saved-avatar" aria-hidden="true">{savedCreds.nick.slice(0, 2).toUpperCase()}</div>
          <div className="saved-copy">
            <p className="saved-kicker label-caps">Saved identity</p>
            <h3>{savedCreds.nick}</h3>
            <span>{serverLabel(savedCreds.server)}</span>
          </div>
        </div>

        {hasError && (
          <p className="form-error" role="alert" data-testid="login-error">
            {error || visibleLastError?.text}
          </p>
        )}

        <button className="lux-button" type="button" disabled={loading} onClick={handleAutoConnect}>
          {loading ? CONNECTION_STEPS[connStep] : visibleLastError ? 'Retry' : 'Connect'}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setAutoMode(false);
            setConnectAttempted(false);
            window.setTimeout(() => nickRef.current?.focus(), 0);
          }}
        >
          Use another account
        </button>
        <button type="button" className="text-button text-button--muted" onClick={handleForget}>
          Forget saved identity
        </button>

        <LoginStyles />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`auth-form${shake ? ' auth-form--shake' : ''}`} noValidate data-testid="login-form">
      <FloatingField label="Nickname" active={Boolean(nick)} error={nickError}>
        <input
          ref={nickRef}
          id="login-nick"
          data-testid="login-nick"
          type="text"
          value={nick}
          onChange={event => {
            setNick(event.target.value);
            clearAttemptState();
          }}
          autoComplete="username"
          maxLength={32}
          aria-invalid={nickError ? true : undefined}
          aria-describedby={nickError ? 'login-nick-error' : undefined}
          disabled={loading}
        />
      </FloatingField>
      {nickError && <p id="login-nick-error" className="field-error" role="alert">{nickError}</p>}

      <FloatingField label="Password" active={Boolean(password)} aside={password ? 'SASL' : 'Guest ok'}>
        <input
          id="login-password"
          data-testid="login-password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={event => {
            setPassword(event.target.value);
            clearAttemptState();
          }}
          autoComplete="current-password"
          disabled={loading}
        />
        <button
          type="button"
          className="field-icon-button"
          onClick={() => setShowPassword(value => !value)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </FloatingField>

      <label className="remember-row">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={event => setRememberMe(event.target.checked)}
          disabled={loading}
        />
        <span>Remember this identity</span>
      </label>

      {hasError && (
        <p className="form-error" role="alert" data-testid="login-error">
          {error || visibleLastError?.text}
        </p>
      )}

      <button className="lux-button" type="submit" disabled={loading} data-testid="login-submit">
        {loading ? CONNECTION_STEPS[connStep] : 'Sign in'}
      </button>

      <p className="switch-line">
        New here? <button type="button" onClick={onSwitch}>Create an account</button>
      </p>

      <LoginStyles />
    </form>
  );
}

function FloatingField({
  active,
  aside,
  children,
  error,
  label,
}: {
  active: boolean;
  aside?: string;
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="float-field" data-active={active} data-error={Boolean(error)}>
      <span className="float-label">{label}</span>
      {children}
      {aside && <span className="float-aside">{aside}</span>}
    </label>
  );
}

function LoginStyles() {
  return (
    <style>{`
      .auth-form {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4, 16px);
      }

      .auth-form--auto {
        padding-top: var(--sp-4, 16px);
      }

      .auth-form--shake {
        animation: field-shake var(--t-surface, 220ms) var(--ease-out);
      }

      @keyframes field-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-2px); }
        50% { transform: translateX(2px); }
        75% { transform: translateX(-2px); }
      }

      .float-field {
        position: relative;
        display: block;
      }

      .float-field input {
        width: 100%;
        height: 54px;
        border: 0;
        border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-lg, 12px);
        background:
          linear-gradient(180deg, rgba(255,255,255,.035), transparent),
          color-mix(in srgb, var(--bg-base) 94%, var(--lux) 6%);
        color: var(--text-primary);
        caret-color: var(--lux);
        font: inherit;
        font-size: var(--text-md, .9375rem);
        padding: 18px 48px 6px 16px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.045), 0 1px 0 rgba(0,0,0,.26);
        outline: 1px solid color-mix(in srgb, var(--border-normal) 70%, transparent);
        outline-offset: -1px;
        transition: outline-color var(--t-control, 150ms) var(--ease-out), background var(--t-control, 150ms) var(--ease-out), transform var(--t-control, 150ms) var(--ease-out);
      }

      .float-field input:focus {
        outline-color: var(--lux);
        background: color-mix(in srgb, var(--bg-elevated) 92%, var(--lux) 8%);
      }

      .float-field[data-error="true"] input {
        outline-color: color-mix(in srgb, var(--danger) 78%, transparent);
      }

      .float-label {
        position: absolute;
        left: 16px;
        top: 17px;
        z-index: 1;
        color: var(--text-muted);
        font-size: var(--text-sm, .8125rem);
        font-weight: 760;
        pointer-events: none;
        transform-origin: left center;
        transition: transform var(--t-control, 150ms) var(--ease-out), color var(--t-control, 150ms) var(--ease-out);
      }

      .float-field:focus-within .float-label,
      .float-field[data-active="true"] .float-label {
        color: var(--lux);
        transform: translateY(-11px) scale(.78);
      }

      .float-aside {
        position: absolute;
        right: 15px;
        top: 50%;
        color: var(--text-muted);
        font-size: var(--text-2xs, .6875rem);
        font-weight: 850;
        letter-spacing: .08em;
        text-transform: uppercase;
        transform: translateY(-50%);
      }

      .field-icon-button {
        position: absolute;
        right: 10px;
        top: 50%;
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: var(--r-sm, 6px);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        transform: translateY(-50%);
      }

      .field-icon-button:hover,
      .field-icon-button:focus-visible {
        color: var(--text-primary);
        background: color-mix(in srgb, var(--lux) 10%, transparent);
        outline: none;
      }

      .field-error,
      .form-error {
        margin: calc(var(--sp-2, 8px) * -1) 0 0;
        color: var(--danger);
        font-size: var(--text-sm, .8125rem);
        line-height: 1.45;
      }

      .form-error {
        margin: 0;
        padding: var(--sp-3, 12px);
        border-radius: var(--r-md, 8px) var(--r-xs, 4px) var(--r-md, 8px) var(--r-sm, 6px);
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        box-shadow: inset 2px 0 0 var(--danger);
      }

      .remember-row {
        width: fit-content;
        display: flex;
        align-items: center;
        gap: var(--sp-2, 8px);
        color: var(--text-secondary);
        cursor: pointer;
        font-size: var(--text-sm, .8125rem);
      }

      .remember-row input {
        width: 17px;
        height: 17px;
        accent-color: var(--lux);
      }

      .lux-button {
        height: 48px;
        border: 0;
        border-radius: var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px);
        background: color-mix(in srgb, var(--accent) 88%, black 12%);
        color: white;
        cursor: pointer;
        font: inherit;
        font-size: var(--text-sm, .8125rem);
        font-weight: 850;
        letter-spacing: .05em;
        text-transform: uppercase;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 16px 28px rgba(0,0,0,.28);
        transition: transform var(--t-control, 150ms) var(--ease-out), filter var(--t-control, 150ms) var(--ease-out);
      }

      .lux-button:hover:not(:disabled),
      .lux-button:focus-visible {
        filter: brightness(1.06);
        outline: none;
        transform: translateY(-1px);
      }

      .lux-button:active:not(:disabled) {
        transform: translateY(0);
      }

      .lux-button:disabled {
        cursor: wait;
        opacity: .62;
      }

      .switch-line {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--text-sm, .8125rem);
        text-align: center;
      }

      .switch-line button,
      .text-button {
        border: 0;
        background: transparent;
        color: var(--lux);
        cursor: pointer;
        font: inherit;
        font-weight: 760;
      }

      .text-button {
        color: var(--text-secondary);
      }

      .text-button--muted {
        color: var(--text-muted);
        font-size: var(--text-xs, .75rem);
      }

      .saved-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--sp-4, 16px);
        align-items: center;
        padding: var(--sp-5, 20px);
        border-radius: var(--r-2xl, 20px) var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px);
        background: var(--bg-elevated);
      }

      .saved-avatar {
        width: 58px;
        height: 58px;
        display: grid;
        place-items: center;
        border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-lg, 12px);
        background: var(--lux);
        color: var(--bg-void);
        font-weight: 900;
      }

      .saved-copy {
        min-width: 0;
      }

      .saved-copy p,
      .saved-copy h3 {
        margin: 0;
      }

      .saved-copy h3 {
        color: var(--text-primary);
        font-family: var(--font-display);
        font-size: var(--text-2xl, 1.5rem);
        line-height: 1.05;
      }

      .saved-copy span {
        color: var(--text-muted);
        font-size: var(--text-sm, .8125rem);
      }

      @media (prefers-reduced-motion: reduce) {
        .auth-form--shake {
          animation: none;
        }

        .float-field input,
        .float-label,
        .lux-button {
          transition-duration: .001ms;
        }
      }
    `}</style>
  );
}

function EyeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d="M2.5 8.5s2.35-4 6-4 6 4 6 4-2.35 4-6 4-6-4-6-4Z" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="8.5" cy="8.5" r="1.9" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d="M3 3l11 11" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M6.5 4.8a6.7 6.7 0 0 1 2-.3c3.65 0 6 4 6 4a9.5 9.5 0 0 1-1.8 2.1M4.4 6.1A9.4 9.4 0 0 0 2.5 8.5s2.35 4 6 4c.82 0 1.58-.2 2.25-.52" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}
