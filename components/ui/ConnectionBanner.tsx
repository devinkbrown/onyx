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
          <span>Connecting to server...</span>
        </>
      )}

      {connectionStatus === 'reconnecting' && (
        <>
          <Spinner />
          <span>
            Connection lost. Reconnecting in {reconnectIn}s&hellip;
          </span>
          <button className="conn-btn" onClick={reconnectNow}>
            Reconnect now
          </button>
        </>
      )}

      {connectionStatus === 'disconnected' && (
        <>
          <DisconnectedIcon />
          <span>You are disconnected.</span>
          {server && (
            <button className="conn-btn" onClick={handleConnect}>
              Connect
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
          padding: 0 16px;
          height: 40px;
          font-size: 13px;
          font-weight: 500;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: 200;
        }
        .conn-banner--connecting {
          background: rgba(251, 191, 36, 0.12);
          border-bottom: 1px solid rgba(251, 191, 36, 0.3);
          color: #fbbf24;
        }
        .conn-banner--reconnecting {
          background: rgba(251, 191, 36, 0.12);
          border-bottom: 1px solid rgba(251, 191, 36, 0.3);
          color: #fbbf24;
        }
        .conn-banner--disconnected {
          background: rgba(248, 113, 113, 0.12);
          border-bottom: 1px solid rgba(248, 113, 113, 0.3);
          color: var(--danger);
        }
        .conn-btn {
          background: currentColor;
          color: var(--bg-base);
          border: none;
          border-radius: var(--r-sm);
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 120ms;
          flex-shrink: 0;
        }
        .conn-btn:hover { opacity: 0.85; }
        .conn-btn:active { opacity: 0.7; }

        /* Spinner */
        @keyframes conn-spin {
          to { transform: rotate(360deg); }
        }
        .conn-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid currentColor;
          border-top-color: transparent;
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
