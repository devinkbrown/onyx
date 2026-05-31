'use client';

import { useEffect, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';

// ── Time helpers ──────────────────────────────────────────────────────────────

function formatIdleDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow({ width = '70%' }: { width?: string }) {
  return <div className="whois-skeleton" style={{ width }} />;
}

// ── Channel pill ─────────────────────────────────────────────────────────────

interface PillProps {
  name: string;
  onClick: () => void;
}

function ChannelPill({ name, onClick }: PillProps) {
  // Strip leading mode prefixes (@, +, %, ~, &) to get just the channel name
  const bare = name.replace(/^[@+%~&]+/, '');
  const prefix = name.slice(0, name.length - bare.length);
  return (
    <button className="whois-pill" onClick={onClick} title={`Go to ${bare}`}>
      <span className="whois-pill-prefix">{prefix}</span>
      {bare}
    </button>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function WhoisPanel() {
  const closeWhois      = useOnyxStore(s => s.closeWhois);
  const whoisNick       = useOnyxStore(s => s.whoisNick);
  const whoisData       = useOnyxStore(s => s.whoisData);
  const navigate        = useOnyxStore(s => s.navigate);
  const openUserProfile = useOnyxStore(s => s.openUserProfile);

  const nick    = whoisNick ?? '';
  const info    = whoisData.get(nick.toLowerCase());
  const loading = info?.loading ?? true;

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWhois();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeWhois]);

  const goToChannel = useCallback((channel: string) => {
    // Strip leading mode prefixes to get the channel name
    const bare = channel.replace(/^[@+%~&]+/, '');
    navigate({ kind: 'channel', channel: bare });
    closeWhois();
  }, [navigate, closeWhois]);

  const openDM = useCallback(() => {
    navigate({ kind: 'dm', nick });
    closeWhois();
  }, [navigate, nick, closeWhois]);

  const viewProfile = useCallback(() => {
    openUserProfile(nick);
    closeWhois();
  }, [openUserProfile, nick, closeWhois]);

  // Channels: show first 10, count overflow
  const allChannels = info?.channels ?? [];
  const visibleChannels = allChannels.slice(0, 10);
  const overflowCount  = allChannels.length - visibleChannels.length;

  const signOnDate = info?.signOnTs ? new Date(info.signOnTs * 1000) : null;

  return (
    <>
      <aside className="whois-panel animate-whois-in" role="complementary" aria-label={`User info for ${nick}`}>
        {/* Header */}
        <div className="whois-header">
          <span className="whois-header-title">User Info</span>
          <button
            className="whois-close"
            onClick={closeWhois}
            aria-label="Close user info panel"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="whois-body">
          {/* Identity section */}
          <div className="whois-identity">
            <div className="whois-avatar-wrap">
              <Avatar nick={nick} size={64} />
            </div>
            <div className="whois-nick">{nick}</div>

            {loading ? (
              <>
                <SkeletonRow width="55%" />
                <SkeletonRow width="40%" />
              </>
            ) : (
              <>
                {info?.username && info.host && (
                  <div className="whois-userhost">
                    {info.username}@{info.host}
                  </div>
                )}
                {info?.realname && (
                  <div className="whois-realname">{info.realname}</div>
                )}
                {info?.account && (
                  <div className="whois-account">
                    <span className="whois-account-icon" aria-label="Logged in">
                      <NickServIcon />
                    </span>
                    {info.account}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="whois-divider" />

          {/* Connection section */}
          <section className="whois-section">
            <div className="whois-section-label">Connection</div>
            {loading ? (
              <>
                <SkeletonRow width="80%" />
                <SkeletonRow width="60%" />
                <SkeletonRow width="70%" />
              </>
            ) : (
              <>
                {(info?.server || info?.serverInfo) && (
                  <div className="whois-row">
                    <span className="whois-row-label">Server</span>
                    <span className="whois-row-value">
                      {info.server}{info.serverInfo ? ` — ${info.serverInfo}` : ''}
                    </span>
                  </div>
                )}
                {info?.idleSecs !== undefined && (
                  <div className="whois-row">
                    <span className="whois-row-label">Idle</span>
                    <span className="whois-row-value">
                      {formatIdleDuration(info.idleSecs)}
                    </span>
                  </div>
                )}
                {signOnDate && (
                  <div className="whois-row">
                    <span className="whois-row-label">Connected</span>
                    <span className="whois-row-value">
                      {DATE_FMT.format(signOnDate)}
                    </span>
                  </div>
                )}
                {info?.realHost && (
                  <div className="whois-row">
                    <span className="whois-row-label">Real host</span>
                    <code className="whois-row-code">{info.realHost}</code>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Channels section */}
          {(loading || visibleChannels.length > 0) && (
            <>
              <div className="whois-divider" />
              <section className="whois-section">
                <div className="whois-section-label">Channels</div>
                {loading ? (
                  <div className="whois-pills-skeleton">
                    <SkeletonRow width="60px" />
                    <SkeletonRow width="80px" />
                    <SkeletonRow width="50px" />
                  </div>
                ) : (
                  <div className="whois-pills">
                    {visibleChannels.map(ch => (
                      <ChannelPill key={ch} name={ch} onClick={() => goToChannel(ch)} />
                    ))}
                    {overflowCount > 0 && (
                      <span className="whois-overflow">+{overflowCount} more</span>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {/* Flags section */}
          {!loading && (info?.isOper || info?.special) && (
            <>
              <div className="whois-divider" />
              <section className="whois-section">
                <div className="whois-section-label">Flags</div>
                {info.isOper && (
                  <div className="whois-badge-oper">
                    <StarIcon />
                    IRC Operator
                  </div>
                )}
                {info.special && (
                  <div className="whois-special">{info.special}</div>
                )}
              </section>
            </>
          )}

          <div className="whois-divider" />

          {/* Actions */}
          <section className="whois-section whois-actions">
            <button className="whois-btn whois-btn--primary" onClick={openDM}>
              Send Message
            </button>
            <button className="whois-btn whois-btn--secondary" onClick={viewProfile}>
              View Profile
            </button>
          </section>
        </div>
      </aside>

      <style>{`
        .whois-panel {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
          width: 360px;
          z-index: 610;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          display: flex;
          flex-direction: column;
          box-shadow: -12px 0 48px rgba(0,0,0,0.55), -1px 0 0 var(--border-subtle);
          overflow: hidden;
        }

        @keyframes whois-slide-in {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .animate-whois-in {
          animation: whois-slide-in 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        /* Header */
        .whois-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          height: var(--header-h, 48px);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-elevated);
        }
        .whois-header-title {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .whois-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
        }
        .whois-close:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        /* Body */
        .whois-body {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 16px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        /* Identity */
        .whois-identity {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 24px 16px 16px;
          gap: 6px;
          text-align: center;
        }
        .whois-avatar-wrap {
          margin-bottom: 8px;
          position: relative;
        }
        .whois-nick {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }
        .whois-userhost {
          font-size: 11px;
          font-family: var(--font-mono, monospace);
          color: var(--text-muted);
          word-break: break-all;
          cursor: text;
          user-select: all;
        }
        .whois-userhost:hover { color: var(--text-secondary); }
        .whois-realname {
          font-size: 13px;
          color: var(--text-secondary);
        }
        .whois-account {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          padding: 3px 10px;
          border-radius: var(--r-full);
          font-weight: 700;
        }
        .whois-account-icon {
          display: flex;
          align-items: center;
          color: var(--accent);
        }

        /* Divider */
        .whois-divider {
          height: 1px;
          background: var(--border-subtle);
          margin: 0 16px;
        }

        /* Sections */
        .whois-section {
          padding: 12px 16px;
        }
        .whois-section-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 10px;
        }

        /* Rows — label + copyable value */
        .whois-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 5px 0;
          border-bottom: 1px solid var(--border-subtle);
        }
        .whois-row:last-child { border-bottom: none; }
        .whois-row-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          flex-shrink: 0;
          width: 72px;
          padding-top: 1px;
        }
        .whois-row-value {
          font-size: 13px;
          color: var(--text-secondary);
          word-break: break-word;
          flex: 1;
          cursor: text;
          user-select: all;
          transition: color var(--t-fast);
        }
        .whois-row-value:hover { color: var(--text-primary); }
        .whois-row-code {
          font-size: 12px;
          font-family: var(--font-mono, monospace);
          color: var(--text-secondary);
          word-break: break-all;
          flex: 1;
          cursor: text;
          user-select: all;
        }

        /* Channel pills */
        .whois-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .whois-pills-skeleton {
          display: flex;
          gap: 6px;
        }
        .whois-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          font-size: 12px;
          font-weight: 600;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          font-family: inherit;
        }
        .whois-pill:hover {
          background: var(--accent-subtle);
          color: var(--accent);
          border-color: var(--accent-border);
        }
        .whois-pill-prefix {
          color: var(--gold);
          font-weight: 700;
          margin-right: 1px;
        }
        .whois-overflow {
          font-size: 12px;
          color: var(--text-muted);
          padding: 3px 0;
          align-self: center;
        }

        /* Oper badge */
        .whois-badge-oper {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          background: var(--gold-subtle);
          border: 1px solid color-mix(in srgb, var(--gold) 35%, transparent);
          border-radius: var(--r-full);
          font-size: 12px;
          font-weight: 700;
          color: var(--gold);
        }
        .whois-special {
          font-size: 13px;
          color: var(--text-secondary);
          margin-top: 6px;
        }

        /* Actions */
        .whois-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .whois-btn {
          width: 100%;
          padding: 10px 16px;
          border-radius: var(--r-md);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          font-family: inherit;
          transition: background var(--t-fast, 150ms), opacity var(--t-fast, 150ms);
        }
        .whois-btn--primary {
          background: var(--accent);
          color: #fff;
        }
        .whois-btn--primary:hover { background: var(--accent-hover); }
        .whois-btn--secondary {
          background: var(--bg-elevated);
          color: var(--text-secondary);
          border: 1px solid var(--border-normal);
        }
        .whois-btn--secondary:hover { background: var(--bg-float); color: var(--text-primary); }

        /* Skeleton */
        .whois-skeleton {
          height: 12px;
          border-radius: var(--r-sm);
          background: linear-gradient(
            90deg,
            var(--bg-elevated) 25%,
            var(--bg-float) 50%,
            var(--bg-elevated) 75%
          );
          background-size: 200% 100%;
          animation: whois-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes whois-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @media (max-width: 768px) {
          .whois-panel {
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function NickServIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="5" />
      <path d="M4 6l1.5 1.5L8 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
      <path d="M6.5 1l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6.5 9.2 3.3 10.9l.6-3.6L1.3 4.8l3.6-.5z" />
    </svg>
  );
}
