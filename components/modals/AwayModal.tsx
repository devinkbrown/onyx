'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';
import Button from '@/components/ui/Button';

const PRESETS = [
  { emoji: '🍽️', label: 'Lunch',    message: 'Out for lunch' },
  { emoji: '💤', label: 'Sleeping', message: 'Sleeping' },
  { emoji: '🎮', label: 'Gaming',   message: 'Gaming' },
  { emoji: '📞', label: 'On call',  message: 'On a call' },
];

const MAX_CHARS = 200;

const IDLE_OPTIONS = [
  { label: 'Disabled', value: 0 },
  { label: '5 min',    value: 5 },
  { label: '10 min',   value: 10 },
  { label: '15 min',   value: 15 },
  { label: '30 min',   value: 30 },
  { label: '1 hour',   value: 60 },
] as const;

export default function AwayModal() {
  const isAway             = useOnyxStore(s => s.isAway);
  const awayMessage        = useOnyxStore(s => s.awayMessage);
  const setAway            = useOnyxStore(s => s.setAway);
  const unsetAway          = useOnyxStore(s => s.unsetAway);
  const closeAwayModal     = useOnyxStore(s => s.closeAwayModal);
  const idleAwayMinutes    = useOnyxStore(s => s.idleAwayMinutes);
  const setIdleAwayMinutes = useOnyxStore(s => s.setIdleAwayMinutes);

  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSet = () => {
    const msg = draft.trim();
    if (!msg) return;
    setAway(msg);
  };

  return (
    <ModalShell
      onClose={closeAwayModal}
      title="Set Away Status"
      kicker="Presence"
      titleId="away-modal-title"
      size="sm"
    >
      <div className="away-content">
        {isAway ? (
          // ── Currently away — show current message + clear button ──────────
          <div className="away-current">
            <p className="away-current-label">You are currently away</p>
            <p className="away-current-msg">{awayMessage || '(no message)'}</p>
            <div className="away-actions">
              <Button variant="secondary" onClick={unsetAway}>
                Clear away
              </Button>
            </div>
          </div>
        ) : (
          // ── Set away ──────────────────────────────────────────────────────
          <>
            <div className="away-presets" role="group" aria-label="Quick presets">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  className="away-preset"
                  onClick={() => setDraft(p.message)}
                >
                  <span className="away-preset-emoji">{p.emoji}</span>
                  <span className="away-preset-label">{p.label}</span>
                </button>
              ))}
            </div>

            <div className="away-field">
              <textarea
                ref={textareaRef}
                className="away-textarea"
                placeholder="Custom away message…"
                value={draft}
                maxLength={MAX_CHARS}
                rows={3}
                onChange={e => setDraft(e.target.value)}
              />
              <span className="away-counter">{draft.length}/{MAX_CHARS}</span>
            </div>

            <div className="away-actions">
              <Button variant="primary" onClick={handleSet} disabled={!draft.trim()}>
                Set away
              </Button>
            </div>
          </>
        )}

        {/* ── Auto-away idle setting ───────────────────────────────────────── */}
        <div className="away-idle-section">
          <div className="away-idle-header">
            <span className="away-idle-icon">⏱</span>
            <span className="away-idle-label">Auto-away after idle</span>
          </div>
          <select
            className="away-idle-select"
            value={idleAwayMinutes}
            onChange={e => setIdleAwayMinutes(Number(e.target.value))}
            aria-label="Auto-away idle timeout"
          >
            {IDLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <style>{`
        .away-content {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4, 16px);
        }

        .away-presets {
          display: flex;
          gap: var(--sp-2, 8px);
          flex-wrap: wrap;
        }

        .away-preset {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          cursor: pointer;
          font-size: var(--text-xs, 12px);
          font-family: inherit;
          color: var(--text-secondary);
          transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms), color var(--t-control, 150ms);
        }
        .away-preset:hover {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          color: var(--text-primary);
          transform: translateY(-1px);
        }
        .away-preset:active { transform: translateY(0.5px); }
        .away-preset:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .away-actions {
          display: flex;
          justify-content: flex-end;
        }

        .away-preset-emoji { font-size: 15px; }
        .away-preset-label { font-weight: 500; }

        .away-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .away-textarea {
          width: 100%;
          padding: 10px 12px;
          background: var(--bg-void, #030810);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-md, 8px);
          color: var(--text-primary);
          font-size: var(--text-base, 14px);
          font-family: inherit;
          resize: vertical;
          min-height: 72px;
          box-sizing: border-box;
          transition: border-color var(--t-control, 150ms);
        }
        .away-textarea:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-color: var(--accent);
        }
        .away-textarea::placeholder { color: var(--text-muted); }

        .away-counter {
          font-size: var(--text-2xs, 11px);
          color: var(--text-muted);
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .away-current {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .away-current-label {
          font-size: var(--text-sm, 13px);
          color: var(--text-secondary);
          margin: 0;
        }

        .away-current-msg {
          font-size: var(--text-md, 15px);
          font-weight: 500;
          color: var(--text-primary);
          background: var(--bg-base, #0c1828);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-md, 8px);
          padding: 10px 12px;
          margin: 0;
          word-break: break-word;
        }

        .away-idle-section {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--sp-3, 12px);
          padding-top: var(--sp-3, 12px);
          border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
        }

        .away-idle-header {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .away-idle-icon {
          font-size: 15px;
        }

        .away-idle-label {
          font-size: var(--text-sm, 13px);
          font-weight: 500;
          color: var(--text-secondary);
        }

        .away-idle-select {
          padding: 5px 28px 5px 10px;
          background: var(--bg-void, #030810);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-md, 8px);
          color: var(--text-primary);
          font-size: var(--text-sm, 13px);
          font-family: inherit;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23607d8b' stroke-width='1.5' stroke-linecap='round' fill='none'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
          transition: border-color var(--t-control, 150ms);
        }
        .away-idle-select:hover {
          border-color: var(--border-normal);
        }
        .away-idle-select:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-color: var(--accent);
        }

        @media (prefers-reduced-motion: reduce) {
          .away-preset { transition-duration: 1ms; }
          .away-preset:hover,
          .away-preset:active { transform: none; }
        }
      `}</style>
    </ModalShell>
  );
}
