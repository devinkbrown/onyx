'use client';

import { useState, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── PollWidget ────────────────────────────────────────────────────────────────

interface PollWidgetProps {
  channel: string;
}

export function PollWidget({ channel }: PollWidgetProps) {
  const streamPolls = useOnyxStore(s => s.streamPolls);
  const voteStreamPoll = useOnyxStore(s => s.voteStreamPoll);
  const poll = streamPolls.get(channel.toLowerCase());

  // Auto-expire the poll client-side if endsAt passes and the server hasn't
  // sent SUIMYAKU_POLL END yet (e.g. brief disconnect during the poll window).
  // expiredEndsAt stores the endsAt value of the poll we last expired, so
  // a new poll with a different endsAt is not suppressed.
  const [expiredEndsAt, setExpiredEndsAt] = useState<number | null>(null);

  useEffect(() => {
    if (!poll?.active || !poll.endsAt) return;
    const endsAt = poll.endsAt;
    const remaining = Math.max(0, endsAt - Date.now());
    // setState is only called inside the timer callback — never synchronously.
    const t = setTimeout(() => setExpiredEndsAt(endsAt), remaining);
    return () => clearTimeout(t);
  }, [poll?.active, poll?.endsAt]);

  if (!poll || !poll.active || expiredEndsAt === poll.endsAt) return null;

  const totalVotes = poll.votes.reduce((a, b) => a + b, 0);

  const handleVote = (idx: number) => {
    if (poll.myVote !== null) return;
    voteStreamPoll(channel, idx);
  };

  return (
    <div className="pw-root" role="group" aria-label={`Poll: ${poll.question}`}>
      <div className="pw-question">{poll.question}</div>
      <div className="pw-options">
        {poll.options.map((opt, idx) => {
          const pct = totalVotes > 0 ? Math.round((poll.votes[idx] ?? 0) / totalVotes * 100) : 0;
          const isVoted = poll.myVote === idx;
          const hasVoted = poll.myVote !== null;
          return (
            <button
              key={idx}
              className={`pw-option${isVoted ? ' pw-option--voted' : ''}${hasVoted ? ' pw-option--locked' : ''}`}
              onClick={() => handleVote(idx)}
              disabled={hasVoted}
              type="button"
              aria-pressed={isVoted}
              aria-label={`${opt} — ${pct}%`}
            >
              <div className="pw-option-bar" style={{ width: `${pct}%` }} aria-hidden="true" />
              <span className="pw-option-label">{opt}</span>
              <span className="pw-option-pct" aria-hidden="true">{pct}%</span>
            </button>
          );
        })}
      </div>
      <div className="pw-footer" aria-live="polite" aria-atomic="true">
        {totalVotes} vote{totalVotes === 1 ? '' : 's'}
      </div>

      <style>{`
        .pw-root {
          background: rgba(6,16,29,0.82);
          border: 1px solid var(--border-normal);
          border-radius: 10px;
          backdrop-filter: blur(10px);
          padding: 12px 14px;
          min-width: 200px;
          max-width: 280px;
        }
        .pw-question {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 8px;
          line-height: 1.4;
        }
        .pw-options {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .pw-option {
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
          text-align: left;
          font-family: inherit;
          transition: border-color 150ms;
        }
        .pw-option:hover:not(.pw-option--locked) {
          border-color: var(--accent-border);
        }
        .pw-option--voted {
          border-color: var(--accent);
        }
        .pw-option--locked { cursor: default; }
        .pw-option-bar {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          background: var(--accent-subtle);
          transition: width 400ms cubic-bezier(0.16,1,0.3,1);
          pointer-events: none;
        }
        .pw-option--voted .pw-option-bar { background: var(--accent-glow); }
        .pw-option-label {
          position: relative;
          font-size: 12px;
          font-weight: 500;
          color: rgba(255,255,255,0.85);
          flex: 1;
          z-index: 1;
        }
        .pw-option-pct {
          position: relative;
          font-size: 11px;
          font-weight: 700;
          color: rgba(255,255,255,0.5);
          font-variant-numeric: tabular-nums;
          z-index: 1;
          flex-shrink: 0;
        }
        .pw-option--voted .pw-option-pct { color: var(--accent); }
        .pw-footer {
          font-size: 10px;
          color: rgba(255,255,255,0.35);
          margin-top: 7px;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

// ── PollCreateModal ───────────────────────────────────────────────────────────

interface PollCreateModalProps {
  channel: string;
  onClose: () => void;
}

const DURATIONS = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

export function PollCreateModal({ channel, onClose }: PollCreateModalProps) {
  const createStreamPoll = useOnyxStore(s => s.createStreamPoll);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState(60);

  const headingId = 'pcm-heading';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const filledOptions = options.filter(o => o.trim());
  const canCreate = question.trim().length > 0 && filledOptions.length >= 2;

  const handleCreate = () => {
    if (!canCreate) return;
    createStreamPoll(channel, question.trim(), filledOptions, duration);
    onClose();
  };

  const updateOption = (idx: number, value: string) => {
    setOptions(prev => prev.map((o, i) => (i === idx ? value : o)));
  };

  const addOption = () => {
    if (options.length < 4) setOptions(prev => [...prev, '']);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div
      className="pcm-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="pcm-modal">
        <div className="pcm-header">
          <h3 id={headingId} className="pcm-title">Create Poll</h3>
          <button className="pcm-close" onClick={onClose} aria-label="Close">
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>
            </svg>
          </button>
        </div>
        <div className="pcm-body">
          <label className="pcm-label" htmlFor="pcm-question">Question</label>
          <input
            id="pcm-question"
            className="pcm-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, 120))}
            placeholder="Ask your viewers..."
            autoFocus
          />

          <label className="pcm-label">Options <span className="pcm-hint">(2–4)</span></label>
          {options.map((opt, idx) => (
            <div key={idx} className="pcm-opt-row">
              <input
                className="pcm-input"
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value.slice(0, 60))}
                placeholder={`Option ${idx + 1}`}
                aria-label={`Poll option ${idx + 1}`}
              />
              {options.length > 2 && (
                <button
                  className="pcm-opt-remove"
                  type="button"
                  onClick={() => removeOption(idx)}
                  aria-label={`Remove option ${idx + 1}`}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
          {options.length < 4 && (
            <button className="pcm-add-opt" type="button" onClick={addOption}>+ Add option</button>
          )}

          <label className="pcm-label">Duration</label>
          <div className="pcm-dur-row" role="group" aria-label="Poll duration">
            {DURATIONS.map(d => (
              <button
                key={d.value}
                type="button"
                className={`pcm-dur-btn${duration === d.value ? ' pcm-dur-btn--active' : ''}`}
                onClick={() => setDuration(d.value)}
                aria-pressed={duration === d.value}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pcm-footer">
          <button className="pcm-btn-cancel" type="button" onClick={onClose}>Cancel</button>
          <button
            className={`pcm-btn-create${canCreate ? '' : ' pcm-btn-create--disabled'}`}
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            aria-disabled={!canCreate}
          >
            Create Poll
          </button>
        </div>
      </div>

      <style>{`
        .pcm-backdrop {
          position: fixed; inset: 0; z-index: 910;
          background: rgba(3,8,16,0.75);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
          animation: pcm-fade 150ms ease-out;
        }
        @keyframes pcm-fade { from { opacity: 0; } to { opacity: 1; } }
        .pcm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 14px;
          width: 100%; max-width: 400px;
          box-shadow: var(--shadow-xl);
          animation: pcm-scale 180ms cubic-bezier(0.16,1,0.3,1);
          overflow: hidden;
        }
        @keyframes pcm-scale {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .pcm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 14px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .pcm-title {
          font-size: 15px; font-weight: 700;
          color: var(--text-primary); margin: 0;
        }
        .pcm-close {
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); font-size: 14px; line-height: 1;
          padding: 4px; border-radius: 4px;
          transition: color 120ms;
        }
        .pcm-close:hover { color: var(--text-secondary); }
        .pcm-body {
          padding: 16px 20px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .pcm-label {
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.07em; text-transform: uppercase;
          color: var(--text-muted);
          margin-top: 10px; margin-bottom: 6px; display: block;
        }
        .pcm-label:first-child { margin-top: 0; }
        .pcm-hint {
          font-weight: 400; text-transform: none; letter-spacing: 0;
          color: var(--text-muted); opacity: 0.7;
        }
        .pcm-input {
          width: 100%;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 7px;
          padding: 8px 11px;
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 150ms;
        }
        .pcm-input:focus { border-color: var(--accent); }
        .pcm-opt-row {
          display: flex; align-items: center; gap: 6px; margin-bottom: 5px;
        }
        .pcm-opt-remove {
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); font-size: 12px; line-height: 1;
          flex-shrink: 0; padding: 6px;
          transition: color 120ms;
        }
        .pcm-opt-remove:hover { color: var(--danger, #f87171); }
        .pcm-add-opt {
          background: none; border: 1px dashed var(--border-normal);
          border-radius: 7px; padding: 7px 11px;
          font-size: 12px; font-weight: 600;
          color: var(--text-muted); cursor: pointer;
          font-family: inherit; text-align: left;
          transition: border-color 150ms, color 150ms;
        }
        .pcm-add-opt:hover { border-color: var(--accent-border); color: var(--accent); }
        .pcm-dur-row { display: flex; gap: 8px; }
        .pcm-dur-btn {
          flex: 1; padding: 6px 0;
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 7px;
          font-size: 12px; font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer; font-family: inherit;
          transition: border-color 120ms, color 120ms, background 120ms;
        }
        .pcm-dur-btn:hover {
          border-color: var(--accent-border); color: var(--text-primary);
        }
        .pcm-dur-btn--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .pcm-footer {
          display: flex; align-items: center; justify-content: flex-end;
          gap: 10px; padding: 12px 20px 16px;
          border-top: 1px solid var(--border-subtle);
        }
        .pcm-btn-cancel {
          padding: 7px 16px;
          background: none; border: 1px solid var(--border-normal);
          border-radius: 7px; font-size: 13px; font-weight: 600;
          color: var(--text-secondary); cursor: pointer;
          font-family: inherit;
          transition: border-color 120ms, background 120ms;
        }
        .pcm-btn-cancel:hover { background: var(--bg-overlay); }
        .pcm-btn-create {
          padding: 7px 18px;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          border: none; border-radius: 7px;
          font-size: 13px; font-weight: 700;
          color: #fff; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px var(--accent-glow);
          transition: opacity 150ms, box-shadow 150ms;
        }
        .pcm-btn-create:hover:not(.pcm-btn-create--disabled) {
          opacity: 0.9; box-shadow: 0 6px 18px rgba(14,165,233,0.4);
        }
        .pcm-btn-create--disabled {
          background: var(--bg-overlay); color: var(--text-muted);
          cursor: not-allowed; box-shadow: none;
        }
      `}</style>
    </div>
  );
}
