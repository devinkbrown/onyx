'use client';

import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useDialogFocus } from './useDialogFocus';

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

  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef   = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  // Close on Escape or backdrop click
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDndModal();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeDndModal]);

  const activeNow = isDndActive();

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div
      ref={overlayRef}
      className="dnd-overlay"
      onClick={(e) => { if (e.target === overlayRef.current) closeDndModal(); }}
    >
      <div className="dnd-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="dnd-title">
        {/* Header */}
        <div className="dnd-header">
          <span className="dnd-moon" aria-hidden="true">🌙</span>
          <h2 id="dnd-title" className="dnd-title">Do Not Disturb</h2>
          <button
            className="dnd-close"
            onClick={closeDndModal}
            aria-label="Close Do Not Disturb settings"
          >
            ✕
          </button>
        </div>

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
            <div className="dnd-section-label">Quiet Hours</div>

            <div className="dnd-hours-row">
              <div className="dnd-hours-field">
                <label htmlFor="dnd-start" className="dnd-field-label">From</label>
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
                <label htmlFor="dnd-end" className="dnd-field-label">To</label>
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
          <div className="dnd-section-label">Suppress Notifications</div>
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

        {/* Footer */}
        <div className="dnd-footer">
          <button className="dnd-btn dnd-btn--primary" onClick={closeDndModal}>
            Done
          </button>
        </div>
      </div>

      <style>{`
        .dnd-overlay {
          position: fixed;
          inset: 0;
          z-index: 800;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: dnd-fade-in 120ms var(--ease-out, ease) both;
        }
        @keyframes dnd-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .dnd-modal {
          width: 420px;
          max-width: calc(100vw - 32px);
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          box-shadow: var(--shadow-xl);
          overflow: hidden;
          animation: dnd-slide-up 160ms var(--ease-out, ease) both;
        }
        @keyframes dnd-slide-up {
          from { transform: translateY(12px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }

        .dnd-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 18px 20px 16px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .dnd-moon {
          font-size: 20px;
          line-height: 1;
        }
        .dnd-title {
          flex: 1;
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .dnd-close {
          width: 28px;
          height: 28px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 14px;
          border-radius: var(--r-sm, 6px);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--t-fast, 80ms), color var(--t-fast, 80ms);
          font-family: inherit;
        }
        .dnd-close:hover {
          background: var(--ch-hover-bg, rgba(255,255,255,0.06));
          color: var(--text-primary);
        }

        .dnd-active-badge {
          margin: 12px 20px 0;
          padding: 8px 12px;
          background: rgba(248,113,113,0.10);
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: var(--r-sm);
          font-size: 12px;
          font-weight: 600;
          color: var(--status-dnd);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .dnd-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
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
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .dnd-row-desc {
          font-size: 12px;
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
          transition: background var(--t-normal, 200ms);
          flex-shrink: 0;
          padding: 0;
        }
        .dnd-toggle--on { background: var(--accent, #0ea5e9); }
        .dnd-toggle-thumb {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--text-muted, #888);
          transition: transform var(--t-normal, 200ms), background var(--t-normal, 200ms);
        }
        .dnd-toggle--on .dnd-toggle-thumb {
          transform: translateX(18px);
          background: #fff;
        }

        /* Quiet hours section */
        .dnd-quiet-section {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .dnd-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 12px;
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
        .dnd-field-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .dnd-select {
          width: 100%;
          padding: 7px 10px;
          background: var(--bg-elevated, rgba(255,255,255,0.06));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm, 6px);
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          appearance: auto;
          transition: border-color var(--t-fast, 80ms);
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
          margin: 12px 0 0;
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }

        /* Preset buttons */
        .dnd-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .dnd-preset-btn {
          padding: 5px 12px;
          border-radius: var(--r-sm, 6px);
          border: 1px solid var(--border-normal);
          background: var(--bg-elevated, rgba(255,255,255,0.06));
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-fast, 80ms), border-color var(--t-fast, 80ms), color var(--t-fast, 80ms);
        }
        .dnd-preset-btn:hover {
          background: var(--accent-subtle, rgba(14,165,233,0.1));
          border-color: var(--accent-border, rgba(14,165,233,0.4));
          color: var(--text-primary);
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

        /* Footer */
        .dnd-footer {
          display: flex;
          justify-content: flex-end;
          padding: 14px 20px;
        }
        .dnd-btn {
          padding: 8px 20px;
          border-radius: var(--r-sm, 6px);
          border: none;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-fast, 80ms), opacity var(--t-fast, 80ms);
        }
        .dnd-btn--primary {
          background: var(--accent, #0ea5e9);
          color: #fff;
        }
        .dnd-btn--primary:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}
