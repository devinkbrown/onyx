'use client';

import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';

export default function OutgoingCallOverlay() {
  const voice = useOnyxStore(s => s.voice);
  const endDmCall = useOnyxStore(s => s.endDmCall);

  if (voice.callState !== 'ringing_out') return null;

  return (
    <div className="ocall-overlay" role="dialog" aria-modal aria-label="Calling">
      <div className="ocall-box">
        {/* Avatar with pulsing ring */}
        <div className="ocall-avatar-wrap">
          <div className="ocall-ring ocall-ring--1" aria-hidden />
          <div className="ocall-ring ocall-ring--2" aria-hidden />
          <Avatar nick={voice.callWith ?? 'Unknown'} size={72} />
        </div>
        <p className="ocall-label" aria-live="polite">
          Calling<span className="ocall-dots" aria-hidden>...</span>
        </p>
        <p className="ocall-nick">{voice.callWith}</p>
        <button
          className="ocall-cancel"
          onClick={() => endDmCall()}
          aria-label="Cancel call"
        >
          <PhoneOffIcon />
          <span>Cancel</span>
        </button>
      </div>
      <style>{`
        .ocall-overlay {
          position: fixed; inset: 0; z-index: 9998;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.72);
          backdrop-filter: blur(8px);
          animation: ocall-in 0.28s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes ocall-in {
          from { opacity: 0; transform: scale(0.88) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .ocall-box {
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          background: color-mix(in srgb, #050505 88%, var(--accent, #0ea5e9) 7%);
          border-radius: var(--r-md, 8px) var(--r-2xl, 20px) var(--r-lg, 14px) var(--r-xl, 16px); padding: 40px 56px;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-3, 0 24px 60px rgba(0,0,0,.52));
        }

        /* ── Avatar with expanding rings ── */
        .ocall-avatar-wrap {
          position: relative;
          width: 72px; height: 72px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 4px;
        }
        .ocall-ring {
          position: absolute;
          border-radius: 50%;
          border: 1.5px solid var(--accent);
          animation: ocall-ring-expand 2s ease-out infinite;
        }
        .ocall-ring--1 { width: 100%; height: 100%; animation-delay: 0s; }
        .ocall-ring--2 { width: 100%; height: 100%; animation-delay: 0.75s; }
        @keyframes ocall-ring-expand {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(1.8); opacity: 0; }
        }

        /* ── "Calling..." animated dots ── */
        .ocall-label {
          color: var(--text-secondary); font-size: 13px; margin: 0;
          letter-spacing: 0.02em;
        }
        .ocall-dots {
          display: inline-block;
          animation: ocall-dots 1.4s steps(4, end) infinite;
          width: 1.6em; text-align: left; overflow: hidden;
          vertical-align: bottom;
        }
        @keyframes ocall-dots {
          0%  { width: 0; }
          25% { width: 0.4em; }
          50% { width: 0.8em; }
          75% { width: 1.2em; }
          100%{ width: 1.6em; }
        }

        .ocall-nick {
          font-size: 22px; font-weight: 700;
          color: var(--text-primary); margin: 0;
          letter-spacing: -0.3px;
        }
        .ocall-cancel {
          margin-top: 4px; padding: 10px 24px;
          background: color-mix(in srgb, var(--danger, #f87171) 28%, #050505 72%); color: white; border: none;
          border-radius: var(--r-xl, 16px) var(--r-sm, 6px) var(--r-2xl, 20px) var(--r-md, 8px); font-size: 15px; font-weight: 600; cursor: pointer;
          display: flex; align-items: center; gap: 8px;
          font-family: inherit;
          transition: opacity 0.15s, transform 0.1s;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 10px 26px rgba(0,0,0,.32));
        }
        .ocall-cancel:hover { opacity: 0.88; transform: scale(1.03); }
        .ocall-cancel:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}

function PhoneOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67M6.18 6.18a19.79 19.79 0 00-3.07 8.63A2 2 0 005.29 17H8a2 2 0 001.72-1 12.84 12.84 0 00.7-2.81 2 2 0 00-.45-2.11L8.7 9.91"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}
