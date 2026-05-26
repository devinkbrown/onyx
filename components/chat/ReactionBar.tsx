'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { MessageReaction } from '@/lib/irc/types';
import ReactionPicker from '@/components/ui/ReactionPicker';
import ReactionWhoPopup from './ReactionWhoPopup';

interface Props {
  reactions: MessageReaction[];
  ourNick: string;
  messageId: string;
  target: string;
  onToggle: (emoji: string) => void;
}

interface TooltipState {
  emoji: string;
  users: string[];
  anchorRect: DOMRect;
}

export default function ReactionBar({ reactions, ourNick, onToggle }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [mounted, setMounted] = useState(false);
  // Track previous counts to detect increases for pop animation
  const prevCountsRef = useRef<Map<string, number>>(new Map());
  const [poppingEmojis, setPoppingEmojis] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Detect reaction count increases and trigger pop animation
  useEffect(() => {
    const newPopping = new Set<string>();
    for (const r of reactions) {
      const prev = prevCountsRef.current.get(r.emoji) ?? 0;
      if (r.users.length > prev && prev > 0) {
        newPopping.add(r.emoji);
      }
    }
    // Update stored counts
    const newMap = new Map<string, number>();
    for (const r of reactions) {
      newMap.set(r.emoji, r.users.length);
    }
    prevCountsRef.current = newMap;

    if (newPopping.size > 0) {
      setPoppingEmojis(prev => {
        const next = new Set([...prev, ...newPopping]);
        return next;
      });
      const tid = setTimeout(() => {
        setPoppingEmojis(prev => {
          const next = new Set(prev);
          for (const e of newPopping) next.delete(e);
          return next;
        });
      }, 450);
      return () => clearTimeout(tid);
    }
  }, [reactions]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerAnchorRef.current && !pickerAnchorRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const handlePillEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>, r: MessageReaction) => {
    clearTimeout(hoverTimerRef.current);
    setTooltip({ emoji: r.emoji, users: r.users, anchorRect: e.currentTarget.getBoundingClientRect() });
  }, []);

  const handlePillLeave = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setTooltip(null), 150);
  }, []);

  return (
    <div className="rb-bar">
      {reactions.map(r => {
        const mine = r.users.some(u => u.toLowerCase() === ourNick.toLowerCase());
        const isPopping = poppingEmojis.has(r.emoji);
        return (
          <button
            key={r.emoji}
            className={`rb-pill ${mine ? 'rb-pill--mine' : ''}`}
            onClick={() => onToggle(r.emoji)}
            onMouseEnter={e => handlePillEnter(e, r)}
            onMouseLeave={handlePillLeave}
            aria-label={`${r.emoji} reacted by ${r.users.join(', ')}`}
            aria-pressed={mine}
          >
            <span className={`rb-emoji${isPopping ? ' rb-emoji--pop' : ''}`}>{r.emoji}</span>
            <span className="rb-count">{r.users.length}</span>
          </button>
        );
      })}

      {/* Add reaction button */}
      <div ref={pickerAnchorRef} className="rb-picker-anchor">
        <button
          className="rb-add-btn"
          onClick={() => setPickerOpen(p => !p)}
          title="Add reaction"
          aria-label="Add reaction"
        >
          <AddReactionIcon />
        </button>
        {pickerOpen && (
          <ReactionPicker
            onPick={emoji => {
              onToggle(emoji);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      {/* Tooltip — rendered into document.body via portal */}
      {mounted && tooltip && createPortal(
        <ReactionWhoPopup
          emoji={tooltip.emoji}
          users={tooltip.users}
          anchorRect={tooltip.anchorRect}
        />,
        document.body
      )}

      <style>{styles}</style>
    </div>
  );
}

// ── Icon ──────────────────────────────────────────────────────────────────────

const AddReactionIcon = () => (
  <svg width="13" height="13" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
    <path d="M7.5 0a7.5 7.5 0 1 0 0 15A7.5 7.5 0 0 0 7.5 0zm0 14a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 9.5c0-.28.22-.5.5-.5h4a.5.5 0 0 1 .38.83A3 3 0 0 1 7.5 11a3 3 0 0 1-2.38-1.17A.5.5 0 0 1 5 9.5z"/>
  </svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = `
  .rb-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 5px;
  }

  .rb-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
    transition: background 150ms ease, border-color 150ms ease, transform 150ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275)), box-shadow 150ms ease;
    line-height: 1;
    white-space: nowrap;
    user-select: none;
  }
  .rb-pill:hover {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    transform: scale(1.08);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .rb-pill--mine {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    color: var(--accent);
    box-shadow: 0 0 0 0.5px var(--accent-border) inset;
  }
  .rb-pill--mine:hover {
    background: rgba(var(--accent-rgb, 14,165,233), 0.16);
    transform: scale(1.08);
  }

  @keyframes reaction-pop {
    0%   { transform: scale(1); }
    35%  { transform: scale(1.45) rotate(-10deg); }
    65%  { transform: scale(0.88) rotate(5deg); }
    100% { transform: scale(1) rotate(0deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .rb-emoji--pop { animation: none !important; }
    .rb-pill:hover { transform: none; }
  }

  .rb-emoji { font-size: 14px; line-height: 1; display: inline-block; }
  .rb-emoji--pop { animation: reaction-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .rb-count {
    font-size: 11.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .rb-pill--mine .rb-count { color: var(--accent); }

  .rb-picker-anchor { position: relative; }

  .rb-add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px dashed var(--border-normal);
    background: none;
    cursor: pointer;
    color: var(--text-muted);
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
  }
  .rb-add-btn:hover {
    border-color: var(--accent-border);
    background: var(--accent-subtle);
    color: var(--accent);
    transform: scale(1.08);
  }
`;

