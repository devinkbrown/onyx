'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useOnyxStore } from '@/lib/store';
import FormField from '@/components/ui/FormField';
import Button from '@/components/ui/Button';

interface Props {
  onSwitch: () => void;
}

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me/gateway';

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

function IconEmail() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M1.5 5.5l6.5 4 6.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
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
  const status    = useOnyxStore(s => s.status);

  const [step,          setStep]          = useState<Step>('fill');
  const [nick,          setNick]          = useState('');
  const [email,         setEmail]         = useState('');
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
  const [emailTouched,    setEmailTouched]     = useState(false);
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
  const emailInline   = emailTouched && !email.trim()  ? 'Email required'
                      : emailTouched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Enter a valid email' : '';
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
    setEmailTouched(true);
    setPasswordTouched(true);
    setConfirmTouched(true);

    if (!nick.trim())          { setError('Nickname required'); triggerShake(); return; }
    if (!email.trim())         { setError('Email required'); triggerShake(); return; }
    if (!password)             { setError('Password required'); triggerShake(); return; }
    if (password.length < 6)   { setError('Password must be at least 6 characters'); triggerShake(); return; }
    if (password !== confirm)  { setError('Passwords do not match'); triggerShake(); return; }
    setError('');
    setLoading(true);

    try {
      connect({ url: server.trim(), nick: nick.trim(), realname: nick.trim() });

      await new Promise<void>((resolve, reject) => {
        const unsub = useOnyxStore.subscribe(
          s => s.status,
          s => {
            if (s === 'connected') { unsub(); resolve(); }
            if (s === 'error') { unsub(); reject(new Error('Connection failed')); }
          },
        );
        setTimeout(() => { unsub(); reject(new Error('Timeout')); }, 15000);
      });

      sendRaw(`PRIVMSG NickServ :REGISTER ${password} ${email}\r\n`);
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
            <circle cx="24" cy="24" r="22" fill="rgba(14,165,233,0.1)" stroke="var(--accent)" strokeWidth="1.5" />
            <rect x="10" y="16" width="28" height="18" rx="3" stroke="var(--accent)" strokeWidth="1.4" fill="none" />
            <path d="M10 20l14 9 14-9" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
        </div>
        <h3 className="verify-title">Check your email</h3>
        <p className="verify-text">
          A verification code was sent to <strong className="verify-email">{email}</strong>.
          Follow the instructions to complete registration.
        </p>
        <p className="verify-subtext">
          After verifying, you can sign in with your nickname and password.
        </p>
        <button className="link-btn" onClick={onSwitch}>Go to sign in →</button>

        <style>{`
          .verify-step { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 8px 0; text-align: center; }
          .verify-icon { margin-bottom: 4px; }
          .verify-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
          .verify-text { font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin: 0; }
          .verify-email { color: var(--accent); font-weight: 600; }
          .verify-subtext { font-size: 13px; color: var(--text-muted); margin: 0; }
          .link-btn { color: var(--accent); background: none; border: none; cursor: pointer; font-size: 14px; margin-top: 4px; font-family: inherit; }
          .link-btn:hover { text-decoration: underline; }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`auth-form-fields${shake ? ' form-shake' : ''}`} noValidate>

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

      {/* Email */}
      <FormField label="Email" required hint="Used for account recovery">
        <div className="input-wrap">
          <span className="input-icon input-icon--left" aria-hidden="true">
            <IconEmail />
          </span>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            autoComplete="email"
            className={`onyx-input onyx-input--has-icon${emailInline ? ' onyx-input--error' : ''}`}
            disabled={loading}
          />
        </div>
        {emailInline && <span className="field-hint field-hint--error">{emailInline}</span>}
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
        <span className={`advanced-arrow${advanced ? ' open' : ''}`}>▸</span>
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

      <Button type="submit" variant="primary" fullWidth loading={loading}>
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
          gap: 16px;
        }

        /* ── Shake animation ── */
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
        }

        /* ── Icons inside inputs ── */
        .input-icon {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          color: var(--text-muted);
          transition: color var(--t-fast);
          z-index: 1;
        }
        .input-icon--left { left: 13px; }
        .input-wrap:focus-within .input-icon--left { color: var(--accent); }

        /* ── Base input ── */
        .onyx-input {
          width: 100%;
          height: 44px;
          padding: 0 14px;
          background: var(--bg-base);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast);
          box-sizing: border-box;
        }
        .onyx-input::placeholder {
          color: var(--text-muted);
          opacity: 0.7;
        }
        .onyx-input--has-icon { padding-left: 40px; }
        .onyx-input--has-icon-right { padding-right: 44px; }
        .onyx-input--mono {
          font-family: var(--font-mono, 'ui-monospace', monospace);
          font-size: 13px;
          letter-spacing: -0.01em;
        }

        /* Focus — accent glow ring */
        .onyx-input:focus {
          outline: none;
          background: var(--bg-elevated);
          border-color: var(--accent);
          box-shadow:
            0 0 0 3px rgba(14,165,233,0.18),
            0 0 12px rgba(14,165,233,0.08);
        }
        .onyx-input:hover:not(:focus):not(:disabled) {
          background: var(--bg-elevated);
        }
        .onyx-input:disabled { opacity: 0.45; cursor: not-allowed; }

        /* Error state */
        .onyx-input--error {
          border-color: rgba(248,113,113,0.6);
          background: rgba(248,113,113,0.03);
        }
        .onyx-input--error:focus {
          border-color: var(--danger);
          box-shadow: 0 0 0 3px rgba(248,113,113,0.15);
        }

        /* Success state */
        .onyx-input--success {
          border-color: rgba(52,211,153,0.5);
          background: rgba(52,211,153,0.03);
        }
        .onyx-input--success:focus {
          border-color: var(--success);
          box-shadow: 0 0 0 3px rgba(52,211,153,0.12);
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
          border-radius: 99px;
          overflow: hidden;
        }
        .strength-fill {
          height: 100%;
          border-radius: 99px;
          transition: width 0.35s var(--ease-out), background 0.35s;
        }
        .strength-fill--none   { width: 0%; background: transparent; }
        .strength-fill--weak   { width: 33%; background: var(--danger); }
        .strength-fill--medium { width: 66%; background: var(--warning); }
        .strength-fill--strong { width: 100%; background: var(--success); }

        .strength-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
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
          transition: color var(--t-fast), background var(--t-fast);
          z-index: 2;
          padding: 0;
        }
        .eye-toggle:hover {
          color: var(--text-secondary);
          background: rgba(14,165,233,0.08);
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
          padding: 0;
          transition: color var(--t-fast);
          align-self: flex-start;
          font-family: inherit;
        }
        .advanced-toggle:hover { color: var(--text-primary); }
        .advanced-arrow { display: inline-block; transition: transform var(--t-fast); font-size: 11px; }
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
      `}</style>
    </form>
  );
}
