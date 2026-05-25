'use client';

import { useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── Nick avatar chip ──────────────────────────────────────────────────────────

function nickHue(nick: string): number {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) & 0xffff;
  return h % 360;
}

function NickChip({ nick }: { nick: string }) {
  const hue = nickHue(nick);
  const initials = nick.slice(0, 2).toUpperCase();
  return (
    <span
      className="rsp-chip"
      title={nick}
      style={{ background: `hsl(${hue},55%,30%)`, borderColor: `hsl(${hue},55%,45%)` }}
    >
      {initials}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReactionStatsPanel() {
  const messageId         = useOnyxStore(s => s.showReactionStats);
  const closeReactionStats = useOnyxStore(s => s.closeReactionStats);
  const activeView        = useOnyxStore(s => s.activeView);
  const channels          = useOnyxStore(s => s.channels);
  const dms               = useOnyxStore(s => s.dms);
  const panelRef          = useRef<HTMLDivElement>(null);

  // Gather the target's messages
  let message = null;
  if (messageId) {
    if (activeView.kind === 'channel') {
      const ch = channels.get(activeView.channel.toLowerCase());
      message = ch?.messages.find(m => m.id === messageId) ?? null;
    } else if (activeView.kind === 'dm') {
      const dm = dms.get(activeView.nick.toLowerCase());
      message = dm?.messages.find(m => m.id === messageId) ?? null;
    }
  }

  const reactions = message?.reactions ?? [];

  // Close on outside click
  useEffect(() => {
    if (!messageId) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closeReactionStats();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [messageId, closeReactionStats]);

  // Close on Escape
  useEffect(() => {
    if (!messageId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReactionStats();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [messageId, closeReactionStats]);

  if (!messageId) return null;

  const totalCount = reactions.reduce((sum, r) => sum + r.users.length, 0);

  return (
    <div
      ref={panelRef}
      className="rsp-panel"
      role="dialog"
      aria-label="Reaction summary"
    >
      {/* Header */}
      <div className="rsp-header">
        <span className="rsp-title">
          Reactions {totalCount > 0 && <span className="rsp-total">({totalCount})</span>}
        </span>
        <button
          className="rsp-close"
          onClick={closeReactionStats}
          aria-label="Close reaction summary"
        >
          ×
        </button>
      </div>

      {/* Reaction rows */}
      <div className="rsp-body">
        {reactions.length === 0 ? (
          <p className="rsp-empty">No reactions yet.</p>
        ) : (
          reactions.map(r => (
            <div key={r.emoji} className="rsp-row">
              <span className="rsp-emoji">{r.emoji}</span>
              <div className="rsp-row-right">
                <div className="rsp-chips">
                  {r.users.map(nick => (
                    <NickChip key={nick} nick={nick} />
                  ))}
                </div>
                <span className="rsp-count">{r.users.length} {r.users.length === 1 ? 'person' : 'people'}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = `
  .rsp-panel {
    position: fixed;
    bottom: 80px;
    right: 280px;
    width: 300px;
    max-height: 360px;
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-xl, 16px);
    box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.5));
    display: flex;
    flex-direction: column;
    z-index: 400;
    animation: rsp-slide-up 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }
  @keyframes rsp-slide-up {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .rsp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .rsp-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .rsp-total {
    color: var(--text-muted);
    font-weight: 500;
  }
  .rsp-close {
    width: 22px; height: 22px;
    border-radius: 50%;
    border: none; background: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 150ms, color 150ms;
  }
  .rsp-close:hover { background: var(--bg-elevated); color: var(--text-primary); }

  .rsp-body {
    overflow-y: auto;
    padding: 10px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rsp-empty {
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    padding: 12px 0;
    margin: 0;
  }

  .rsp-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .rsp-emoji {
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .rsp-row-right {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .rsp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rsp-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px; height: 26px;
    border-radius: 50%;
    border: 1px solid;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    cursor: default;
  }
  .rsp-count {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
  }
`;
