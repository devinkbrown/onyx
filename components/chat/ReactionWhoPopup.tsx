'use client';

import { useEffect, useRef, useState } from 'react';

interface ReactionWhoPopupProps {
  emoji: string;
  users: string[];
  anchorRect: DOMRect;
}

const MAX_SHOWN = 5;

export default function ReactionWhoPopup({ emoji, users, anchorRect }: ReactionWhoPopupProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [leftPos, setLeftPos] = useState<number>(anchorRect.left + anchorRect.width / 2);

  const shown = users.slice(0, MAX_SHOWN);
  const overflow = users.length - MAX_SHOWN;

  // Clamp horizontally so the popup never bleeds off-screen
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const vw = window.innerWidth;
    const cardWidth = card.offsetWidth;
    const raw = anchorRect.left + anchorRect.width / 2;
    const half = cardWidth / 2;
    const clamped = Math.max(half + 8, Math.min(raw, vw - half - 8));
    setLeftPos(clamped);
  }, [anchorRect]);

  const style: React.CSSProperties = {
    left: leftPos,
    top: anchorRect.top - 8,
  };

  return (
    <>
      <div className="rwp" style={style} role="tooltip" ref={cardRef}>
        <div className="rwp-card">
          <div className="rwp-header">
            <span className="rwp-emoji">{emoji}</span>
            <span className="rwp-count">
              {users.length} reaction{users.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="rwp-users">
            {shown.join(' · ')}
            {overflow > 0 && ` and ${overflow} more`}
          </div>
        </div>
        <div className="rwp-arrow" />
      </div>
      <style>{rwpStyles}</style>
    </>
  );
}

const rwpStyles = `
  .rwp {
    position: fixed;
    z-index: 9000;
    pointer-events: none;
    transform: translateX(-50%) translateY(-100%);
    animation: rwp-in 0.12s ease;
  }
  @keyframes rwp-in {
    from { opacity: 0; transform: translateX(-50%) translateY(calc(-100% + 6px)); }
    to   { opacity: 1; transform: translateX(-50%) translateY(-100%); }
  }
  .rwp-card {
    background: var(--bg-overlay, #1a2b3d);
    border: 1px solid var(--border-normal, rgba(255,255,255,0.1));
    border-radius: 8px;
    padding: 8px 12px;
    max-width: 220px;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.5));
  }
  .rwp-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    padding-bottom: 5px;
  }
  .rwp-emoji { font-size: 16px; }
  .rwp-count { font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .rwp-users { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
  .rwp-arrow {
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid var(--border-normal, rgba(255,255,255,0.1));
  }
`;
