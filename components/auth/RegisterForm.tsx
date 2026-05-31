'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useOnyxStore } from '@/lib/store';
import FormField from '@/components/ui/FormField';
import Button from '@/components/ui/Button';

interface Props {
  onSwitch: () => void;
}

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me:8080';

type Step = 'fill' | 'verify';

// ── SVG Icons ────────────────────────────────────────────────────────────────

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

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="rgba(52,211,153,0.15)" stroke="var(--success)" strokeWidth="1.2" />
      <path d="M5 8l2.2 2.2L11 5.5" stroke="var(--success)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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

// ── Password strength ─────────────────────────────────────────────────────────

type PasswordStrength = 'none' | 'weak' | 'medium' | 'strong';

function getPasswordStrength(pw: string): PasswordStrength {
  if (!pw) return 'none';
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return 'weak';
  if (score <= 3) return 'medium';
  return 'strong';
}

const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  none:   '',
  weak:   'Weak',
  medium: 'Medium',
  strong: 'Strong',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function RegisterForm({ onSwitch }: Props) {
  const connect   = useOnyxStore(s => s.connect);
  const sendRaw   = useOnyxStore(s => s.sendRaw);

  const [step,          setStep]          = useState<Step>('fill');
  const [nick,          setNick]          = useState('');
  const [password,      setPassword]      = useState('');
  const [confirm,       setConfirm]       = useState('');
  const [showPassword,  setShowPassword]  = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [server,        setServer]        = useState(DEFAULT_SERVER);
  const [advanced,      setAdvanced]      = useState(false);
  const [error,         setError]         = useState('');
  const [shake,         setShake]         = useState(false);
  const [loading,       setLoading]       = useState(false);

  // Inline validation touched state
  const [nickTouched,     setNickTouched]     = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched,  setConfirmTouched]  = useState(false);

  const nickRef = useRef<HTMLInputElement>(null);

  // Auto-focus nick field on mount
  useEffect(() => {
    nickRef.current?.focus();
  }, []);

  const strength     = getPasswordStrength(password);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const passwordsMismatch = confirm.length > 0 && password !== confirm;

  // Inline validation
  const nickInline    = nickTouched && !nick.trim()    ? 'Nickname required' : '';
  const pwInline      = passwordTouched && !password   ? 'Password required'
                      : passwordTouched && password.length < 6 ? 'Minimum 6 characters' : '';
  const confirmInline = confirmTouched && passwordsMismatch ? 'Passwords do not match' : '';

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNickTouched(true);
    setPasswordTouched(true);
    setConfirmTouched(true);

    if (!nick.trim())         { setError('Nickname required'); triggerShake(); return; }
    if (!password)            { setError('Password required'); triggerShake(); return; }
    if (password.length < 6)  { setError('Password must be at least 6 characters'); triggerShake(); return; }
    if (password !== confirm) { setError('Passwords do not match'); triggerShake(); return; }
    setError('');
    setLoading(true);

    try {
      // Connect without a password so we join as the requested nick (unregistered)
      connect({ url: server.trim(), nick: nick.trim(), realname: nick.trim() });

      // Wait for the connection to reach 'connected'. Guard against the race
      // where status flips before subscribe() is called.
      await new Promise<void>((resolve, reject) => {
        // Check immediately in case already connected (shouldn't happen on a fresh
        // connect, but guard it anyway)
        if (useOnyxStore.getState().status === 'connected') { resolve(); return; }

        const unsub = useOnyxStore.subscribe(
          s => s.status,
          s => {
            if (s === 'connected') { unsub(); resolve(); }
            if (s === 'error')     { unsub(); reject(new Error('Connection failed')); }
          },
        );
        // 15 s hard timeout
        setTimeout(() => { unsub(); reject(new Error('Connection timed out')); }, 15000);
      });

      // Ophion built-in services: ACCOUNT REGISTER <password>
      // (no NickServ bot, no email parameter)
      sendRaw(`ACCOUNT REGISTER ${password}`);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <div className="verify-step animate-fade-in">
        <div className="verify-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" fill="rgba(52,211,153,0.1)" stroke="var(--success)" strokeWidth="1.5" />
            <path d="M14 24l7 7 13-14" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <h3 className="verify-title">Account created!</h3>
        <p className="verify-text">
          <strong className="verify-nick">{nick}</strong> is registered.
          Sign in with your nickname and password to get started.
        </p>
        <p className="verify-subtext">
          Your account is active immediately — no verification step needed.
        </p>
        <button className="link-btn" onClick={onSwitch}>Sign in →</button>

        <style>{`
          .verify-step { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 8px 0; text-align: center; }
          .verify-icon { margin-bottom: 4px; animation: check-pop 0.4s cubic-bezier(0.34,1.56,0.64,1); }
          @keyframes check-pop {
            from { transform: scale(0.5); opacity: 0; }
            to   { transform: scale(1); opacity: 1; }
          }
          .verify-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
          .verify-text { font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
          .verify-nick { color: var(--accent); font-weight: 600; }
          .verify-subtext { font-size: 13px; color: var(--text-muted); margin: 0; }
          .link-btn {
            color: var(--accent);
            background: none;
            border: none;
            cursor: pointer;
            font-size: 14px;
            margin-top: 4px;
            font-family: inherit;
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
          @media (prefers-reduced-motion: reduce) {
            .verify-step,
            .verify-icon {
              animation: none;
            }
            .link-btn {
              transition-duration: 0.001ms;
            }
            .link-btn:hover,
            .link-btn:active {
              transform: none;
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`auth-form-fields${shake ? ' form-shake' : ''}`} noValidate>
      <div className="register-brand">
        <div className="register-brand-mark" aria-hidden="true">
          <span className="register-brand-core" />
        </div>
        <div className="register-brand-copy">
          <span className="register-kicker">Ocean registry</span>
          <h1 className="register-title">Claim the midnight</h1>
          <p className="register-subtitle">eshmaki.me IRC account</p>
        </div>
      </div>

      {/* Username */}
      <FormField label="Username" required>
        <div className="input-wrap">
          <span className="input-icon input-icon--left" aria-hidden="true">
            <IconUser />
          </span>
          <input
            ref={nickRef}
            type="text"
            placeholder="coolname"
            value={nick}
            onChange={e => setNick(e.target.value)}
            onBlur={() => setNickTouched(true)}
            autoComplete="username"
            maxLength={30}
            className={`onyx-input onyx-input--has-icon${nickInline ? ' onyx-input--error' : ''}`}
            disabled={loading}
          />
        </div>
        {nickInline && <span className="field-hint field-hint--error">{nickInline}</span>}
      </FormField>

      {/* Password */}
      <FormField label="Password" required>
        <div className="input-wrap">
          <span className="input-icon input-icon--left" aria-hidden="true">
            <IconLock />
          </span>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onBlur={() => setPasswordTouched(true)}
            autoComplete="new-password"
            className={`onyx-input onyx-input--has-icon onyx-input--has-icon-right${pwInline ? ' onyx-input--error' : ''}`}
            disabled={loading}
          />
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
        {/* Password strength bar */}
        {password.length > 0 && (
          <div className="strength-wrap" aria-label={`Password strength: ${STRENGTH_LABELS[strength]}`}>
            <div className="strength-bar">
              <div className={`strength-fill strength-fill--${strength}`} />
            </div>
            <span className={`strength-label strength-label--${strength}`}>
              {STRENGTH_LABELS[strength]}
            </span>
          </div>
        )}
        {pwInline && <span className="field-hint field-hint--error">{pwInline}</span>}
      </FormField>

      {/* Confirm password */}
      <FormField label="Confirm Password" required>
        <div className="input-wrap">
          <span className="input-icon input-icon--left" aria-hidden="true">
            <IconLock />
          </span>
          <input
            type={showConfirm ? 'text' : 'password'}
            placeholder="••••••••"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onBlur={() => setConfirmTouched(true)}
            autoComplete="new-password"
            className={`onyx-input onyx-input--has-icon onyx-input--has-icon-right${confirmInline ? ' onyx-input--error' : passwordsMatch ? ' onyx-input--success' : ''}`}
            disabled={loading}
          />
          {passwordsMatch ? (
            <span className="confirm-check">
              <IconCheck />
            </span>
          ) : (
            <button
              type="button"
              className="eye-toggle"
              onClick={() => setShowConfirm(v => !v)}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              <IconEye off={showConfirm} />
            </button>
          )}
        </div>
        {confirmInline && <span className="field-hint field-hint--error">{confirmInline}</span>}
        {passwordsMatch && <span className="field-hint field-hint--success">Passwords match</span>}
      </FormField>

      {/* Advanced toggle */}
      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setAdvanced(a => !a)}
      >
        <span className={`advanced-arrow${advanced ? ' open' : ''}`} aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        Advanced
      </button>

      {advanced && (
        <FormField label="Server">
          <div className="input-wrap">
            <span className="input-icon input-icon--left" aria-hidden="true">
              <IconServer />
            </span>
            <input
              type="text"
              placeholder="wss://server/gateway"
              value={server}
              onChange={e => setServer(e.target.value)}
              className="onyx-input onyx-input--has-icon onyx-input--mono"
              disabled={loading}
            />
          </div>
        </FormField>
      )}

      {error && (
        <div className="auth-error" role="alert">
          <span className="auth-error-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M7 4v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="7" cy="10" r="0.8" fill="currentColor" />
            </svg>
          </span>
          {error}
        </div>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading} className="register-submit">
        {loading ? (
          <span className="btn-loading-inner">
            <IconSpinner />
            Creating account…
          </span>
        ) : 'Create Account'}
      </Button>

      <p className="switch-link">
        Already have an account?{' '}
        <button type="button" className="link-btn" onClick={onSwitch}>
          Sign in
        </button>
      </p>

      <style>{`
        .auth-form-fields {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .register-brand {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 14px;
          padding: 2px 0 6px;
        }
        .register-brand-mark {
          width: 46px;
          height: 46px;
          border-radius: var(--r-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(145deg, color-mix(in srgb, var(--gold) 16%, var(--bg-overlay)), var(--bg-base)),
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
        .register-brand-mark::before,
        .register-brand-mark::after {
          content: '';
          position: absolute;
          inset: 8px;
          border: 1px solid var(--border-normal);
          border-radius: 50%;
          opacity: 0.74;
        }
        .register-brand-mark::after {
          inset: 15px;
          border-color: var(--gold);
          opacity: 0.5;
        }
        .register-brand-core {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--gold);
          box-shadow:
            0 0 0 5px var(--gold-subtle),
            0 0 22px var(--gold);
          z-index: 1;
        }
        .auth-form-fields:hover .register-brand-mark {
          transform: translateY(-1px) scale(1.02);
          filter: brightness(1.05);
        }
        .register-brand-copy {
          min-width: 0;
        }
        .register-kicker {
          display: block;
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
          line-height: 1.1;
          text-transform: uppercase;
          color: var(--gold);
        }
        .register-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 34px;
          font-weight: 900;
          line-height: 0.98;
          letter-spacing: 0;
        }
        .register-subtitle {
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
        .onyx-input--has-icon-right { padding-right: 44px; }
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

        /* Success state */
        .onyx-input--success {
          border-color: rgba(52,211,153,0.5);
          background: rgba(52,211,153,0.03);
        }
        .onyx-input--success:focus {
          border-color: var(--success);
          box-shadow: 0 0 0 4px rgba(52,211,153,0.12);
        }

        /* Field hints */
        .field-hint { display: block; font-size: 12px; margin-top: 5px; }
        .field-hint--error   { color: var(--danger); }
        .field-hint--success { color: var(--success); }

        /* ── Password strength bar ── */
        .strength-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 7px;
        }
        .strength-bar {
          flex: 1;
          height: 3px;
          background: var(--border-subtle);
          border-radius: var(--r-full);
          overflow: hidden;
        }
        .strength-fill {
          height: 100%;
          width: 100%;
          border-radius: var(--r-full);
          transform-origin: left center;
          transition: transform var(--t-normal) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .strength-fill--none   { transform: scaleX(0); background: transparent; }
        .strength-fill--weak   { transform: scaleX(0.33); background: var(--danger); }
        .strength-fill--medium { transform: scaleX(0.66); background: var(--warning); }
        .strength-fill--strong { transform: scaleX(1); background: var(--success); }

        .strength-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0;
          min-width: 40px;
          text-align: right;
        }
        .strength-label--weak   { color: var(--danger); }
        .strength-label--medium { color: var(--warning); }
        .strength-label--strong { color: var(--success); }

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

        /* ── Confirm checkmark ── */
        .confirm-check {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          z-index: 2;
          animation: check-pop 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes check-pop {
          from { transform: translateY(-50%) scale(0.6); opacity: 0; }
          to   { transform: translateY(-50%) scale(1); opacity: 1; }
        }

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
          padding: 1px 0 2px;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          align-self: flex-start;
          font-family: inherit;
        }
        .advanced-toggle:hover {
          color: var(--text-primary);
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .advanced-toggle:active {
          transform: translateY(0);
          opacity: 0.76;
        }
        .advanced-arrow {
          display: inline-block;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          font-size: 11px;
        }
        .advanced-arrow.open { transform: rotate(90deg); }

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
        .auth-form-fields .register-submit {
          margin-top: 2px;
          letter-spacing: 0;
          text-transform: uppercase;
          box-shadow:
            0 10px 24px rgba(0,0,0,0.34),
            0 0 0 1px rgba(255,255,255,0.09) inset,
            0 0 24px var(--accent-glow);
        }
        .auth-form-fields .register-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.05) drop-shadow(0 8px 20px var(--accent-glow));
        }
        .auth-form-fields .register-submit:active:not(:disabled) {
          transform: translateY(0) scale(0.99);
          filter: brightness(0.95);
        }

        @media (max-width: 420px) {
          .register-brand {
            gap: 12px;
          }
          .register-brand-mark {
            width: 42px;
            height: 42px;
          }
          .register-title {
            font-size: 27px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .form-shake,
          .confirm-check,
          .spin-icon,
          .auth-error {
            animation: none;
          }
          .register-brand-mark,
          .input-wrap,
          .input-icon,
          .onyx-input,
          .strength-fill,
          .eye-toggle,
          .advanced-toggle,
          .advanced-arrow,
          .auth-form-fields .btn,
          .link-btn {
            transition-duration: 0.001ms;
          }
          .auth-form-fields:hover .register-brand-mark,
          .input-wrap:hover,
          .input-wrap:focus-within,
          .input-wrap:focus-within .input-icon--left,
          .eye-toggle:hover,
          .eye-toggle:active,
          .advanced-toggle:hover,
          .advanced-toggle:active,
          .auth-form-fields .register-submit:hover:not(:disabled),
          .auth-form-fields .register-submit:active:not(:disabled),
          .link-btn:hover,
          .link-btn:active {
            transform: none;
          }
        }
      `}</style>
    </form>
  );
}
