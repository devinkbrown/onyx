'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  onSwitch: () => void;
}

const DEFAULT_SERVER = process.env.NEXT_PUBLIC_IRC_WS ?? 'wss://eshmaki.me:8080';
const NICK_RE = /^[a-zA-Z0-9\-_\[\]{}\\|`^]{1,30}$/;

type RegisterStep = 0 | 1 | 2;
type StrengthLevel = 0 | 1 | 2 | 3 | 4;

const STEP_LABELS = ['Identity', 'Password', 'Confirm'] as const;

function passwordStrength(password: string): StrengthLevel {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4) as StrengthLevel;
}

function waitForConnected(): Promise<void> {
  if (useOnyxStore.getState().status === 'connected') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsub();
      reject(new Error('Connection timed out'));
    }, 15000);

    const unsub = useOnyxStore.subscribe(
      state => state.status,
      status => {
        if (status === 'connected') {
          window.clearTimeout(timeout);
          unsub();
          resolve();
        }

        if (status === 'error') {
          window.clearTimeout(timeout);
          unsub();
          reject(new Error('Connection failed'));
        }
      },
    );
  });
}

export default function RegisterForm({ onSwitch }: Props) {
  const connect = useOnyxStore(s => s.connect);
  const registerAccount = useOnyxStore(s => s.registerAccount);
  const verifyAccount = useOnyxStore(s => s.verifyAccount);
  const registerPending = useOnyxStore(s => s.registerPending);
  const registerError = useOnyxStore(s => s.registerError);
  const verifyRequired = useOnyxStore(s => s.verifyRequired);

  const [step, setStep] = useState<RegisterStep>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [nick, setNick] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [localError, setLocalError] = useState('');
  const [shakeField, setShakeField] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [complete, setComplete] = useState(false);

  const nickRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nickRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!submitted || registerPending || registerError || verifyRequired) return;
    setComplete(true);
  }, [registerError, registerPending, submitted, verifyRequired]);

  const cleanNick = nick.trim();
  const nickError = cleanNick && !NICK_RE.test(cleanNick)
    ? 'Use 1-30 IRC-safe characters'
    : '';
  const availability = useMemo(() => {
    if (!cleanNick) return 'Enter a nickname';
    if (nickError) return 'Not ready';
    if (cleanNick.length < 3) return 'Still too short';
    return 'Looks available';
  }, [cleanNick, nickError]);

  const strength = passwordStrength(password);
  const strengthText = ['Add a password', 'Fragile', 'Usable', 'Strong', 'Lacquered'][strength];
  const passwordError = password && password.length < 8 ? 'Use at least 8 characters' : '';
  const confirmError = confirm && password !== confirm ? 'Passwords do not match' : '';
  const activeError = localError || registerError || '';

  const setStepSafely = (next: RegisterStep) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setLocalError('');
  };

  const shake = (field: string, message: string) => {
    setLocalError(message);
    setShakeField(field);
    window.setTimeout(() => setShakeField(''), 240);
  };

  const next = () => {
    if (step === 0) {
      if (!cleanNick) return shake('nick', 'Nickname is required');
      if (nickError || cleanNick.length < 3) return shake('nick', nickError || 'Use at least 3 characters');
      return setStepSafely(1);
    }

    if (step === 1) {
      if (!password) return shake('password', 'Password is required');
      if (password.length < 8) return shake('password', 'Use at least 8 characters');
      return setStepSafely(2);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (complete) {
      onSwitch();
      return;
    }

    if (verifyRequired) {
      if (!verifyCode.trim()) {
        shake('verify', 'Verification code is required');
        return;
      }
      setSubmitted(true);
      setLocalError('');
      verifyAccount(cleanNick, verifyCode.trim());
      return;
    }

    if (password !== confirm) {
      shake('confirm', 'Passwords do not match');
      return;
    }

    if (password.length < 8 || !cleanNick || nickError) {
      shake('confirm', 'Check your identity and password first');
      return;
    }

    try {
      setSubmitted(true);
      setLocalError('');
      connect({ url: DEFAULT_SERVER, nick: cleanNick, realname: cleanNick });
      await waitForConnected();
      registerAccount(cleanNick, email.trim() || undefined, password);
    } catch (error) {
      setSubmitted(false);
      shake('confirm', error instanceof Error ? error.message : 'Registration failed');
    }
  };

  if (complete) {
    return (
      <div className="register-form register-complete" data-testid="register-complete">
        <div className="complete-mark" aria-hidden="true">
          <CheckIcon />
        </div>
        <p className="step-kicker label-caps">Registered</p>
        <h3>Access created</h3>
        <p>
          <strong>{cleanNick}</strong> is registered on Orochi. Sign in with the
          same password — tick <em>Stay signed in</em> and Ocean keeps a session
          token so you skip it next time.
        </p>
        <button type="button" className="lux-button" onClick={onSwitch}>Sign in</button>
        <RegisterStyles />
      </div>
    );
  }

  return (
    <form
      className="register-form"
      data-testid="register-form"
      data-direction={direction}
      onSubmit={submit}
      noValidate
    >
      <div className="stepper" aria-label={`Step ${step + 1} of 3`}>
        {STEP_LABELS.map((label, index) => (
          <button
            key={label}
            type="button"
            className="step-dot"
            data-active={index === step}
            data-done={index < step}
            disabled={index > step}
            onClick={() => setStepSafely(index as RegisterStep)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="slide-lock">
        {step === 0 && (
          <section className="step-panel" data-testid="register-step-identity">
            <p className="step-kicker label-caps">Step 1</p>
            <h3>Choose your identity</h3>
            <FloatingField label="Nickname" active={Boolean(nick)} error={shakeField === 'nick' || Boolean(nickError)}>
              <input
                ref={nickRef}
                data-testid="register-nick"
                value={nick}
                onChange={event => {
                  setNick(event.target.value);
                  setLocalError('');
                }}
                autoComplete="username"
                maxLength={30}
              />
            </FloatingField>
            <div className="availability" data-state={!cleanNick || nickError || cleanNick.length < 3 ? 'pending' : 'available'}>
              <span aria-hidden="true" />
              {availability}
            </div>
            <FloatingField label="Recovery email" active={Boolean(email)} aside="Optional">
              <input
                data-testid="register-email"
                value={email}
                type="email"
                onChange={event => setEmail(event.target.value)}
                autoComplete="email"
              />
            </FloatingField>
            <p className="field-note">
              Registration uses Orochi&rsquo;s built-in <code>REGISTER</code> command
              (draft/account-registration). No NickServ bot — results come back as
              standard server replies.
            </p>
          </section>
        )}

        {step === 1 && (
          <section className="step-panel" data-testid="register-step-password">
            <p className="step-kicker label-caps">Step 2</p>
            <h3>Set the key</h3>
            <FloatingField label="Password" active={Boolean(password)} error={shakeField === 'password' || Boolean(passwordError)}>
              <input
                data-testid="register-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={event => {
                  setPassword(event.target.value);
                  setLocalError('');
                }}
                autoComplete="new-password"
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
            <div className="strength" aria-label={`Password strength: ${strengthText}`}>
              {[1, 2, 3, 4].map(segment => (
                <span key={segment} data-lit={segment <= strength} data-level={strength} />
              ))}
            </div>
            <p className="strength-copy">{strengthText}</p>
            <p className="field-note">
              <ShieldIcon />
              This becomes your SASL secret. Ocean signs in with
              {' '}<strong>SCRAM-SHA-256</strong> when the server offers it, so your
              password is never sent in the clear.
            </p>
          </section>
        )}

        {step === 2 && (
          <section className="step-panel" data-testid="register-step-confirm">
            <p className="step-kicker label-caps">Step 3</p>
            <h3>{verifyRequired ? 'Verify access' : 'Confirm access'}</h3>
            {!verifyRequired ? (
              <>
                <FloatingField label="Confirm password" active={Boolean(confirm)} error={shakeField === 'confirm' || Boolean(confirmError)}>
                  <input
                    data-testid="register-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={event => {
                      setConfirm(event.target.value);
                      setLocalError('');
                    }}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="field-icon-button"
                    onClick={() => setShowConfirm(value => !value)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </FloatingField>
                <div className="confirm-card elev-1">
                  <span className="label-caps">Account</span>
                  <strong>{cleanNick || 'nickname'}</strong>
                  <small>{email.trim() || 'No recovery email'}</small>
                </div>
              </>
            ) : (
              <>
                <p className="verify-copy">
                  Orochi requested a verification code before activating{' '}
                  <strong>{cleanNick}</strong>.{' '}
                  {email.trim()
                    ? <>Check <strong>{email.trim()}</strong> for the code.</>
                    : <>The code was sent through the server.</>}
                </p>
                <FloatingField label="Verification code" active={Boolean(verifyCode)} error={shakeField === 'verify'}>
                  <input
                    data-testid="register-verify"
                    value={verifyCode}
                    onChange={event => {
                      setVerifyCode(event.target.value);
                      setLocalError('');
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </FloatingField>
                <p className="field-note">
                  Didn&rsquo;t get it? Once you&rsquo;re connected, run{' '}
                  <code>/VERIFY {cleanNick} &lt;code&gt;</code> or re-register to resend.
                </p>
              </>
            )}
          </section>
        )}
      </div>

      {activeError && (
        <p className="form-error" role="alert" data-testid="register-error">
          {activeError}
        </p>
      )}

      <div className="register-actions">
        {step > 0 && !verifyRequired && (
          <button type="button" className="quiet-button" onClick={() => setStepSafely((step - 1) as RegisterStep)}>
            Back
          </button>
        )}
        {step < 2 ? (
          <button type="button" className="lux-button" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="submit" className="lux-button" disabled={registerPending} data-testid="register-submit">
            {registerPending ? 'Creating' : verifyRequired ? 'Verify' : 'Create account'}
          </button>
        )}
      </div>

      <p className="switch-line">
        Already registered? <button type="button" onClick={onSwitch}>Sign in</button>
      </p>

      <RegisterStyles />
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
  error?: boolean;
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

function RegisterStyles() {
  return (
    <style>{`
      .register-form {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4, 16px);
      }

      .stepper {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--sp-2, 8px);
      }

      .step-dot {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--sp-2, 8px);
        border: 0;
        border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-xs, 4px);
        background: color-mix(in srgb, var(--bg-base) 88%, var(--lux) 12%);
        color: var(--text-muted);
        cursor: pointer;
        font: inherit;
        font-size: var(--text-xs, .75rem);
        font-weight: 800;
        padding: var(--sp-2, 8px);
      }

      .step-dot span {
        width: 20px;
        height: 20px;
        display: grid;
        place-items: center;
        border-radius: var(--r-xs, 4px);
        background: color-mix(in srgb, var(--text-muted) 14%, transparent);
        color: var(--text-secondary);
      }

      .step-dot[data-active="true"] {
        color: var(--lux);
        background: color-mix(in srgb, var(--lux) 13%, var(--bg-elevated));
      }

      .step-dot[data-active="true"] span,
      .step-dot[data-done="true"] span {
        background: var(--lux);
        color: var(--bg-void);
      }

      .step-dot:disabled {
        cursor: not-allowed;
        opacity: .48;
      }

      .slide-lock {
        min-height: 330px;
        overflow: hidden;
        position: relative;
      }

      .step-panel {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4, 16px);
        animation: step-slide var(--t-surface, 220ms) var(--ease-out) both;
      }

      .register-form[data-direction="-1"] .step-panel {
        animation-name: step-slide-back;
      }

      @keyframes step-slide {
        from { opacity: 0; transform: translateX(18px); }
        to { opacity: 1; transform: translateX(0); }
      }

      @keyframes step-slide-back {
        from { opacity: 0; transform: translateX(-18px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .step-kicker,
      .step-panel h3,
      .register-complete h3,
      .register-complete p {
        margin: 0;
      }

      .step-panel h3,
      .register-complete h3 {
        font-family: var(--font-display);
        font-size: var(--text-2xl, 1.5rem);
        line-height: 1.1;
        color: var(--text-primary);
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

      .float-field[data-error="true"] input {
        animation: field-shake var(--t-surface, 220ms) var(--ease-out);
        outline-color: color-mix(in srgb, var(--danger) 78%, transparent);
      }

      @keyframes field-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-2px); }
        50% { transform: translateX(2px); }
        75% { transform: translateX(-2px); }
      }

      .float-field input:focus {
        outline-color: var(--lux);
        background: color-mix(in srgb, var(--bg-elevated) 92%, var(--lux) 8%);
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

      .availability {
        display: flex;
        align-items: center;
        gap: var(--sp-2, 8px);
        color: var(--text-muted);
        font-size: var(--text-sm, .8125rem);
        font-weight: 700;
      }

      .availability span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--warning, #f59e0b);
      }

      .availability[data-state="available"] {
        color: var(--status-online, #3ba55d);
      }

      .availability[data-state="available"] span {
        background: var(--status-online, #3ba55d);
      }

      .strength {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--sp-2, 8px);
      }

      .strength span {
        height: 7px;
        border-radius: var(--r-xs, 4px);
        background: color-mix(in srgb, var(--text-muted) 18%, transparent);
      }

      .strength span[data-lit="true"][data-level="1"] { background: var(--danger); }
      .strength span[data-lit="true"][data-level="2"] { background: var(--warning); }
      .strength span[data-lit="true"][data-level="3"] { background: color-mix(in srgb, var(--lux) 76%, var(--status-online)); }
      .strength span[data-lit="true"][data-level="4"] { background: var(--status-online, #3ba55d); }

      .strength-copy,
      .verify-copy,
      .form-error,
      .switch-line,
      .register-complete p {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm, .8125rem);
        line-height: 1.5;
      }

      .register-complete em {
        color: var(--text-secondary);
        font-style: normal;
        font-weight: 800;
      }

      .field-note {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2, 8px);
        margin: calc(var(--sp-1, 4px) * -1) 0 0;
        padding: var(--sp-2, 8px) var(--sp-3, 12px);
        border-radius: var(--r-md, 8px) var(--r-xs, 4px) var(--r-md, 8px) var(--r-sm, 6px);
        background: color-mix(in srgb, var(--accent) 6%, transparent);
        box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
        color: var(--text-muted);
        font-size: var(--text-xs, .75rem);
        line-height: 1.5;
      }

      .field-note strong { color: var(--text-secondary); font-weight: 800; }

      .field-note svg {
        flex-shrink: 0;
        margin-top: 1px;
        width: 14px;
        height: 14px;
        color: var(--accent);
      }

      .field-note code {
        font-family: var(--font-mono);
        font-size: .92em;
        color: var(--lux);
        background: color-mix(in srgb, var(--lux) 11%, transparent);
        padding: 0 4px;
        border-radius: 4px;
        word-break: break-word;
      }

      .form-error {
        color: var(--danger);
        padding: var(--sp-3, 12px);
        border-radius: var(--r-md, 8px) var(--r-xs, 4px) var(--r-md, 8px) var(--r-sm, 6px);
        background: color-mix(in srgb, var(--danger) 10%, transparent);
        box-shadow: inset 2px 0 0 var(--danger);
      }

      .confirm-card {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1, 4px);
        padding: var(--sp-4, 16px);
        border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-lg, 12px);
        background: var(--bg-elevated);
      }

      .confirm-card strong {
        color: var(--text-primary);
        font-family: var(--font-display);
        font-size: var(--text-xl, 1.25rem);
      }

      .confirm-card small {
        color: var(--text-muted);
      }

      .register-actions {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--sp-3, 12px);
        align-items: center;
      }

      .register-actions .lux-button {
        grid-column: 2;
      }

      .register-actions .lux-button:first-child {
        grid-column: 1 / -1;
      }

      .lux-button,
      .quiet-button {
        height: 48px;
        border: 0;
        border-radius: var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px);
        cursor: pointer;
        font: inherit;
        font-size: var(--text-sm, .8125rem);
        font-weight: 850;
      }

      .lux-button {
        background: color-mix(in srgb, var(--accent) 88%, black 12%);
        color: white;
        letter-spacing: .05em;
        text-transform: uppercase;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 16px 28px rgba(0,0,0,.28);
      }

      .quiet-button {
        min-width: 92px;
        padding: 0 var(--sp-4, 16px);
        background: color-mix(in srgb, var(--bg-base) 88%, var(--lux) 12%);
        color: var(--text-secondary);
      }

      .lux-button:hover:not(:disabled),
      .lux-button:focus-visible,
      .quiet-button:hover,
      .quiet-button:focus-visible {
        filter: brightness(1.06);
        outline: none;
      }

      .lux-button:disabled {
        cursor: wait;
        opacity: .62;
      }

      .switch-line {
        color: var(--text-muted);
        text-align: center;
      }

      .switch-line button {
        border: 0;
        background: transparent;
        color: var(--lux);
        cursor: pointer;
        font: inherit;
        font-weight: 760;
      }

      .register-complete {
        align-items: center;
        text-align: center;
        padding-top: var(--sp-8, 32px);
      }

      .complete-mark {
        width: 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border-radius: var(--r-2xl, 20px) var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px);
        background: color-mix(in srgb, var(--status-online) 14%, var(--bg-elevated));
        color: var(--status-online);
      }

      .complete-mark svg {
        width: 34px;
        height: 34px;
      }

      @media (max-width: 380px) {
        .step-dot {
          flex-direction: column;
          gap: var(--sp-1, 4px);
          font-size: var(--text-2xs, .6875rem);
        }

        .slide-lock {
          min-height: 356px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .step-panel,
        .float-field[data-error="true"] input,
        .float-field input,
        .float-label {
          animation: none;
          transition-duration: .001ms;
        }
      }
    `}</style>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5 9.2 17 19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M7.5 1 2 3.2v4c0 3.4 2.4 6.2 5.5 7.3C10.6 13.4 13 10.6 13 7.2v-4L7.5 1Z" strokeLinejoin="round" />
      <path d="M5.4 7.4 7 9l2.8-2.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
