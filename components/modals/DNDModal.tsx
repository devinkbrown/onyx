'use client';

import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';
import Button from '@/components/ui/Button';

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

function buildPreviewText(start: number, end: number): string {
  return `Notifications will be silenced from ${formatHour(start)} to ${formatHour(end)}`;
}

const DND_PRESETS = [
  { label: 'Until I turn it off', value: -1 },
  { label: 'For 1 hour',          value: 1 * 60 * 60 * 1000 },
  { label: 'For 4 hours',         value: 4 * 60 * 60 * 1000 },
  { label: 'For 8 hours',         value: 8 * 60 * 60 * 1000 },
] as const;

function getTomorrowTimestamp(): number {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return t.getTime();
}

export default function DNDModal() {
  const dndEnabled    = useOnyxStore(s => s.dndEnabled);
  const dndQuietStart = useOnyxStore(s => s.dndQuietStart);
  const dndQuietEnd   = useOnyxStore(s => s.dndQuietEnd);
  const dndUntil      = useOnyxStore(s => s.dndUntil);
  const isDndActive   = useOnyxStore(s => s.isDndActive);
  const setDndEnabled   = useOnyxStore(s => s.setDndEnabled);
  const setDndQuietHours = useOnyxStore(s => s.setDndQuietHours);
  const setDndUntil     = useOnyxStore(s => s.setDndUntil);
  const closeDndModal   = useOnyxStore(s => s.closeDndModal);

  const activeNow = isDndActive();

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <ModalShell
      onClose={closeDndModal}
      title={<><span className="dnd-moon" aria-hidden="true">🌙</span> Do Not Disturb</>}
      kicker="Presence"
      titleId="dnd-title"
      size="sm"
      closeLabel="Close Do Not Disturb settings"
      flushBody
      footer={
        <Button variant="primary" onClick={closeDndModal}>
          Done
        </Button>
      }
    >
      <div className="dnd-content">
        {/* Active indicator */}
        {activeNow && (
          <div className="dnd-active-badge" role="status" aria-live="polite">
            <span aria-hidden="true">🌙</span> DND is currently active
          </div>
        )}

        {/* Enable toggle */}
        <label className="dnd-row dnd-toggle-row">
          <div className="dnd-row-text">
            <span className="dnd-row-label">Enable Do Not Disturb</span>
            <span className="dnd-row-desc">Silence all notifications</span>
          </div>
          <button
            role="switch"
            aria-checked={dndEnabled}
            className={`dnd-toggle ${dndEnabled ? 'dnd-toggle--on' : ''}`}
            onClick={() => setDndEnabled(!dndEnabled)}
            aria-label="Toggle Do Not Disturb"
          >
            <span className="dnd-toggle-thumb" />
          </button>
        </label>

        {/* Quiet hours (shown when DND enabled) */}
        {dndEnabled && (
          <div className="dnd-quiet-section">
            <div className="label-caps dnd-section-label">Quiet Hours</div>

            <div className="dnd-hours-row">
              <div className="dnd-hours-field">
                <label htmlFor="dnd-start" className="label-caps dnd-field-label">From</label>
                <select
                  id="dnd-start"
                  className="dnd-select"
                  value={dndQuietStart}
                  onChange={(e) => setDndQuietHours(Number(e.target.value), dndQuietEnd)}
                >
                  {hours.map(h => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              <span className="dnd-hours-to" aria-hidden="true">—</span>

              <div className="dnd-hours-field">
                <label htmlFor="dnd-end" className="label-caps dnd-field-label">To</label>
                <select
                  id="dnd-end"
                  className="dnd-select"
                  value={dndQuietEnd}
                  onChange={(e) => setDndQuietHours(dndQuietStart, Number(e.target.value))}
                >
                  {hours.map(h => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="dnd-preview">
              {buildPreviewText(dndQuietStart, dndQuietEnd)}
            </p>
          </div>
        )}

        {/* Timed override section */}
        <div className="dnd-quiet-section">
          <div className="label-caps dnd-section-label">Suppress Notifications</div>
          <div className="dnd-presets">
            {DND_PRESETS.map(preset => {
              const isActive = preset.value === -1
                ? dndEnabled && dndUntil === null
                : dndUntil !== null && Math.abs(dndUntil - (Date.now() + preset.value)) < 5000;
              return (
                <button
                  key={preset.label}
                  className={`dnd-preset-btn${isActive ? ' dnd-preset-btn--active' : ''}`}
                  onClick={() => {
                    if (preset.value === -1) {
                      // Permanent — use the toggle
                      setDndUntil(null);
                      setDndEnabled(true);
                    } else {
                      setDndUntil(Date.now() + preset.value);
                      setDndEnabled(false);
                    }
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              className={`dnd-preset-btn${dndUntil !== null && dndUntil >= getTomorrowTimestamp() - 5000 ? ' dnd-preset-btn--active' : ''}`}
              onClick={() => {
                setDndUntil(getTomorrowTimestamp());
                setDndEnabled(false);
              }}
            >
              Until tomorrow
            </button>
            {(dndUntil !== null) && (
              <button
                className="dnd-preset-btn dnd-preset-btn--clear"
                onClick={() => setDndUntil(null)}
              >
                Clear timer
              </button>
            )}
          </div>
          {dndUntil !== null && Date.now() < dndUntil && (
            <p className="dnd-preview">
              Notifications suppressed until {new Date(dndUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      </div>

      <style>{`
        .dnd-moon {
          font-size: 18px;
          line-height: 1;
        }

        .dnd-active-badge {
          margin: var(--sp-3, 12px) var(--sp-5, 20px) 0;
          padding: 8px 12px;
          background: rgba(248,113,113,0.10);
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: var(--r-sm);
          font-size: var(--text-xs, 12px);
          font-weight: 600;
          color: var(--status-dnd);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .dnd-row {
          display: flex;
          align-items: center;
          gap: var(--sp-3, 12px);
          padding: var(--sp-4, 16px) var(--sp-5, 20px);
        }
        .dnd-toggle-row {
          cursor: pointer;
          border-bottom: 1px solid var(--border-subtle);
        }
        .dnd-row-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .dnd-row-label {
          font-size: var(--text-base, 14px);
          font-weight: 600;
          color: var(--text-primary);
        }
        .dnd-row-desc {
          font-size: var(--text-xs, 12px);
          color: var(--text-muted);
        }

        /* Toggle switch */
        .dnd-toggle {
          position: relative;
          width: 40px;
          height: 22px;
          border-radius: 11px;
          border: none;
          cursor: pointer;
          background: var(--bg-elevated, rgba(255,255,255,0.08));
          transition: background var(--t-surface, 220ms);
          flex-shrink: 0;
          padding: 0;
        }
        .dnd-toggle--on { background: var(--accent, #0ea5e9); }
        .dnd-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .dnd-toggle-thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--text-muted, #888);
          transition: transform var(--t-surface, 220ms), background var(--t-surface, 220ms);
        }
        .dnd-toggle--on .dnd-toggle-thumb {
          transform: translateX(18px);
          background: #fff;
        }

        /* Quiet hours section */
        .dnd-quiet-section {
          padding: var(--sp-4, 16px) var(--sp-5, 20px);
          border-bottom: 1px solid var(--border-subtle);
        }
        .dnd-quiet-section:last-child { border-bottom: none; }
        .dnd-section-label {
          margin-bottom: var(--sp-3, 12px);
        }
        .dnd-hours-row {
          display: flex;
          align-items: flex-end;
          gap: 10px;
        }
        .dnd-hours-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        .dnd-select {
          width: 100%;
          padding: 7px 10px;
          background: var(--bg-elevated, rgba(255,255,255,0.06));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm, 6px);
          color: var(--text-primary);
          font-size: var(--text-sm, 13px);
          font-family: inherit;
          cursor: pointer;
          appearance: auto;
          transition: border-color var(--t-control, 150ms);
        }
        .dnd-select:focus {
          outline: 2px solid var(--accent-border, rgba(14,165,233,0.5));
          outline-offset: 1px;
        }
        .dnd-hours-to {
          font-size: 16px;
          color: var(--text-muted);
          padding-bottom: 8px;
          flex-shrink: 0;
        }
        .dnd-preview {
          margin: var(--sp-3, 12px) 0 0;
          font-size: var(--text-xs, 12px);
          color: var(--text-muted);
          font-style: italic;
        }

        /* Preset buttons */
        .dnd-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: var(--sp-2, 8px);
        }
        .dnd-preset-btn {
          padding: 5px 12px;
          border-radius: var(--r-sm, 6px);
          border: 1px solid var(--border-normal);
          background: var(--bg-elevated, rgba(255,255,255,0.06));
          color: var(--text-secondary);
          font-size: var(--text-xs, 12px);
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms), color var(--t-control, 150ms);
        }
        .dnd-preset-btn:hover {
          background: var(--accent-subtle, rgba(14,165,233,0.1));
          border-color: var(--accent-border, rgba(14,165,233,0.4));
          color: var(--text-primary);
        }
        .dnd-preset-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .dnd-preset-btn--active {
          background: var(--accent-subtle, rgba(14,165,233,0.15));
          border-color: var(--accent, #0ea5e9);
          color: var(--accent, #0ea5e9);
          font-weight: 600;
        }
        .dnd-preset-btn--clear {
          border-color: var(--danger, #ef4444);
          color: var(--danger, #ef4444);
          background: transparent;
        }
        .dnd-preset-btn--clear:hover {
          background: rgba(239,68,68,0.1);
          border-color: var(--danger, #ef4444);
          color: var(--danger, #ef4444);
        }
        .dnd-preset-btn--clear:focus-visible {
          outline: 2px solid var(--danger);
          outline-offset: 2px;
        }
      `}</style>
    </ModalShell>
  );
}
