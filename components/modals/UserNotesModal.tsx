'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useDialogFocus } from './useDialogFocus';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  nick: string;
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LENGTH = 500;

// ── Component ─────────────────────────────────────────────────────────────────

export default function UserNotesModal({ nick, onClose }: Props) {
  const getUserNote  = useOnyxStore(s => s.getUserNote);
  const setUserNote  = useOnyxStore(s => s.setUserNote);
  const deleteUserNote = useOnyxStore(s => s.deleteUserNote);

  const existingNote = getUserNote(nick);
  const [text, setText] = useState(existingNote);
  const [saved, setSaved] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef    = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = () => {
    setUserNote(nick, text);
    setSaved(true);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleDelete = () => {
    deleteUserNote(nick);
    onClose();
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const remaining = MAX_LENGTH - text.length;
  const hasExisting = existingNote.trim().length > 0;

  return (
    <div className="unm-overlay" onClick={handleBackdrop}>
      <div className="unm-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="unm-modal-title">
        <div className="unm-header">
          <span id="unm-modal-title" className="unm-title">Note about <strong>{nick}</strong></span>
          <button className="unm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        <div className="unm-body">
          <textarea
            ref={textareaRef}
            className="unm-textarea"
            value={text}
            onChange={e => {
              if (e.target.value.length <= MAX_LENGTH) setText(e.target.value);
            }}
            rows={5}
            placeholder="Add a private note about this user..."
            maxLength={MAX_LENGTH}
          />
          <div className="unm-counter" aria-live="polite">
            <span className={remaining <= 50 ? 'unm-counter--warn' : ''}>{remaining}</span>
          </div>
        </div>

        <div className="unm-footer">
          {hasExisting && (
            <button className="unm-btn unm-btn--delete" onClick={handleDelete}>
              Delete
            </button>
          )}
          <div className="unm-footer-right">
            {saved && <span className="unm-saved" aria-live="assertive">✓ Saved</span>}
            <button className="unm-btn unm-btn--cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="unm-btn unm-btn--save"
              onClick={handleSave}
              disabled={saved}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = `
  .unm-overlay {
    position: fixed;
    inset: 0;
    z-index: 1400;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: unm-fade 120ms ease both;
  }

  @keyframes unm-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .unm-modal {
    width: 100%;
    max-width: 400px;
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-xl), 0 0 0 1px var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 0;
    animation: unm-in 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }

  @keyframes unm-in {
    from { opacity: 0; transform: scale(0.92) translateY(8px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }

  .unm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .unm-title {
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .unm-title strong {
    color: var(--accent);
  }

  .unm-close {
    width: 26px;
    height: 26px;
    border-radius: var(--r-full);
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: background var(--t-fast, 120ms), color var(--t-fast, 120ms);
  }
  .unm-close:hover {
    background: var(--bg-float);
    color: var(--text-primary);
  }

  .unm-body {
    padding: 14px 16px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .unm-textarea {
    width: 100%;
    background: var(--bg-base);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-md);
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
    resize: vertical;
    min-height: 120px;
    font-family: inherit;
    transition: border-color var(--t-fast, 120ms), box-shadow var(--t-fast, 120ms);
    box-sizing: border-box;
    scrollbar-width: thin;
    scrollbar-color: var(--accent-border, rgba(14,165,233,0.28)) transparent;
  }
  .unm-textarea::placeholder {
    color: var(--text-muted);
    font-style: italic;
  }
  .unm-textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle, rgba(14,165,233,0.12));
  }

  .unm-counter {
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
    padding-right: 2px;
  }
  .unm-counter--warn {
    color: var(--status-dnd, #f04747);
  }

  .unm-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 14px;
    gap: 8px;
  }

  .unm-footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .unm-saved {
    font-size: 12px;
    color: var(--status-online, #43b581);
    font-weight: 500;
    animation: unm-saved-in 200ms ease both;
  }

  @keyframes unm-saved-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .unm-btn {
    border: none;
    border-radius: var(--r-sm);
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--t-fast, 120ms), color var(--t-fast, 120ms), opacity var(--t-fast, 120ms);
  }

  .unm-btn--save {
    background: var(--accent);
    color: #fff;
  }
  .unm-btn--save:hover:not(:disabled) {
    background: var(--accent-hover, color-mix(in srgb, var(--accent) 85%, #fff));
  }
  .unm-btn--save:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .unm-btn--cancel {
    background: var(--bg-float);
    color: var(--text-secondary);
    border: 1px solid var(--border-normal);
  }
  .unm-btn--cancel:hover {
    background: var(--bg-overlay);
    color: var(--text-primary);
  }

  .unm-btn--delete {
    background: none;
    color: var(--status-dnd, #f04747);
    border: 1px solid rgba(240, 71, 71, 0.3);
  }
  .unm-btn--delete:hover {
    background: rgba(240, 71, 71, 0.08);
    border-color: rgba(240, 71, 71, 0.5);
  }
`;
