'use client';

import { useEffect, useMemo, useState } from 'react';

type ChanstatsChannel = {
  name: string;
  url: string;
  json_url?: string;
  total_messages: number;
  total_joins: number;
  total_parts: number;
  peak_members: number;
  last_active: number;
};

type ChanstatsIndex = {
  server: string;
  generated: number;
  live_users: number;
  live_channels: number;
  tracked_channels: number;
  channels: ChanstatsChannel[];
};

const numberFmt = new Intl.NumberFormat('en-US');

export default function ChanstatsPreview() {
  const [stats, setStats] = useState<ChanstatsIndex | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/stats/index.json', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`chanstats ${res.status}`);
        return res.json() as Promise<ChanstatsIndex>;
      })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const channels = stats?.channels ?? [];
    const top = channels[0];
    return {
      top,
      messages: channels.reduce((sum, channel) => sum + (channel.total_messages || 0), 0),
      joins: channels.reduce((sum, channel) => sum + (channel.total_joins || 0), 0),
      peak: channels.reduce((max, channel) => Math.max(max, channel.peak_members || 0), 0),
    };
  }, [stats]);

  return (
    <section id="activity" className="cs-root" aria-label="Community activity">
      <div className="cs-heading">
        <span className="cs-kicker">Live archive</span>
        <h2>Community activity, exported by Orochi.</h2>
        <p>
          Channel statistics are generated directly inside the server and served
          as static JSON and HTML. No stats bot needs to join, part, or reconnect.
        </p>
      </div>

      <div className="cs-grid">
        <a href="/stats/" className="cs-main-card">
          <span className="cs-label">Stats portal</span>
          <strong>{summary.top?.name ?? '#root'}</strong>
          <span>
            {failed
              ? 'Open the generated channel statistics.'
              : summary.top
                ? `${numberFmt.format(summary.top.total_messages)} tracked messages`
                : 'Loading channel statistics...'}
          </span>
        </a>

        <div className="cs-metric">
          <span>Messages</span>
          <strong>{stats ? numberFmt.format(summary.messages) : '...'}</strong>
        </div>
        <div className="cs-metric">
          <span>Joins</span>
          <strong>{stats ? numberFmt.format(summary.joins) : '...'}</strong>
        </div>
        <div className="cs-metric">
          <span>Peak</span>
          <strong>{stats ? numberFmt.format(summary.peak) : '...'}</strong>
        </div>
        <div className="cs-metric">
          <span>Tracked</span>
          <strong>{stats ? numberFmt.format(stats.tracked_channels) : '...'}</strong>
        </div>
      </div>

      <style>{`
        .cs-root {
          position: relative;
          z-index: 1;
          max-width: 1240px;
          margin: 0 auto;
          padding: 0 clamp(20px, 5vw, 80px) 90px;
        }
        .cs-heading {
          max-width: 740px;
          margin: 0 auto 28px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .cs-kicker {
          display: inline-flex;
          width: fit-content;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--accent-border);
          background: var(--accent-subtle);
          color: var(--accent);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .cs-heading h2 {
          margin: 0;
          color: var(--text-primary);
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 850;
          line-height: 1.08;
          letter-spacing: -0.03em;
        }
        .cs-heading p {
          margin: 0;
          color: var(--text-secondary);
          font-size: clamp(0.98rem, 1.4vw, 1.08rem);
          line-height: 1.65;
        }
        .cs-grid {
          display: grid;
          grid-template-columns: 1.4fr repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .cs-main-card,
        .cs-metric {
          min-width: 0;
          min-height: 156px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-end;
          gap: 8px;
          padding: 22px;
          border-radius: 18px;
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-base) 88%, transparent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .cs-main-card {
          text-decoration: none;
          background:
            radial-gradient(circle at 20% 20%, var(--accent-subtle), transparent 58%),
            color-mix(in srgb, var(--bg-elevated) 88%, transparent);
          border-color: var(--accent-border);
          transition: border-color 160ms var(--ease-out), transform 160ms var(--ease-out);
        }
        .cs-main-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent);
          text-decoration: none;
        }
        .cs-label,
        .cs-metric span {
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .cs-main-card strong {
          color: var(--text-primary);
          font-size: clamp(1.5rem, 2.4vw, 2rem);
          line-height: 1.05;
          letter-spacing: -0.025em;
        }
        .cs-main-card > span:last-child {
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .cs-metric strong {
          color: var(--accent);
          font-size: clamp(1.45rem, 2.6vw, 2.15rem);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.035em;
          line-height: 1;
        }
        @media (max-width: 980px) {
          .cs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .cs-main-card { grid-column: 1 / -1; }
        }
        @media (max-width: 640px) {
          .cs-root {
            padding-left: 12px;
            padding-right: 12px;
            padding-bottom: 64px;
          }
          .cs-heading {
            align-items: flex-start;
            text-align: left;
            margin-bottom: 20px;
          }
          .cs-heading h2 { font-size: clamp(1.75rem, 8vw, 2.25rem); }
          .cs-grid { gap: 10px; }
          .cs-main-card,
          .cs-metric {
            min-height: 126px;
            padding: 18px;
            border-radius: 14px;
          }
        }
        @media (max-width: 375px) {
          .cs-root {
            padding-left: 8px;
            padding-right: 8px;
          }
          .cs-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
