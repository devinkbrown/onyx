'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

type ChanstatsChannel = {
  name: string;
  url?: string;
  json_url?: string;
  total_messages?: number;
  total_joins?: number;
  total_parts?: number;
  peak_members?: number;
  last_active?: number;
};

type ChanstatsIndex = {
  server?: string;
  generated?: number;
  live_users?: number;
  live_channels?: number;
  tracked_channels?: number;
  channels?: ChanstatsChannel[];
};

const numberFmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export default function ServerStatsWidget() {
  const serverStats = useOnyxStore(s => s.serverStats);
  const [chanstats, setChanstats] = useState<ChanstatsIndex | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadChanstats() {
      try {
        const res = await fetch('/stats/index.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as ChanstatsIndex;
        if (!cancelled) setChanstats(data);
      } catch {
        // The app also runs in dev environments without the nginx stats export.
      }
    }

    loadChanstats();
    const timer = window.setInterval(loadChanstats, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const activity = useMemo(() => {
    const channels = [...(chanstats?.channels ?? [])].sort(
      (a, b) => safeNumber(b.total_messages) - safeNumber(a.total_messages),
    );
    const top = channels[0];

    return {
      top,
      messages: channels.reduce((sum, channel) => sum + safeNumber(channel.total_messages), 0),
      joins: channels.reduce((sum, channel) => sum + safeNumber(channel.total_joins), 0),
      peak: channels.reduce((max, channel) => Math.max(max, safeNumber(channel.peak_members)), 0),
      tracked: safeNumber(chanstats?.tracked_channels ?? channels.length),
    };
  }, [chanstats]);

  if (!serverStats && !chanstats) return null;

  const stats: Array<{ mark: string; label: string; value: number }> = serverStats ? [
    { mark: 'USR', label: 'Users', value: serverStats.users },
    { mark: 'CHN', label: 'Channels', value: serverStats.channels },
    { mark: 'NET', label: 'Servers', value: serverStats.servers },
    { mark: 'OP', label: 'Operators', value: serverStats.opers },
  ] : [];

  return (
    <div className="ssw-root">
      {serverStats && (
        <>
          <h3 className="ssw-title">Network Stats</h3>
          <div className="ssw-grid">
            {stats.map(({ mark, label, value }) => (
              <div key={label} className="ssw-card">
                <span className="ssw-mark" aria-hidden>{mark}</span>
                <span className="ssw-value">{numberFmt.format(value)}</span>
                <span className="ssw-label">{label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {chanstats && (
        <section className="ssw-activity" aria-label="Channel activity">
          <div className="ssw-activity-head">
            <h3 className="ssw-title">Channel Activity</h3>
            <a href="/stats/" className="ssw-stats-link">Open</a>
          </div>

          <a href={activity.top?.url ?? '/stats/'} className="ssw-activity-main">
            <span className="ssw-activity-label">Top channel</span>
            <strong>{activity.top?.name ?? '#root'}</strong>
            <span>
              {compactFmt.format(safeNumber(activity.top?.total_messages))} messages tracked
            </span>
          </a>

          <div className="ssw-activity-grid">
            <div>
              <span>Messages</span>
              <strong>{compactFmt.format(activity.messages)}</strong>
            </div>
            <div>
              <span>Joins</span>
              <strong>{compactFmt.format(activity.joins)}</strong>
            </div>
            <div>
              <span>Peak</span>
              <strong>{numberFmt.format(activity.peak)}</strong>
            </div>
            <div>
              <span>Tracked</span>
              <strong>{numberFmt.format(activity.tracked)}</strong>
            </div>
          </div>
        </section>
      )}

      <style>{`
        .ssw-root {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-top: 4px;
          border-top: 1px solid var(--border-subtle);
          margin-top: 4px;
        }

        .ssw-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }

        .ssw-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .ssw-card {
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 8px);
          padding: 10px 10px 8px;
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
          position: relative;
          overflow: hidden;
          transition: border-color var(--t-fast);
        }

        .ssw-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent-border), transparent);
          opacity: 0;
          transition: opacity var(--t-fast);
        }

        .ssw-card:hover {
          border-color: var(--accent-border);
        }

        .ssw-card:hover::after {
          opacity: 1;
        }

        .ssw-mark {
          width: fit-content;
          padding: 2px 5px;
          border-radius: 5px;
          background: var(--accent-subtle);
          color: var(--accent);
          font-size: 8px;
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: 0.08em;
          margin-bottom: 5px;
        }

        .ssw-value {
          font-size: 20px;
          font-weight: 800;
          color: var(--accent);
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.03em;
        }

        .ssw-label {
          font-size: 10px;
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 1px;
        }

        .ssw-activity {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-top: 10px;
          border-top: 1px solid var(--border-subtle);
        }

        .ssw-activity-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .ssw-stats-link {
          color: var(--accent);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-decoration: none;
        }

        .ssw-stats-link:hover {
          text-decoration: underline;
        }

        .ssw-activity-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px;
          border: 1px solid var(--accent-border);
          border-radius: var(--r-md, 8px);
          background:
            radial-gradient(circle at 18% 16%, var(--accent-subtle), transparent 64%),
            var(--bg-void);
          text-decoration: none;
          min-width: 0;
          transition: border-color var(--t-fast), transform var(--t-fast);
        }

        .ssw-activity-main:hover {
          border-color: var(--accent);
          transform: translateY(-1px);
          text-decoration: none;
        }

        .ssw-activity-label,
        .ssw-activity-grid span {
          color: var(--text-muted);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ssw-activity-main strong {
          color: var(--text-primary);
          font-size: 18px;
          line-height: 1.05;
          overflow-wrap: anywhere;
        }

        .ssw-activity-main > span:last-child {
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.35;
        }

        .ssw-activity-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .ssw-activity-grid div {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 9px 10px;
          border-radius: var(--r-sm, 6px);
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-void) 86%, transparent);
        }

        .ssw-activity-grid strong {
          color: var(--text-primary);
          font-size: 15px;
          line-height: 1.05;
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }
      `}</style>
    </div>
  );
}
