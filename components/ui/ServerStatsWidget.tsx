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
        }

        .ssw-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }

        .ssw-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .ssw-card {
          background: var(--bg-deep, #06101d);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-md, 8px);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .ssw-icon {
          font-size: 16px;
          line-height: 1;
          margin-bottom: 2px;
        }

        .ssw-value {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary, #e8eaf0);
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }

        .ssw-label {
          font-size: 11px;
          color: var(--text-muted, rgba(255,255,255,0.4));
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
