'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import SlowModeBar from './SlowModeBar';
import TypingIndicator from './TypingIndicator';
import UnreadJumpBadge from './UnreadJumpBadge';
import ChannelWelcomeBanner from './ChannelWelcomeBanner';
import MessageSelectionToolbar from './MessageSelectionToolbar';
import ForumView from './ForumView';
import dynamic from 'next/dynamic';

const StreamLayout = dynamic(
  () => import('@/components/stream/StreamLayout').then(m => ({ default: m.StreamLayout })).catch(() => ({ default: () => null })),
  { ssr: false, loading: () => null },
);

/**
 * Parse a channel mode string for a slow mode / rate-limit value.
 * Common patterns:
 *   "+z 5"   → slow mode 5s  (many servers: z = throttle/slow mode)
 *   "+Y 10"  → another common slow-mode flag
 * Returns the seconds value, or null if not found.
 */
function parseSlowModeSecs(modes: string): number | null {
  if (!modes) return null;
  // Mode strings from server typically look like: "+ntmz 5" or "z 30" etc.
  // We look for a numeric argument following a letter mode flag.
  // Strategy: strip leading '+'/'-', then match any trailing numeric param.
  const match = modes.match(/\b(\d+)\s*$/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

export default function ChatArea() {
  const activeView          = useOnyxStore(s => s.activeView);
  const channels            = useOnyxStore(s => s.channels);
  const dms                 = useOnyxStore(s => s.dms);
  const client              = useOnyxStore(s => s.client);
  const channelWelcomeSeen  = useOnyxStore(s => s.channelWelcomeSeen);
  const markWelcomeSeen     = useOnyxStore(s => s.markWelcomeSeen);
  const forumChannels       = useOnyxStore(s => s.forumChannels);
  const nsfwChannels        = useOnyxStore(s => s.nsfwChannels);
  const nsfwAcknowledged    = useOnyxStore(s => s.nsfwAcknowledged);
  const acknowledgeNsfw     = useOnyxStore(s => s.acknowledgeNsfw);
  const streams             = useOnyxStore(s => s.streams);

  // Channel search state
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string>>(new Set());
  const [searchFocusedId, setSearchFocusedId] = useState<string | null>(null);

  // Unread jump badge state
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevMessagesLengthRef = useRef(0);
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  const scrollToBottom = useCallback(() => {
    scrollToBottomRef.current?.();
    setUnreadCount(0);
  }, []);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
    if (atBottom) setUnreadCount(0);
  }, []);

  // Derive current messages array from store directly so we can safely useEffect before the early return
  const currentMessages: any[] = (() => {
    if (activeView.kind === 'channel') {
      const ch = channels.get(activeView.channel.toLowerCase());
      return (ch as any)?.messages ?? [];
    } else if (activeView.kind === 'dm') {
      const dm = dms.get(activeView.nick.toLowerCase());
      return dm?.messages ?? [];
    }
    return [];
  })();

  useEffect(() => {
    const newLen = currentMessages.length;
    const prevLen = prevMessagesLengthRef.current;
    if (newLen > prevLen && !isAtBottom) {
      setUnreadCount(c => c + (newLen - prevLen));
    }
    prevMessagesLengthRef.current = newLen;
  }, [currentMessages.length, isAtBottom]);

  // Slow mode state
  const [lastSentAt, setLastSentAt] = useState<number>(0);

  const handleSearchResults = useCallback((ids: Set<string>, focusedId: string | null) => {
    setSearchMatchIds(ids);
    setSearchFocusedId(focusedId);
  }, []);

  // Drag-drop state
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Callback so MessageInput can receive a dropped file
  const [droppedFile, setDroppedFile] = useState<File | null>(null);

  const handleTypingStart = useCallback(() => {
    if (!client) return;
    const view = activeView;
    const ch = view.kind === 'channel' ? view.channel : view.kind === 'dm' ? view.nick : null;
    if (!ch) return;
    client.sendRaw('PRIVMSG', ch, '\x01TYPING 1\x01');
  }, [client, activeView]);

  const handleTypingStop = useCallback(() => {
    if (!client) return;
    const view = activeView;
    const ch = view.kind === 'channel' ? view.channel : view.kind === 'dm' ? view.nick : null;
    if (!ch) return;
    client.sendRaw('PRIVMSG', ch, '\x01TYPING 0\x01');
  }, [client, activeView]);

  let target = '';
  let title  = '';
  let topic  = '';
  let messages: any[] = [];
  let isChannel = false;
  let slowModeSecs: number | null = null;
  let memberCount = 0;

  if (activeView.kind === 'channel') {
    const ch = channels.get(activeView.channel.toLowerCase());
    target = activeView.channel;
    title  = activeView.channel;
    topic  = ch?.topic ?? '';
    messages = (ch as any)?.messages ?? [];
    isChannel = true;
    slowModeSecs = ch ? parseSlowModeSecs(ch.modes) : null;
    memberCount = ch?.users.size ?? 0;
  } else if (activeView.kind === 'dm') {
    const dm = dms.get(activeView.nick.toLowerCase());
    target = activeView.nick;
    title  = activeView.nick;
    messages = dm?.messages ?? [];
    isChannel = false;
  }

  if (!target) return null;

  // Forum channel: replace normal chat with ForumView
  if (isChannel && forumChannels.has(target.toLowerCase())) {
    return (
      <div className="chat-area">
        <ChatHeader
          title={title}
          topic={topic}
          isChannel
          onSearchResults={() => {}}
        />
        <ForumView />
      </div>
    );
  }

  // NSFW gate: show warning screen until user acknowledges
  if (isChannel && nsfwChannels.has(target.toLowerCase()) && !nsfwAcknowledged.has(target.toLowerCase())) {
    return (
      <div className="chat-area">
        <ChatHeader
          title={title}
          topic={topic}
          isChannel
          onSearchResults={() => {}}
        />
        <div className="nsfw-gate">
          <div className="nsfw-gate-icon">🔞</div>
          <h3 className="nsfw-gate-title">NSFW Channel</h3>
          <p className="nsfw-gate-desc">This channel may contain content not suitable for all audiences.</p>
          <button
            className="nsfw-gate-btn"
            onClick={() => acknowledgeNsfw(target)}
          >
            I understand, show channel
          </button>
          <style>{`
            .nsfw-gate {
              flex: 1;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 14px;
              padding: 40px 20px;
              background: var(--bg-deep);
              text-align: center;
            }
            .nsfw-gate-icon {
              font-size: 56px;
              line-height: 1;
              opacity: 0.8;
            }
            .nsfw-gate-title {
              font-size: 20px;
              font-weight: 700;
              color: var(--text-primary);
              margin: 0;
            }
            .nsfw-gate-desc {
              font-size: 14px;
              color: var(--text-muted);
              margin: 0;
              max-width: 320px;
              line-height: 1.6;
            }
            .nsfw-gate-btn {
              padding: 9px 22px;
              background: rgba(248,113,113,0.12);
              border: 1px solid rgba(248,113,113,0.35);
              border-radius: var(--r-sm);
              color: #f87171;
              font-size: 14px;
              font-weight: 600;
              font-family: inherit;
              cursor: pointer;
              transition: background var(--t-fast), border-color var(--t-fast);
              margin-top: 4px;
            }
            .nsfw-gate-btn:hover {
              background: rgba(248,113,113,0.2);
              border-color: rgba(248,113,113,0.6);
            }
          `}</style>
        </div>
      </div>
    );
  }

  const activeChannelKey = activeView.kind === 'channel' ? activeView.channel.toLowerCase() : '';
  const showWelcomeBanner = isChannel &&
    activeChannelKey !== '' &&
    !channelWelcomeSeen.has(activeChannelKey);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current += 1;
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFile(files[0]);
    }
  }, []);

  return (
    <div
      className="chat-area"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ChatHeader
        title={title}
        topic={topic}
        isChannel={isChannel}
        onSearchResults={handleSearchResults}
      />
      {showWelcomeBanner && (
        <ChannelWelcomeBanner
          channel={title}
          topic={topic}
          memberCount={memberCount}
          onDismiss={() => markWelcomeSeen(activeChannelKey)}
        />
      )}
      {/* Stream layout — shown above messages when channel is live */}
      {isChannel && activeChannelKey && streams.get(activeChannelKey)?.live && (
        <StreamLayout channel={activeView.kind === 'channel' ? activeView.channel : ''} />
      )}
      <div className="chat-msg-wrap">
        <MessageList
          messages={messages}
          ourNick={''}
          target={target}
          searchActive={searchMatchIds.size > 0}
          searchMatchIds={searchMatchIds}
          searchFocusedId={searchFocusedId}
          onAtBottomChange={handleAtBottomChange}
          scrollToBottomRef={scrollToBottomRef}
        />
        <UnreadJumpBadge count={unreadCount} onClick={scrollToBottom} />
      </div>
      {slowModeSecs !== null && slowModeSecs > 0 && (
        <SlowModeBar
          seconds={slowModeSecs}
          lastSentAt={lastSentAt || undefined}
          onCountdownEnd={() => {/* countdown reaching 0 re-enables send naturally */}}
        />
      )}
      <TypingIndicator channel={target} />
      <MessageSelectionToolbar />
      <MessageInput
        target={target}
        placeholder={`Message ${isChannel ? title : `@${title}`}`}
        droppedFile={droppedFile}
        onDroppedFileConsumed={() => setDroppedFile(null)}
        slowModeActive={
          slowModeSecs !== null &&
          slowModeSecs > 0 &&
          lastSentAt > 0 &&
          Date.now() - lastSentAt < slowModeSecs * 1000
        }
        onMessageSent={() => setLastSentAt(Date.now())}
        onTypingStart={handleTypingStart}
        onTypingStop={handleTypingStop}
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className="drag-overlay" aria-hidden>
          <div className="drag-overlay-inner">
            <span className="drag-overlay-icon">📎</span>
            <span className="drag-overlay-text">Drop files to share</span>
          </div>
        </div>
      )}

      <style>{`
        .chat-area {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          position: relative;
        }

        .chat-msg-wrap {
          position: relative;
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .drag-overlay {
          position: absolute;
          inset: 0;
          z-index: 100;
          background: rgba(14, 165, 233, 0.08);
          border: 2px dashed var(--accent);
          border-radius: var(--r-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }

        .drag-overlay-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        .drag-overlay-icon {
          font-size: 40px;
          line-height: 1;
          filter: drop-shadow(0 0 12px rgba(14, 165, 233, 0.5));
        }

        .drag-overlay-text {
          font-size: 18px;
          font-weight: 700;
          color: var(--accent);
          letter-spacing: 0.02em;
          text-shadow: 0 0 20px rgba(14, 165, 233, 0.4);
        }
      `}</style>
    </div>
  );
}
