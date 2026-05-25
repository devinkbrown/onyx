'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  channel: string;
}

export function RaidBanner({ channel }: Props) {
  const raids = useOnyxStore(s => s.raids);
  const raid = raids.get(channel.toLowerCase());

  // Track which raid timestamp we last showed so we trigger on each new raid.
  const lastTimestampRef = useRef<number | null>(null);
  const [showing, setShowing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!raid) return;
    if (raid.timestamp === lastTimestampRef.current) return;
    lastTimestampRef.current = raid.timestamp;

    setLeaving(false);
    setShowing(true);

    // Begin exit animation at 11.6s so it finishes by ~12s.
    const exitTimer = setTimeout(() => setLeaving(true), 11_600);
    const hideTimer = setTimeout(() => { setShowing(false); setLeaving(false); }, 12_000);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(hideTimer);
    };
  }, [raid]);

  if (!showing || !raid) return null;

  return (
    <div className={`raid-root${leaving ? ' raid-root--leaving' : ''}`} aria-live="assertive" aria-atomic="true">
      <div className="raid-card">
        <div className="raid-label">INCOMING RAID</div>
        <div className="raid-nick">{raid.raider}</div>
        <div className="raid-sub">
          from {raid.from}
          {raid.viewers > 0 && ` with ${raid.viewers} viewer${raid.viewers === 1 ? '' : 's'}`}
        </div>
      </div>

      <style>{`
        .raid-root {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 20;
        }
        .raid-root--leaving .raid-card {
          animation: raid-exit 400ms cubic-bezier(0.7,0,0.84,0) forwards;
        }
        .raid-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 24px 36px;
          background: rgba(6, 16, 29, 0.92);
          border: 1px solid rgba(103, 232, 249, 0.3);
          border-radius: 16px;
          backdrop-filter: blur(16px);
          box-shadow: 0 0 0 1px rgba(103,232,249,0.10), 0 24px 64px rgba(0,0,0,0.75);
          animation: raid-entrance 400ms cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes raid-entrance {
          from { opacity: 0; transform: scale(0.88); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes raid-exit {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.92); }
        }
        .raid-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 4px;
        }
        .raid-nick {
          font-size: 32px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.02em;
          text-shadow: 0 0 20px rgba(103,232,249,0.6), 0 0 40px rgba(103,232,249,0.3);
          line-height: 1.1;
        }
        .raid-sub {
          font-size: 13px;
          color: rgba(255,255,255,0.6);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
