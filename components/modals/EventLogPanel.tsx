'use client';

import { useMemo, type CSSProperties } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChannelEventType } from '@/lib/store';

// ── Filter button labels ───────────────────────────────────────────────────────

const FILTER_LABELS: Record<ChannelEventType, { label: string; icon: string; activeColor: string }> = {
  join:  { label: 'Join',  icon: '▸', activeColor: '#3ba55d' },
  part:  { label: 'Part',  icon: '◂', activeColor: '#8b949e' },
  quit:  { label: 'Quit',  icon: '✕', activeColor: '#8b949e' },
  kick:  { label: 'Kick',  icon: '⊘', activeColor: '#f04747' },
  mode:  { label: 'Mode',  icon: '⚙', activeColor: '#9b79f5' },
  nick:  { label: 'Nick',  icon: '→', activeColor: '#58a6ff' },
};

const EVENT_TYPES: ChannelEventType[] = ['join', 'part', 'quit', 'kick', 'mode', 'nick'];

// ── Time formatter ─────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function EventLogPanel() {
  const activeView       = useOnyxStore(s => s.activeView);
  const channelEvents    = useOnyxStore(s => s.channelEvents);
  const eventLogFilters  = useOnyxStore(s => s.eventLogFilters);
  const toggleEventFilter = useOnyxStore(s => s.toggleEventFilter);
  const clearChannelEvents = useOnyxStore(s => s.clearChannelEvents);
  const closeEventLog    = useOnyxStore(s => s.closeEventLog);

  const channel = activeView.kind === 'channel' ? activeView.channel : null;
  const rawEvents = channel ? (channelEvents[channel.toLowerCase()] ?? []) : [];

  const events = useMemo(() => {
    return [...rawEvents]
      .filter(e => eventLogFilters.has(e.type))
      .reverse();
  }, [rawEvents, eventLogFilters]);

  return (
    <aside className="elp-panel" aria-label="Event Log" role="complementary">
      {/* Header */}
      <div className="elp-header">
        <span className="elp-title">Event Log</span>
        <div className="elp-header-actions">
          <button
            className="elp-clear-btn"
            onClick={() => channel && clearChannelEvents(channel)}
            title="Clear event log"
            aria-label="Clear event log"
          >
            <TrashIcon />
          </button>
          <button
            className="elp-close-btn"
            onClick={closeEventLog}
            aria-label="Close event log"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Filter toggles */}
      <div className="elp-filters" role="group" aria-label="Event type filters">
        {EVENT_TYPES.map(type => {
          const { label, icon, activeColor } = FILTER_LABELS[type];
          const active = eventLogFilters.has(type);
          return (
            <button
              key={type}
              className={`elp-filter-btn${active ? ' elp-filter-btn--active' : ''}`}
              style={active ? { '--filter-color': activeColor } as unknown as CSSProperties : undefined}
              onClick={() => toggleEventFilter(type)}
              aria-pressed={active}
              title={`Toggle ${label} events`}
            >
              <span className="elp-filter-icon" aria-hidden>{icon}</span>
              <span className="elp-filter-label">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Event list */}
      <div className="elp-list" role="log" aria-live="polite" aria-relevant="additions">
        {events.length === 0 ? (
          <div className="elp-empty">
            <span className="elp-empty-icon" aria-hidden>📋</span>
            <p className="elp-empty-text">No events yet</p>
          </div>
        ) : (
          events.map((event, idx) => {
            const { label, icon, activeColor } = FILTER_LABELS[event.type];
            return (
              <div key={`${event.time.getTime()}-${idx}`} className="elp-row">
                <span
                  className="elp-row-icon"
                  style={{ color: activeColor }}
                  aria-label={label}
                  title={label}
                >
                  {icon}
                </span>
                <span className="elp-row-time">{formatTime(event.time)}</span>
                <span className="elp-row-text">{event.text}</span>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .elp-panel {
          width: 300px;
          height: 100%;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-elevated);
          border-left: 1px solid var(--border-subtle);
          overflow: hidden;
          transform: translateX(0);
          animation: elp-slide-in 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        @keyframes elp-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        /* Header */
        .elp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          height: 48px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          gap: 8px;
        }

        .elp-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-secondary);
          flex: 1;
        }

        .elp-header-actions {
          display: flex;
          align-items: center;
          gap: 2px;
        }

        .elp-clear-btn,
        .elp-close-btn {
          width: 28px; height: 28px;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: var(--r-sm, 4px);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          transition: background 120ms, color 120ms;
        }
        .elp-clear-btn:hover { background: var(--danger-subtle, rgba(240,71,71,0.1)); color: var(--danger, #f04747); }
        .elp-close-btn:hover { background: var(--ch-hover-bg); color: var(--text-primary); }

        /* Filter bar */
        .elp-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 8px 10px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .elp-filter-btn {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 3px 7px;
          border-radius: var(--r-full, 9999px);
          border: 1px solid var(--border-subtle);
          background: var(--bg-deep);
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          color: var(--text-muted);
          transition: background 120ms, border-color 120ms, color 120ms;
          user-select: none;
        }
        .elp-filter-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-secondary);
        }
        .elp-filter-btn--active {
          background: color-mix(in srgb, var(--filter-color, var(--accent)) 14%, transparent);
          border-color: color-mix(in srgb, var(--filter-color, var(--accent)) 40%, transparent);
          color: var(--filter-color, var(--accent));
        }
        .elp-filter-icon {
          font-size: 10px;
          line-height: 1;
        }
        .elp-filter-label {
          line-height: 1;
        }

        /* Event list */
        .elp-list {
          flex: 1;
          overflow-y: auto;
          padding: 6px 0;
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border, rgba(14,165,233,0.28)) transparent;
        }
        .elp-list::-webkit-scrollbar { width: 3px; }
        .elp-list::-webkit-scrollbar-track { background: transparent; }
        .elp-list::-webkit-scrollbar-thumb {
          background: var(--accent-border, rgba(14,165,233,0.28));
          border-radius: 2px;
        }
        .elp-list::-webkit-scrollbar-thumb:hover {
          background: var(--accent, #0ea5e9);
        }

        .elp-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 40px 20px;
          text-align: center;
        }
        .elp-empty-icon { font-size: 28px; opacity: 0.4; }
        .elp-empty-text {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0;
        }

        .elp-row {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          padding: 3px 12px;
          transition: background 100ms;
        }
        .elp-row:nth-child(even) { background: rgba(255,255,255,0.018); }
        .elp-row:hover { background: var(--accent-subtle, rgba(14,165,233,0.06)) !important; }

        .elp-row-icon {
          font-size: 11px;
          line-height: 18px;
          flex-shrink: 0;
          width: 14px;
          text-align: center;
        }

        .elp-row-time {
          font-size: 10px;
          color: var(--text-muted);
          flex-shrink: 0;
          line-height: 18px;
          font-family: var(--font-mono, monospace);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
          white-space: nowrap;
          opacity: 0.7;
        }

        .elp-row-text {
          font-size: 12px;
          font-family: var(--font-mono, monospace);
          color: var(--text-secondary);
          line-height: 18px;
          min-width: 0;
          word-break: break-word;
        }

        @media (max-width: 768px) {
          .elp-panel { width: 260px; }
        }
      `}</style>
    </aside>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
      <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
