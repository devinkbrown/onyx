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
                <h3 className="sip-section-title">Network Stats</h3>
                <div className="sip-stat-grid">
                  <div className="sip-stat-card">
                    <span className="sip-stat-value sip-stat-value--accent">
                      {serverStats?.users ?? '—'}
                    </span>
                    <span className="sip-stat-label">Users</span>
                  </div>
                  <div className="sip-stat-card">
                    <span className="sip-stat-value">
                      {serverStats?.channels ?? '—'}
                    </span>
                    <span className="sip-stat-label">Channels</span>
                  </div>
                  <div className="sip-stat-card">
                    <span className="sip-stat-value">
                      {serverStats?.servers ?? '—'}
                    </span>
                    <span className="sip-stat-label">Servers</span>
                  </div>
                  <div className="sip-stat-card">
                    <span className="sip-stat-value">
                      {serverStats?.opers ?? '—'}
                    </span>
                    <span className="sip-stat-label">Opers</span>
                  </div>
                </div>
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
          background: var(--bg-elevated, #132131);
          border-left: 1px solid var(--border-normal, rgba(14,165,233,0.15));
          box-shadow: -12px 0 48px rgba(0,0,0,0.55), -1px 0 0 rgba(14,165,233,0.06);
          animation: sip-slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
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
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          flex-shrink: 0;
          background: linear-gradient(180deg, rgba(14,165,233,0.04) 0%, transparent 100%);
        }

        .sip-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary, #dff0ff);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .sip-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: 1px solid transparent;
          cursor: pointer;
          color: var(--text-muted, #3d6480);
          font-size: 13px;
          line-height: 1;
          border-radius: var(--r-sm, 6px);
          transition: color 120ms, background 120ms, border-color 120ms;
        }
        .sip-close:hover {
          color: var(--text-primary, #dff0ff);
          background: var(--bg-float, rgba(26,44,64,0.9));
          border-color: var(--border-subtle, rgba(14,165,233,0.08));
        }

        /* Tabs */
        .sip-tabs {
          display: flex;
          padding: 0 10px;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          flex-shrink: 0;
        }
        .sip-tab {
          position: relative;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 9px 10px;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted, #3d6480);
          transition: color 140ms;
          white-space: nowrap;
          letter-spacing: 0.01em;
        }
        .sip-tab:hover { color: var(--text-secondary, #7aa8c4); }
        .sip-tab--active { color: var(--text-primary, #dff0ff); }
        .sip-tab--active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent, #0ea5e9);
          border-radius: 2px 2px 0 0;
          box-shadow: 0 -1px 6px rgba(14,165,233,0.4);
        }
        .sip-tab-badge {
          font-size: 9.5px;
          font-weight: 700;
          background: rgba(14,165,233,0.12);
          color: var(--accent, #0ea5e9);
          border: 1px solid rgba(14,165,233,0.2);
          padding: 1px 5px;
          border-radius: 999px;
        }

        .sip-body {
          flex: 1;
          overflow-y: auto;
          padding: 6px 0 24px;
          scrollbar-width: thin;
          scrollbar-color: rgba(14,165,233,0.15) transparent;
        }
        .sip-body::-webkit-scrollbar { width: 3px; }
        .sip-body::-webkit-scrollbar-thumb {
          background: rgba(14,165,233,0.15);
          border-radius: 2px;
        }

        .sip-section {
          padding: 12px 16px 10px;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.06));
        }
        .sip-section:last-child { border-bottom: none; }
        .sip-section--isupport { padding-bottom: 24px; }

        .sip-section-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--accent, #0ea5e9);
          opacity: 0.6;
          margin: 0 0 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
        }

        /* Stat grid for key numbers */
        .sip-stat-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
          margin: 0;
        }

        .sip-stat-card {
          background: var(--bg-base, #0c1828);
          border: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          border-radius: var(--r-md, 8px);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          transition: border-color 120ms, background 120ms;
        }
        .sip-stat-card:hover {
          border-color: rgba(14,165,233,0.2);
          background: rgba(14,165,233,0.03);
        }

        .sip-stat-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary, #dff0ff);
          line-height: 1;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }
        .sip-stat-value--accent { color: var(--accent, #0ea5e9); }

        .sip-stat-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted, #3d6480);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .sip-dl {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin: 0;
        }

        .sip-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
          border-radius: var(--r-sm, 6px);
          padding: 4px 6px;
          margin: 0 -6px;
          transition: background 80ms;
        }
        .sip-row:hover {
          background: rgba(14,165,233,0.04);
        }

        .sip-row dt {
          font-size: 12px;
          color: var(--text-muted, #3d6480);
          flex-shrink: 0;
          width: 112px;
          min-width: 112px;
        }

        .sip-row dd {
          font-size: 12.5px;
          color: var(--text-primary, #dff0ff);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }

        .sip-mono {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11.5px !important;
          color: var(--gold, #67e8f9) !important;
        }

        .sip-empty {
          font-size: 12px;
          color: var(--text-muted, #3d6480);
          margin: 0;
          font-style: italic;
        }

        /* Capability tags — ocean sky-blue pill chips */
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
          font-size: 10.5px;
          padding: 2px 8px;
          background: rgba(14,165,233,0.08);
          border: 1px solid rgba(14,165,233,0.2);
          border-radius: 999px;
          color: var(--accent, #0ea5e9);
          white-space: nowrap;
          transition: background 100ms, border-color 100ms;
        }
        .sip-cap-tag:hover {
          background: rgba(14,165,233,0.14);
          border-color: rgba(14,165,233,0.35);
        }

        /* ISUPPORT grid */
        .sip-isupport-grid {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .sip-isupport-row {
          display: grid;
          grid-template-columns: minmax(80px, 42%) 1fr;
          gap: 8px;
          align-items: start;
          padding: 4px 6px;
          border-radius: var(--r-sm, 6px);
          transition: background 100ms;
          margin: 0 -6px;
        }
        .sip-isupport-row:hover {
          background: rgba(14,165,233,0.04);
        }
        .sip-isupport-key {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          font-weight: 700;
          color: var(--accent, #0ea5e9);
          letter-spacing: 0.03em;
          word-break: break-all;
        }
        .sip-isupport-val {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          color: var(--text-primary, #dff0ff);
          word-break: break-all;
          text-align: right;
        }
        .sip-isupport-empty {
          color: var(--text-muted, #3d6480);
        }

        @media (max-width: 768px) {
          .sip { width: 100%; }
        }
      `}</style>
    </>
  );
}
