'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

type BannerState = 'hidden' | 'connecting' | 'lost' | 'restored';

export default function ConnectionBanner() {
  const connectionStatus = useOnyxStore(s => s.connectionStatus);
  const reconnectIn      = useOnyxStore(s => s.reconnectIn);
  const reconnectNow     = useOnyxStore(s => s.reconnectNow);
  const connect          = useOnyxStore(s => s.connect);
  const server           = useOnyxStore(s => s.server);
  const previousStatus   = useRef(connectionStatus);
  const [bannerState, setBannerState] = useState<BannerState>(
    connectionStatus === 'connected'
      ? 'hidden'
      : connectionStatus === 'disconnected'
      ? 'lost'
      : 'connecting',
  );

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = connectionStatus;

    if (connectionStatus === 'connected') {
      if (previous === 'reconnecting' || previous === 'disconnected' || previous === 'connecting') {
        setBannerState('restored');
        const t = setTimeout(() => setBannerState('hidden'), 3000);
        return () => clearTimeout(t);
      }
      setBannerState('hidden');
      return;
    }

    if (connectionStatus === 'disconnected') {
      setBannerState('lost');
      return;
    }

    setBannerState('connecting');
  }, [connectionStatus]);

  if (bannerState === 'hidden') return null;

  const handleConnect = () => {
    if (connectionStatus === 'reconnecting' || connectionStatus === 'connecting') {
      reconnectNow();
    } else if (server) {
      connect({ url: server.url, nick: server.nick });
    }
  };

  return (
    <div
      className={`conn-banner conn-banner--${bannerState}`}
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
    >
      {bannerState === 'connecting' && (
        <>
          <Spinner />
          <span className="conn-text">
            {connectionStatus === 'reconnecting'
              ? `Connection lost. Reconnecting${reconnectIn > 0 ? ` in ${reconnectIn}s` : '...'}`
              : 'Connecting to server...'}
          </span>
          {connectionStatus === 'reconnecting' && (
            <button className="conn-btn" onClick={reconnectNow}>
              Now
            </button>
          )}
        </>
      )}

      {bannerState === 'lost' && (
        <>
          <DisconnectedIcon />
          <span className="conn-text">Connection lost.</span>
          {server && (
            <button className="conn-btn" onClick={handleConnect}>
              Reconnect
            </button>
          )}
        </>
      )}

      {bannerState === 'restored' && (
        <>
          <RestoredIcon />
          <span className="conn-text">Connection restored.</span>
        </>
      )}

      <style>{`
        .conn-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--sp-3, 12px);
          padding: 0 var(--sp-5, 20px);
          height: 38px;
          font-size: var(--text-sm, 0.8125rem);
          font-weight: 600;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: var(--z-header, 20);
          letter-spacing: 0;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 24px rgba(0,0,0,.28));
        }

        .conn-banner--connecting {
          background: color-mix(in srgb, var(--warning, #fbbf24) 13%, var(--elev-tint-1, #132131));
          color: var(--warning, #fbbf24);
          animation: conn-warning-pulse 1600ms var(--ease-out, cubic-bezier(.16,1,.3,1)) infinite;
        }
        .conn-banner--lost {
          background: color-mix(in srgb, var(--danger, #f87171) 14%, var(--elev-tint-1, #132131));
          color: var(--danger, #f87171);
        }
        .conn-banner--restored {
          background: color-mix(in srgb, var(--success, #23a55a) 14%, var(--elev-tint-1, #132131));
          color: var(--success, #23a55a);
          animation: conn-restored-in var(--t-surface, 220ms) var(--ease-out, cubic-bezier(.16,1,.3,1)) both;
        }

        .conn-text {
          flex: 0 1 auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .conn-btn {
          padding: var(--sp-1, 4px) var(--sp-3, 12px);
          border: 1px solid color-mix(in srgb, currentColor 28%, transparent);
          border-radius: var(--r-xs, 4px) var(--r-md, 8px) var(--r-xs, 4px) var(--r-sm, 6px);
          background: color-mix(in srgb, currentColor 10%, transparent);
          color: currentColor;
          font-size: var(--text-xs, 0.75rem);
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)), transform var(--t-micro, 90ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          flex-shrink: 0;
          letter-spacing: 0;
          white-space: nowrap;
        }
        .conn-btn:hover {
          background: color-mix(in srgb, currentColor 18%, transparent);
          transform: translateY(-1px);
        }
        .conn-btn:active {
          transform: translateY(0.5px);
          background: color-mix(in srgb, currentColor 14%, transparent);
        }
        .conn-btn:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }

        /* Spinner */
        @keyframes conn-spin {
          to { transform: rotate(360deg); }
        }
        .conn-spinner {
          width: 13px;
          height: 13px;
          border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: conn-spin 700ms linear infinite;
          flex-shrink: 0;
        }
        @keyframes conn-warning-pulse {
          0%, 100% { background: color-mix(in srgb, var(--warning, #fbbf24) 11%, var(--elev-tint-1, #132131)); }
          50% { background: color-mix(in srgb, var(--warning, #fbbf24) 18%, var(--elev-tint-1, #132131)); }
        }
        @keyframes conn-restored-in {
          from { opacity: 0; transform: translate3d(0, -6px, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .conn-banner--connecting,
          .conn-banner--restored,
          .conn-spinner {
            animation-duration: 1ms;
            animation-iteration-count: 1;
          }
          .conn-btn,
          .conn-btn:hover,
          .conn-btn:active {
            transition-duration: 1ms;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

function Spinner() {
  return <span className="conn-spinner" aria-hidden />;
}

function DisconnectedIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M7 1v6M4 10.5a4 4 0 1 0 6 0" />
    </svg>
  );
}

function RestoredIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
    </svg>
  );
}
