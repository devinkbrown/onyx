'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

export default function ScreensharePreview() {
  const voice      = useOnyxStore(s => s.voice);
  const addToast   = useOnyxStore(s => s.addToast);
  const activeView = useOnyxStore(s => s.activeView);
  const { screenshareStream, screenshareActive, callChannel } = voice;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<'smooth' | 'crisp'>('smooth');

  useEffect(() => {
    if (videoRef.current && screenshareStream) {
      videoRef.current.srcObject = screenshareStream;
    }
  }, [screenshareStream]);

  const handleStartShare = useCallback(async () => {
    const frameRate = quality === 'crisp' ? 30 : 15;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate },
        audio: false,
      });
      // Wire ended event to stop store state when user ends share via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        useOnyxStore.getState().voice.stopScreenshare();
      });
      useOnyxStore.setState(s => ({
        voice: {
          ...s.voice,
          screenshareActive: true,
          screenshareStream: stream,
        },
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Screen share cancelled';
      addToast({ variant: 'error', title: 'Screen share failed', description: msg, duration: 4000 });
    }
  }, [quality, addToast]);

  const channelLabel =
    callChannel ??
    (activeView.kind === 'channel' ? activeView.channel : null);

  // ── Initiation panel ───────────────────────────────────────────────────────
  if (!screenshareActive) {
    return (
      <div className="screenshare-init-wrap" role="dialog" aria-label="Share your screen">
        <div className="screenshare-init">
          <div className="screenshare-init-icon" aria-hidden="true">🖥️</div>
          <h3 className="screenshare-init-title">Share your screen</h3>
          <p className="screenshare-init-desc">
            Others in the call will be able to see your screen.
          </p>
          <div className="screenshare-quality-row">
            <label htmlFor="screenshare-quality" className="screenshare-quality-label">
              Quality
            </label>
            <select
              id="screenshare-quality"
              className="screenshare-quality-select"
              value={quality}
              onChange={e => setQuality(e.target.value as 'smooth' | 'crisp')}
            >
              <option value="smooth">Smooth (720p 15fps)</option>
              <option value="crisp">Crisp (1080p 30fps)</option>
            </select>
          </div>
          <button className="screenshare-start-btn" onClick={() => void handleStartShare()}>
            Start Sharing
          </button>
        </div>

        <style>{`
          .screenshare-init-wrap {
            position: fixed;
            bottom: 64px;
            right: 16px;
            z-index: 500;
            width: 240px;
          }

          .screenshare-init {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            border: 1px solid rgba(14,165,233,0.3);
            border-radius: 10px;
            background: var(--bg-deep);
            padding: 16px 14px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(14,165,233,0.1);
          }

          .screenshare-init-icon {
            font-size: 28px;
            line-height: 1;
            filter: drop-shadow(0 2px 6px rgba(14,165,233,0.4));
          }

          .screenshare-init-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0;
            text-align: center;
          }

          .screenshare-init-desc {
            font-size: 11px;
            color: var(--text-muted);
            text-align: center;
            margin: 0;
            line-height: 1.5;
          }

          .screenshare-quality-row {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
          }

          .screenshare-quality-label {
            font-size: 11px;
            color: var(--text-secondary);
            white-space: nowrap;
            flex-shrink: 0;
          }

          .screenshare-quality-select {
            flex: 1;
            min-width: 0;
            font-size: 11px;
            padding: 4px 6px;
            border-radius: 4px;
            background: var(--bg-surface);
            color: var(--text-primary);
            border: 1px solid var(--border);
            outline: none;
            cursor: pointer;
          }
          .screenshare-quality-select:focus {
            border-color: var(--accent);
          }

          .screenshare-start-btn {
            width: 100%;
            padding: 7px 0;
            background: var(--accent);
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 150ms ease, opacity 150ms;
            letter-spacing: 0.01em;
          }
          .screenshare-start-btn:hover {
            background: var(--accent-hover);
          }
          .screenshare-start-btn:active {
            opacity: 0.85;
          }
        `}</style>
      </div>
    );
  }

  // ── Active screenshare preview ─────────────────────────────────────────────
  return (
    <div className="screenshare-preview" role="region" aria-label="Screen share preview">
      {channelLabel && (
        <div className="screenshare-sharing-to" aria-live="polite">
          Sharing to: {channelLabel}
        </div>
      )}
      <div className="screenshare-label">You&apos;re sharing your screen</div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="screenshare-video"
      />
      <button
        className="screenshare-stop"
        onClick={() => useOnyxStore.getState().voice.stopScreenshare()}
        aria-label="Stop sharing screen"
      >
        Stop Sharing
      </button>

      <style>{`
        .screenshare-preview {
          position: fixed;
          bottom: 64px;
          right: 16px;
          z-index: 500;
          width: 240px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          border: 2px solid var(--danger);
          border-radius: 8px;
          background: var(--bg-deep);
          padding: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(248,113,113,0.15);
        }

        .screenshare-sharing-to {
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          padding-bottom: 2px;
          letter-spacing: 0.01em;
        }

        .screenshare-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--danger);
          letter-spacing: 0.02em;
          text-align: center;
          padding-bottom: 4px;
          border-bottom: 1px solid rgba(248,113,113,0.2);
        }

        .screenshare-video {
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 4px;
          object-fit: contain;
          background: #000;
        }

        .screenshare-stop {
          width: 100%;
          padding: 6px 0;
          background: var(--danger-subtle);
          color: var(--danger);
          border: 1px solid rgba(248,113,113,0.3);
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 150ms ease;
        }
        .screenshare-stop:hover {
          background: rgba(239,68,68,0.25);
        }
      `}</style>
    </div>
  );
}
