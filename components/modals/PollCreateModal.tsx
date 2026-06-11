'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

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

    const cleanPart = (part: string) => part.trim().replace(/[|\]]/g, ' ');
    const pollParts = [
      cleanPart(question),
      ...options.filter(o => o.trim()).map(cleanPart),
    ];
    sendMessage(target, `[POLL: ${pollParts.join('|')}]`);
    closePollCreate();
  }, [canSubmit, activeView, question, options, durationIdx, multiVote, sendMessage, closePollCreate]);

  return (
    <ModalShell
      onClose={closePollCreate}
      title="Create Poll"
      kicker="Engage"
      titleId="pcm-modal-title"
      size="sm"
      footer={
        <>
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
        </>
      }
    >
      <div className="pcm-body">
        {/* Question */}
        <div className="pcm-field">
          <label className="label-caps pcm-label" htmlFor="pcm-question">Question</label>
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
          <label className="label-caps pcm-label">Options</label>
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
          <label className="label-caps pcm-label">Duration</label>
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

      <style>{styles}</style>
    </ModalShell>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = `
  .pcm-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4, 16px);
  }

  .pcm-field { display: flex; flex-direction: column; gap: 7px; }

  .pcm-input {
    padding: 9px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: var(--text-base, 14px);
    font-family: inherit;
    outline: none;
    transition: border-color var(--t-control, 150ms), background var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
  }
  .pcm-input:focus { border-color: var(--accent); background: var(--bg-float); box-shadow: 0 0 0 2px var(--accent-glow); }
  .pcm-input--option { flex: 1; font-size: var(--text-sm, 13px); }

  /* Question input: larger and more prominent */
  #pcm-question.pcm-input {
    font-size: var(--text-lg, 16px);
    font-weight: 500;
    padding: 11px 14px;
    border-color: var(--border-normal);
  }
  #pcm-question.pcm-input:focus { border-color: var(--accent); }

  .pcm-options-list { display: flex; flex-direction: column; gap: 7px; }

  .pcm-option-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
  }
  .pcm-option-num {
    width: 22px;
    height: 22px;
    text-align: center;
    font-size: var(--text-2xs, 11px);
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
    transition: background var(--t-control, 150ms), color var(--t-control, 150ms);
  }
  .pcm-remove-btn:hover { background: var(--danger-subtle, rgba(240,71,71,0.15)); color: var(--danger, #f04747); }

  .pcm-add-option-btn {
    align-self: flex-start;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px dashed var(--border-normal);
    background: none;
    color: var(--text-muted);
    font-size: var(--text-sm, 13px);
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--t-control, 150ms), color var(--t-control, 150ms);
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
    transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms), color var(--t-control, 150ms);
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
    transition: background var(--t-surface, 220ms), border-color var(--t-surface, 220ms);
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
    transition: transform var(--t-surface, 220ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1));
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .pcm-toggle--on .pcm-toggle-thumb { transform: translateX(16px); }
  .pcm-toggle-label { font-size: var(--text-base, 14px); color: var(--text-secondary); }

  .pcm-cancel-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border-normal);
    background: none;
    color: var(--text-secondary);
    font-size: var(--text-base, 14px);
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--t-control, 150ms), color var(--t-control, 150ms);
  }
  .pcm-cancel-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
  .pcm-submit-btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: var(--text-base, 14px);
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity var(--t-control, 150ms), background var(--t-control, 150ms);
  }
  .pcm-submit-btn:hover { opacity: 0.88; }
  .pcm-submit-btn--disabled { opacity: 0.4; cursor: not-allowed; }
  .pcm-submit-btn--disabled:hover { opacity: 0.4; }
`;
