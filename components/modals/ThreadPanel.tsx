'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import Avatar from '@/components/ui/Avatar';
import ModalShell from './ModalShell';

const ARCHIVE_DURATION_OPTIONS: { label: string; minutes: number }[] = [
  { label: '1 hour',  minutes: 60 },
  { label: '1 day',   minutes: 1440 },
  { label: '3 days',  minutes: 4320 },
  { label: '1 week',  minutes: 10080 },
];

export default function ThreadPanel() {
  const closeThread              = useOnyxStore(s => s.closeThread);
  const threadParentId           = useOnyxStore(s => s.threadParentId);
  const activeView               = useOnyxStore(s => s.activeView);
  const channels                 = useOnyxStore(s => s.channels);
  const dms                      = useOnyxStore(s => s.dms);
  const sendMessage              = useOnyxStore(s => s.sendMessage);
  const setReplyingTo            = useOnyxStore(s => s.setReplyingTo);
  const ourNick                  = useOnyxStore(s => s.ourNick);
  const markThreadSeen           = useOnyxStore(s => s.markThreadSeen);
  const archivedThreads          = useOnyxStore(s => s.archivedThreads);
  const archiveThread            = useOnyxStore(s => s.archiveThread);
  const unarchiveThread          = useOnyxStore(s => s.unarchiveThread);
  const addActiveThread          = useOnyxStore(s => s.addActiveThread);
  const threadAutoArchiveMinutes = useOnyxStore(s => s.threadAutoArchiveMinutes);
  const setThreadAutoArchiveMinutes = useOnyxStore(s => s.setThreadAutoArchiveMinutes);

  const [draft, setDraft] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef     = useRef<HTMLDivElement>(null);

  // Mark thread as seen when the panel opens
  useEffect(() => {
    if (threadParentId) {
      markThreadSeen(threadParentId);
    }
  }, [threadParentId, markThreadSeen]);

  // Close settings dropdown on outside click
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const handleJumpToParent = useCallback(() => {
    if (!threadParentId) return;
    document.dispatchEvent(
      new CustomEvent('ocean:jump-to-msg', { detail: { id: threadParentId } })
    );
    closeThread();
  }, [threadParentId, closeThread]);

  // Gather messages from the active channel/DM
  const allMessages: ChatMessage[] = (() => {
    if (activeView.kind === 'channel') {
      return channels.get(activeView.channel.toLowerCase())?.messages ?? [];
    }
    if (activeView.kind === 'dm') {
      return dms.get(activeView.nick.toLowerCase())?.messages ?? [];
    }
    return [];
  })();

  const target = activeView.kind === 'channel'
    ? activeView.channel
    : activeView.kind === 'dm'
    ? activeView.nick
    : '';

  // Find the parent message
  const parentMessage = allMessages.find(m => m.id === threadParentId) ?? null;

  // Find all replies to the parent
  const replies = allMessages.filter(
    m => m.replyTo?.id === threadParentId,
  );

  // Scroll replies to bottom when new ones arrive
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [replies.length]);

  // Auto-archive detection: check if the thread has gone stale
  useEffect(() => {
    if (!threadParentId) return;
    if (replies.length === 0) return;
    const lastMsg = replies[replies.length - 1];
    const minutesSince = (Date.now() - new Date(lastMsg.time).getTime()) / 60000;
    if (minutesSince > threadAutoArchiveMinutes) {
      archiveThread(threadParentId);
    } else {
      unarchiveThread(threadParentId);
      if (minutesSince < 1440) {
        addActiveThread(threadParentId);
      }
    }
  }, [threadParentId, replies, threadAutoArchiveMinutes, archiveThread, unarchiveThread, addActiveThread]);

  const isArchived = threadParentId ? archivedThreads.has(threadParentId) : false;

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || !target || !parentMessage) return;
    // Unarchive thread when sending to an archived thread
    if (threadParentId && archivedThreads.has(threadParentId)) {
      unarchiveThread(threadParentId);
    }
    // Set reply context before sending so the message echoes with replyTo
    setReplyingTo(parentMessage);
    sendMessage(target, trimmed);
    setDraft('');
  }, [draft, target, parentMessage, sendMessage, setReplyingTo, threadParentId, archivedThreads, unarchiveThread]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!parentMessage) return null;

  return (
    <ModalShell
      onClose={closeThread}
      variant="sheet"
      size="sm"
      title="Thread"
      kicker={target || 'Conversation'}
      titleId="thread-panel-title"
      closeLabel="Close thread"
      headerExtra={
        <>
          {replies.length > 0 && (
            <span className="thread-count">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
          )}
          {isArchived && <span className="thread-archived-chip">Archived</span>}
          {/* Auto-archive settings */}
          <div className="thread-settings-wrap" ref={settingsRef}>
            <button
              className={`thread-settings-btn${showSettings ? ' thread-settings-btn--active' : ''}`}
              onClick={() => setShowSettings(v => !v)}
              aria-label="Thread settings"
              aria-expanded={showSettings}
              title="Auto-archive settings"
            >
              <GearIcon />
            </button>
            {showSettings && (
              <div className="thread-settings-dropdown" role="menu" aria-label="Auto-archive duration">
                <div className="label-caps thread-settings-header">Auto-archive after</div>
                {ARCHIVE_DURATION_OPTIONS.map(opt => (
                  <button
                    key={opt.minutes}
                    className={`thread-settings-item${threadAutoArchiveMinutes === opt.minutes ? ' thread-settings-item--active' : ''}`}
                    role="menuitemradio"
                    aria-checked={threadAutoArchiveMinutes === opt.minutes}
                    onClick={() => { setThreadAutoArchiveMinutes(opt.minutes); setShowSettings(false); }}
                    type="button"
                  >
                    {opt.label}
                    {threadAutoArchiveMinutes === opt.minutes && <CheckIcon />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      }
      flushBody
    >
      <div className="thread-layout">
        {/* Body */}
        <div className="thread-body" ref={bodyRef}>

          {/* Jump to original message in main chat */}
          <button
            className="thread-jump-to-parent"
            onClick={handleJumpToParent}
            aria-label="View original message in main chat"
          >
            <UpArrowIcon />
            <span>View original message</span>
          </button>

          {/* Parent message */}
          <div className="thread-parent-msg">
            <ThreadMessageCard msg={parentMessage} isParent />
          </div>

          {/* Archived banner */}
          {isArchived && (
            <div className="thread-archived-banner" role="status">
              <span aria-hidden="true">🔒</span>
              <span>This thread is archived. Reply to unarchive it.</span>
            </div>
          )}

          {/* Divider */}
          <div className="thread-divider">
            <span className="thread-divider-line" />
            <span className="thread-divider-label">
              {replies.length === 0
                ? 'No replies yet'
                : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
            </span>
            <span className="thread-divider-line" />
          </div>

          {/* Replies */}
          {replies.map(msg => (
            <ThreadMessageCard key={msg.id} msg={msg} isParent={false} />
          ))}

          {replies.length === 0 && (
            <p className="thread-empty-hint">
              Be the first to reply to this message.
            </p>
          )}
        </div>

        {/* Compact reply input */}
        <div className="thread-input-wrap">
          <div className="thread-input-row">
            <Avatar nick={ourNick} size={28} />
            <div className="thread-textarea-wrap">
              <textarea
                ref={textareaRef}
                className={`thread-textarea${isArchived ? ' thread-textarea--archived' : ''}`}
                placeholder={isArchived ? 'Thread is archived. Reply to reopen.' : 'Reply in thread…'}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
            </div>
            <button
              className={`thread-send-btn ${draft.trim() ? 'thread-send-btn--active' : ''}`}
              onClick={handleSend}
              disabled={!draft.trim()}
              aria-label="Send reply"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .thread-layout {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }

        .thread-count {
          font-size: var(--text-2xs, 11px); font-weight: 700;
          padding: 1px 7px; border-radius: var(--r-full);
          background: var(--accent-subtle); border: 1px solid var(--accent-border);
          color: var(--accent);
          white-space: nowrap;
        }

        .thread-body {
          flex: 1; overflow-y: auto; padding: var(--sp-3, 12px);
          display: flex; flex-direction: column; gap: 2px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        /* Jump to parent */
        .thread-jump-to-parent {
          display: inline-flex; align-items: center; gap: 5px;
          background: none; border: none; cursor: pointer;
          font-size: var(--text-2xs, 11px); font-weight: 700; color: var(--text-muted);
          padding: 4px 8px; border-radius: var(--r-sm);
          margin-bottom: var(--sp-2, 8px);
          transition: color var(--t-control, 150ms), background var(--t-control, 150ms);
          font-family: inherit;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .thread-jump-to-parent:hover {
          color: var(--accent); background: var(--accent-subtle);
        }

        /* Parent message card — quoted bg */
        .thread-parent-msg {
          background: var(--elev-tint-1, var(--bg-elevated));
          border: 1px solid var(--border-subtle);
          border-left: 3px solid var(--accent);
          border-radius: var(--r-md);
          padding: 10px 12px;
          margin-bottom: var(--sp-2, 8px);
        }

        /* Divider */
        .thread-divider {
          display: flex; align-items: center; gap: var(--sp-2, 8px);
          padding: var(--sp-2, 8px) 0; flex-shrink: 0;
        }
        .thread-divider-line {
          flex: 1; height: 1px; background: var(--border-subtle);
        }
        .thread-divider-label {
          font-size: 10px; color: var(--text-muted);
          font-weight: 700; letter-spacing: 0.07em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .thread-empty-hint {
          font-size: var(--text-sm, 13px); color: var(--text-muted);
          text-align: center; padding: var(--sp-4, 16px); margin: 0;
          font-style: italic;
        }

        /* Reply message cards */
        .thread-msg-card {
          display: flex; gap: 10px;
          padding: 6px 4px;
          border-radius: var(--r-sm);
          transition: background var(--t-control, 150ms);
        }
        .thread-msg-card:hover { background: var(--accent-subtle); }
        .thread-msg-card--parent {
          padding: 0;
          background: none !important;
        }

        .thread-msg-body { flex: 1; min-width: 0; }
        .thread-msg-meta {
          display: flex; align-items: baseline; gap: 7px;
          margin-bottom: 2px;
        }
        .thread-msg-nick {
          font-size: var(--text-base, 14px); font-weight: 700; color: var(--text-primary);
        }
        .thread-msg-time {
          font-size: var(--text-2xs, 11px); color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .thread-msg-text {
          font-size: var(--text-base, 14px); line-height: 1.55; color: var(--text-secondary);
          word-break: break-word; white-space: pre-wrap;
        }
        .thread-msg-card--parent .thread-msg-nick { color: var(--accent); }
        .thread-msg-card--parent .thread-msg-text { color: var(--text-primary); }
        .thread-msg-deleted {
          font-size: var(--text-sm, 13px); color: var(--text-muted); font-style: italic;
        }

        /* Reply input */
        .thread-input-wrap {
          padding: 10px 12px 12px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .thread-input-row {
          display: flex; align-items: flex-end; gap: var(--sp-2, 8px);
        }
        .thread-textarea-wrap {
          flex: 1; min-width: 0;
        }
        .thread-textarea {
          width: 100%;
          background: var(--bg-void);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          color: var(--text-primary);
          font-size: var(--text-base, 14px);
          line-height: 1.5;
          padding: 8px 12px;
          resize: none;
          outline: none;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
          max-height: 120px;
          overflow-y: auto;
          field-sizing: content;
        }
        .thread-textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }
        .thread-textarea::placeholder { color: var(--text-muted); }

        .thread-send-btn {
          width: 34px; height: 34px; flex-shrink: 0;
          border: none; border-radius: var(--r-md);
          background: var(--bg-float);
          border: 1px solid var(--border-subtle);
          color: var(--text-muted); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms), border-color var(--t-control, 150ms);
        }
        .thread-send-btn--active {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
        .thread-send-btn:disabled { opacity: 0.45; cursor: default; }

        /* ── Archived chip in header ── */
        .thread-archived-chip {
          font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
          padding: 2px 7px; border-radius: var(--r-full);
          background: var(--danger-subtle);
          border: 1px solid rgba(248,113,113,0.25);
          color: var(--danger);
          text-transform: uppercase;
          white-space: nowrap;
        }

        /* ── Settings button ── */
        .thread-settings-wrap { position: relative; }
        .thread-settings-btn {
          width: 28px; height: 28px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted); border-radius: var(--r-sm);
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms);
        }
        .thread-settings-btn:hover,
        .thread-settings-btn--active {
          background: var(--ch-hover-bg); color: var(--text-primary);
        }

        /* ── Settings dropdown ── */
        .thread-settings-dropdown {
          position: absolute; top: calc(100% + 4px); right: 0;
          z-index: 200;
          background: var(--elev-tint-2, var(--bg-float));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, var(--shadow-md));
          min-width: 168px;
          padding: 4px 0;
          animation: settings-pop 120ms var(--ease-out) both;
        }
        @keyframes settings-pop {
          from { opacity: 0; transform: translateY(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .thread-settings-dropdown { animation: none; }
        }
        .thread-settings-header {
          padding: 7px 12px 4px;
        }
        .thread-settings-item {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; padding: 7px 12px;
          background: none; border: none; cursor: pointer;
          font-size: var(--text-sm, 13px); font-family: inherit;
          color: var(--text-secondary);
          transition: background var(--t-control, 150ms), color var(--t-control, 150ms);
        }
        .thread-settings-item:hover {
          background: var(--ch-hover-bg); color: var(--text-primary);
        }
        .thread-settings-item--active { color: var(--accent); }

        /* ── Archived banner ── */
        .thread-archived-banner {
          display: flex; align-items: center; gap: var(--sp-2, 8px);
          padding: 8px 12px; margin: 6px 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          font-size: var(--text-sm, 13px); color: var(--text-muted);
          flex-shrink: 0;
        }

        /* ── Archived textarea variant ── */
        .thread-textarea--archived {
          opacity: 0.55;
          cursor: text;
        }
      `}</style>
    </ModalShell>
  );
}

// ── Thread message card ────────────────────────────────────────────────────────

interface ThreadMessageCardProps {
  msg: ChatMessage;
  isParent: boolean;
}

function ThreadMessageCard({ msg, isParent }: ThreadMessageCardProps) {
  const timeStr = isParent
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(msg.time)
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(msg.time);

  return (
    <div className={`thread-msg-card ${isParent ? 'thread-msg-card--parent' : ''}`}>
      <Avatar nick={msg.from} size={isParent ? 32 : 28} />
      <div className="thread-msg-body">
        <div className="thread-msg-meta">
          <span className="thread-msg-nick">{msg.from}</span>
          <time className="thread-msg-time">{timeStr}</time>
        </div>
        {msg.deleted
          ? <p className="thread-msg-deleted">(message deleted)</p>
          : <p className="thread-msg-text">{msg.text}</p>
        }
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const UpArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 10V2M2 6l4-4 4 4" />
  </svg>
);

const SendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <path d="M1.5 1.5l12 6-12 6V9l8-1.5L1.5 6V1.5z" />
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6l3 3 5-5" />
  </svg>
);
