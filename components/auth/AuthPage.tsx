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
        <div className="auth-bg-grid" />
        <div className="auth-bg-orb auth-bg-orb-1" />
        <div className="auth-bg-orb auth-bg-orb-2" />
        <div className="auth-bg-orb auth-bg-orb-3" />
      </div>

      {/* Card */}
      <div className="auth-card animate-scale-in">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <OceanLogo />
          </div>
          <span className="auth-logo-text">Ocean</span>
          <span className="auth-logo-tagline">Deep-sea IRC · eshmaki.me</span>
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

        /* Fine dot grid — more visible, centered fade */
        .auth-bg-grid {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, var(--border-normal) 1px, transparent 1px);
          background-size: 32px 32px;
          mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 100%);
          opacity: 0.5;
          animation: grid-drift 25s ease-in-out infinite alternate;
        }
        @keyframes grid-drift {
          0%   { transform: translate(0, 0); }
          100% { transform: translate(12px, 16px); }
        }

        /* Atmospheric depth orbs */
        .auth-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
        }

        /* Primary — large accent blue, top-left */
        .auth-bg-orb-1 {
          width: 900px; height: 900px;
          background: radial-gradient(circle, var(--accent) 0%, transparent 65%);
          top: -380px; left: -300px;
          opacity: 0.12;
          animation: orb-drift-1 22s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-1 {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(50px, 40px) scale(1.05); }
          66%  { transform: translate(-30px, 70px) scale(0.96); }
          100% { transform: translate(35px, -20px) scale(1.03); }
        }

        /* Secondary — gold/cyan, bottom-right */
        .auth-bg-orb-2 {
          width: 700px; height: 700px;
          background: radial-gradient(circle, var(--gold) 0%, transparent 65%);
          bottom: -250px; right: -200px;
          opacity: 0.08;
          animation: orb-drift-2 28s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-2 {
          0%   { transform: translate(0, 0) scale(1); }
          40%  { transform: translate(-45px, -35px) scale(1.06); }
          100% { transform: translate(30px, 50px) scale(0.94); }
        }

        /* Tertiary — accent, mid right */
        .auth-bg-orb-3 {
          width: 480px; height: 480px;
          background: radial-gradient(circle, var(--accent) 0%, transparent 65%);
          top: 40%; right: 10%;
          opacity: 0.06;
          animation: orb-drift-3 35s ease-in-out infinite alternate;
        }
        @keyframes orb-drift-3 {
          0%   { transform: translate(0, 0); }
          50%  { transform: translate(40px, -55px); }
          100% { transform: translate(-35px, 30px); }
        }

        /* ── Card ── */
        .auth-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 480px;
          background: linear-gradient(
            160deg,
            var(--bg-elevated) 0%,
            var(--bg-deep) 100%
          );
          border: 1px solid var(--border-normal);
          border-radius: 20px;
          padding: 44px 40px;
          box-shadow:
            0 32px 80px rgba(0,0,0,0.7),
            0 0 0 1px var(--border-subtle),
            0 0 120px rgba(14,165,233,0.06),
            inset 0 1px 0 var(--border-normal);
        }

        /* Top edge shimmer line — animated */
        .auth-card::before {
          content: '';
          position: absolute;
          top: 0; left: 24px; right: 24px;
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, var(--accent) 25%, var(--gold) 50%, var(--accent) 75%, transparent 100%);
          background-size: 200% 100%;
          border-radius: 100%;
          opacity: 0.6;
          animation: shimmer-slide 4s ease-in-out infinite;
        }
        @keyframes shimmer-slide {
          0%   { background-position: 100% 0; opacity: 0.4; }
          50%  { background-position: 0% 0;   opacity: 0.7; }
          100% { background-position: 100% 0; opacity: 0.4; }
        }

        /* Subtle inner ambient glow */
        .auth-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 200px;
          background: radial-gradient(ellipse 80% 100% at 50% 0%, rgba(14,165,233,0.04) 0%, transparent 100%);
          border-radius: 20px 20px 0 0;
          pointer-events: none;
        }

        /* ── Logo section ── */
        .auth-logo {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          margin-bottom: 8px;
          padding-bottom: 28px;
          border-bottom: 1px solid var(--border-subtle);
          position: relative;
          z-index: 1;
        }

        /* Logo icon container with pulse/glow animation */
        .auth-logo-icon {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: logo-pulse 3s ease-in-out infinite;
        }
        .auth-logo-icon::before {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 18px;
          background: radial-gradient(circle, var(--accent) 0%, transparent 70%);
          opacity: 0;
          animation: logo-glow 3s ease-in-out infinite;
        }
        @keyframes logo-pulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 8px rgba(14,165,233,0.4)); }
          50%       { transform: scale(1.04); filter: drop-shadow(0 0 20px rgba(14,165,233,0.7)); }
        }
        @keyframes logo-glow {
          0%, 100% { opacity: 0; transform: scale(0.8); }
          50%       { opacity: 0.15; transform: scale(1.2); }
        }

        .auth-logo-text {
          font-size: 30px;
          font-weight: 900;
          letter-spacing: -1.2px;
          line-height: 1;
          background: linear-gradient(135deg, var(--text-primary) 20%, var(--accent) 60%, var(--gold) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .auth-logo-tagline {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          -webkit-text-fill-color: var(--text-muted);
        }

        /* ── Tabs ── */
        .auth-tabs {
          display: flex;
          gap: 3px;
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 4px;
          margin: 28px 0 26px;
          position: relative;
          z-index: 1;
        }

        .auth-tab {
          flex: 1;
          padding: 10px 16px;
          border-radius: calc(var(--r-md) - 2px);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          transition: all var(--t-normal) var(--ease-out);
          font-family: inherit;
          letter-spacing: 0.02em;
        }

        .auth-tab:hover {
          color: var(--text-secondary);
          background: rgba(14,165,233,0.05);
        }

        .auth-tab--active {
          background: linear-gradient(135deg, var(--bg-elevated), var(--bg-float));
          color: var(--text-primary);
          font-weight: 700;
          box-shadow: 0 1px 6px rgba(0,0,0,0.4), 0 0 0 1px var(--border-normal);
        }

        .auth-form-area {
          min-height: 280px;
          position: relative;
          z-index: 1;
        }

        .auth-footer {
          text-align: center;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 0.02em;
          position: relative;
          z-index: 1;
        }

        .text-accent {
          color: var(--accent);
          font-weight: 700;
        }

        /* ── Mobile ─────────────────────────────────────────────────────────── */
        @media (max-width: 480px) {
          .auth-root {
            padding: 16px;
            align-items: flex-start;
            padding-top: max(32px, env(safe-area-inset-top, 0px));
            padding-bottom: max(24px, env(safe-area-inset-bottom, 0px));
          }
          .auth-card {
            padding: 28px 20px;
            border-radius: 16px;
            max-width: 100%;
          }
          .auth-logo-text { font-size: 24px; letter-spacing: -0.8px; }
          .auth-logo { gap: 10px; padding-bottom: 20px; margin-bottom: 4px; }
          .auth-tabs { margin: 20px 0 18px; }
          .auth-tab { padding: 9px 12px; font-size: 12.5px; }
          .auth-form-area { min-height: 240px; }
          .auth-bg-orb-1 { width: 500px; height: 500px; top: -200px; left: -150px; }
          .auth-bg-orb-2 { width: 400px; height: 400px; bottom: -150px; right: -100px; }
          .auth-bg-orb-3 { width: 300px; height: 300px; }
        }

        @media (max-width: 375px) {
          .auth-root { padding: 12px; }
          .auth-card { padding: 24px 16px; }
          .auth-logo-text { font-size: 22px; }
        }

        /* Flush card — no radius on tiny screens */
        @media (max-width: 360px) {
          .auth-root { padding: 0; align-items: flex-start; }
          .auth-card {
            border-radius: 0;
            border-left: none;
            border-right: none;
            padding: 20px 16px;
            max-width: 100%;
            width: 100%;
          }
          .auth-card::before { left: 0; right: 0; border-radius: 0; }
        }
      `}</style>
    </div>
  );
}

function OceanLogo() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect width="44" height="44" rx="12" fill="url(#logo-grad)" />
      <path
        d="M22 9L33 15.5V26.5L22 33L11 26.5V15.5L22 9Z"
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="rgba(255,255,255,0.1)"
      />
      <circle cx="22" cy="22" r="5" fill="white" fillOpacity="0.92" />
      <circle cx="22" cy="22" r="2.5" fill="url(#logo-grad)" fillOpacity="0.8" />
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
    </svg>
  );
}
