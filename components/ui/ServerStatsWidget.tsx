'use client';

import { useOnyxStore } from '@/lib/store';

export default function ServerStatsWidget() {
  const serverStats = useOnyxStore(s => s.serverStats);

  if (!serverStats) return null;

  const stats: Array<{ icon: string; label: string; value: number }> = [
    { icon: '👥', label: 'Users', value: serverStats.users },
    { icon: '📢', label: 'Channels', value: serverStats.channels },
    { icon: '🌐', label: 'Servers', value: serverStats.servers },
    { icon: '⭐', label: 'Operators', value: serverStats.opers },
  ];

  return (
    <div className="ssw-root">
      <h3 className="ssw-title">Network Stats</h3>
      <div className="ssw-grid">
        {stats.map(({ icon, label, value }) => (
          <div key={label} className="ssw-card">
            <span className="ssw-icon" aria-hidden>{icon}</span>
            <span className="ssw-value">{value.toLocaleString()}</span>
            <span className="ssw-label">{label}</span>
          </div>
        ))}
      </div>

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

        .ssw-icon {
          font-size: 14px;
          line-height: 1;
          margin-bottom: 4px;
          opacity: 0.75;
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
      `}</style>
    </div>
  );
}
