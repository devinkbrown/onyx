'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

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

  // Focus textarea on open
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAwayModal();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeAwayModal]);

  const handleSet = () => {
    const msg = draft.trim();
    if (!msg) return;
    setAway(msg);
  };

  return (
    <div
      className="away-backdrop"
      onClick={e => { if (e.target === e.currentTarget) closeAwayModal(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Set away status"
    >
      <div className="away-panel">
        <div className="away-header">
          <h2 className="away-title">Set Away Status</h2>
          <button className="away-close" onClick={closeAwayModal} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {isAway ? (
          // ── Currently away — show current message + clear button ──────────
          <div className="away-current">
            <p className="away-current-label">You are currently away</p>
            <p className="away-current-msg">{awayMessage || '(no message)'}</p>
            <button className="away-btn-clear" onClick={unsetAway}>
              Clear Away
            </button>
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

            <button
              className="away-btn-set"
              onClick={handleSet}
              disabled={!draft.trim()}
            >
              Set Away
            </button>
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
        .away-backdrop {
          position: fixed;
          inset: 0;
          z-index: 900;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .away-panel {
          width: 400px;
          max-width: calc(100vw - 32px);
          background: var(--bg-deep, #06101d);
          border: 1px solid var(--border-normal, rgba(255,255,255,0.1));
          border-radius: var(--r-xl, 16px);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.6);
        }

        .away-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .away-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .away-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm, 6px);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .away-close:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .away-presets {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .away-preset {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          background: var(--bg-base, #0c1828);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-full, 9999px);
          cursor: pointer;
          font-size: 13px;
          font-family: inherit;
          color: var(--text-secondary);
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
        }
        .away-preset:hover {
          background: var(--bg-overlay, rgba(255,255,255,0.08));
          border-color: var(--border-normal, rgba(255,255,255,0.1));
          color: var(--text-primary);
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
          font-size: 14px;
          font-family: inherit;
          resize: vertical;
          min-height: 72px;
          box-sizing: border-box;
          transition: border-color var(--t-fast);
        }
        .away-textarea:focus {
          outline: none;
          border-color: var(--accent-border, rgba(14,165,233,0.5));
        }
        .away-textarea::placeholder { color: var(--text-muted); }

        .away-counter {
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
        }

        .away-btn-set {
          padding: 9px 18px;
          background: var(--accent, #0ea5e9);
          color: #fff;
          border: none;
          border-radius: var(--r-md, 8px);
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: opacity var(--t-fast), filter var(--t-fast);
          align-self: flex-end;
        }
        .away-btn-set:hover:not(:disabled) { filter: brightness(1.1); }
        .away-btn-set:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .away-current {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .away-current-label {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
        }

        .away-current-msg {
          font-size: 15px;
          font-weight: 500;
          color: var(--text-primary);
          background: var(--bg-base, #0c1828);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-md, 8px);
          padding: 10px 12px;
          margin: 0;
          word-break: break-word;
        }

        .away-btn-clear {
          padding: 9px 18px;
          background: none;
          border: 1px solid var(--border-normal, rgba(255,255,255,0.1));
          color: var(--text-secondary);
          border-radius: var(--r-md, 8px);
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          align-self: flex-end;
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
        }
        .away-btn-clear:hover {
          background: var(--ch-hover-bg);
          border-color: var(--border-normal);
          color: var(--text-primary);
        }

        .away-idle-section {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-top: 12px;
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
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .away-idle-select {
          padding: 5px 28px 5px 10px;
          background: var(--bg-void, #030810);
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
          border-radius: var(--r-md, 8px);
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23607d8b' stroke-width='1.5' stroke-linecap='round' fill='none'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
          transition: border-color var(--t-fast);
        }
        .away-idle-select:focus {
          outline: none;
          border-color: var(--accent-border, rgba(14,165,233,0.5));
        }
      `}</style>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}
