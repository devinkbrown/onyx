'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { ChatMessage } from '@/lib/irc/types';
import { useOnyxStore } from '@/lib/store';
import { showToast } from '@/components/ui/Toast';

interface Props {
  x: number;
  y: number;
  message: ChatMessage;
  isOwnMessage: boolean;
  isPinned: boolean;
  onClose: () => void;
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

const ReplyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M7 3L2 8l5 5V10c3.5 0 6 1 7.5 4C14 9.5 11.5 5 7 5V3z" fill="currentColor"/>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M11.5 2.5a1.5 1.5 0 0 1 2.12 2.12l-8.5 8.5-2.63.5.5-2.63 8.5-8.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ForwardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M9 3l5 5-5 5v-3c-3.5 0-6 1-7.5 4C2 9.5 4.5 5 9 5V3z" fill="currentColor"/>
  </svg>
);

const PinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M9.5 2L14 6.5l-2 2-1-.5L8 11V13H6l-3-3v-2L5.5 5.5l-.5-1 2-2 2.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="3" y1="13" x2="5.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const CopyTextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="5" y="4" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M3 12V3h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M7 9a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M9 7a3.5 3.5 0 0 0-5 0L2 9a3.5 3.5 0 0 0 5 5l1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const IdIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <line x1="5" y1="8.5" x2="11" y2="8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <line x1="5" y1="10.5" x2="8.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <circle cx="8" cy="3" r="1" fill="currentColor"/>
  </svg>
);

const ProfileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M2 13.5c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const MentionIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M11 8a3 3 0 0 0 3 3v-3a6 6 0 1 0-2.7 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const DeleteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M2.5 4h11M5 4V2.5h6V4M12 4l-.5 9.5h-7L4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="6.5" y1="7" x2="6.5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <line x1="9.5" y1="7" x2="9.5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const ReportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M8 2L14 13H2L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    <line x1="8" y1="7" x2="8" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
  </svg>
);

const ThreadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M2 3h12M2 7h8M2 11h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M10 9l4 4-4 0v-4z" fill="currentColor" opacity="0.7"/>
  </svg>
);

// ── Quick react emoji row ──────────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

interface QuickReactRowProps {
  onReact: (emoji: string) => void;
}

