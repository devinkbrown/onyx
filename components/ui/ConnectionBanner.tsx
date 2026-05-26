'use client';

import { useOnyxStore } from '@/lib/store';

export default function ConnectionBanner() {
  const connectionStatus = useOnyxStore(s => s.connectionStatus);
  const reconnectIn      = useOnyxStore(s => s.reconnectIn);
  const reconnectNow     = useOnyxStore(s => s.reconnectNow);
  const connect          = useOnyxStore(s => s.connect);
  const server           = useOnyxStore(s => s.server);

  if (connectionStatus === 'connected') return null;

  const handleConnect = () => {
    if (connectionStatus === 'reconnecting' || connectionStatus === 'connecting') {
      reconnectNow();
    } else if (server) {
      connect({ url: server.url, nick: server.nick });
    }
  };

  return (
    <div
      className={`conn-banner conn-banner--${connectionStatus}`}
      role="status"
      aria-live="polite"
    >
      {connectionStatus === 'connecting' && (
        <>
          <Spinner />
          <span className="conn-text">Connecting to server…</span>
        </>
      )}

      {connectionStatus === 'reconnecting' && (
        <>
          <Spinner />
          <span className="conn-text">
            Connection lost. Reconnecting
            {reconnectIn > 0 ? ` in ${reconnectIn}s` : '…'}
          </span>
          <button className="conn-btn" onClick={reconnectNow}>
            Now
          </button>
        </>
      )}

      {connectionStatus === 'disconnected' && (
        <>
          <DisconnectedIcon />
          <span className="conn-text">You are disconnected.</span>
          {server && (
            <button className="conn-btn" onClick={handleConnect}>
              Reconnect
            </button>
          )}
        </>
      )}

      <style>{`
        .conn-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 0 20px;
          height: 38px;
          font-size: 13px;
          font-weight: 500;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: 200;
          letter-spacing: 0.01em;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        /* Status variant colors */
        .conn-banner--connecting,
        .conn-banner--reconnecting {
          background: rgba(251,191,36, 0.08);
          border-bottom: 1px solid rgba(251,191,36,0.2);
          color: var(--warning, #fbbf24);
        }
        .conn-banner--disconnected {
          background: rgba(248,113,113, 0.08);
          border-bottom: 1px solid rgba(248,113,113,0.2);
          color: var(--danger, #f87171);
        }

        /* Pulsing status dot — only on disconnected (no spinner) */
        .conn-banner--disconnected::before {
          content: '';
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex-shrink: 0;
          box-shadow: 0 0 6px currentColor;
        }

        .conn-text {
          flex: 0 1 auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .conn-btn {
          padding: 4px 14px;
          border: 1px solid currentColor;
          border-radius: var(--r-sm, 6px);
          background: rgba(255,255,255,0.06);
          color: currentColor;
          font-size: 12px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          transition: background 120ms ease, transform 120ms ease;
          flex-shrink: 0;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .conn-btn:hover {
          background: rgba(255,255,255,0.12);
        }
        .conn-btn:active {
          transform: scale(0.96);
          background: rgba(255,255,255,0.08);
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
