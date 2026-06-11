'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type React from 'react';
import type { ChatMessage } from '@/lib/irc/types';
import MessageItem from './MessageItem';
import TypingIndicator from './TypingIndicator';
import ReadReceipt, { updateDmReadAt } from './ReadReceipt';
import SkeletonMessage from './SkeletonMessage';
import UnreadDivider from './UnreadDivider';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import { getNickColor } from '@/lib/nick-color';

interface Props {
  messages: ChatMessage[];
  ourNick: string;
  target: string;
  /** When true, messages not in searchMatchIds get dimmed */
  searchActive?: boolean;
  searchMatchIds?: Set<string>;
  searchFocusedId?: string | null;
  /** Called whenever the at-bottom state changes */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** When set, ChatArea can call this to scroll to bottom */
  scrollToBottomRef?: React.MutableRefObject<(() => void) | null>;
}

export default function MessageList({ messages, target, searchActive, searchMatchIds, searchFocusedId, onAtBottomChange, scrollToBottomRef }: Props) {
  const ourNick          = useOnyxStore(s => s.ourNick);
  const firstUnreadId    = useOnyxStore(s => s.firstUnreadId);
  const clearFirstUnread = useOnyxStore(s => s.clearFirstUnread);
  const historyLoading    = useOnyxStore(s => s.historyLoading);
  const historyExhausted  = useOnyxStore(s => s.historyExhausted);
  const loadHistory       = useOnyxStore(s => s.loadHistory);
  const connectionStatus  = useOnyxStore(s => s.connectionStatus);
  const messageDensity    = useOnyxStore(s => s.messageDensity);

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);
  const msgRefs   = useRef<Map<string, HTMLElement>>(new Map());
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  // Track how many messages were present on the previous render to identify "new" ones
  const prevCountRef = useRef(messages.length);
  // Preserve scroll position when older messages are prepended at the top
  const prevScrollHeightRef = useRef(0);
  const prevMsgLenRef       = useRef(messages.length);

  const handleMsgRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      msgRefs.current.set(id, el);
    } else {
      msgRefs.current.delete(id);
    }
  }, []);

  const jumpToMessage = useCallback((msgId: string) => {
    const el = msgRefs.current.get(msgId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-jump-highlight');
    setTimeout(() => el.classList.remove('msg-jump-highlight'), 1500);
  }, []);

  const targetKey      = target.toLowerCase();
  const unreadMsgId    = firstUnreadId.get(targetKey) ?? null;
  const isHistLoading  = historyLoading.get(targetKey) ?? false;
  const isHistExhausted = historyExhausted.get(targetKey) ?? false;
  const unreadIndex = unreadMsgId ? messages.findIndex(m => m.id === unreadMsgId) : -1;
  const unreadCount = unreadIndex >= 0 ? messages.length - unreadIndex : 0;

  // Expose scrollToBottom to parent via ref
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior });
  };
  useEffect(() => {
    if (scrollToBottomRef) {
      scrollToBottomRef.current = () => scrollToBottom('smooth');
      return () => { scrollToBottomRef.current = null; };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToBottomRef]);

  // Handle Ctrl+L (ocean:scroll-bottom custom event)
  useEffect(() => {
    const handler = () => {
      scrollToBottom('smooth');
      setIsAtBottom(true);
    };
    document.addEventListener('ocean:scroll-bottom', handler);
    return () => document.removeEventListener('ocean:scroll-bottom', handler);
  }, []);

  // Handle ocean:jump-to-message events dispatched from search results
  useEffect(() => {
    const handler = (e: CustomEvent<{ msgId: string }>) => {
      jumpToMessage(e.detail.msgId);
    };
    window.addEventListener('ocean:jump-to-message', handler as EventListener);
    return () => window.removeEventListener('ocean:jump-to-message', handler as EventListener);
  }, [jumpToMessage]);

  // Notify parent when at-bottom state changes
  useEffect(() => {
    onAtBottomChange?.(isAtBottom);
  }, [isAtBottom, onAtBottomChange]);

  // Update prevCountRef after each render (but not during a channel switch)
  useEffect(() => {
    if (!isSwitching) {
      prevCountRef.current = messages.length;
    }
  }, [messages.length, isSwitching]);

  // Auto-scroll when new messages arrive — only if already at bottom
  const prevLengthRef = useRef(messages.length);
  useEffect(() => {
    const prevLen = prevLengthRef.current;
    prevLengthRef.current = messages.length;
    if (messages.length > prevLen && isAtBottom) {
      scrollToBottom('smooth');
    }
  }, [messages.length, isAtBottom]);

  // Preserve scroll position when older messages are prepended (history load)
  // Must run before paint so DOM measurements are consistent.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const prevLen    = prevMsgLenRef.current;
    const prevHeight = prevScrollHeightRef.current;
    const added      = messages.length - prevLen;

    // Only compensate when messages were added while user is NOT at bottom
    // (i.e. they scrolled up to read history).
    if (added > 0 && !isAtBottom && prevHeight > 0) {
      const heightDiff = el.scrollHeight - prevHeight;
      if (heightDiff > 0) {
        el.scrollTop += heightDiff;
      }
    }

    prevMsgLenRef.current       = messages.length;
    prevScrollHeightRef.current = el.scrollHeight;
  // isAtBottom intentionally omitted — we only want to track length changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Reset scroll-height baseline on channel switch so prepend compensation
  // doesn't fire with a stale measurement from the previous channel.
  useEffect(() => {
    const el = listRef.current;
    prevScrollHeightRef.current = el ? el.scrollHeight : 0;
    prevMsgLenRef.current       = messages.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // ── Scroll position memory — save + restore per channel ─────────────────
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const prevTargetRef = useRef(target);

  // Channel-switch fade transition
  useEffect(() => {
    if (prevTargetRef.current === target) return;
    setIsSwitching(true);
    // After fade-out (100ms), snap prevCountRef to current length so no "new" flash
    const tid = setTimeout(() => {
      prevCountRef.current = messages.length;
      setIsSwitching(false);
    }, 120);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Save position for previous target before switching
  useEffect(() => {
    const el = listRef.current;
    const prevTarget = prevTargetRef.current;
    if (prevTarget === target) return;

    if (el) {
      scrollPositions.current.set(prevTarget, el.scrollTop);
    }
    prevTargetRef.current = target;

    // Restore or jump to bottom for the new target
    const savedPos = scrollPositions.current.get(target);
    if (savedPos !== undefined) {
      // Restore — but only if user was not at bottom (i.e. scrolled up reading history)
      requestAnimationFrame(() => {
        const scrollEl = listRef.current;
        if (!scrollEl) return;
        scrollEl.scrollTop = savedPos;
        const atBottom = scrollEl.scrollHeight - savedPos - scrollEl.clientHeight < 100;
        setIsAtBottom(atBottom);
      });
    } else {
      scrollToBottom('instant');
      setIsAtBottom(true);
    }
  }, [target]);

  // DM read receipt: update localStorage when at bottom in a DM conversation
  const chanTypes = useOnyxStore(s => s.client?.isupport.CHANTYPES ?? '#&');
  const isDm = target.length === 0 || !chanTypes.includes(target[0]);
  useEffect(() => {
    if (!isDm || !isAtBottom) return;
    updateDmReadAt(target);
  }, [isDm, isAtBottom, target, messages.length]);

  // Find the last message sent by the local user (for ReadReceipt placement)
  const lastOwnMsg = isDm
    ? [...messages].reverse().find(m => m.from.toLowerCase() === ourNick.toLowerCase() && m.type === 'msg')
    : undefined;

  // Detect manual scroll up; clear unread separator when back at bottom;
  // trigger history load when near the top
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setIsAtBottom(nearBottom);
    if (nearBottom && unreadMsgId) {
      clearFirstUnread(target);
    }

    // Load older messages when within 100px of the top
    if (el.scrollTop < 100 && !isHistLoading && !isHistExhausted) {
      const oldestMsg = messages[0];
      loadHistory(target, oldestMsg);
    }
  };

  // Group consecutive messages from the same user
  const grouped = groupMessages(messages);

  // Compute the cutoff index for "new" messages (rendered after initial load)
  const initialCountSnapshot = prevCountRef.current;
  // Compute flat message index as we iterate groups
  let flatMsgIndex = 0;

  const showEmpty = messages.length === 0 && connectionStatus === 'connected' && !isHistLoading;
  const channelDisplayName = target.replace(/^[#&]/, '');
  const nickColor = isDm ? getNickColor(target) : undefined;

  const handleSayHello = () => {
    document.dispatchEvent(new CustomEvent('ocean:prefill-input', { detail: { text: 'Hello! 👋' } }));
  };

  return (
    <div
      className={`msg-list${isSwitching ? ' channel-switching' : ''}`}
      ref={listRef}
      onScroll={onScroll}
      role="log"
      aria-label="Message history"
      aria-live="polite"
      aria-relevant="additions"
      data-density={messageDensity}
    >
      {/* Skeleton during initial connection / reconnect */}
      {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
        <SkeletonMessage count={10} />
      )}

      {/* History loading indicator */}
      {connectionStatus === 'connected' && isHistLoading && (
        <div className="ml-hist-loading">
          <span className="ml-hist-dot" />
          <span className="ml-hist-dot" />
          <span className="ml-hist-dot" />
        </div>
      )}

      {/* Beginning of conversation marker */}
      {connectionStatus === 'connected' && isHistExhausted && messages.length > 0 && (
        <div className="ml-hist-start">
          <span>This is the beginning of your conversation in <strong>{target}</strong></span>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────── */}
      {showEmpty && (
        isDm ? (
          <div className="msg-empty msg-empty--dm msg-empty--animate">
            <div className="msg-empty-dm-avatar">
              <Avatar nick={target} size={72} />
              <div className="msg-empty-dm-ring" style={{ borderColor: nickColor }} />
            </div>
            <p className="msg-empty-dm-nick" style={{ color: nickColor }}>{target}</p>
            <p className="msg-empty-dm-title">This is the beginning of your conversation with <strong>{target}</strong></p>
            <p className="msg-empty-dm-hint">Send a message to get things started.</p>
            <button className="msg-empty-dm-hello" onClick={handleSayHello}>
              Say hello! 👋
            </button>
          </div>
        ) : (
          <div className="msg-empty msg-empty--channel msg-empty--animate">
            <div className="msg-empty-dots-bg" aria-hidden />
            <div className="msg-empty-icon-wrap">
              <span className="msg-empty-icon">💬</span>
            </div>
            <p className="msg-empty-channel-title">Be the first to say something</p>
            <p className="msg-empty-channel-sub">This is the beginning of <strong>#{channelDisplayName}</strong></p>
          </div>
        )
      )}

      {connectionStatus === 'connected' && grouped.map((group, gi) => {
        const firstMsgInGroup = group[0];
        const showSeparator = unreadMsgId !== null && firstMsgInGroup.id === unreadMsgId;

        // Date separator: show when this group's day differs from the previous group's day
        const prevGroup = gi > 0 ? grouped[gi - 1] : null;
        const prevLastMsg = prevGroup ? prevGroup[prevGroup.length - 1] : null;
        const thisDateStr = firstMsgInGroup.time.toDateString();
        const prevDateStr = prevLastMsg ? prevLastMsg.time.toDateString() : null;
        const showDateSep = thisDateStr !== prevDateStr;
        const dateLabel = showDateSep ? formatDateSeparator(firstMsgInGroup.time) : null;

        return (
          <div key={gi}>
            {showDateSep && dateLabel && (
              <div
                className="date-separator"
                aria-label={`Messages from ${dateLabel}`}
              >
                <span className="date-separator-line" />
                <span className="date-separator-label">{dateLabel}</span>
                <span className="date-separator-line" />
              </div>
            )}
            {showSeparator && <UnreadDivider />}
            <div className="msg-group">
              {group.map((msg, mi) => {
                const currentFlatIndex = flatMsgIndex++;
                const isNew = !isSwitching && currentFlatIndex >= initialCountSnapshot;
                const isMatch   = searchActive && searchMatchIds?.has(msg.id);
                const isFocused = searchFocusedId === msg.id;
                const isDimmed  = searchActive && !isMatch;
                const searchCls = isFocused
                  ? 'msg--highlighted msg--focused'
                  : isMatch
                  ? 'msg--highlighted'
                  : isDimmed
                  ? 'msg--dimmed'
                  : '';
                return (
                  <div key={msg.id} data-msg-id={msg.id} className={searchCls}>
                    <MessageItem
                      message={msg}
                      isMe={msg.from.toLowerCase() === ourNick.toLowerCase()}
                      isGrouped={mi > 0}
                      isNew={isNew}
                      onMsgRef={handleMsgRef}
                      onJumpToMessage={jumpToMessage}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* DM read receipt — shown after the last message sent by the local user */}
      {isDm && lastOwnMsg && (
        <ReadReceipt
          nick={target}
          msgTimestamp={lastOwnMsg.time.getTime()}
        />
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} className="scroll-anchor" />

      {/* Typing indicator */}
      <TypingIndicator channel={target} />

      {/* Jump to Present button */}
      {!isAtBottom && (
        <button
          className="ml-jump-btn animate-ml-fadein"
          aria-label="Jump to present"
          onClick={() => {
            setIsAtBottom(true);
            scrollToBottom('smooth');
            if (unreadMsgId) clearFirstUnread(target);
          }}
        >
          {unreadCount > 0 ? `↓ ${unreadCount} new` : '↓ Jump to Present'}
        </button>
      )}

      <style>{`
        .msg-list {
          flex: 1;
          overflow-y: auto;
          padding: var(--sp-4, 16px) 0 80px;
          display: flex;
          flex-direction: column;
          position: relative;
          transition: opacity 100ms ease;
          --msg-group-gap: var(--sp-4, 16px);
          --msg-intra-gap: 2px;
          --msg-head-pad-y: 5px;
          --msg-grouped-pad-y: 1px;
        }
        .msg-list[data-density="compact"] {
          --msg-group-gap: var(--sp-3, 12px);
          --msg-head-pad-y: 2px;
          --msg-grouped-pad-y: 0px;
        }
        .msg-list[data-density="spacious"],
        .msg-list[data-density="comfortable"] {
          --msg-group-gap: var(--sp-5, 20px);
          --msg-head-pad-y: 7px;
          --msg-grouped-pad-y: 2px;
        }
        .channel-switching {
          opacity: 0;
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .msg-list { transition: none; }
          .channel-switching { opacity: 1; }
        }

        .msg-group {
          display: flex;
          flex-direction: column;
          gap: var(--msg-intra-gap);
          margin-bottom: var(--msg-group-gap);
        }
        .msg-group:last-of-type { margin-bottom: 0; }

        .scroll-anchor { height: 8px; }

        /* ── Empty state (shared) ─────────────────────────────────── */
        .msg-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 48px 24px;
          text-align: center;
        }

        @keyframes msg-empty-fadein {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .msg-empty--animate { animation: msg-empty-fadein 400ms ease both; }

        /* ── Channel empty state ─────────────────────────────────── */
        .msg-empty--channel {
          position: relative;
          overflow: hidden;
        }

        .msg-empty-dots-bg {
          position: absolute;
          inset: 0;
          background: color-mix(in srgb, var(--bg-elevated, #132131) 28%, transparent);
          pointer-events: none;
        }

        .msg-empty-icon-wrap {
          width: 72px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: 50%;
          position: relative;
          z-index: 1;
        }

        .msg-empty-icon {
          font-size: 36px;
          line-height: 1;
        }

        .msg-empty-channel-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.2px;
          position: relative;
          z-index: 1;
        }

        .msg-empty-channel-sub {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0;
          line-height: 1.55;
          position: relative;
          z-index: 1;
        }
        .msg-empty-channel-sub strong {
          color: var(--text-secondary);
          font-weight: 600;
        }

        /* ── DM empty state ──────────────────────────────────────── */
        .msg-empty--dm {
          gap: 12px;
        }

        .msg-empty-dm-avatar {
          position: relative;
          width: 80px;
          height: 80px;
          margin-bottom: 4px;
        }

        .msg-empty-dm-ring {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2px solid transparent;
          opacity: 0.4;
        }

        .msg-empty-dm-nick {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin: 0;
          opacity: 0.85;
        }

        .msg-empty-dm-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          max-width: 300px;
          line-height: 1.5;
          margin: 0;
        }
        .msg-empty-dm-title strong { font-weight: 700; }

        .msg-empty-dm-hint {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0;
        }

        .msg-empty-dm-hello {
          margin-top: 4px;
          padding: 8px 20px;
          border-radius: var(--r-full);
          background: var(--accent);
          color: #fff;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          transition: opacity 150ms, transform 150ms;
          box-shadow: 0 2px 12px rgba(14,165,233,0.3);
        }
        .msg-empty-dm-hello:hover {
          opacity: 0.88;
          transform: translateY(-1px);
        }

        /* ── Chat history loading dots ─────────────────────────────── */
        .ml-hist-loading {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 5px;
          padding: 14px;
        }
        .ml-hist-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          opacity: 0.5;
          animation: pulse 1.3s ease-in-out infinite;
        }
        .ml-hist-dot:nth-child(2) { animation-delay: 0.22s; }
        .ml-hist-dot:nth-child(3) { animation-delay: 0.44s; }

        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }

        /* ── Beginning of conversation marker ──────────────────────── */
        .ml-hist-start {
          text-align: center;
          padding: 16px;
          color: var(--text-muted);
          font-size: 13px;
          border-top: 1px solid var(--border-subtle);
          margin-bottom: 8px;
        }
        .ml-hist-start strong {
          color: var(--text-secondary);
          font-weight: 600;
        }

        /* ── Jump to Present button ─────────────────────────────────── */
        .ml-jump-btn {
          position: sticky;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: color-mix(in srgb, var(--bg-elevated, #132131) 88%, transparent);
          color: var(--lux, #d8b96a);
          border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 34%, transparent);
          border-radius: var(--r-full);
          padding: 7px 16px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-2, 0 10px 28px rgba(0,0,0,.38));
          transition: background var(--t-control, 150ms), border-color var(--t-control, 150ms), transform var(--t-micro, 90ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          white-space: nowrap;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ml-jump-btn:hover {
          background: color-mix(in srgb, var(--bg-elevated, #132131) 78%, var(--lux, #d8b96a) 8%);
          border-color: color-mix(in srgb, var(--lux, #d8b96a) 52%, transparent);
          transform: translateX(-50%) translateY(-1px);
        }

        @keyframes ml-fadein {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .animate-ml-fadein { animation: ml-fadein 180ms var(--ease-out) both; }

        /* ── Date separator ─────────────────────────────────────── */
        .date-separator {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 20px 0 10px;
          padding: 0 16px;
        }
        .date-separator-line {
          flex: 1;
          height: 1px;
          background: var(--border-subtle, rgba(255,255,255,0.06));
        }
        .date-separator-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted, #4a6b8a);
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 2px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
        }

        /* ── Jump-to-message highlight ── */
        .msg-jump-highlight {
          animation: msg-jump-flash 2s ease-out forwards;
        }
        @keyframes msg-jump-flash {
          0%   { background: rgba(124, 90, 245, 0.3); }
          50%  { background: rgba(124, 90, 245, 0.15); }
          100% { background: transparent; }
        }

        /* ── Search highlight / dim ── */
        .msg--dimmed {
          opacity: 0.25;
          transition: opacity var(--t-fast);
        }
        .msg--highlighted {
          opacity: 1;
          transition: opacity var(--t-fast);
        }
        .msg--focused {
          background: rgba(14, 165, 233, 0.08);
          border-left: 2px solid var(--accent);
          padding-left: 6px;
          border-radius: var(--r-xs);
          margin-left: -8px;
        }

      `}</style>
    </div>
  );
}

function formatDateSeparator(date: Date): string {
  const now       = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay    = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: msgDay.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function groupMessages(messages: ChatMessage[]): ChatMessage[][] {
  if (!messages.length) return [];
  const groups: ChatMessage[][] = [];
  let current: ChatMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    const sameAuthor = curr.from === prev.from && curr.from !== '';
    const closeInTime = curr.time.getTime() - prev.time.getTime() < 300_000;
    const sameType = curr.type === prev.type;
    const sameDayCheck = sameDay(curr.time, prev.time);
    const prevIsSystemLike = prev.type !== 'msg';
    const currHasReply = !!curr.replyTo;

    if (
      sameAuthor &&
      closeInTime &&
      sameType &&
      sameDayCheck &&
      curr.type === 'msg' &&
      !prevIsSystemLike &&
      !currHasReply
    ) {
      current.push(curr);
    } else {
      groups.push(current);
      current = [curr];
    }
  }
  groups.push(current);
  return groups;
}