function QuickReactRow({ onReact }: QuickReactRowProps) {
  return (
    <div className="mctx-quick-row" role="group" aria-label="Quick react">
      {QUICK_EMOJIS.map(emoji => (
        <button
          key={emoji}
          className="mctx-quick-btn"
          onClick={() => onReact(emoji)}
          aria-label={`React with ${emoji}`}
          title={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MessageContextMenu({
  x, y, message, isOwnMessage, isPinned, onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [, setFocusIdx] = useState(-1);
  const [pos, setPos] = useState({ top: y, left: x });

  const addReaction         = useOnyxStore(s => s.addReaction);
  const setReplyingTo       = useOnyxStore(s => s.setReplyingTo);
  const setForwardingMessage = useOnyxStore(s => s.setForwardingMessage);
  const pinMessage          = useOnyxStore(s => s.pinMessage);
  const unpinMessage        = useOnyxStore(s => s.unpinMessage);
  const pinDMMessage        = useOnyxStore(s => s.pinDMMessage);
  const unpinDMMessage      = useOnyxStore(s => s.unpinDMMessage);
  const dmPinnedMessages    = useOnyxStore(s => s.dmPinnedMessages);
  const openThread          = useOnyxStore(s => s.openThread);
  const activeView          = useOnyxStore(s => s.activeView);
  const ourNick             = useOnyxStore(s => s.ourNick);
  const openUserProfileCard = useOnyxStore(s => s.openUserProfileCard);
  const deleteMessage       = useOnyxStore(s => s.deleteMessage);

  const isDM = activeView.kind === 'dm';
  const dmNick = isDM ? activeView.nick : '';
  const isDMPinned = isDM
    ? (dmPinnedMessages.get(dmNick.toLowerCase()) ?? []).some(p => p.id === message.id)
    : false;

  const channel = activeView.kind === 'channel'
    ? activeView.channel
    : activeView.kind === 'dm'
      ? activeView.nick
      : 'unknown';

  const messageSender = message.from ?? '';
  const isSelf = messageSender.toLowerCase() === ourNick.toLowerCase();

  // ── Viewport-aware positioning ─────────────────────────────────────────────
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = y;
    let left = x;

    // Flip upward if in bottom 40% of screen
    if (y > vh * 0.6) {
      top = y - rect.height;
    }
    // Flip leftward if in right 30% of screen
    if (x > vw * 0.7) {
      left = x - rect.width;
    }

    // Clamp to viewport with 8px margin
    top  = Math.max(8, Math.min(top,  vh - rect.height - 8));
    left = Math.max(8, Math.min(left, vw - rect.width  - 8));

    setPos({ top, left });
  }, [x, y]);

  // ── Outside click ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '.mctx-item:not(:disabled)'
    );

    const handler = (e: globalThis.KeyboardEvent) => {
      if (!items || items.length === 0) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx(prev => {
          const next = (prev + 1) % items.length;
          items[next].focus();
          return next;
        });
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx(prev => {
          const next = (prev - 1 + items.length) % items.length;
          items[next].focus();
          return next;
        });
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Helper: run action then close ─────────────────────────────────────────
  const run = useCallback((fn: () => void) => {
    fn();
    onClose();
  }, [onClose]);

  // ── Action handlers ────────────────────────────────────────────────────────

  const handleQuickReact = useCallback((emoji: string) => {
    run(() => addReaction(message.target, message.id, emoji));
  }, [run, addReaction, message.target, message.id]);

  const handleReply = () => run(() => setReplyingTo(message));

  const handleEdit = () => run(() => {
    window.dispatchEvent(new CustomEvent('ocean:edit-message', { detail: { messageId: message.id } }));
  });

  const handleForward = () => run(() => setForwardingMessage(message));

  const handleOpenThread = () => run(() => openThread(message.id));

  const handlePin = () => run(() => {
    if (isDM) {
      if (isDMPinned) unpinDMMessage(dmNick, message.id);
      else pinDMMessage(dmNick, message);
    } else {
      if (isPinned) unpinMessage(message.target, message.id);
      else pinMessage(message.target, message);
    }
  });

  const handleCopyText = () => run(() => {
    navigator.clipboard.writeText(message.text).catch(() => undefined);
    showToast('Copied to clipboard', { variant: 'success' });
  });

  const handleCopyLink = () => run(() => {
    const link = `ocean://${channel}/${message.id}`;
    navigator.clipboard.writeText(link).catch(() => undefined);
    showToast('Message link copied', { variant: 'success' });
  });

  const handleCopyId = () => run(() => {
    navigator.clipboard.writeText(message.id).catch(() => undefined);
    showToast('Message ID copied', { variant: 'info' });
  });

  const handleViewProfile = () => run(() => {
    if (messageSender) {
      openUserProfileCard(messageSender, { x, y });
    }
  });

  const handleMentionUser = () => run(() => {
    document.dispatchEvent(
      new CustomEvent('ocean:prefill-input', { detail: { text: `@${messageSender} ` } })
    );
  });

  const handleDelete = () => run(() => {
    deleteMessage(message.target, message.id);
  });

  const handleReport = () => run(() => {
    showToast(`Message reported`, { variant: 'info' });
  });

  const pinLabel = isDM
    ? (isDMPinned ? 'Unpin from DM' : 'Pin in DM')
    : (isPinned   ? 'Unpin Message'  : 'Pin Message');

  return (
    <>
      <div
        ref={menuRef}
        className="mctx"
        role="menu"
        aria-label="Message actions"
        style={{ top: pos.top, left: pos.left }}
      >
        {/* Section 1 — Quick react */}
        <QuickReactRow onReact={handleQuickReact} />

        <div className="mctx-sep" role="separator" />

        {/* Section 2 — Message actions */}
        <button className="mctx-item" role="menuitem" onClick={handleReply}>
          <span className="mctx-icon"><ReplyIcon /></span>
          <span className="mctx-label">Reply</span>
          <span className="mctx-shortcut">↩</span>
        </button>

        {isOwnMessage && (
          <button className="mctx-item" role="menuitem" onClick={handleEdit}>
            <span className="mctx-icon"><EditIcon /></span>
            <span className="mctx-label">Edit</span>
          </button>
        )}

        <button className="mctx-item" role="menuitem" onClick={handleForward}>
          <span className="mctx-icon"><ForwardIcon /></span>
          <span className="mctx-label">Forward</span>
        </button>

        {!isDM && (
          <button className="mctx-item" role="menuitem" onClick={handleOpenThread}>
            <span className="mctx-icon"><ThreadIcon /></span>
            <span className="mctx-label">Start Thread</span>
          </button>
        )}

        <button className="mctx-item" role="menuitem" onClick={handlePin}>
          <span className="mctx-icon"><PinIcon /></span>
          <span className="mctx-label">{pinLabel}</span>
        </button>

        <div className="mctx-sep" role="separator" />

        {/* Section 3 — Copy */}
        <button className="mctx-item" role="menuitem" onClick={handleCopyText}>
          <span className="mctx-icon"><CopyTextIcon /></span>
          <span className="mctx-label">Copy Text</span>
        </button>

        <button className="mctx-item" role="menuitem" onClick={handleCopyLink}>
          <span className="mctx-icon"><LinkIcon /></span>
          <span className="mctx-label">Copy Message Link</span>
        </button>

        <button className="mctx-item" role="menuitem" onClick={handleCopyId}>
          <span className="mctx-icon"><IdIcon /></span>
          <span className="mctx-label">Copy Message ID</span>
        </button>

        {/* Section 4 — User actions (only for others' messages) */}
        {!isSelf && messageSender && (
          <>
            <div className="mctx-sep" role="separator" />

            <button className="mctx-item" role="menuitem" onClick={handleViewProfile}>
              <span className="mctx-icon"><ProfileIcon /></span>
              <span className="mctx-label">View Profile</span>
            </button>

            <button className="mctx-item" role="menuitem" onClick={handleMentionUser}>
              <span className="mctx-icon"><MentionIcon /></span>
              <span className="mctx-label">Mention User</span>
            </button>
          </>
        )}

        {/* Section 5 — Danger zone */}
        <div className="mctx-sep" role="separator" />

        {isOwnMessage && (
          <button className="mctx-item mctx-item--danger" role="menuitem" onClick={handleDelete}>
            <span className="mctx-icon"><DeleteIcon /></span>
            <span className="mctx-label">Delete Message</span>
          </button>
        )}

        <button className="mctx-item mctx-item--danger" role="menuitem" onClick={handleReport}>
          <span className="mctx-icon"><ReportIcon /></span>
          <span className="mctx-label">Report Message</span>
        </button>
      </div>

      <style>{styles}</style>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = `
  .mctx {
    position: fixed;
    background: var(--bg-surface, #1e1f22);
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    min-width: 200px;
    padding: 4px 0;
    z-index: 1500;
    animation: mctx-in 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: top left;
    user-select: none;
  }

  @keyframes mctx-in {
    from { opacity: 0; transform: scale(0.94); }
    to   { opacity: 1; transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .mctx { animation: none; }
  }

  /* ── Quick react row ── */
  .mctx-quick-row {
    display: flex;
    gap: 4px;
    padding: 6px 8px 4px;
  }

  .mctx-quick-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: transform 120ms cubic-bezier(0.16, 1, 0.3, 1),
                background 100ms ease;
    flex-shrink: 0;
  }

  .mctx-quick-btn:hover {
    background: var(--bg-overlay, rgba(255,255,255,0.07));
    transform: scale(1.25);
  }

  .mctx-quick-btn:active {
    transform: scale(1.1);
  }

  /* ── Separator ── */
  .mctx-sep {
    height: 1px;
    background: var(--border-subtle, rgba(255,255,255,0.06));
    margin: 4px 0;
  }

  /* ── Menu items ── */
  .mctx-item {
    display: flex;
    align-items: center;
    gap: 0;
    height: 32px;
    min-width: 180px;
    width: 100%;
    padding: 0 8px 0 12px;
    border: none;
    background: none;
    color: var(--text-primary, #dbdee1);
    font-size: 14px;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 80ms ease;
    outline: none;
  }

  .mctx-item:hover,
  .mctx-item:focus-visible {
    background: var(--bg-overlay, rgba(255,255,255,0.07));
  }

  .mctx-item--danger {
    color: var(--danger, #ed4245);
  }

  .mctx-item--danger:hover,
  .mctx-item--danger:focus-visible {
    background: rgba(237, 66, 69, 0.15);
  }

  /* ── Icon slot (always 16px, left-aligned) ── */
  .mctx-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    flex-shrink: 0;
    margin-right: 8px;
    opacity: 0.75;
    color: inherit;
  }

  .mctx-item:hover .mctx-icon,
  .mctx-item:focus-visible .mctx-icon {
    opacity: 1;
  }

  /* ── Label ── */
  .mctx-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Optional shortcut hint ── */
  .mctx-shortcut {
    margin-left: 12px;
    font-size: 12px;
    color: var(--text-muted, #87898c);
    flex-shrink: 0;
  }
`;
