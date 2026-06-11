'use client';

import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';

export default function IncomingCallOverlay() {
  const voice = useOnyxStore(s => s.voice);
  const acceptDmCall = useOnyxStore(s => s.acceptDmCall);
  const rejectDmCall = useOnyxStore(s => s.rejectDmCall);

  if (voice.callState !== 'ringing_in') return null;

  const callerNick = voice.callWith ?? 'Unknown';

  return (
    <div className="icall-overlay" role="dialog" aria-modal aria-label="Incoming call">
      <div className="icall-box">
        <div className="icall-ring-anim">
          <div className="icall-ring icall-ring--1" />
          <div className="icall-ring icall-ring--2" />
          <div className="icall-ring icall-ring--3" />
          <Avatar nick={callerNick} size={72} />
        </div>
        <p className="icall-label">Incoming voice call</p>
        <p className="icall-nick">{callerNick}</p>
        <div className="icall-actions">
          <button
            className="icall-btn icall-btn--reject"
            onClick={() => rejectDmCall()}
            aria-label="Decline call"
          >
            <PhoneDeclineIcon />
          </button>
          <button
            className="icall-btn icall-btn--accept"
            onClick={() => acceptDmCall()}
            aria-label="Accept call"
          >
            <PhoneIcon />
          </button>
        </div>
      </div>
      <style>{`
        .icall-overlay {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: flex-end; justify-content: center;
          padding-bottom: 10vh;
          background: rgba(0,0,0,0.72);
          backdrop-filter: blur(10px);
          animation: icall-backdrop-in 0.28s ease;
        }
        @keyframes icall-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .icall-box {
          display: flex; flex-direction: column; align-items: center; gap: 12px;
          background: color-mix(in srgb, #050505 88%, var(--accent, #0ea5e9) 7%);
          border-radius: var(--r-md, 8px) var(--r-2xl, 20px) var(--r-lg, 14px) var(--r-xl, 16px);
          padding: 36px 48px;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-3, 0 24px 60px rgba(0,0,0,.52));
          text-align: center;
          animation: icall-box-in 0.32s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes icall-box-in {
          from { opacity: 0; transform: scale(0.88) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .icall-ring-anim {
          position: relative;
          width: 88px; height: 88px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 4px;
        }
        .icall-ring {
          position: absolute;
          border-radius: 50%;
          border: 2px solid var(--status-online, #34d399);
          animation: icall-pulse 2s ease-out infinite;
        }
        .icall-ring--1 { width: 100%; height: 100%; animation-delay: 0s; }
        .icall-ring--2 { width: 125%; height: 125%; animation-delay: 0.55s; }
        .icall-ring--3 { width: 155%; height: 155%; animation-delay: 1.1s; }
        @keyframes icall-pulse {
          0%   { opacity: 0.75; transform: scale(0.88); }
          50%  { opacity: 0.25; transform: scale(1); }
          100% { opacity: 0;    transform: scale(1.12); }
        }
        .icall-label { font-size: 13px; color: var(--text-muted); margin: 0; letter-spacing: 0.02em; }
        .icall-nick {
          font-size: 22px; font-weight: 700;
          color: var(--text-primary); margin: 0;
          letter-spacing: -0.3px;
        }
        .icall-actions { display: flex; gap: 24px; margin-top: 8px; }
        .icall-btn {
          width: 60px; height: 60px; border-radius: var(--r-xl, 16px) var(--r-sm, 6px) var(--r-2xl, 20px) var(--r-md, 8px); border: none;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.15s, background 0.15s;
          color: #fff;
          font-family: inherit;
        }
        .icall-btn:hover  { transform: scale(1.1); }
        .icall-btn:active { transform: scale(0.95); }
        .icall-btn--reject { background: color-mix(in srgb, var(--danger, #f87171) 28%, #050505 72%); }
        .icall-btn--accept { background: color-mix(in srgb, var(--status-online, #34d399) 28%, #050505 72%); }
      `}</style>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 11a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18H5a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/>
    </svg>
  );
}

function PhoneDeclineIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M16.5 19.5l-1.27-1.27a2 2 0 00-2.11.45l-.09.09a2 2 0 01-2.82 0 16 16 0 01-6-6 2 2 0 010-2.82l.09-.09a2 2 0 00.45-2.11L3.47 6.47A2 2 0 001.72 5H.18a2 2 0 00-2 2.18A19.79 19.79 0 003.07 14M21.73 14.86A19.5 19.5 0 0013 6.27"/>
    </svg>
  );
}
