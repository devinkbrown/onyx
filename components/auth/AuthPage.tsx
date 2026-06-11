'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOnyxStore } from '@/lib/store';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';

type Tab = 'login' | 'register';

export default function AuthPage() {
  const [tab, setTab] = useState<Tab>('login');
  const status = useOnyxStore(s => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === 'connected') router.push('/app');
  }, [status, router]);

  return (
    <main className="auth-root" data-testid="auth-page">
      <section className="auth-stage" aria-label="Ocean sign in">
        <aside className="auth-brand" aria-hidden="true">
          <div className="auth-brand-grain" />
          <div className="auth-brand-content">
            <OceanLogo />
            <p className="auth-kicker">eshmaki.me</p>
            <h1 className="auth-wordmark">Ocean</h1>
            <p className="auth-brand-copy">
              Lacquered chat for Ophion communities, LADON media, and session-safe identity.
            </p>
            <div className="auth-brand-meter">
              <span />
              <strong>Orochi ready</strong>
            </div>
          </div>
        </aside>

        <section className="auth-panel elev-1">
          <div className="auth-panel-head">
            <div>
              <p className="auth-panel-kicker label-caps">Account</p>
              <h2 className="auth-panel-title">{tab === 'login' ? 'Welcome back' : 'Create access'}</h2>
            </div>
            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'login'}
                className="auth-tab"
                data-active={tab === 'login'}
                data-testid="auth-tab-login"
                onClick={() => setTab('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'register'}
                className="auth-tab"
                data-active={tab === 'register'}
                data-testid="auth-tab-register"
                onClick={() => setTab('register')}
              >
                Register
              </button>
            </div>
          </div>

          <div className="auth-form-area">
            {tab === 'login'
              ? <LoginForm onSwitch={() => setTab('register')} />
              : <RegisterForm onSwitch={() => setTab('login')} />
            }
          </div>

          <div className="auth-footer">
            <span className="auth-status-dot" aria-hidden="true" />
            <span>Ophion gateway</span>
          </div>
        </section>
      </section>

      <style>{`
        .auth-root {
          min-height: 100dvh;
          display: grid;
          place-items: center;
          padding: var(--sp-8, 32px);
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-void) 94%, var(--lux) 6%), var(--bg-void)),
            var(--bg-void);
          color: var(--text-primary);
          overflow: hidden;
        }

        .auth-stage {
          width: min(1120px, 100%);
          min-height: min(720px, calc(100dvh - var(--sp-16, 64px)));
          display: grid;
          grid-template-columns: 45fr 55fr;
          border-radius: var(--r-2xl, 20px) var(--r-lg, 12px) var(--r-2xl, 20px) var(--r-md, 8px);
          overflow: hidden;
          background: color-mix(in srgb, var(--bg-base) 92%, transparent);
          box-shadow: var(--elev-shadow-3, 0 32px 96px rgba(0,0,0,.52));
        }

        .auth-brand {
          position: relative;
          min-height: 100%;
          overflow: hidden;
          background:
            linear-gradient(130deg, rgba(216,185,106,.18), transparent 36%),
            radial-gradient(110% 80% at 10% 8%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 58%),
            linear-gradient(180deg, color-mix(in srgb, var(--bg-void) 78%, var(--lux) 22%), var(--bg-void));
          animation: depth-drift 18s var(--ease-in-out, ease-in-out) infinite alternate;
        }

        .auth-brand::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(255,255,255,.045), transparent 34%, rgba(255,255,255,.026) 35%, transparent 67%),
            linear-gradient(180deg, transparent, rgba(0,0,0,.28));
          mix-blend-mode: screen;
          opacity: .42;
        }

        .auth-brand-grain {
          position: absolute;
          inset: -40%;
          opacity: .13;
          background-image:
            repeating-radial-gradient(circle at 20% 30%, rgba(255,255,255,.4) 0 1px, transparent 1px 3px),
            repeating-linear-gradient(115deg, transparent 0 6px, rgba(255,255,255,.16) 6px 7px);
          transform: rotate(8deg);
          animation: grain-walk 11s steps(8) infinite;
        }

        .auth-brand-content {
          position: relative;
          z-index: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: var(--sp-16, 64px);
        }

        .auth-logo {
          width: 64px;
          height: 64px;
          margin-bottom: var(--sp-10, 40px);
          filter: drop-shadow(0 18px 30px rgba(0,0,0,.38));
        }

        .auth-kicker {
          margin: 0 0 var(--sp-2, 8px);
          color: var(--lux);
          font-size: var(--text-xs, .75rem);
          font-weight: 800;
          letter-spacing: .14em;
          text-transform: uppercase;
        }

        .auth-wordmark {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(4rem, 9vw, 7.8rem);
          font-weight: 800;
          line-height: .82;
          letter-spacing: 0;
          color: var(--text-primary);
        }

        .auth-brand-copy {
          max-width: 360px;
          margin: var(--sp-6, 24px) 0 0;
          color: var(--text-secondary);
          font-size: var(--text-lg, 1.0625rem);
          line-height: 1.55;
        }

        .auth-brand-meter {
          width: min(300px, 100%);
          display: flex;
          align-items: center;
          gap: var(--sp-3, 12px);
          margin-top: var(--sp-10, 40px);
          color: var(--text-secondary);
          font-size: var(--text-xs, .75rem);
          font-weight: 750;
          text-transform: uppercase;
          letter-spacing: .1em;
        }

        .auth-brand-meter span {
          width: 40px;
          height: 2px;
          background: var(--lux);
          box-shadow: 42px 0 0 color-mix(in srgb, var(--lux) 44%, transparent), 84px 0 0 color-mix(in srgb, var(--lux) 18%, transparent);
        }

        .auth-panel {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: var(--sp-12, 48px);
          background:
            linear-gradient(180deg, var(--elev-tint-1, transparent), transparent 46%),
            var(--bg-elevated);
        }

        .auth-panel-head {
          display: flex;
          justify-content: space-between;
          gap: var(--sp-5, 20px);
          align-items: flex-start;
          margin-bottom: var(--sp-8, 32px);
        }

        .auth-panel-kicker,
        .auth-panel-title {
          margin: 0;
        }

        .auth-panel-title {
          margin-top: var(--sp-1, 4px);
          font-family: var(--font-display);
          font-size: var(--text-3xl, 2rem);
          line-height: 1.05;
          letter-spacing: 0;
          color: var(--text-primary);
        }

        .auth-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--sp-1, 4px);
          padding: var(--sp-1, 4px);
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-lg, 12px);
          background: color-mix(in srgb, var(--bg-base) 88%, var(--lux) 12%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
        }

        .auth-tab {
          border: 0;
          border-radius: var(--r-md, 8px) var(--r-xs, 4px) var(--r-md, 8px) var(--r-sm, 6px);
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          font: inherit;
          font-size: var(--text-sm, .8125rem);
          font-weight: 750;
          padding: var(--sp-2, 8px) var(--sp-4, 16px);
          transition: background var(--t-control, 150ms) var(--ease-out), color var(--t-control, 150ms) var(--ease-out), transform var(--t-control, 150ms) var(--ease-out);
        }

        .auth-tab:hover,
        .auth-tab:focus-visible {
          color: var(--text-primary);
          outline: none;
        }

        .auth-tab[data-active="true"] {
          background: color-mix(in srgb, var(--lux) 14%, var(--bg-elevated));
          color: var(--lux);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 8px 18px rgba(0,0,0,.22);
        }

        .auth-form-area {
          min-height: 470px;
        }

        .auth-footer {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          margin-top: var(--sp-6, 24px);
          color: var(--text-muted);
          font-size: var(--text-xs, .75rem);
          font-weight: 700;
        }

        .auth-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--status-online, #3ba55d);
        }

        @keyframes depth-drift {
          from { background-position: 0 0, 0 0, 0 0; }
          to { background-position: 28px -18px, -24px 18px, 0 0; }
        }

        @keyframes grain-walk {
          to { transform: rotate(8deg) translate3d(3%, -2%, 0); }
        }

        @media (max-width: 760px) {
          .auth-root {
            padding: 0;
            align-items: stretch;
          }

          .auth-stage {
            min-height: 100dvh;
            grid-template-columns: 1fr;
            border-radius: 0;
          }

          .auth-brand {
            min-height: 220px;
          }

          .auth-brand-content {
            padding: var(--sp-8, 32px);
          }

          .auth-logo {
            width: 46px;
            height: 46px;
            margin-bottom: var(--sp-4, 16px);
          }

          .auth-wordmark {
            font-size: clamp(3.4rem, 19vw, 5.5rem);
          }

          .auth-brand-copy,
          .auth-brand-meter {
            display: none;
          }

          .auth-panel {
            justify-content: flex-start;
            padding: var(--sp-8, 32px) var(--sp-5, 20px);
          }

          .auth-panel-head {
            flex-direction: column;
            margin-bottom: var(--sp-6, 24px);
          }

          .auth-tabs {
            width: 100%;
          }
        }

        @media (max-width: 360px) {
          .auth-panel {
            padding-inline: var(--sp-4, 16px);
          }

          .auth-panel-title {
            font-size: var(--text-2xl, 1.5rem);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .auth-brand,
          .auth-brand-grain,
          .auth-tab {
            animation: none;
            transition-duration: .001ms;
          }
        }
      `}</style>
    </main>
  );
}

function OceanLogo() {
  return (
    <svg className="auth-logo" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="var(--bg-void)" />
      <rect x="1" y="1" width="62" height="62" rx="17" stroke="rgba(255,255,255,.12)" />
      <circle cx="32" cy="32" r="21" stroke="var(--lux)" strokeOpacity=".36" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="13" stroke="var(--text-secondary)" strokeOpacity=".28" strokeWidth="1.5" />
      <path d="M32 32 45 17" stroke="var(--lux)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="32" r="3.8" fill="var(--lux)" />
    </svg>
  );
}
