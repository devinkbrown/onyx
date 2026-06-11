'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

export default function HighlightWordsModal() {
  const highlightWords    = useOnyxStore(s => s.highlightWords);
  const addHighlightWord  = useOnyxStore(s => s.addHighlightWord);
  const removeHighlightWord = useOnyxStore(s => s.removeHighlightWord);
  const closeHighlightModal = useOnyxStore(s => s.closeHighlightModal);

  const [draft, setDraft] = useState('');
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAdd = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!highlightWords.includes(trimmed.toLowerCase())) {
      addHighlightWord(trimmed);
    }
    setDraft('');
    inputRef.current?.focus();
  }, [draft, highlightWords, addHighlightWord]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }, [handleAdd]);

  const previewWord = highlightWords[0] ?? 'ocean';
  const previewText = `Hey, someone mentioned ${previewWord} in the channel today!`;

  return (
    <ModalShell
      onClose={closeHighlightModal}
      title={<><span className="hlm-icon" aria-hidden>✦</span> Highlight Words</>}
      kicker="Notifications"
      titleId="hlm-modal-title"
      size="sm"
    >
      <div className="hlm-content">
        <p className="hlm-subtitle">
          Messages containing these words will be highlighted in gold.
        </p>

        {/* Input row */}
        <div className="hlm-input-row">
          <input
            ref={inputRef}
            className="hlm-input"
            type="text"
            placeholder="Add a word or phrase…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="New highlight word"
          />
          <button
            className="hlm-add-btn"
            onClick={handleAdd}
            disabled={!draft.trim()}
            aria-label="Add word"
          >
            Add
          </button>
        </div>

        {/* Word chips */}
        {highlightWords.length > 0 ? (
          <div className="hlm-chips" role="list" aria-label="Highlight words list">
            {highlightWords.map(word => (
              <span key={word} className="hlm-chip" role="listitem">
                {word}
                <button
                  className="hlm-chip-remove"
                  onClick={() => removeHighlightWord(word)}
                  aria-label={`Remove ${word}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="hlm-empty">No highlight words yet. Add one above.</p>
        )}

        {/* Preview */}
        <div className="hlm-preview-section">
          <div className="label-caps hlm-preview-label">Preview</div>
          <div className="hlm-preview-bubble">
            <span className="hlm-preview-nick">user</span>
            <span className="hlm-preview-text">
              {highlightWords.length > 0
                ? renderPreview(previewText, previewWord)
                : previewText}
            </span>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </ModalShell>
  );
}

function renderPreview(text: string, word: string): React.ReactNode {
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part)
      ? <mark key={i} className="hlm-word-preview">{part}</mark>
      : part
  );
}

const styles = `
  .hlm-content {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4, 16px);
  }

  .hlm-icon {
    font-size: 16px;
    color: var(--gold, #e8b84b);
    line-height: 1;
  }

  .hlm-subtitle {
    font-size: var(--text-sm, 13px);
    color: var(--text-muted, #3d6480);
    margin: 0;
    line-height: 1.5;
  }

  .hlm-input-row {
    display: flex;
    gap: var(--sp-2, 8px);
  }

  .hlm-input {
    flex: 1;
    background: var(--elev-tint-1, var(--bg-elevated, rgba(14,165,233,0.04)));
    border: 1px solid var(--border-normal, rgba(14,165,233,0.18));
    border-radius: var(--r-md, 8px);
    color: var(--text-primary, #dff0ff);
    font-size: var(--text-base, 14px);
    padding: 8px 12px;
    outline: none;
    font-family: inherit;
    transition: border-color var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
  }
  .hlm-input::placeholder { color: var(--text-muted, #3d6480); }
  .hlm-input:focus {
    border-color: var(--accent, #0ea5e9);
    box-shadow: 0 0 0 2px rgba(14,165,233,0.18);
  }

  .hlm-add-btn {
    padding: 8px 16px;
    background: var(--accent, #0ea5e9);
    color: #fff;
    border: none;
    border-radius: var(--r-md, 8px);
    font-size: var(--text-base, 14px);
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity var(--t-control, 150ms);
    flex-shrink: 0;
  }
  .hlm-add-btn:hover:not(:disabled) { opacity: 0.85; }
  .hlm-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .hlm-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 32px;
  }

  .hlm-chip {
    background: rgba(251,191,36,0.1);
    border: 1px solid rgba(251,191,36,0.3);
    border-radius: var(--r-full, 9999px);
    padding: 4px 8px 4px 12px;
    font-size: 12.5px;
    font-weight: 600;
    color: #fbbf24;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: background var(--t-micro, 90ms), border-color var(--t-micro, 90ms);
  }
  .hlm-chip:hover {
    background: rgba(251,191,36,0.17);
    border-color: rgba(251,191,36,0.5);
  }

  .hlm-chip-remove {
    background: rgba(251,191,36,0.15);
    border: none;
    cursor: pointer;
    color: rgba(251,191,36,0.7);
    font-size: 13px;
    line-height: 1;
    padding: 0 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--t-micro, 90ms), background var(--t-micro, 90ms);
    flex-shrink: 0;
  }
  .hlm-chip-remove:hover {
    color: #fff;
    background: rgba(251,191,36,0.6);
  }

  .hlm-empty {
    font-size: var(--text-sm, 13px);
    color: var(--text-muted, #3d6480);
    font-style: italic;
    margin: 0;
    text-align: center;
    padding: var(--sp-2, 8px) 0;
  }

  .hlm-preview-section {
    border-top: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2, 8px);
  }

  .hlm-preview-bubble {
    background: var(--elev-tint-1, var(--bg-elevated, rgba(14,165,233,0.04)));
    border: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
    border-radius: var(--r-md, 8px);
    padding: 10px 12px;
    font-size: var(--text-base, 14px);
    display: flex;
    gap: var(--sp-2, 8px);
    align-items: baseline;
  }

  .hlm-preview-nick {
    font-size: var(--text-base, 14px);
    font-weight: 700;
    color: var(--accent, #0ea5e9);
    flex-shrink: 0;
  }

  .hlm-preview-text {
    color: var(--text-primary, #dff0ff);
    line-height: 1.5;
  }

  .hlm-word-preview {
    background: rgba(251,191,36,0.18);
    border-radius: 2px;
    padding: 0 2px;
    color: #fbbf24;
    font-weight: 600;
    font-style: normal;
  }
`;
