'use client';

import { useState, FormEvent } from 'react';
import { useOnyxStore } from '@/lib/store';
import FormField from '@/components/ui/FormField';
import Button from '@/components/ui/Button';

interface Props {
  onSwitch: () => void;
}

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me/gateway';

type Step = 'fill' | 'verify';

export default function RegisterForm({ onSwitch }: Props) {
  const connect   = useOnyxStore(s => s.connect);
  const sendRaw   = useOnyxStore(s => s.sendRaw);
  const status    = useOnyxStore(s => s.status);

  const [step,     setStep]     = useState<Step>('fill');
  const [nick,     setNick]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [server,   setServer]   = useState(DEFAULT_SERVER);
  const [advanced, setAdvanced] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nick.trim())     { setError('Nickname required'); return; }
    if (!email.trim())    { setError('Email required'); return; }
    if (!password)        { setError('Password required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError('');
    setLoading(true);

    try {
      // Connect without password first (guest), then REGISTER
      connect({ url: server.trim(), nick: nick.trim(), realname: nick.trim() });

      // Wait for connection
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

      // Send NickServ REGISTER command
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
        <div className="verify-icon">✉️</div>
        <h3 className="verify-title">Check your email</h3>
        <p className="verify-text">
          A verification code was sent to <strong>{email}</strong>.
          Check your email and follow the instructions to complete registration.
        </p>
        <p className="verify-text" style={{ marginTop: 8, fontSize: 13 }}>
          After verifying, you can sign in with your nickname and password.
        </p>
        <button className="link-btn" onClick={onSwitch}>Go to sign in</button>

        <style>{`
          .verify-step { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 8px 0; }
          .verify-icon { font-size: 40px; }
          .verify-title { font-size: 18px; font-weight: 600; color: var(--text-primary); }
          .verify-text { font-size: 14px; color: var(--text-secondary); text-align: center; line-height: 1.6; }
          .link-btn { color: var(--accent); background: none; border: none; cursor: pointer; font-size: 14px; margin-top: 8px; }
          .link-btn:hover { text-decoration: underline; }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="auth-form-fields">
      <FormField label="Username" required>
        <input
          type="text"
          placeholder="coolname"
          value={nick}
          onChange={e => setNick(e.target.value)}
          autoComplete="username"
          autoFocus
          maxLength={30}
          className="onyx-input"
          disabled={loading}
        />
      </FormField>

      <FormField label="Email" required hint="Used for account recovery">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          className="onyx-input"
          disabled={loading}
        />
      </FormField>

      <FormField label="Password" required>
        <input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          className="onyx-input"
          disabled={loading}
        />
      </FormField>

      <FormField label="Confirm Password" required>
        <input
          type="password"
          placeholder="••••••••"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="onyx-input"
          disabled={loading}
        />
      </FormField>

      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setAdvanced(a => !a)}
      >
        <span className={`advanced-arrow ${advanced ? 'open' : ''}`}>▸</span>
        Advanced
      </button>

      {advanced && (
        <FormField label="Server">
          <input
            type="text"
            placeholder="wss://server/gateway"
            value={server}
            onChange={e => setServer(e.target.value)}
            className="onyx-input"
            disabled={loading}
          />
        </FormField>
      )}

      {error && (
        <div className="auth-error">{error}</div>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading}>
        {loading ? 'Creating account…' : 'Create Account'}
      </Button>

      <p className="switch-link">
        Already have an account?{' '}
        <button type="button" className="link-btn" onClick={onSwitch}>
          Sign in
        </button>
      </p>

      <style>{`
        .auth-form-fields { display: flex; flex-direction: column; gap: 16px; }
        .onyx-input {
          width: 100%; padding: 10px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          color: var(--text-primary);
          font-size: 15px; font-family: inherit;
          transition: border-color var(--t-fast);
        }
        .onyx-input:focus { outline: none; border-color: var(--accent-border); box-shadow: 0 0 0 3px var(--accent-subtle); }
        .onyx-input:disabled { opacity: 0.5; cursor: not-allowed; }
        .advanced-toggle {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; color: var(--text-secondary);
          background: none; border: none; cursor: pointer; padding: 0;
          transition: color var(--t-fast); align-self: flex-start;
        }
        .advanced-toggle:hover { color: var(--text-primary); }
        .advanced-arrow { display: inline-block; transition: transform var(--t-fast); font-size: 11px; }
        .advanced-arrow.open { transform: rotate(90deg); }
        .auth-error { padding: 10px 14px; background: var(--danger-subtle); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
        .switch-link { text-align: center; font-size: 13px; color: var(--text-secondary); }
        .link-btn { color: var(--accent); background: none; border: none; cursor: pointer; font-size: inherit; font-family: inherit; }
        .link-btn:hover { text-decoration: underline; }
      `}</style>
    </form>
  );
}
