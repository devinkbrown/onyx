'use client';

import { useState, useEffect } from 'react';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import { useOnyxStore } from '@/lib/store';
import { useRouter } from 'next/navigation';

type Tab = 'login' | 'register';

export default function AuthPage() {
  const [tab, setTab] = useState<Tab>('login');
  const status = useOnyxStore(s => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === 'connected') {
      router.push('/app');
    }
  }, [status, router]);

  return (
    <div className="auth-root">
      {/* Background */}
      <div className="auth-bg">
        {/* Dot grid pattern */}
        <div className="auth-bg-grid" />
        {/* Drifting orbs */}
        <div className="auth-bg-orb auth-bg-orb-1" />
        <div className="auth-bg-orb auth-bg-orb-2" />
        <div className="auth-bg-orb auth-bg-orb-3" />
      </div>

      {/* Card */}
      <div className="auth-card animate-scale-in">
        {/* Logo */}
        <div className="auth-logo">
          <OceanLogo />
          <span className="auth-logo-text">Ocean</span>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => setTab('login')}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${tab === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => setTab('register')}
          >
            Register
          </button>
        </div>

        {/* Form */}
        <div className="auth-form-area">
          {tab === 'login'
            ? <LoginForm onSwitch={() => setTab('register')} />
            : <RegisterForm onSwitch={() => setTab('login')} />
          }
        </div>

        {/* Footer */}
        <p className="auth-footer">
          Powered by <span className="text-accent">Ophion</span>
        </p>
      </div>

      <style>{`
        .auth-root {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          position: relative;
          overflow: hidden;
          background: var(--bg-void);
        }

        /* ── Background layer ── */
        .auth-bg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }

        /* Subtle dot grid */
        .auth-bg-grid {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, rgba(14,165,233,0.12) 1px, transparent 1px);
          background-size: 28px 28px;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%);
          animation: grid-drift 20s ease-in-out infinite alternate;
        }
        @keyframes grid-drift {
          0%   { transform: translate(0, 0); }
          100% { transform: translate(8px, 12px); }
        }

        /* Orbs */
        .auth-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
        }

        .auth-bg-orb-1 {
          width: 640px; height: 640px;
          background: radial-gradient(circle, #0ea5e9 0%, transparent 68%);
          top: -220px; left: -160px;
          opacity: 0.16;
          animation: orb-drift-1 18s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-1 {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(40px, 30px) scale(1.04); }
          66%  { transform: translate(-20px, 50px) scale(0.97); }
          100% { transform: translate(25px, -15px) scale(1.02); }
        }

        .auth-bg-orb-2 {
          width: 460px; height: 460px;
          background: radial-gradient(circle, #67e8f9 0%, transparent 68%);
          bottom: -120px; right: -120px;
          opacity: 0.09;
          animation: orb-drift-2 24s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-2 {
          0%   { transform: translate(0, 0) scale(1); }
          40%  { transform: translate(-35px, -25px) scale(1.05); }
          100% { transform: translate(20px, 40px) scale(0.95); }
        }

        .auth-bg-orb-3 {
          width: 320px; height: 320px;
          background: radial-gradient(circle, #3b82f6 0%, transparent 68%);
          top: 45%; right: 18%;
          opacity: 0.07;
          animation: orb-drift-3 30s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-3 {
          0%   { transform: translate(0, 0); }
          50%  { transform: translate(30px, -40px); }
          100% { transform: translate(-25px, 20px); }
        }

        /* ── Card ── */
        .auth-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          padding: 36px 32px;
          box-shadow: var(--shadow-xl), 0 0 0 1px rgba(14,165,233,0.08);
        }

        .auth-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 28px;
        }

        .auth-logo-text {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.5px;
          color: var(--text-primary);
        }

        .auth-tabs {
          display: flex;
          gap: 4px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          padding: 4px;
          margin-bottom: 28px;
        }

        .auth-tab {
          flex: 1;
          padding: 8px 16px;
          border-radius: var(--r-sm);
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          background: none;
          border: none;
          cursor: pointer;
          transition: all var(--t-normal);
          font-family: inherit;
        }

        .auth-tab:hover { color: var(--text-primary); }

        .auth-tab--active {
          background: var(--bg-float);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
        }

        .auth-form-area {
          min-height: 280px;
        }

        .auth-footer {
          text-align: center;
          margin-top: 24px;
          font-size: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

function OceanLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="10" fill="url(#logo-grad)" />
      <path
        d="M18 8L28 14V22L18 28L8 22V14L18 8Z"
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="rgba(255,255,255,0.08)"
      />
      <circle cx="18" cy="18" r="4" fill="white" fillOpacity="0.9" />
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
    </svg>
  );
}
