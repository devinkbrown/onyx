'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

interface Props {
  channel: string;
}

interface StreamClip {
  id: string;
  channel: string;
  title: string;
  timestamp: number;
  elapsed: number;
}

function saveClip(clip: StreamClip): void {
  try {
    const key = 'ocean-stream-clips';
    const existing: StreamClip[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const next = [clip, ...existing].slice(0, 50);
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* ignore quota errors */ }
}

function formatUptime(secs: number): string {
  if (secs < 3600) {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function StreamOverlay({ channel }: Props) {
  const streams = useOnyxStore(s => s.streams);
  const stream = streams.get(channel.toLowerCase());
  const ourNick = useOnyxStore(s => s.ourNick);

  // Compute elapsed immediately on mount so the display is correct from frame 1.
  const [elapsed, setElapsed] = useState(() =>
    stream?.live ? Math.floor(Date.now() / 1000) - stream.startedAt : 0
  );
  const [clipped, setClipped] = useState(false);
  // Keep a ref to the latest elapsed so the keyboard handler never captures stale values.
  const elapsedRef = useRef(elapsed);
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  const isStreamer = Boolean(
    stream?.streamer && ourNick &&
    stream.streamer.toLowerCase() === ourNick.toLowerCase()
  );

  const streamLive = stream?.live ?? false;
  const streamStartedAt = stream?.startedAt ?? 0;

  useEffect(() => {
    if (!streamLive) return;
    const startedAt = streamStartedAt;
    const interval = setInterval(() => {
      setElapsed(Math.floor(Date.now() / 1000) - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [streamLive, streamStartedAt]);

  const streamChannel = stream?.channel ?? '';
  const streamTitle = stream?.title ?? '';

  // Keyboard shortcut: press C to clip (when streamer, no input focused)
  useEffect(() => {
    if (!streamLive || !isStreamer) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
      if (clipped) return;
      saveClip({
        id: `${Date.now()}`,
        channel: streamChannel,
        title: streamTitle,
        timestamp: Date.now(),
        elapsed: elapsedRef.current,
      });
      setClipped(true);
      setTimeout(() => setClipped(false), 2000);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [streamLive, streamChannel, streamTitle, isStreamer, clipped]);

  if (!stream?.live) return null;

  const handleClip = () => {
    if (clipped) return;
    saveClip({
      id: `${Date.now()}`,
      channel: stream.channel,
      title: stream.title,
      timestamp: Date.now(),
      elapsed,
    });
    setClipped(true);
    setTimeout(() => setClipped(false), 2000);
  };

  return (
    // Not aria-hidden — contains an interactive clip button for streamers.
    <div className="sovl-root">
      {/* Top gradient — purely decorative */}
      <div className="sovl-gradient-top" aria-hidden="true" />

      <div className="sovl-bar">
        <span className="sovl-live-badge" aria-label="Live">LIVE</span>
        <span className="sovl-title">{stream.title}</span>
        {stream.category && (
          <span className="sovl-category">{stream.category}</span>
        )}
        <div className="sovl-spacer" aria-hidden="true" />
        {isStreamer && (
          <button
            className="sovl-clip-btn"
            onClick={handleClip}
            aria-label={clipped ? 'Clip saved' : 'Save stream clip (C)'}
            title={clipped ? 'Clip saved!' : 'Save clip (C)'}
          >
            {clipped ? (
              <span style={{ color: 'var(--gold)' }}>✓ Saved</span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>
              </svg>
            )}
          </button>
        )}
        <span className="sovl-viewers" aria-label={`${stream.viewers} viewers`}>
          <EyeIcon />
          {stream.viewers}
        </span>
        <span className="sovl-uptime" aria-label={`Uptime ${formatUptime(elapsed)}`}>
          <ClockIcon />
          {formatUptime(elapsed)}
        </span>
      </div>

      <style>{`
        .sovl-root {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          pointer-events: none;
          z-index: 10;
        }
        .sovl-gradient-top {
          height: 64px;
          background: linear-gradient(to bottom, rgba(3,8,16,0.85) 0%, transparent 100%);
        }
        .sovl-bar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
        }
        .sovl-live-badge {
          background: #e63946;
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          padding: 3px 8px;
          border-radius: 999px;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(230,57,70,0.5);
          animation: sovl-live-pulse 2s ease-in-out infinite;
        }
        @keyframes sovl-live-pulse {
          0%, 100% { box-shadow: 0 2px 8px rgba(230,57,70,0.5); }
          50%       { box-shadow: 0 2px 14px rgba(230,57,70,0.75); }
        }
        .sovl-title {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 200px;
          text-shadow: 0 1px 4px rgba(0,0,0,0.6);
        }
        .sovl-category {
          font-size: 11px;
          font-weight: 500;
          color: rgba(255,255,255,0.7);
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 999px;
          padding: 2px 8px;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .sovl-spacer { flex: 1; }
        .sovl-viewers,
        .sovl-uptime {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,0.85);
          font-variant-numeric: tabular-nums;
          background: rgba(0,0,0,0.3);
          border-radius: 999px;
          padding: 3px 9px;
        }
        .sovl-clip-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          color: var(--text-primary);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          pointer-events: auto;
          transition: background 0.15s;
          font-family: inherit;
        }
        .sovl-clip-btn:hover {
          background: var(--accent-glow);
        }
      `}</style>
    </div>
  );
}

const EyeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const ClockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);
