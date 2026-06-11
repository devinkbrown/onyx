'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

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

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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

  const remaining = MAX_LENGTH - text.length;
  const hasExisting = existingNote.trim().length > 0;

  return (
    <ModalShell
      onClose={onClose}
      title={<>Note about <strong className="unm-nick">{nick}</strong></>}
      kicker="Private note"
      titleId="unm-modal-title"
      size="sm"
      footer={
        <>
          {hasExisting && (
            <button className="unm-btn unm-btn--delete" onClick={handleDelete}>
              Delete
            </button>
          )}
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
        </>
      }
    >
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

      <style>{styles}</style>
    </ModalShell>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = `
  .unm-nick {
    color: var(--accent);
  }

  .unm-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2, 8px);
  }

  .unm-textarea {
    width: 100%;
    background: var(--bg-base);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-md);
    padding: 12px 14px;
    font-size: var(--text-sm, 13px);
    line-height: 1.6;
    color: var(--text-primary);
    resize: vertical;
    min-height: 120px;
    font-family: inherit;
    transition: border-color var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
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
    font-size: var(--text-2xs, 11px);
    color: var(--text-muted);
    text-align: right;
    padding-right: 2px;
  }
  .unm-counter--warn {
    color: var(--status-dnd, #f04747);
  }

  .unm-saved {
    font-size: var(--text-xs, 12px);
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
    font-size: var(--text-sm, 13px);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--t-control, 150ms), color var(--t-control, 150ms), opacity var(--t-control, 150ms);
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
    margin-right: auto;
  }
  .unm-btn--delete:hover {
    background: rgba(240, 71, 71, 0.08);
    border-color: rgba(240, 71, 71, 0.5);
  }
`;
