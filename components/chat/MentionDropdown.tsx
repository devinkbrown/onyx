'use client';

import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

export interface MentionDropdownProps {
  query: string;
  channel: string;
  onSelect: (nick: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Controlled selected index — parent drives this via keyboard events */
  selectedIndex?: number;
}

// Derive the highest-priority IRC prefix character from a modes Set.
// Priority: q (owner ~) > a (admin &) > o (op @) > v (voice +)
function modesPrefix(modes: Set<string>): string {
  if (modes.has('q')) return '~';
  if (modes.has('a')) return '&';
  if (modes.has('o')) return '@';
  if (modes.has('v')) return '+';
  return '';
}

const PREFIX_COLOR: Record<string, string> = {
  '~': '#f59e0b',
  '&': '#ef4444',
  '@': '#f97316',
  '+': '#0ea5e9',
};

export function getMentionMembers(
  channels: ReturnType<typeof useOnyxStore.getState>['channels'],
  channel: string,
  query: string,
): Array<{ nick: string; prefix: string }> {
  const ch = channels.get(channel.toLowerCase());
  if (!ch) return [];
  const q = query.toLowerCase();
  const results: Array<{ nick: string; prefix: string }> = [];
  for (const user of ch.users.values()) {
    if (user.nick.toLowerCase().startsWith(q)) {
      results.push({ nick: user.nick, prefix: modesPrefix(user.modes) });
    }
    if (results.length >= 8) break;
  }
  return results;
}

export default function MentionDropdown({
  query,
  channel,
  onSelect,
  anchorRef,
  selectedIndex = 0,
}: MentionDropdownProps) {
  const channels = useOnyxStore(s => s.channels);
  const members = getMentionMembers(channels, channel, query);

  const listRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<{ bottom: number; left: number; width: number } | null>(null);

  // Measure anchor position once and on resize
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      posRef.current = {
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        width: Math.max(rect.width, 280),
      };
      const el = listRef.current;
      if (el) {
        el.style.bottom = posRef.current.bottom + 'px';
        el.style.left   = posRef.current.left + 'px';
        el.style.width  = posRef.current.width + 'px';
      }
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchorRef]);

  // Scroll selected item into view when selectedIndex changes
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (members.length === 0) return null;

  return (
    <>
      <div
        ref={listRef}
        className="mention-dropdown"
        role="listbox"
        aria-label="Mention autocomplete"
        style={{ position: 'fixed', bottom: 0, left: 0, width: 280 }}
      >
        {members.map((m, i) => {
          const isSelected = i === selectedIndex;
          const color = m.prefix ? PREFIX_COLOR[m.prefix] : undefined;
          return (
            <button
              key={m.nick}
              className={`mention-row${isSelected ? ' mention-row--selected' : ''}`}
              role="option"
              aria-selected={isSelected}
              onMouseDown={e => {
                e.preventDefault();
                onSelect(m.nick);
              }}
            >
              <span className="mention-avatar" aria-hidden="true">
                {m.nick.slice(0, 1)}
              </span>
              {m.prefix ? (
                <span
                  className="mention-prefix"
                  aria-label={m.prefix}
                  style={{ color }}
                >
                  {m.prefix}
                </span>
              ) : (
                <span className="mention-prefix-empty" aria-hidden="true" />
              )}
              <span className="mention-nick">@{m.nick}</span>
            </button>
          );
        })}
      </div>

      <style>{`
        .mention-dropdown {
          max-height: 216px;
          overflow-y: auto;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl), 0 0 0 1px var(--accent-border);
          display: flex;
          flex-direction: column;
          z-index: 200;
          min-width: 320px;
          width: 320px;
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border) transparent;
          animation: mention-rise 140ms var(--ease-out) both;
        }
        @keyframes mention-rise {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }

        .mention-row {
          display: flex;
          align-items: center;
          gap: 10px;
          height: 36px;
          padding: 0 12px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          width: 100%;
          flex-shrink: 0;
          transition: background var(--t-fast);
        }
        .mention-row:hover {
          background: var(--accent-subtle);
        }
        .mention-row--selected {
          background: var(--accent-subtle);
        }
        .mention-row--selected:hover {
          background: var(--accent-subtle);
        }

        .mention-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--accent);
          opacity: 0.8;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          text-transform: uppercase;
        }

        .mention-prefix {
          width: 14px;
          font-size: 13px;
          font-weight: 700;
          font-family: var(--font-mono);
          text-align: center;
          flex-shrink: 0;
          line-height: 1;
        }
        .mention-prefix-empty {
          width: 14px;
          flex-shrink: 0;
        }

        .mention-nick {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .mention-row--selected .mention-nick {
          color: var(--accent);
        }
      `}</style>
    </>
  );
}
