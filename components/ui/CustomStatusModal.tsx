'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── Activity preset quick-picks ───────────────────────────────────────────────

const PRESETS: Array<{ emoji: string; label: string; text: string }> = [
  { emoji: '🎮', label: 'Gaming',    text: '🎮 Gaming' },
  { emoji: '💻', label: 'Coding',    text: '💻 Coding' },
  { emoji: '🎵', label: 'Music',     text: '🎵 Music' },
  { emoji: '📚', label: 'Studying',  text: '📚 Studying' },
  { emoji: '🍕', label: 'AFK',       text: '🍕 AFK' },
  { emoji: '😴', label: 'Do Not Disturb', text: '😴 Do Not Disturb' },
];

const EMOJI_ROW = ['😀', '😂', '😍', '🔥', '💯', '🎉', '👀', '🤔', '😎', '🥳', '💪', '🙌'];

const MAX_LEN = 128;

// ── Expiry options ─────────────────────────────────────────────────────────────

type ExpiryOption = '1h' | '4h' | 'today' | 'week' | 'never';

const EXPIRY_LABELS: Record<ExpiryOption, string> = {
  '1h':   '1 hour',
  '4h':   '4 hours',
  'today': 'Today',
  'week':  'This week',
  'never': 'Never',
};

function computeExpiry(option: ExpiryOption): Date | null {
  if (option === 'never') return null;
  const now = new Date();
  if (option === '1h') {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (option === '4h') {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  }
  if (option === 'today') {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d;
  }
  // week
  const d = new Date(now);
  d.setDate(d.getDate() + (7 - d.getDay()));
  d.setHours(23, 59, 59, 999);
  return d;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomStatusModal() {
  const customStatus          = useOnyxStore(s => s.customStatus);
  const customStatusExpiry    = useOnyxStore(s => s.customStatusExpiry);
  const setCustomStatus       = useOnyxStore(s => s.setCustomStatus);
  const setCustomStatusExpiry = useOnyxStore(s => s.setCustomStatusExpiry);
  const closeCustomStatus     = useOnyxStore(s => s.closeCustomStatus);
  const client                = useOnyxStore(s => s.client);

  const [draft, setDraft]             = useState(customStatus);
  const [showEmoji, setShowEmoji]     = useState(false);
  const [expiryOption, setExpiryOption] = useState<ExpiryOption>(() => {
    if (!customStatusExpiry) return 'never';
    return 'never'; // default to 'never' on open, user can re-pick
  });
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCustomStatus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeCustomStatus]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) closeCustomStatus();
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    setCustomStatus(trimmed);
    setCustomStatusExpiry(computeExpiry(expiryOption));
    // Send IRC AWAY with the status text so other clients see it
    if (client) {
      if (trimmed) {
        client.sendRaw('AWAY', trimmed);
      } else {
        client.sendRaw('AWAY');  // clears AWAY
      }
    }
    closeCustomStatus();
  };

  const handleClear = () => {
    setCustomStatus('');
    setCustomStatusExpiry(null);
    if (client) client.sendRaw('AWAY');
    closeCustomStatus();
  };

  const appendEmoji = (emoji: string) => {
    const next = (draft + emoji).slice(0, MAX_LEN);
    setDraft(next);
    setShowEmoji(false);
    inputRef.current?.focus();
  };

  const handlePreset = (preset: { emoji: string; text: string }) => {
    setDraft(preset.text.slice(0, MAX_LEN));
    inputRef.current?.focus();
  };

  const remaining = MAX_LEN - draft.length;

  return (
    <div
      className="csm-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal
      aria-label="Set custom status"
    >
      <div className="csm-panel animate-csm-in">

        {/* Header */}
        <div className="csm-header">
          <span className="csm-title">Set a custom status</span>
          <button className="csm-close-btn" onClick={closeCustomStatus} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Input row */}
        <div className="csm-input-row">
          <button
            className={`csm-emoji-btn ${showEmoji ? 'csm-emoji-btn--active' : ''}`}
            onClick={() => setShowEmoji(v => !v)}
            aria-label="Pick an emoji"
            type="button"
          >
            😊
          </button>
          <input
            ref={inputRef}
            className="csm-input"
            type="text"
            placeholder="What's your status?"
            value={draft}
            maxLength={MAX_LEN}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            aria-label="Custom status text"
          />
          <span className={`csm-char-count ${remaining <= 10 ? 'csm-char-count--warn' : ''}`}>
            {draft.length} / {MAX_LEN}
          </span>
        </div>

        {/* Emoji picker row */}
        {showEmoji && (
          <div className="csm-emoji-row" role="group" aria-label="Quick emoji">
            {EMOJI_ROW.map(em => (
              <button
                key={em}
                className="csm-emoji-pick"
                onClick={() => appendEmoji(em)}
                aria-label={em}
                type="button"
              >
                {em}
              </button>
            ))}
          </div>
        )}

        {/* Activity preset chips */}
        <div className="csm-presets-label">Activity</div>
        <div className="csm-presets">
          {PRESETS.map(p => (
            <button
              key={p.text}
              className={`csm-preset-chip ${draft === p.text ? 'csm-preset-chip--active' : ''}`}
              onClick={() => handlePreset(p)}
              type="button"
            >
              <span className="csm-preset-emoji" aria-hidden>{p.emoji}</span>
              {p.label}
            </button>
          ))}
        </div>

        {/* Expiry selector */}
        <div className="csm-presets-label">Clear after</div>
        <div className="csm-expiry-row">
          {(Object.keys(EXPIRY_LABELS) as ExpiryOption[]).map(opt => (
            <button
              key={opt}
              className={`csm-expiry-btn ${expiryOption === opt ? 'csm-expiry-btn--active' : ''}`}
              onClick={() => setExpiryOption(opt)}
              type="button"
              aria-pressed={expiryOption === opt}
            >
              {EXPIRY_LABELS[opt]}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="csm-actions">
          <button className="csm-clear-btn" onClick={handleClear} type="button">
            Clear Status
          </button>
          <button className="csm-save-btn" onClick={handleSave} type="button">
            Save
          </button>
        </div>

      </div>

      <style>{`
        /* ── Overlay ── */
        .csm-overlay {
          position: fixed;
          inset: 0;
          z-index: 950;
          display: flex;
          align-items: flex-end;
          justify-content: flex-start;
          padding: 0 0 60px 8px;
          pointer-events: none;
        }

        /* ── Panel ── */
        .csm-panel {
          pointer-events: all;
          width: 340px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl, 0 16px 48px rgba(0,0,0,0.55));
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        @keyframes csm-in {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-csm-in { animation: csm-in 150ms cubic-bezier(0.16, 1, 0.3, 1) both; }

        /* ── Header ── */
        .csm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .csm-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0.01em;
        }

        .csm-close-btn {
          width: 24px;
          height: 24px;
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--r-sm);
          transition: background 120ms ease, color 120ms ease;
        }
        .csm-close-btn:hover { background: var(--bg-overlay); color: var(--text-primary); }

        /* ── Input row ── */
        .csm-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 6px 10px;
          transition: border-color 150ms ease;
        }
        .csm-input-row:focus-within {
          border-color: var(--accent-border, var(--accent));
        }

        .csm-emoji-btn {
          font-size: 18px;
          line-height: 1;
          background: none;
          border: none;
          cursor: pointer;
          border-radius: var(--r-sm);
          padding: 2px;
          transition: background 120ms ease;
          flex-shrink: 0;
        }
        .csm-emoji-btn:hover { background: var(--bg-overlay); }
        .csm-emoji-btn--active { background: var(--accent-subtle); }

        .csm-input {
          flex: 1;
          border: none;
          background: transparent;
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
          outline: none;
          min-width: 0;
        }
        .csm-input::placeholder { color: var(--text-muted); }

        .csm-char-count {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
        .csm-char-count--warn { color: var(--status-idle, #f59e0b); }

        /* ── Emoji picker row ── */
        .csm-emoji-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 6px;
          background: var(--bg-deep);
          border-radius: var(--r-md);
          border: 1px solid var(--border-subtle);
        }

        .csm-emoji-pick {
          font-size: 20px;
          line-height: 1;
          background: none;
          border: none;
          cursor: pointer;
          border-radius: var(--r-sm);
          padding: 4px;
          transition: background 100ms ease;
        }
        .csm-emoji-pick:hover { background: var(--bg-overlay); }

        /* ── Section label ── */
        .csm-presets-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        /* ── Activity presets ── */
        .csm-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .csm-preset-chip {
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-float, var(--bg-deep));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          padding: 4px 10px;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
          white-space: nowrap;
          font-family: inherit;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .csm-preset-chip:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }
        .csm-preset-chip--active {
          background: var(--accent-subtle);
          color: var(--accent);
          border-color: var(--accent);
        }
        .csm-preset-emoji {
          font-size: 14px;
          line-height: 1;
        }

        /* ── Expiry row ── */
        .csm-expiry-row {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .csm-expiry-btn {
          font-size: 11px;
          font-weight: 500;
          font-family: inherit;
          color: var(--text-secondary);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          padding: 4px 9px;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
          white-space: nowrap;
        }
        .csm-expiry-btn:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }
        .csm-expiry-btn--active {
          background: var(--accent-subtle);
          color: var(--accent);
          border-color: var(--accent-border, var(--accent));
        }

        /* ── Actions ── */
        .csm-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .csm-clear-btn {
          flex: 1;
          height: 36px;
          border: 1px solid var(--border-normal);
          background: transparent;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          border-radius: var(--r-md);
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }
        .csm-clear-btn:hover { background: var(--bg-overlay); color: var(--text-primary); }

        .csm-save-btn {
          flex: 1;
          height: 36px;
          border: none;
          background: var(--accent);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          font-family: inherit;
          border-radius: var(--r-md);
          cursor: pointer;
          transition: opacity 120ms ease;
        }
        .csm-save-btn:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 1l10 10M11 1L1 11" />
    </svg>
  );
}
