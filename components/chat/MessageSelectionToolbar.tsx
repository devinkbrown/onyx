'use client';

import { useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';

export default function MessageSelectionToolbar() {
  const isSelectMode       = useOnyxStore(s => s.isSelectMode);
  const selectedMessages   = useOnyxStore(s => s.selectedMessages);
  const exitSelectMode     = useOnyxStore(s => s.exitSelectMode);
  const clearSelection     = useOnyxStore(s => s.clearSelection);
  const channels           = useOnyxStore(s => s.channels);
  const dms                = useOnyxStore(s => s.dms);
  const activeView         = useOnyxStore(s => s.activeView);
  const setForwardingMessage = useOnyxStore(s => s.setForwardingMessage);
  const deleteMessage      = useOnyxStore(s => s.deleteMessage);
  const ourNick            = useOnyxStore(s => s.ourNick);

  const count = selectedMessages.size;

  // Determine if local user is an op in the current channel
  const isOp = useCallback((): boolean => {
    if (activeView.kind !== 'channel') return false;
    const ch = channels.get(activeView.channel.toLowerCase());
    if (!ch) return false;
    const user = ch.users.get(ourNick.toLowerCase());
    if (!user) return false;
    return user.modes.has('o') || user.modes.has('a') || user.modes.has('q');
  }, [activeView, channels, ourNick]);

  const handleCopy = useCallback(() => {
    const target = activeView.kind === 'channel'
      ? activeView.channel
      : activeView.kind === 'dm'
        ? activeView.nick
        : null;
    if (!target) return;

    const messages = activeView.kind === 'channel'
      ? (channels.get(activeView.channel.toLowerCase())?.messages ?? [])
      : activeView.kind === 'dm'
        ? (dms.get(activeView.nick.toLowerCase())?.messages ?? [])
        : [];

    const selected = messages
      .filter(m => selectedMessages.has(m.id))
      .map(m => `[${m.time.toLocaleTimeString()}] ${m.from}: ${m.text}`)
      .join('\n');

    navigator.clipboard.writeText(selected).catch(() => {/* clipboard unavailable */});
    clearSelection();
  }, [activeView, channels, dms, selectedMessages, clearSelection]);

  const handleForward = useCallback(() => {
    const messages = activeView.kind === 'channel'
      ? (channels.get(activeView.channel.toLowerCase())?.messages ?? [])
      : activeView.kind === 'dm'
        ? (dms.get(activeView.nick?.toLowerCase?.() ?? '')?.messages ?? [])
        : [];

    const firstSelected = messages.find(m => selectedMessages.has(m.id));
    if (firstSelected) {
      // Build a synthetic message representing the batch
      if (selectedMessages.size === 1) {
        setForwardingMessage(firstSelected);
      } else {
        const combinedText = messages
          .filter(m => selectedMessages.has(m.id))
          .map(m => `[${m.from}] ${m.text}`)
          .join('\n');
        setForwardingMessage({
          ...firstSelected,
          text: combinedText,
          from: firstSelected.from,
        });
      }
    }
    clearSelection();
  }, [activeView, channels, dms, selectedMessages, setForwardingMessage, clearSelection]);

  const handleDelete = useCallback(() => {
    const target = activeView.kind === 'channel'
      ? activeView.channel
      : activeView.kind === 'dm'
        ? activeView.nick
        : null;
    if (!target) return;
    for (const id of selectedMessages) {
      deleteMessage(target, id);
    }
    clearSelection();
  }, [activeView, deleteMessage, selectedMessages, clearSelection]);

  if (!isSelectMode) return null;

  return (
    <>
      <div className="msg-sel-toolbar" role="toolbar" aria-label="Message selection actions">
        <span className="msg-sel-count" aria-live="polite">
          {count} {count === 1 ? 'message' : 'messages'} selected
        </span>

        <div className="msg-sel-actions">
          <button
            className="msg-sel-btn"
            onClick={handleCopy}
            disabled={count === 0}
            aria-label="Copy selected messages"
          >
            <CopyIcon />
            Copy All
          </button>

          <button
            className="msg-sel-btn"
            onClick={handleForward}
            disabled={count === 0}
            aria-label="Forward selected messages"
          >
            <ForwardIcon />
            Forward
          </button>

          {isOp() && (
            <button
              className="msg-sel-btn msg-sel-btn--danger"
              onClick={handleDelete}
              disabled={count === 0}
              aria-label="Delete selected messages"
            >
              <DeleteIcon />
              Delete
            </button>
          )}

          <button
            className="msg-sel-btn msg-sel-btn--cancel"
            onClick={exitSelectMode}
            aria-label="Cancel selection"
          >
            Cancel
          </button>
        </div>
      </div>

      <style>{`
        .msg-sel-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 16px;
          background: var(--bg-deep, #0d1117);
          border-top: 1px solid var(--accent, #7c5af5);
          box-shadow: 0 -4px 20px rgba(124, 90, 245, 0.12);
          animation: sel-toolbar-rise 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
          z-index: 10;
          flex-shrink: 0;
        }

        @keyframes sel-toolbar-rise {
          from { opacity: 0; transform: translateY(100%); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .msg-sel-count {
          font-size: 13px;
          font-weight: 600;
          color: var(--accent, #7c5af5);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .msg-sel-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .msg-sel-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          border: 1px solid var(--border-normal, rgba(255,255,255,0.1));
          border-radius: var(--r-sm, 6px);
          background: var(--bg-elevated, #161b22);
          color: var(--text-secondary, #8b949e);
          cursor: pointer;
          transition: background 150ms, color 150ms, border-color 150ms;
          white-space: nowrap;
        }
        .msg-sel-btn:hover:not(:disabled) {
          background: var(--bg-overlay, #1f2937);
          color: var(--text-primary, #f0f6fc);
        }
        .msg-sel-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .msg-sel-btn--danger {
          color: var(--danger, #f85149);
          border-color: rgba(248, 81, 73, 0.3);
        }
        .msg-sel-btn--danger:hover:not(:disabled) {
          background: var(--danger-subtle, rgba(248, 81, 73, 0.08));
          color: var(--danger, #f85149);
        }

        .msg-sel-btn--cancel {
          color: var(--text-muted, #484f58);
        }
        .msg-sel-btn--cancel:hover {
          color: var(--text-secondary, #8b949e);
        }

        .msg-sel-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          opacity: 0.8;
        }
      `}</style>
    </>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg className="msg-sel-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg className="msg-sel-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 2l4 4-4 4" />
      <path d="M14 6H6a4 4 0 0 0 0 8h1" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="msg-sel-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/>
    </svg>
  );
}
