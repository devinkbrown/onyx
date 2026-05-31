'use client';

/**
 * PollMessage — renders IRC-native polls
 *
 * Polls are created via the /poll slash command:
 *   /poll Question | Option 1 | Option 2 | Option 3
 * Which sends: [POLL: Question|Option 1|Option 2|Option 3]
 *
 * Votes are cast by clicking option buttons, which send numbered reactions
 * (1️⃣ 2️⃣ 3️⃣ 4️⃣) via the reaction system. The reaction counts drive the
 * progress bars.
 */

import { useMemo } from 'react';
import type { ChatMessage } from '@/lib/irc/types';
import { useOnyxStore } from '@/lib/store';

// ── Poll pattern (exported so MessageItem can test before rendering) ──────────
export const POLL_PATTERN = /^\[POLL:\s*([^|]+)\|([^\]]+)\]$/;

const VOTE_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'] as const;

interface PollMessageProps {
  msg: ChatMessage;
  onVote: (optionIndex: number) => void;
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const PollIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
    <path d="M2 10h2v3H2v-3zm3-4h2v7H5V6zm3-3h2v10H8V3zm3 2h2v8h-2V5z"/>
  </svg>
);

const RadioEmptyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2z"/>
  </svg>
);

const RadioFilledIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <path d="M6 1a5 5 0 1 1 0 10A5 5 0 0 1 6 1zm0 1a4 4 0 1 0 0 8A4 4 0 0 0 6 2zm0 2a2 2 0 1 1 0 4A2 2 0 0 1 6 4z"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────

export default function PollMessage({ msg, onVote }: PollMessageProps) {
  const ourNick = useOnyxStore(s => s.ourNick);

  const parsed = useMemo(() => {
    const m = POLL_PATTERN.exec(msg.text);
    if (!m) return null;
    const question = m[1].trim();
    const options = m[2].split('|').map(o => o.trim()).filter(Boolean).slice(0, 4);
    if (options.length < 2) return null;
    return { question, options };
  }, [msg.text]);

  if (!parsed) return null;
  const { question, options } = parsed;

  // Tally votes from reactions: 1️⃣ = option 0, 2️⃣ = option 1, etc.
  const voteCounts: number[] = options.map((_opt, i) => {
    const emoji = VOTE_EMOJIS[i];
    const reaction = msg.reactions?.find(r => r.emoji === emoji);
    return reaction ? reaction.users.length : 0;
  });

  const totalVotes = voteCounts.reduce((a, b) => a + b, 0);

  // Which option did the current user vote for? (-1 = none)
  const myVote: number = options.findIndex((_opt, i) => {
    const emoji = VOTE_EMOJIS[i];
    const reaction = msg.reactions?.find(r => r.emoji === emoji);
    return reaction ? reaction.users.includes(ourNick) : false;
  });

  return (
    <div className="poll-card" role="group" aria-label={`Poll: ${question}`}>
      <div className="poll-header">
        <span className="poll-header-icon"><PollIcon /></span>
        <span className="poll-question">Poll: <em>{question}</em></span>
      </div>

      <div className="poll-options">
        {options.map((opt, i) => {
          const count = voteCounts[i] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isMyVote = myVote === i;

          return (
            <button
              key={i}
              className={`poll-option ${isMyVote ? 'poll-option--voted' : ''}`}
              onClick={() => onVote(i)}
              aria-label={`Vote for ${opt}: ${count} votes (${pct}%)`}
              aria-pressed={isMyVote}
            >
              <span className="poll-option-radio" aria-hidden>
                {isMyVote ? <RadioFilledIcon /> : <RadioEmptyIcon />}
              </span>
              <span className="poll-option-label">{opt}</span>
              <span className="poll-bar-track" aria-hidden>
                <span className="poll-bar-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="poll-option-stats" aria-hidden>
                <span className="poll-stat-count">{count}</span>
                <span className="poll-stat-pct">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="poll-footer">
        <span className="poll-total">
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      <style>{pollStyles}</style>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const pollStyles = `
  .poll-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-md);
    padding: 16px 16px 12px;
    max-width: 420px;
    margin-top: 4px;
    box-shadow: var(--shadow-sm);
  }

  /* Header */
  .poll-header {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .poll-header-icon {
    flex-shrink: 0;
    color: var(--accent);
    display: flex;
    align-items: center;
  }
  .poll-question {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.35;
  }
  .poll-question em {
    font-style: normal;
    color: var(--text-secondary);
    font-weight: 600;
  }

  /* Options list */
  .poll-options {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  /* Option button — 4-column grid: radio | label | bar | stats */
  .poll-option {
    display: grid;
    grid-template-columns: 18px 1fr 72px 44px;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md, 6px);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    color: var(--text-secondary);
    transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast);
  }
  .poll-option:hover {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    color: var(--text-primary);
  }
  .poll-option--voted {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    color: var(--text-primary);
  }

  /* Radio icon */
  .poll-option-radio {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: color var(--t-fast);
  }
  .poll-option:hover .poll-option-radio,
  .poll-option--voted .poll-option-radio {
    color: var(--accent);
  }

  /* Label text */
  .poll-option-label {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Progress bar */
  .poll-bar-track {
    height: 5px;
    background: var(--bg-float);
    border-radius: 99px;
    overflow: hidden;
    display: block;
  }
  .poll-bar-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 99px;
    transition: width 0.4s var(--ease-out, ease);
    min-width: 0;
  }
  .poll-option--voted .poll-bar-fill {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent-glow);
  }

  /* Vote stats */
  .poll-option-stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }
  .poll-stat-count {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }
  .poll-stat-pct {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  /* Footer */
  .poll-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 2px;
  }
  .poll-total {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
`;
