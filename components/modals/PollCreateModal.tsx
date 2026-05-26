'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

const DURATION_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '1 hour',  seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days',  seconds: 604800 },
];

export default function PollCreateModal() {
  const closePollCreate = useOnyxStore(s => s.closePollCreate);
  const sendMessage     = useOnyxStore(s => s.sendMessage);
  const activeView      = useOnyxStore(s => s.activeView);

  const [question,   setQuestion]   = useState('');
  const [options,    setOptions]    = useState(['', '']);
  const [multiVote,  setMultiVote]  = useState(false);
  const [durationIdx, setDurationIdx] = useState(1);

  const questionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePollCreate();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closePollCreate]);

  const addOption = () => {
    if (options.length >= 4) return;
    setOptions(prev => [...prev, '']);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter((_, i) => i !== idx));
  };

  const updateOption = (idx: number, value: string) => {
    setOptions(prev => prev.map((o, i) => i === idx ? value : o));
  };

  const canSubmit = question.trim().length > 0 && options.filter(o => o.trim()).length >= 2;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const target = activeView.kind === 'channel'
      ? activeView.channel
      : activeView.kind === 'dm'
        ? activeView.nick
        : null;
    if (!target) return;

    const payload = JSON.stringify({
      question: question.trim(),
      options: options.filter(o => o.trim()).map(o => o.trim()),
      duration: DURATION_OPTIONS[durationIdx].seconds,
      multiVote,
    });
    sendMessage(target, `\x01POLL ${payload}\x01`);
    closePollCreate();
  }, [canSubmit, activeView, question, options, durationIdx, multiVote, sendMessage, closePollCreate]);

  return (
    <div className="pcm-overlay" role="dialog" aria-modal aria-label="Create poll">
      <div className="pcm-modal">
        {/* Header */}
        <div className="pcm-header">
          <div className="pcm-title-row">
            <PollIcon />
            <h2 className="pcm-title">Create Poll</h2>
          </div>
          <button
            className="pcm-close"
            onClick={closePollCreate}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="pcm-body">
          {/* Question */}
          <div className="pcm-field">
            <label className="pcm-label" htmlFor="pcm-question">Question</label>
            <input
              ref={questionRef}
              id="pcm-question"
              className="pcm-input"
              type="text"
              placeholder="Ask a question…"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Options */}
          <div className="pcm-field">
            <label className="pcm-label">Options</label>
            <div className="pcm-options-list">
              {options.map((opt, i) => (
                <div key={i} className="pcm-option-row">
                  <span className="pcm-option-num">{i + 1}</span>
                  <input
                    className="pcm-input pcm-input--option"
                    type="text"
                    placeholder={`Option ${i + 1}`}
                    value={opt}
                    onChange={e => updateOption(i, e.target.value)}
                    maxLength={100}
                  />
                  {options.length > 2 && (
                    <button
                      className="pcm-remove-btn"
                      onClick={() => removeOption(i)}
                      aria-label={`Remove option ${i + 1}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 4 && (
              <button className="pcm-add-option-btn" onClick={addOption}>
                + Add option
              </button>
            )}
          </div>

          {/* Duration */}
          <div className="pcm-field">
            <label className="pcm-label">Duration</label>
            <div className="pcm-duration-row">
              {DURATION_OPTIONS.map((d, i) => (
                <button
                  key={d.label}
                  className={`pcm-duration-btn ${durationIdx === i ? 'pcm-duration-btn--active' : ''}`}
                  onClick={() => setDurationIdx(i)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Multi-vote toggle */}
          <label className="pcm-toggle-row">
            <div
              className={`pcm-toggle ${multiVote ? 'pcm-toggle--on' : ''}`}
              role="switch"
              aria-checked={multiVote}
              tabIndex={0}
              onClick={() => setMultiVote(v => !v)}
              onKeyDown={e => e.key === ' ' && setMultiVote(v => !v)}
            >
              <div className="pcm-toggle-thumb" />
            </div>
            <span className="pcm-toggle-label">Allow multiple votes</span>
          </label>
        </div>

        {/* Footer */}
        <div className="pcm-footer">
          <button className="pcm-cancel-btn" onClick={closePollCreate}>
            Cancel
          </button>
          <button
            className={`pcm-submit-btn ${!canSubmit ? 'pcm-submit-btn--disabled' : ''}`}
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
          >
            Create Poll
          </button>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const PollIcon = () => (
  <svg width="18" height="18" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
    <path d="M2 10h2v3H2v-3zm3-4h2v7H5V6zm3-3h2v10H8V3zm3 2h2v8h-2V5z"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = `
  .pcm-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    animation: pcm-fade 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }
  @keyframes pcm-fade { from { opacity: 0; } to { opacity: 1; } }

  .pcm-modal {
    width: 460px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    overflow-y: auto;
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-xl, 16px);
    box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.5));
    animation: pcm-scale 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }
  @keyframes pcm-scale {
    from { opacity: 0; transform: scale(0.95) translateY(6px); }
    to   { opacity: 1; transform: scale(1)    translateY(0); }
  }

  .pcm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .pcm-title-row {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--accent);
  }
  .pcm-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }
  .pcm-close {
    width: 28px; height: 28px;
    border-radius: 6px;
    border: none; background: none;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
    transition: background 150ms, color 150ms;
  }
  .pcm-close:hover { background: var(--bg-elevated); color: var(--text-primary); }

  .pcm-body {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .pcm-field { display: flex; flex-direction: column; gap: 7px; }

  .pcm-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .pcm-input {
    padding: 9px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 150ms, background 150ms, box-shadow 150ms;
  }
  .pcm-input:focus { border-color: var(--accent); background: var(--bg-float); box-shadow: 0 0 0 2px var(--accent-glow); }
  .pcm-input--option { flex: 1; font-size: 13px; }

  /* Question input: larger and more prominent */
  #pcm-question.pcm-input {
    font-size: 16px;
    font-weight: 500;
    padding: 11px 14px;
    border-color: var(--border-normal);
  }
  #pcm-question.pcm-input:focus { border-color: var(--accent); }

  .pcm-options-list { display: flex; flex-direction: column; gap: 7px; }

  .pcm-option-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pcm-option-num {
    width: 22px;
    height: 22px;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    flex-shrink: 0;
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .pcm-remove-btn {
    width: 24px; height: 24px;
    border-radius: 50%;
    border: none; background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    transition: background 150ms, color 150ms;
  }
  .pcm-remove-btn:hover { background: var(--danger-subtle, rgba(240,71,71,0.15)); color: var(--danger, #f04747); }

  .pcm-add-option-btn {
    align-self: flex-start;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px dashed var(--border-normal);
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 150ms, color 150ms;
    margin-left: 28px;
  }
  .pcm-add-option-btn:hover { border-color: var(--accent); color: var(--accent); }

  .pcm-duration-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pcm-duration-btn {
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid var(--border-normal);
    background: var(--bg-elevated, rgba(255,255,255,0.04));
    color: var(--text-muted);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms, border-color 150ms, color 150ms;
  }
  .pcm-duration-btn:hover { border-color: var(--accent-border); color: var(--text-secondary); }
  .pcm-duration-btn--active {
    border-color: var(--accent);
    background: var(--accent-subtle, rgba(14,165,233,0.15));
    color: var(--accent);
    font-weight: 600;
  }

  .pcm-toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .pcm-toggle {
    width: 36px; height: 20px;
    border-radius: 10px;
    background: var(--bg-elevated, rgba(255,255,255,0.1));
    border: 1px solid var(--border-normal);
    position: relative;
    transition: background 200ms, border-color 200ms;
    flex-shrink: 0;
    cursor: pointer;
    outline: none;
  }
  .pcm-toggle:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .pcm-toggle--on { background: var(--accent); border-color: var(--accent); }
  .pcm-toggle-thumb {
    position: absolute;
    top: 2px; left: 2px;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1));
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .pcm-toggle--on .pcm-toggle-thumb { transform: translateX(16px); }
  .pcm-toggle-label { font-size: 14px; color: var(--text-secondary); }

  .pcm-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px 16px;
    border-top: 1px solid var(--border-subtle);
  }
  .pcm-cancel-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border-normal);
    background: none;
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms, color 150ms;
  }
  .pcm-cancel-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
  .pcm-submit-btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 150ms, background 150ms;
  }
  .pcm-submit-btn:hover { opacity: 0.88; }
  .pcm-submit-btn--disabled { opacity: 0.4; cursor: not-allowed; }
  .pcm-submit-btn--disabled:hover { opacity: 0.4; }
`;
