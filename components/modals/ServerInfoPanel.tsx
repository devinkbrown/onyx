'use client';

import { useState, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';

type SIPTab = 'info' | 'isupport';

function formatUptime(since: Date): string {
  const secs = Math.floor((Date.now() - since.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

export default function ServerInfoPanel() {
  const closeServerInfo     = useOnyxStore(s => s.closeServerInfo);
  const server              = useOnyxStore(s => s.server);
  const networkName         = useOnyxStore(s => s.networkName);
  const serverVersion       = useOnyxStore(s => s.serverVersion);
  const serverCapabilities  = useOnyxStore(s => s.serverCapabilities);
  const serverStats         = useOnyxStore(s => s.serverStats);
  const ourNick             = useOnyxStore(s => s.ourNick);
  const connectedAt         = useOnyxStore(s => s.connectedAt);
  const latencyMs           = useOnyxStore(s => s.latencyMs);
  const isupportTokens      = useOnyxStore(s => s.isupportTokens);

  const [uptime, setUptime] = useState<string>('');
  const [tab, setTab] = useState<SIPTab>('info');

  useEffect(() => {
    if (!connectedAt) {
      setUptime('—');
      return;
    }
    setUptime(formatUptime(connectedAt));
    const interval = setInterval(() => setUptime(formatUptime(connectedAt)), 1000);
    return () => clearInterval(interval);
  }, [connectedAt]);

  // Parse hostname from server URL
  const hostname = (() => {
    if (!server?.url) return '—';
    try {
      return new URL(server.url).hostname;
    } catch {
      return server.url;
    }
  })();

  const isupportEntries = Object.entries(isupportTokens).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <div className="sip-backdrop" onClick={closeServerInfo} aria-hidden />
      <aside className="sip" role="complementary" aria-label="Server information">
        <header className="sip-header">
          <span className="sip-title">Server Info</span>
          <button
            className="sip-close"
            onClick={closeServerInfo}
            aria-label="Close server info"
          >
            ✕
          </button>
        </header>

        {/* Tab bar */}
        <div className="sip-tabs">
          <button
            className={`sip-tab ${tab === 'info' ? 'sip-tab--active' : ''}`}
            onClick={() => setTab('info')}
          >
            Overview
          </button>
          <button
            className={`sip-tab ${tab === 'isupport' ? 'sip-tab--active' : ''}`}
            onClick={() => setTab('isupport')}
          >
            ISUPPORT
            {isupportEntries.length > 0 && (
              <span className="sip-tab-badge">{isupportEntries.length}</span>
            )}
          </button>
        </div>

        <div className="sip-body">

          {tab === 'info' && (
            <>
              {/* ── Server ── */}
              <section className="sip-section">
                <h3 className="sip-section-title">Server</h3>
                <dl className="sip-dl">
                  <div className="sip-row">
                    <dt>Network</dt>
                    <dd>{networkName || '—'}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Host</dt>
                    <dd className="sip-mono">{hostname}</dd>
                  </div>
                </dl>
              </section>

              {/* ── Version ── */}
              <section className="sip-section">
                <h3 className="sip-section-title">Version</h3>
                <dl className="sip-dl">
                  <div className="sip-row">
                    <dt>Software</dt>
                    <dd className="sip-mono">{serverVersion ?? '—'}</dd>
                  </div>
                </dl>
              </section>

              {/* ── Stats ── */}
              <section className="sip-section">
                <h3 className="sip-section-title">Stats</h3>
                <dl className="sip-dl">
                  <div className="sip-row">
                    <dt>Users online</dt>
                    <dd>{serverStats?.users ?? '—'}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Channels</dt>
                    <dd>{serverStats?.channels ?? '—'}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Servers</dt>
                    <dd>{serverStats?.servers ?? '—'}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Opers</dt>
                    <dd>{serverStats?.opers ?? '—'}</dd>
                  </div>
                </dl>
              </section>

              {/* ── Capabilities ── */}
              <section className="sip-section">
                <h3 className="sip-section-title">Capabilities</h3>
                {serverCapabilities.length === 0 ? (
                  <p className="sip-empty">No capabilities negotiated</p>
                ) : (
                  <ul className="sip-caps">
                    {serverCapabilities.map(cap => (
                      <li key={cap} className="sip-cap-tag">{cap}</li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ── Your session ── */}
              <section className="sip-section">
                <h3 className="sip-section-title">Your Session</h3>
                <dl className="sip-dl">
                  <div className="sip-row">
                    <dt>Nick</dt>
                    <dd className="sip-mono">{ourNick || '—'}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Account</dt>
                    <dd className="sip-mono">{server?.account ?? '—'}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Connected</dt>
                    <dd>{uptime}</dd>
                  </div>
                  <div className="sip-row">
                    <dt>Ping</dt>
                    <dd>{latencyMs !== null ? `${latencyMs}ms` : '—'}</dd>
                  </div>
                </dl>
              </section>
            </>
          )}

          {tab === 'isupport' && (
            <section className="sip-section sip-section--isupport">
              <h3 className="sip-section-title">ISUPPORT Tokens</h3>
              {isupportEntries.length === 0 ? (
                <p className="sip-empty">No ISUPPORT tokens received yet</p>
              ) : (
                <div className="sip-isupport-grid">
                  {isupportEntries.map(([key, val]) => (
                    <div key={key} className="sip-isupport-row">
                      <span className="sip-isupport-key">{key}</span>
                      <span className="sip-isupport-val">{val || <span className="sip-isupport-empty">—</span>}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </aside>

      <style>{`
        .sip-backdrop {
          position: fixed;
          inset: 0;
          z-index: 49;
          background: transparent;
        }

        .sip {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 320px;
          z-index: 50;
          display: flex;
          flex-direction: column;
          background: var(--bg-elevated, #1e1e2e);
          border-left: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          box-shadow: -8px 0 32px rgba(0,0,0,0.4);
          animation: sip-slide-in 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        @keyframes sip-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        .sip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 16px 12px;
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }

        .sip-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary, #fff);
          letter-spacing: 0.01em;
          text-transform: uppercase;
        }

        .sip-close {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted, rgba(255,255,255,0.4));
          font-size: 14px;
          line-height: 1;
          padding: 4px;
          border-radius: var(--r-sm, 4px);
          transition: color 120ms, background 120ms;
        }
        .sip-close:hover {
          color: var(--text-primary, #fff);
          background: var(--bg-hover, rgba(255,255,255,0.06));
        }

        /* Tabs */
        .sip-tabs {
          display: flex;
          padding: 0 8px;
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }
        .sip-tab {
          position: relative;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 10px;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted, rgba(255,255,255,0.4));
          transition: color 120ms;
          white-space: nowrap;
        }
        .sip-tab:hover { color: var(--text-secondary, rgba(255,255,255,0.6)); }
        .sip-tab--active { color: var(--text-primary, #fff); }
        .sip-tab--active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent, #7c5af5);
          border-radius: 2px 2px 0 0;
        }
        .sip-tab-badge {
          font-size: 10px;
          font-weight: 700;
          background: var(--bg-overlay, rgba(255,255,255,0.08));
          color: var(--text-secondary);
          padding: 1px 5px;
          border-radius: 10px;
        }

        .sip-body {
          flex: 1;
          overflow-y: auto;
          padding: 8px 0 24px;
        }

        .sip-section {
          padding: 12px 16px 8px;
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
        }
        .sip-section:last-child {
          border-bottom: none;
        }
        .sip-section--isupport {
          padding-bottom: 24px;
        }

        .sip-section-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted, rgba(255,255,255,0.4));
          margin: 0 0 8px;
        }

        .sip-dl {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin: 0;
        }

        .sip-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
        }

        .sip-row dt {
          font-size: 13px;
          color: var(--text-secondary, rgba(255,255,255,0.6));
          flex-shrink: 0;
        }

        .sip-row dd {
          font-size: 13px;
          color: var(--text-primary, #fff);
          margin: 0;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sip-mono {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 12px !important;
        }

        .sip-empty {
          font-size: 12px;
          color: var(--text-muted, rgba(255,255,255,0.35));
          margin: 0;
        }

        .sip-caps {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .sip-cap-tag {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          padding: 2px 7px;
          background: rgba(124, 90, 245, 0.12);
          border: 1px solid rgba(124, 90, 245, 0.25);
          border-radius: 999px;
          color: var(--accent, #7c5af5);
          white-space: nowrap;
        }

        /* ISUPPORT grid */
        .sip-isupport-grid {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .sip-isupport-row {
          display: grid;
          grid-template-columns: minmax(80px, 40%) 1fr;
          gap: 8px;
          align-items: start;
          padding: 4px 6px;
          border-radius: var(--r-sm, 4px);
          transition: background 100ms;
        }
        .sip-isupport-row:hover {
          background: rgba(255,255,255,0.04);
        }
        .sip-isupport-key {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          font-weight: 700;
          color: var(--accent, #7c5af5);
          letter-spacing: 0.03em;
          word-break: break-all;
        }
        .sip-isupport-val {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          color: var(--text-primary, #fff);
          word-break: break-all;
          text-align: right;
        }
        .sip-isupport-empty {
          color: var(--text-muted, rgba(255,255,255,0.4));
        }

        @media (max-width: 768px) {
          .sip {
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
