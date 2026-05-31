'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import Tooltip from '@/components/ui/Tooltip';
import ChannelSearchBar from './ChannelSearchBar';
import DMSearchBar from './DMSearchBar';
import DateJumpPicker from './DateJumpPicker';
import UserStatusBadge from '@/components/ui/UserStatusBadge';
import ActivityHeatmap from './ActivityHeatmap';
import LadonStatusBadge from '@/components/ui/LadonStatusBadge';

interface Props {
  title: string;
  topic?: string;
  isChannel: boolean;
  onSearchResults?(matchIds: Set<string>, focusedId: string | null): void;
}

const TOPIC_MAX = 512;
const TOPIC_TRUNCATE = 100;

const MODE_LABELS: Record<string, { label: string; title: string; variant?: 'ladon' }> = {
  // Standard IRC modes
  'n': { label: 'No External', title: 'No messages from outside the channel' },
  't': { label: 'Topic Lock',  title: 'Only ops can change the topic' },
  'm': { label: 'Moderated',   title: 'Only voiced users can speak' },
  'i': { label: 'Invite Only', title: 'Users must be invited to join' },
  's': { label: 'Secret',      title: 'Channel is hidden from LIST' },
  'p': { label: 'Private',     title: 'Channel is private' },
  'k': { label: 'Key',         title: 'Channel requires a password' },
  'l': { label: 'Limit',       title: 'Member limit is set' },
  'r': { label: 'Registered',  title: 'Only registered users can join' },
  'S': { label: 'Secure',      title: 'TLS/secure connections only' },
  'c': { label: 'No Color',    title: 'Color codes stripped' },
  'C': { label: 'No CTCP',     title: 'CTCP messages blocked' },
  // LADON media modes
  'B': { label: 'Bitrate Cap', title: 'LADON: media bitrate cap is active', variant: 'ladon' },
  'G': { label: 'Media Mod',   title: 'LADON: only approved speakers may send voice/video', variant: 'ladon' },
  'R': { label: 'Record',      title: 'LADON: recording-consent mode — participants must acknowledge', variant: 'ladon' },
  'V': { label: 'Voice Slots', title: 'LADON: voice slot limit is active', variant: 'ladon' },
  'W': { label: 'Video Slots', title: 'LADON: video slot limit is active', variant: 'ladon' },
};

const MODE_BADGE_MAX = 4;

export default function ChatHeader({ title, topic, isChannel, onSearchResults }: Props) {
  const [showSearch, setShowSearch] = useState(false);
  const [showDMSearch, setShowDMSearch] = useState(false);
  const [topicEditing, setTopicEditing] = useState(false);
  const [topicDraft, setTopicDraft] = useState(topic || '');
  const [topicExpanded, setTopicExpanded] = useState(false);
  const [showTopicHistory, setShowTopicHistory] = useState(false);
  const [showThreadList, setShowThreadList] = useState(false);
  const [showChannelTools, setShowChannelTools] = useState(false);
  // Track whether Enter was pressed so blur doesn't cancel the save
  const enterPressedRef = useRef(false);
  const topicHistoryRef = useRef<HTMLDivElement>(null);
  const threadListRef = useRef<HTMLDivElement>(null);
  const channelToolsRef = useRef<HTMLDivElement>(null);

  const topicHistory       = useOnyxStore(s => s.topicHistory);
  const addTopicHistory    = useOnyxStore(s => s.addTopicHistory);

  const toggleMemberList   = useOnyxStore(s => s.toggleMemberList);
  const showMemberList     = useOnyxStore(s => s.showMemberList);
  const openMobileSidebar  = useOnyxStore(s => s.openMobileSidebar);
  const isAway             = useOnyxStore(s => s.isAway);
  const channels         = useOnyxStore(s => s.channels);
  const activeView       = useOnyxStore(s => s.activeView);
  const partChannel      = useOnyxStore(s => s.partChannel);
  const client           = useOnyxStore(s => s.client);
  const ourNick          = useOnyxStore(s => s.ourNick);

  const channel = activeView.kind === 'channel'
    ? channels.get(activeView.channel.toLowerCase())
    : null;

  const memberCount = channel?.users.size ?? 0;

  // ── Permission check ────────────────────────────────────────────────────────
  const myModes      = channel?.users.get(ourNick.toLowerCase())?.modes ?? new Set<string>();
  const channelModes = channel?.modes ?? '';
  const canEditTopic = isChannel && (
    myModes.has('o') || myModes.has('a') || myModes.has('q') || !channelModes.includes('t')
  );

  const openEventLog          = useOnyxStore(s => s.openEventLog);
  const showEventLog          = useOnyxStore(s => s.showEventLog);
  const openMessageSearch     = useOnyxStore(s => s.openMessageSearch);
  const openInviteModal       = useOnyxStore(s => s.openInviteModal);
  const openChannelInfo       = useOnyxStore(s => s.openChannelInfo);
  const openAccessList        = useOnyxStore(s => s.openAccessList);
  const openModerationPanel   = useOnyxStore(s => s.openModerationPanel);
  const showModerationPanel   = useOnyxStore(s => s.showModerationPanel);
  const openPinnedMessages = useOnyxStore(s => s.openPinnedMessages);
  const pinnedMessages     = useOnyxStore(s => s.pinnedMessages);
  const requestHistory     = useOnyxStore(s => s.requestHistory);
  const openBookmarks      = useOnyxStore(s => s.openBookmarks);
  const bookmarks          = useOnyxStore(s => s.bookmarks);
  const openMediaGallery   = useOnyxStore(s => s.openMediaGallery);
  const showMediaGallery   = useOnyxStore(s => s.showMediaGallery);
  const archivedThreads    = useOnyxStore(s => s.archivedThreads);
  const activeThreads      = useOnyxStore(s => s.activeThreads);
  const openThread         = useOnyxStore(s => s.openThread);

  // DM-specific
  const openDMPins         = useOnyxStore(s => s.openDMPins);
  const dmPinnedMessages   = useOnyxStore(s => s.dmPinnedMessages);
  const friends            = useOnyxStore(s => s.friends);
  const dms                = useOnyxStore(s => s.dms);
  const openUserProfileCard = useOnyxStore(s => s.openUserProfileCard);
  const userProps          = useOnyxStore(s => s.userProps);
  const openExportModal    = useOnyxStore(s => s.openExportModal);
  const openWhiteboard     = useOnyxStore(s => s.openWhiteboard);
  const showWhiteboard     = useOnyxStore(s => s.showWhiteboard);
  const closeWhiteboard    = useOnyxStore(s => s.closeWhiteboard);
  const openGoLiveModal    = useOnyxStore(s => s.openGoLiveModal);
  const endStream          = useOnyxStore(s => s.endStream);
  const streams            = useOnyxStore(s => s.streams);
  const showSpatialPad      = useOnyxStore(s => s.showSpatialPad);
  const openSpatialPad      = useOnyxStore(s => s.openSpatialPad);
  const closeSpatialPad     = useOnyxStore(s => s.closeSpatialPad);
  const showBreakoutSidebar  = useOnyxStore(s => s.showBreakoutSidebar);
  const openBreakoutSidebar  = useOnyxStore(s => s.openBreakoutSidebar);
  const closeBreakoutSidebar = useOnyxStore(s => s.closeBreakoutSidebar);
  const muteDM             = useOnyxStore(s => s.muteDM);
  const unmuteDM           = useOnyxStore(s => s.unmuteDM);
  const isDMMuted          = useOnyxStore(s => s.isDMMuted);
  const openDMMedia        = useOnyxStore(s => s.openDMMedia);
  const voice              = useOnyxStore(s => s.voice);
  const startDmCall        = useOnyxStore(s => s.startDmCall);

  const pinnedCount = activeView.kind === 'channel'
    ? (pinnedMessages.get(activeView.channel.toLowerCase()) ?? []).length
    : 0;

  // ── Thread list computed values ────────────────────────────────────────────
  const channelMessages = useMemo(
    () => activeView.kind === 'channel'
      ? (channels.get(activeView.channel.toLowerCase())?.messages ?? [])
      : [],
    [activeView, channels],
  );

  // Messages that have at least one reply
  const threadParentMessages = useMemo(() => {
    const replyParentIds = new Set<string>();
    for (const msg of channelMessages) {
      if (msg.replyTo?.id) replyParentIds.add(msg.replyTo.id);
    }
    return channelMessages.filter(m => replyParentIds.has(m.id));
  }, [channelMessages]);

  // Compute last reply time for each parent
  const threadLastReplyMap = useMemo(() => {
    const map = new Map<string, Date>();
    for (const msg of channelMessages) {
      if (msg.replyTo?.id) {
        const prev = map.get(msg.replyTo.id);
        if (!prev || msg.time > prev) map.set(msg.replyTo.id, msg.time);
      }
    }
    return map;
  }, [channelMessages]);

  const threadReplyCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const msg of channelMessages) {
      if (msg.replyTo?.id) {
        map.set(msg.replyTo.id, (map.get(msg.replyTo.id) ?? 0) + 1);
      }
    }
    return map;
  }, [channelMessages]);

  const [threadListArchiveExpanded, setThreadListArchiveExpanded] = useState(false);

  // ── DM header computed values ──────────────────────────────────────────────
  const dmNick = activeView.kind === 'dm' ? activeView.nick : '';

  const dmPinCount = activeView.kind === 'dm'
    ? (dmPinnedMessages.get(dmNick.toLowerCase()) ?? []).length
    : 0;

  const isDMOnline = useMemo(() => {
    if (!dmNick) return false;
    const friend = friends.get(dmNick.toLowerCase());
    if (friend?.online) return true;
    for (const ch of channels.values()) {
      if (ch.users.has(dmNick.toLowerCase())) return true;
    }
    return false;
  }, [dmNick, friends, channels]);

  const dmStatusText = useMemo(() => {
    if (!dmNick) return '';
    const props = userProps.get(dmNick.toLowerCase());
    if (props?.['AWAYTEXT'] || props?.['AWAYMSG']) return props['AWAYTEXT'] ?? props['AWAYMSG'] ?? '';
    const dm = dms.get(dmNick.toLowerCase());
    if (dm?.away) return 'Away';
    return '';
  }, [dmNick, userProps, dms]);

  const dmMuted = useMemo(() => dmNick ? isDMMuted(dmNick) : false, [dmNick, isDMMuted]);

  const dmProfileAnchorRef = useRef<HTMLButtonElement>(null);

  const loadHistory = () => {
    if (activeView.kind === 'channel') {
      requestHistory(activeView.channel, 100);
    }
  };

  const handleDateJump = useCallback((date: Date) => {
    if (activeView.kind !== 'channel' || !client) return;
    // Use CHATHISTORY BEFORE with an ISO timestamp to jump to that date
    const ts = `timestamp=${date.toISOString()}`;
    client.sendRaw('CHATHISTORY', 'BEFORE', activeView.channel, ts, '50');
  }, [activeView, client]);

  const handleTopicClick = () => {
    if (canEditTopic && activeView.kind === 'channel') {
      enterPressedRef.current = false;
      setTopicDraft(topic || '');
      setTopicEditing(true);
    }
  };

  const handleTopicSave = () => {
    if (activeView.kind === 'channel' && client) {
      client.sendRaw('TOPIC', activeView.channel, topicDraft);
      if (topicDraft) addTopicHistory(activeView.channel, topicDraft);
    }
    setTopicEditing(false);
  };

  const handleTopicCancel = () => {
    setTopicDraft(topic || '');
    setTopicEditing(false);
  };

  const handleTopicKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enterPressedRef.current = true;
      handleTopicSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleTopicCancel();
    }
  };

  const handleTopicBlur = () => {
    // Only cancel on blur — Enter already saved via handleTopicSave
    if (!enterPressedRef.current) {
      handleTopicCancel();
    }
    enterPressedRef.current = false;
  };

  // Collapse expanded topic when switching channels
  useEffect(() => {
    queueMicrotask(() => {
      setTopicExpanded(false);
      setTopicEditing(false);
      setShowDMSearch(false);
      setShowTopicHistory(false);
      setShowChannelTools(false);
    });
  }, [activeView]);

  // Close topic history on outside click
  useEffect(() => {
    if (!showTopicHistory) return;
    const handler = (e: MouseEvent) => {
      if (topicHistoryRef.current && !topicHistoryRef.current.contains(e.target as Node)) {
        setShowTopicHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTopicHistory]);

  // Close thread list on outside click
  useEffect(() => {
    if (!showThreadList) return;
    const handler = (e: MouseEvent) => {
      if (threadListRef.current && !threadListRef.current.contains(e.target as Node)) {
        setShowThreadList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showThreadList]);

  // Close channel tools on outside click
  useEffect(() => {
    if (!showChannelTools) return;
    const handler = (e: MouseEvent) => {
      if (channelToolsRef.current && !channelToolsRef.current.contains(e.target as Node)) {
        setShowChannelTools(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChannelTools]);

  // Listen for the ocean:channel-search custom event (fired by Ctrl+F shortcut)
  useEffect(() => {
    const handler = () => setShowSearch(true);
    document.addEventListener('ocean:channel-search', handler);
    return () => document.removeEventListener('ocean:channel-search', handler);
  }, []);

  // When search closes, clear results
  const handleSearchClose = useCallback(() => {
    setShowSearch(false);
    onSearchResults?.(new Set(), null);
  }, [onSearchResults]);

  // ── Topic display helpers ────────────────────────────────────────────────────
  const effectiveTopic = topic || '';
  const isLong = effectiveTopic.length > TOPIC_TRUNCATE;
  const displayTopic = (!topicExpanded && isLong)
    ? effectiveTopic.slice(0, TOPIC_TRUNCATE)
    : effectiveTopic;

  const charCount = topicDraft.length;

  const activeChannel = activeView.kind === 'channel' ? activeView.channel.toLowerCase() : '';
  const channelTopicHistory = topicHistory[activeChannel] ?? [];

  return (
    <div className="ch-head-wrap">
    <header className="ch-head">
      <div className="ch-head-left">
        <button
          className="ch-head-mobile-menu"
          onClick={openMobileSidebar}
          aria-label="Open sidebar"
        >
          <ChatHeaderHamburgerIcon />
        </button>
        <span className="ch-head-sigil">{isChannel ? '#' : '@'}</span>

        {!isChannel && activeView.kind === 'dm' ? (
          <div className="ch-head-dm-identity">
            <div className="ch-head-dm-nick-row">
              <span
                className={`ch-head-dm-status-dot ${isDMOnline ? 'ch-head-dm-status-dot--online' : ''}`}
                aria-label={isDMOnline ? 'Online' : 'Offline'}
                title={isDMOnline ? 'Online' : 'Offline'}
              />
              <h2 className="ch-head-title">{title.replace(/^[#&@]/, '')}</h2>
            </div>
            {dmStatusText && (
              <p className="ch-head-dm-status-text" title={dmStatusText}>
                {dmStatusText}
              </p>
            )}
          </div>
        ) : (
          <h2 className="ch-head-title">{title.replace(/^[#&@]/, '')}</h2>
        )}

        {isChannel && (
          <>
            <LadonStatusBadge />
            <div className="ch-head-divider" />
            {topicEditing ? (
              <div className="ch-head-topic-edit-wrap">
                <input
                  className="ch-head-topic-input"
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onBlur={handleTopicBlur}
                  onKeyDown={handleTopicKeyDown}
                  maxLength={TOPIC_MAX}
                  autoFocus
                  placeholder="Enter channel topic..."
                  aria-label="Edit channel topic"
                />
                <span className="ch-head-topic-counter">
                  {charCount} / {TOPIC_MAX}
                </span>
              </div>
            ) : (
              <div
                className={`ch-head-topic-area${canEditTopic ? ' ch-head-topic-area--editable' : ''}`}
                onClick={handleTopicClick}
                role={canEditTopic ? 'button' : undefined}
                tabIndex={canEditTopic ? 0 : undefined}
                onKeyDown={canEditTopic ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleTopicClick(); } : undefined}
                aria-label={canEditTopic ? 'Click to edit topic' : undefined}
              >
                {effectiveTopic ? (
                  <>
                    <p className="ch-head-topic" title={effectiveTopic}>
                      {displayTopic}
                      {isLong && !topicExpanded && <span className="ch-head-topic-ellipsis">…</span>}
                    </p>
                    {isLong && (
                      <button
                        className="ch-head-topic-readmore"
                        onClick={(e) => { e.stopPropagation(); setTopicExpanded(v => !v); }}
                        tabIndex={0}
                        type="button"
                      >
                        {topicExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </>
                ) : canEditTopic ? (
                  <p className="ch-head-topic ch-head-topic--empty">Click to set a topic...</p>
                ) : null}
                {canEditTopic && (
                  <span className="ch-head-topic-pencil" aria-hidden="true">✏</span>
                )}
              </div>
            )}
            {/* Topic history button */}
            {isChannel && channelTopicHistory.length > 0 && (
              <div className="ch-topic-hist-wrap" ref={topicHistoryRef}>
                <Tooltip text="Topic history" side="bottom">
                  <button
                    className={`ch-topic-hist-btn${showTopicHistory ? ' ch-topic-hist-btn--active' : ''}`}
                    aria-label="Topic history"
                    aria-expanded={showTopicHistory}
                    onClick={(e) => { e.stopPropagation(); setShowTopicHistory(v => !v); }}
                    type="button"
                  >
                    🕐
                  </button>
                </Tooltip>
                {showTopicHistory && (
                  <div className="ch-topic-hist-dropdown" role="listbox" aria-label="Topic history">
                    <div className="ch-topic-hist-header">Topic history</div>
                    {channelTopicHistory.map((t, i) => (
                      <button
                        key={i}
                        className="ch-topic-hist-item"
                        role="option"
                        aria-selected="false"
                        onClick={() => {
                          if (canEditTopic && activeView.kind === 'channel' && client) {
                            client.sendRaw('TOPIC', activeView.channel, t);
                          }
                          setShowTopicHistory(false);
                        }}
                        type="button"
                        title={t}
                      >
                        {t.length > 80 ? t.slice(0, 80) + '…' : t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Mode badges ──────────────────────────────────────────────── */}
      {isChannel && (() => {
        const modesStr = channels.get(
          activeView.kind === 'channel' ? activeView.channel.toLowerCase() : ''
        )?.modes ?? '';
        const activeModes = [...modesStr].filter(c => MODE_LABELS[c]);
        if (activeModes.length === 0) return null;
        const visible = activeModes.slice(0, MODE_BADGE_MAX);
        const overflow = activeModes.slice(MODE_BADGE_MAX);
        return (
          <div className="ch-mode-badges">
            {visible.map(m => (
              <span
                className={`ch-mode-badge${MODE_LABELS[m].variant === 'ladon' ? ' ch-mode-badge--ladon' : ''}`}
                title={MODE_LABELS[m].title}
                key={m}
              >
                {MODE_LABELS[m].label}
              </span>
            ))}
            {overflow.length > 0 && (
              <span
                className="ch-mode-badge ch-mode-badge--more"
                title={overflow.map(m => MODE_LABELS[m].label).join(', ')}
              >
                +{overflow.length} more
              </span>
            )}
          </div>
        );
      })()}

      <div className="ch-head-actions">
        {isAway && (
          <Tooltip text="You are away — click to change status" side="bottom">
            <span className="ch-head-away-badge" aria-label="Away">
              <UserStatusBadge />
            </span>
          </Tooltip>
        )}

        {/* ── DM action buttons ─────────────────────────────────────── */}
        {!isChannel && activeView.kind === 'dm' && (
          <>
            {voice.callState === 'idle' && (
              <div className="ch-head-action-group ch-head-action-group--calls" aria-label="Call controls">
                <Tooltip text="Voice Call" side="bottom">
                  <button
                    className="ch-head-btn ch-head-btn--call"
                    onClick={() => startDmCall?.(activeView.nick, false)}
                    aria-label="Start voice call"
                  >
                    <PhoneCallIcon />
                  </button>
                </Tooltip>
                <Tooltip text="Video Call" side="bottom">
                  <button
                    className="ch-head-btn ch-head-btn--call"
                    onClick={() => startDmCall?.(activeView.nick, true)}
                    aria-label="Start video call"
                  >
                    <VideoCallIcon />
                  </button>
                </Tooltip>
              </div>
            )}

            <div className="ch-head-action-group ch-head-action-group--messages" aria-label="Direct message tools">
              <Tooltip text={dmPinCount > 0 ? `Pinned Messages (${dmPinCount})` : 'Pinned Messages'} side="bottom">
                <button
                  className={`ch-head-btn ch-head-btn--pin ${dmPinCount > 0 ? 'ch-head-btn--pin-active' : ''}`}
                  aria-label="Pinned messages in DM"
                  onClick={() => openDMPins(dmNick)}
                >
                  <PinIcon />
                  {dmPinCount > 0 && (
                    <span className="ch-head-pin-badge">{dmPinCount > 9 ? '9+' : dmPinCount}</span>
                  )}
                </button>
              </Tooltip>

              <Tooltip text={dmMuted ? 'Unmute DM' : 'Mute DM'} side="bottom">
                <button
                  className={`ch-head-btn ${dmMuted ? 'ch-head-btn--active' : ''}`}
                  aria-label={dmMuted ? 'Unmute DM' : 'Mute DM'}
                  aria-pressed={dmMuted}
                  onClick={() => dmMuted ? unmuteDM(dmNick) : muteDM(dmNick)}
                >
                  {dmMuted ? <MuteOnIcon /> : <MuteOffIcon />}
                </button>
              </Tooltip>

              <Tooltip text="Search Messages" side="bottom">
                <button
                  className={`ch-head-btn ${showDMSearch ? 'ch-head-btn--active' : ''}`}
                  aria-label="Search DM messages"
                  aria-pressed={showDMSearch}
                  onClick={() => setShowDMSearch(v => !v)}
                >
                  <SearchIcon />
                </button>
              </Tooltip>

              <Tooltip text="Media &amp; Files" side="bottom">
                <button
                  className="ch-head-btn"
                  aria-label="DM media gallery"
                  onClick={openDMMedia}
                >
                  <MediaIcon />
                </button>
              </Tooltip>
            </div>

            <div className="ch-head-action-group ch-head-action-group--tools" aria-label="Profile tools">
              <Tooltip text="View Profile" side="bottom">
                <button
                  ref={dmProfileAnchorRef}
                  className="ch-head-btn"
                  aria-label="View user profile"
                  onClick={() => {
                    if (dmProfileAnchorRef.current) {
                      const rect = dmProfileAnchorRef.current.getBoundingClientRect();
                      openUserProfileCard(dmNick, { x: rect.left, y: rect.bottom + 4 });
                    }
                  }}
                >
                  <ProfileIcon />
                </button>
              </Tooltip>
            </div>
          </>
        )}

        {isChannel && (
          <>
            <div className="ch-head-action-group ch-head-action-group--status" aria-label="Channel status">
            {/* ── Member count chip — click to open member list ─────────── */}
            <Tooltip text={showMemberList ? 'Close member list' : 'Open member list'} side="bottom">
              <button
                className={`ch-head-member-chip${showMemberList ? ' ch-head-member-chip--active' : ''}`}
                aria-label={`${memberCount} members — click to ${showMemberList ? 'close' : 'open'} member list`}
                aria-pressed={showMemberList}
                onClick={toggleMemberList}
              >
                <MembersIcon />
                <span>{memberCount}</span>
              </button>
            </Tooltip>

            {/* ── Notification level bell ───────────────────────────────── */}
            {activeView.kind === 'channel' && (
              <NotifyLevelButton channel={activeView.channel} />
            )}
            </div>

            <div className="ch-head-action-group ch-head-action-group--messages" aria-label="Message tools">
              <Tooltip text="Search (Ctrl+F)" side="bottom">
                <button
                  className={`ch-head-btn ${showSearch ? 'ch-head-btn--active' : ''}`}
                  aria-label="Search messages"
                  onClick={() => {
                    if (showSearch) {
                      handleSearchClose();
                    } else {
                      setShowSearch(true);
                    }
                  }}
                >
                  <SearchIcon />
                </button>
              </Tooltip>

              {threadParentMessages.length > 0 && (
                <div className="ch-thread-list-wrap" ref={threadListRef}>
                  <Tooltip text={`Threads (${threadParentMessages.length})`} side="bottom">
                    <button
                      className={`ch-head-btn ch-thread-list-btn${showThreadList ? ' ch-head-btn--active' : ''}`}
                      aria-label="View threads"
                      aria-expanded={showThreadList}
                      onClick={() => setShowThreadList(v => !v)}
                      type="button"
                    >
                      <ThreadsIcon />
                    </button>
                  </Tooltip>
                  {showThreadList && (
                    <div className="ch-thread-list-dropdown" role="dialog" aria-label="Channel threads">
                      <div className="ch-thread-list-header">Threads</div>

                      {/* Active threads */}
                      {threadParentMessages
                        .filter(m => !archivedThreads.has(m.id))
                        .map(m => {
                          const count = threadReplyCountMap.get(m.id) ?? 0;
                          const lastTime = threadLastReplyMap.get(m.id);
                          const isActive = activeThreads.has(m.id);
                          return (
                            <button
                              key={m.id}
                              className="ch-thread-list-item"
                              onClick={() => { openThread(m.id); setShowThreadList(false); }}
                              type="button"
                            >
                              <div className="ch-thread-item-text">
                                {m.deleted ? '(deleted)' : m.text.slice(0, 72) + (m.text.length > 72 ? '…' : '')}
                              </div>
                              <div className="ch-thread-item-meta">
                                <span className="ch-thread-item-count">{count} {count === 1 ? 'reply' : 'replies'}</span>
                                {lastTime && (
                                  <span className="ch-thread-item-time">
                                    {lastTime.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                                {isActive && <span className="ch-thread-item-active-dot" aria-label="Active" />}
                              </div>
                            </button>
                          );
                        })
                      }

                      {/* Archived section */}
                      {threadParentMessages.some(m => archivedThreads.has(m.id)) && (
                        <>
                          <button
                            className="ch-thread-list-section-toggle"
                            onClick={() => setThreadListArchiveExpanded(v => !v)}
                            type="button"
                            aria-expanded={threadListArchiveExpanded}
                          >
                            <span>{threadListArchiveExpanded ? '▾' : '▸'}</span>
                            <span>Archived</span>
                          </button>
                          {threadListArchiveExpanded && threadParentMessages
                            .filter(m => archivedThreads.has(m.id))
                            .map(m => {
                              const count = threadReplyCountMap.get(m.id) ?? 0;
                              const lastTime = threadLastReplyMap.get(m.id);
                              return (
                                <button
                                  key={m.id}
                                  className="ch-thread-list-item ch-thread-list-item--archived"
                                  onClick={() => { openThread(m.id); setShowThreadList(false); }}
                                  type="button"
                                >
                                  <div className="ch-thread-item-text">
                                    <span className="ch-thread-item-lock">🔒</span>
                                    {m.deleted ? '(deleted)' : m.text.slice(0, 68) + (m.text.length > 68 ? '…' : '')}
                                  </div>
                                  <div className="ch-thread-item-meta">
                                    <span className="ch-thread-item-count">{count} {count === 1 ? 'reply' : 'replies'}</span>
                                    {lastTime && (
                                      <span className="ch-thread-item-time">
                                        {lastTime.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })
                          }
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Tooltip text={pinnedCount > 0 ? `Pinned Messages (${pinnedCount})` : 'Pinned Messages'} side="bottom">
                <button
                  className={`ch-head-btn ch-head-btn--pin ${pinnedCount > 0 ? 'ch-head-btn--pin-active' : ''}`}
                  aria-label="Pinned messages"
                  onClick={openPinnedMessages}
                >
                  <PinIcon />
                  {pinnedCount > 0 && (
                    <span className="ch-head-pin-badge">{pinnedCount > 9 ? '9+' : pinnedCount}</span>
                  )}
                </button>
              </Tooltip>

              <Tooltip text="Jump to Date" side="bottom">
                <DateJumpPicker onJump={handleDateJump} />
              </Tooltip>
            </div>

            <div className="ch-head-tools-wrap" ref={channelToolsRef}>
              <Tooltip text="Channel tools" side="bottom">
                <button
                  className={`ch-head-btn ch-head-btn--tools ${showChannelTools ? 'ch-head-btn--active' : ''}`}
                  aria-label="Open channel tools"
                  aria-expanded={showChannelTools}
                  onClick={() => setShowChannelTools(v => !v)}
                  type="button"
                >
                  <MoreIcon />
                </button>
              </Tooltip>

              {showChannelTools && (
                <div className="ch-tools-menu" role="menu" aria-label="Channel tools">
                  <div className="ch-tools-section-label">Channel</div>
                  <button
                    className="ch-tools-item"
                    role="menuitem"
                    onClick={() => { openInviteModal(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <InviteIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Invite people</span>
                      <span className="ch-tools-desc">Bring someone into this channel</span>
                    </span>
                  </button>
                  <button
                    className="ch-tools-item"
                    role="menuitem"
                    onClick={() => {
                      if (activeView.kind === 'channel') openChannelInfo(activeView.channel);
                      setShowChannelTools(false);
                    }}
                    type="button"
                  >
                    <InfoIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Channel info</span>
                      <span className="ch-tools-desc">Topic, modes, and details</span>
                    </span>
                  </button>
                  <button
                    className="ch-tools-item"
                    role="menuitem"
                    onClick={() => { openAccessList(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <AccessIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Access list</span>
                      <span className="ch-tools-desc">Review channel permissions</span>
                    </span>
                  </button>
                  {(myModes.has('o') || myModes.has('a') || myModes.has('q')) && (
                    <button
                      className={`ch-tools-item ${showModerationPanel ? 'ch-tools-item--active' : ''}`}
                      role="menuitem"
                      onClick={() => { openModerationPanel(); setShowChannelTools(false); }}
                      type="button"
                    >
                      <ShieldHeaderIcon />
                      <span className="ch-tools-copy">
                        <span className="ch-tools-title">Moderation</span>
                        <span className="ch-tools-desc">Manage channel controls</span>
                      </span>
                    </button>
                  )}

                  <div className="ch-tools-section-label">Messages</div>
                  <button
                    className="ch-tools-item"
                    role="menuitem"
                    onClick={() => { loadHistory(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <HistoryIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Load history</span>
                      <span className="ch-tools-desc">Fetch more recent context</span>
                    </span>
                  </button>
                  <button
                    className="ch-tools-item"
                    role="menuitem"
                    onClick={() => { openMessageSearch(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <SearchMessagesIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Advanced search</span>
                      <span className="ch-tools-desc">Search across message history</span>
                    </span>
                  </button>
                  <button
                    className={`ch-tools-item ${showEventLog ? 'ch-tools-item--active' : ''}`}
                    role="menuitem"
                    onClick={() => { openEventLog(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <EventLogIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Event log</span>
                      <span className="ch-tools-desc">Joins, parts, modes, and notices</span>
                    </span>
                  </button>
                  <button
                    className={`ch-tools-item ${bookmarks.length > 0 ? 'ch-tools-item--active' : ''}`}
                    role="menuitem"
                    onClick={() => { openBookmarks(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <BookmarkHeaderIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Bookmarks</span>
                      <span className="ch-tools-desc">{bookmarks.length > 0 ? `${bookmarks.length} saved` : 'Saved messages and places'}</span>
                    </span>
                  </button>

                  <div className="ch-tools-section-label">Media</div>
                  <button
                    className={`ch-tools-item ${showMediaGallery ? 'ch-tools-item--active' : ''}`}
                    role="menuitem"
                    onClick={() => { openMediaGallery(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <MediaIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Media gallery</span>
                      <span className="ch-tools-desc">Images, files, and embeds</span>
                    </span>
                  </button>
                  <button
                    className="ch-tools-item"
                    role="menuitem"
                    onClick={() => { openExportModal(); setShowChannelTools(false); }}
                    type="button"
                  >
                    <ExportIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Export chat</span>
                      <span className="ch-tools-desc">Download channel history</span>
                    </span>
                  </button>
                  {(() => {
                    const chanKey = activeView.kind === 'channel' ? activeView.channel.toLowerCase() : '';
                    const liveStream = chanKey ? streams.get(chanKey) : undefined;
                    return (
                      <button
                        className={`ch-tools-item ${liveStream?.live ? 'ch-tools-item--active' : ''}`}
                        role="menuitem"
                        onClick={() => {
                          if (activeView.kind === 'channel') {
                            if (liveStream?.live) endStream(activeView.channel);
                            else openGoLiveModal(activeView.channel);
                          }
                          setShowChannelTools(false);
                        }}
                        type="button"
                      >
                        {liveStream?.live ? <StopStreamIcon /> : <GoLiveIcon />}
                        <span className="ch-tools-copy">
                          <span className="ch-tools-title">{liveStream?.live ? 'End stream' : 'Go live'}</span>
                          <span className="ch-tools-desc">{liveStream?.live ? 'Stop the current stream' : 'Start a live session'}</span>
                        </span>
                      </button>
                    );
                  })()}
                  <button
                    className={`ch-tools-item ${showWhiteboard ? 'ch-tools-item--active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      if (showWhiteboard) closeWhiteboard();
                      else openWhiteboard();
                      setShowChannelTools(false);
                    }}
                    type="button"
                  >
                    <WhiteboardIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Whiteboard</span>
                      <span className="ch-tools-desc">Shared drawing space</span>
                    </span>
                  </button>
                  <button
                    className={`ch-tools-item ${showSpatialPad ? 'ch-tools-item--active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      if (showSpatialPad) closeSpatialPad();
                      else openSpatialPad();
                      setShowChannelTools(false);
                    }}
                    type="button"
                  >
                    <SpatialIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Spatial audio</span>
                      <span className="ch-tools-desc">Open the channel audio pad</span>
                    </span>
                  </button>
                  <button
                    className={`ch-tools-item ${showBreakoutSidebar ? 'ch-tools-item--active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      if (showBreakoutSidebar) closeBreakoutSidebar();
                      else openBreakoutSidebar();
                      setShowChannelTools(false);
                    }}
                    type="button"
                  >
                    <BreakoutIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Breakout rooms</span>
                      <span className="ch-tools-desc">Create smaller side rooms</span>
                    </span>
                  </button>

                  {channel && channel.messages.length > 0 && (
                    <div className="ch-tools-activity" aria-label="Message activity heatmap">
                      <span className="ch-tools-title">Activity</span>
                      <ActivityHeatmap messages={channel.messages} />
                    </div>
                  )}

                  <div className="ch-tools-divider" />
                  <button
                    className="ch-tools-item ch-tools-item--danger"
                    role="menuitem"
                    onClick={() => {
                      partChannel(activeView.kind === 'channel' ? activeView.channel : '');
                      setShowChannelTools(false);
                    }}
                    type="button"
                  >
                    <LeaveIcon />
                    <span className="ch-tools-copy">
                      <span className="ch-tools-title">Leave channel</span>
                      <span className="ch-tools-desc">Remove it from your channel list</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>

    {/* Channel search bar (slides in below header) */}
    {showSearch && (
      <ChannelSearchBar
        onClose={handleSearchClose}
        onResults={(ids, focusedId) => onSearchResults?.(ids, focusedId)}
      />
    )}

    {/* DM search bar (slides in below header for DM conversations) */}
    {showDMSearch && activeView.kind === 'dm' && (
      <DMSearchBar
        nick={activeView.nick}
        onClose={() => setShowDMSearch(false)}
      />
    )}

    <style>{`
        .ch-head-wrap {
          position: relative;
          flex-shrink: 0;
        }

        /* Mobile hamburger — hidden on desktop */
        .ch-head-mobile-menu {
          display: none;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .ch-head-mobile-menu:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }
        @media (max-width: 768px) {
          .ch-head-mobile-menu { display: flex; }
        }
        .ch-head {
          height: var(--header-h);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px;
          border-bottom: 1px solid var(--border-normal);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0)),
            color-mix(in srgb, var(--bg-base) 94%, var(--accent) 6%);
          flex-shrink: 0;
          gap: 10px;
          box-shadow: 0 1px 0 rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.18);
          min-width: 0;
          box-sizing: border-box;
        }

        .ch-head-left {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
          flex: 1;
          min-width: 0;
        }

        .ch-head-sigil {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-muted);
          flex-shrink: 0;
          line-height: 1;
          opacity: 0.65;
          letter-spacing: -0.01em;
        }

        .ch-head-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 0;
          max-width: min(240px, 28vw);
          letter-spacing: -0.01em;
          line-height: 1.25;
        }

        .ch-head-divider {
          width: 1px;
          height: 16px;
          background: var(--border-normal);
          flex-shrink: 0;
          opacity: 0.7;
          margin: 0 2px;
        }

        /* ── DM identity block ── */
        .ch-head-dm-identity {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
          flex-shrink: 1;
        }
        .ch-head-dm-nick-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ch-head-dm-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-muted);
          flex-shrink: 0;
          transition: background var(--t-fast);
        }
        .ch-head-dm-status-dot--online {
          background: #3ba55d;
          box-shadow: 0 0 0 2px rgba(59, 165, 93, 0.25);
        }
        .ch-head-dm-status-text {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0;
          max-width: 200px;
        }

        /* ── Topic area (non-editing) ── */
        .ch-head-topic-area {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          flex: 1;
          overflow: hidden;
          position: relative;
          max-width: 100%;
        }
        .ch-head-topic-area--editable {
          cursor: text;
        }
        .ch-head-topic-area--editable:focus {
          outline: none;
        }

        .ch-head-topic {
          font-size: 13px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
          padding: 1px 4px;
          border-radius: var(--r-xs);
          transition: background var(--t-fast), color var(--t-fast);
          margin: 0;
          line-height: 1.4;
        }
        .ch-head-topic-area--editable:hover .ch-head-topic {
          background: var(--ch-hover-bg);
          color: var(--text-secondary);
        }
        .ch-head-topic--empty {
          color: var(--text-muted);
          font-style: italic;
          opacity: 0.6;
        }
        .ch-head-topic-ellipsis {
          margin-left: 1px;
        }

        .ch-head-topic-readmore {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--accent);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0 4px;
          white-space: nowrap;
          opacity: 0.8;
          transition: opacity var(--t-fast);
        }
        .ch-head-topic-readmore:hover {
          opacity: 1;
          text-decoration: underline;
        }

        .ch-head-topic-pencil {
          flex-shrink: 0;
          font-size: 12px;
          opacity: 0;
          transition: opacity 150ms;
          pointer-events: none;
          color: var(--text-muted);
          line-height: 1;
        }
        .ch-head-topic-area--editable:hover .ch-head-topic-pencil {
          opacity: 0.6;
        }

        /* ── Topic edit mode ── */
        .ch-head-topic-edit-wrap {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .ch-head-topic-input {
          font-size: 13px;
          color: var(--text-primary);
          background: var(--bg-elevated);
          border: 1px solid var(--accent);
          border-radius: var(--r-sm);
          outline: none;
          width: 100%;
          padding: 4px 8px;
          box-sizing: border-box;
        }
        .ch-head-topic-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-border);
        }

        .ch-head-topic-counter {
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
          line-height: 1;
          padding-right: 2px;
          pointer-events: none;
        }

        /* ── Topic history button + dropdown ── */
        .ch-topic-hist-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .ch-topic-hist-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 2px 4px;
          border-radius: var(--r-xs);
          opacity: 0.5;
          transition: opacity var(--t-fast), background var(--t-fast);
          color: inherit;
        }
        .ch-topic-hist-btn:hover,
        .ch-topic-hist-btn--active {
          opacity: 1;
          background: var(--ch-hover-bg);
        }
        .ch-topic-hist-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          z-index: 200;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          min-width: 260px;
          max-width: 380px;
          padding: 4px 0;
          animation: ch-hist-pop 120ms ease-out;
        }
        @keyframes ch-hist-pop {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ch-topic-hist-header {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 6px 12px 4px;
        }
        .ch-topic-hist-item {
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px 12px;
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: background var(--t-fast), color var(--t-fast);
        }
        .ch-topic-hist-item:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* ── Away badge in header ── */
        .ch-head-away-badge {
          display: flex;
          align-items: center;
          max-width: 140px;
          flex-shrink: 0;
        }
        .ch-head-away-badge .usb-root {
          padding: 3px 8px;
          border-radius: var(--r-full, 9999px);
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.28);
        }
        .ch-head-away-badge .usb-text {
          font-size: 12px;
          font-weight: 600;
          color: #f59e0b;
        }
        .ch-head-away-badge .usb-root:hover {
          background: rgba(245, 158, 11, 0.2);
        }

        /* ── Action bar ── */
        .ch-head-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          min-width: 0;
          max-width: min(920px, 64vw);
          overflow: visible;
          padding: 2px 0;
        }

        .ch-head-action-group {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          height: 34px;
          padding: 2px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          background: color-mix(in srgb, var(--bg-deep) 68%, transparent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.018);
          flex: 0 0 auto;
        }
        .ch-head-action-group--status {
          background: color-mix(in srgb, var(--accent-subtle) 48%, var(--bg-deep));
          border-color: var(--accent-border);
        }
        .ch-head-action-group--danger {
          background: color-mix(in srgb, var(--danger-subtle) 28%, var(--bg-deep));
          border-color: color-mix(in srgb, var(--danger) 24%, transparent);
        }

        .ch-head-tools-wrap {
          position: relative;
          flex: 0 0 auto;
        }

        .ch-head-btn {
          width: 30px; height: 30px;
          border-radius: var(--r-sm);
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          transition: background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast);
          flex-shrink: 0;
          position: relative;
        }
        .ch-head-btn:hover {
          background: var(--bg-float);
          color: var(--text-primary);
          box-shadow: inset 0 0 0 1px var(--border-subtle);
        }
        .ch-head-btn:active { background: var(--accent-subtle); }
        .ch-head-btn--active { color: var(--accent); }
        .ch-head-btn--active:hover { color: var(--accent); background: var(--accent-subtle); }
        .ch-head-btn--danger:hover { background: var(--danger-subtle); color: var(--danger); }

        .ch-head-btn--tools {
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-deep) 68%, transparent);
        }

        .ch-tools-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 350;
          width: min(340px, calc(100vw - 20px));
          max-height: min(640px, calc(100vh - 88px));
          overflow-y: auto;
          padding: 8px;
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0)),
            var(--bg-float);
          box-shadow: 0 18px 48px rgba(0,0,0,0.48), 0 0 0 1px rgba(255,255,255,0.025);
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
          animation: ch-tools-in 120ms var(--ease-out, ease) both;
        }

        @keyframes ch-tools-in {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ch-tools-section-label {
          padding: 8px 8px 5px;
          font-size: 10px;
          line-height: 1;
          font-weight: 800;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .ch-tools-item {
          width: 100%;
          min-height: 44px;
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr);
          align-items: center;
          gap: 9px;
          padding: 7px 8px;
          border: 1px solid transparent;
          border-radius: var(--r-sm);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          text-align: left;
          font: inherit;
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
        }

        .ch-tools-item:hover,
        .ch-tools-item--active {
          background: var(--ch-hover-bg);
          border-color: var(--border-subtle);
          color: var(--text-primary);
        }

        .ch-tools-item--active {
          box-shadow: inset 3px 0 0 var(--accent);
        }

        .ch-tools-item--danger {
          color: var(--danger);
        }

        .ch-tools-item--danger:hover {
          background: var(--danger-subtle);
          border-color: color-mix(in srgb, var(--danger) 28%, transparent);
        }

        .ch-tools-item svg {
          justify-self: center;
          width: 16px;
          height: 16px;
          opacity: 0.78;
        }

        .ch-tools-copy {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        .ch-tools-title {
          font-size: 13px;
          font-weight: 650;
          color: currentColor;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }

        .ch-tools-desc {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.25;
        }

        .ch-tools-activity {
          margin: 6px 4px;
          padding: 8px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          background: color-mix(in srgb, var(--bg-deep) 72%, transparent);
          display: grid;
          gap: 7px;
        }

        .ch-tools-divider {
          height: 1px;
          margin: 7px 4px;
          background: var(--border-subtle);
        }

        @media (prefers-reduced-motion: reduce) {
          .ch-head-btn { transition: background var(--t-fast), color var(--t-fast); }
        }

        @media (max-width: 768px) {
          .ch-head-btn { width: 32px; height: 32px; }
          .ch-head { padding: 0 10px; gap: 8px; }
          .ch-head-title { font-size: 14px; max-width: 140px; }
          .ch-head-actions {
            max-width: 54vw;
            gap: 4px;
            overflow: visible;
          }
          .ch-head-action-group {
            height: 36px;
          }
          .ch-head-action-group--tools,
          .ch-head-action-group--collab {
            display: none;
          }
          .ch-head-topic-area,
          .ch-head-divider,
          .ch-topic-hist-wrap { display: none; }
          .ch-mode-badges { display: none; }
          .ch-head-heatmap { display: none; }
          .ch-head-members-count { display: none; }
          .ch-head-sep { display: none; }
        }

        /* Member count chip */
        .ch-head-member-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px 3px 7px;
          height: 30px;
          border-radius: var(--r-sm);
          background: none;
          border: 1px solid transparent;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          transition: background var(--t-fast), color var(--t-fast);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ch-head-member-chip:hover { background: var(--bg-float); border-color: var(--border-subtle); color: var(--text-primary); }
        .ch-head-member-chip--active { color: var(--accent); }
        .ch-head-member-chip--active:hover { background: var(--accent-subtle); color: var(--accent); }
        .ch-head-member-chip svg { flex-shrink: 0; }

        /* Notification level bell */
        .ch-head-btn--notify-all     { color: var(--text-muted); }
        .ch-head-btn--notify-mentions { color: var(--gold, #e8b84b); }
        .ch-head-btn--notify-none    { color: var(--text-muted); opacity: 0.5; }
        .ch-head-btn--notify-none:hover { opacity: 1; }

        .ch-head-sep {
          width: 1px; height: 20px;
          background: var(--border-subtle);
          margin: 0 4px;
        }

        .ch-head-heatmap {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          padding: 0 4px;
          opacity: 0.7;
          transition: opacity 120ms;
        }
        .ch-head-heatmap:hover { opacity: 1; }

        .ch-head-members-count {
          display: flex; align-items: center; gap: 4px;
          font-size: 11px; font-weight: 600;
          color: var(--text-muted);
          padding: 2px 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }

        .ch-head-btn--pin {
          position: relative;
        }
        .ch-head-btn--pin-active {
          color: var(--gold);
        }
        .ch-head-btn--pin-active:hover {
          color: var(--gold);
        }
        .ch-head-pin-badge {
          position: absolute; top: 1px; right: 1px;
          font-size: 8px; font-weight: 800;
          min-width: 13px; height: 13px;
          background: var(--gold);
          color: #000;
          border-radius: var(--r-full);
          display: flex; align-items: center; justify-content: center;
          line-height: 1;
          pointer-events: none;
          letter-spacing: 0;
        }

        .ch-head-btn--bookmark { position: relative; }
        .ch-head-btn--bookmark-active { color: var(--gold); }
        .ch-head-btn--bookmark-active:hover { color: var(--gold); }
        .ch-head-bookmark-badge {
          position: absolute; top: 2px; right: 2px;
          font-size: 9px; font-weight: 700;
          min-width: 14px; height: 14px;
          background: var(--gold);
          color: #000;
          border-radius: var(--r-full);
          display: flex; align-items: center; justify-content: center;
          line-height: 1;
          pointer-events: none;
        }

        /* ── Mode badges ── */
        .ch-mode-badges {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .ch-mode-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          background: var(--bg-float);
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          padding: 2px 6px;
          cursor: default;
          white-space: nowrap;
          line-height: 1.4;
        }
        .ch-mode-badge--more {
          color: var(--text-faint, var(--text-muted));
          opacity: 0.7;
        }
        .ch-mode-badge--ladon {
          color: var(--accent);
          border-color: var(--accent-border, rgba(14,165,233,0.3));
          background: rgba(14,165,233,0.08);
        }

        /* ── Thread list panel ── */
        .ch-thread-list-wrap { position: relative; }
        .ch-thread-list-dropdown {
          position: absolute; top: calc(100% + 6px); right: 0;
          z-index: 300;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: 0 8px 32px rgba(0,0,0,0.45);
          width: 300px;
          max-height: 400px;
          overflow-y: auto;
          padding: 4px 0;
          animation: ch-thread-list-pop 120ms ease-out;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        @keyframes ch-thread-list-pop {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ch-thread-list-header {
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--text-muted);
          padding: 6px 12px 4px;
        }
        .ch-thread-list-item {
          display: flex; flex-direction: column; gap: 2px;
          width: 100%; padding: 7px 12px;
          background: none; border: none; cursor: pointer;
          text-align: left; font-family: inherit;
          transition: background var(--t-fast);
        }
        .ch-thread-list-item:hover { background: var(--ch-hover-bg); }
        .ch-thread-list-item--archived { opacity: 0.65; }
        .ch-thread-item-text {
          font-size: 13px; color: var(--text-secondary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          display: flex; align-items: center; gap: 4px;
        }
        .ch-thread-item-lock { font-size: 11px; flex-shrink: 0; }
        .ch-thread-item-meta {
          display: flex; align-items: center; gap: 8px;
        }
        .ch-thread-item-count {
          font-size: 11px; font-weight: 600; color: var(--accent);
        }
        .ch-thread-item-time {
          font-size: 11px; color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .ch-thread-item-active-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #22c55e; flex-shrink: 0;
          animation: ch-thread-pulse 2s ease-in-out infinite;
        }
        @keyframes ch-thread-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .ch-thread-list-section-toggle {
          display: flex; align-items: center; gap: 6px;
          width: 100%; padding: 5px 12px;
          background: none; border: none; cursor: pointer;
          font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--text-muted);
          font-family: inherit;
          transition: color var(--t-fast);
          border-top: 1px solid var(--border-subtle);
          margin-top: 4px;
        }
        .ch-thread-list-section-toggle:hover { color: var(--text-secondary); }

        /* ── Go Live / End Stream buttons ── */
        .ch-head-btn--go-live {
          position: relative;
          color: #e63946;
          border: 1px solid rgba(230,57,70,0.25);
          border-radius: var(--r-sm);
        }
        .ch-head-btn--go-live:hover {
          background: rgba(230,57,70,0.12);
          color: #ff6b7a;
          border-color: rgba(230,57,70,0.5);
        }
        .ch-head-btn--end-stream {
          color: #e63946;
          background: rgba(230,57,70,0.1);
          border: 1px solid rgba(230,57,70,0.3);
        }
        .ch-head-btn--end-stream:hover {
          background: rgba(230,57,70,0.2);
          color: #ff6b7a;
        }
      `}</style>
    </div>
  );
}

const ChatHeaderHamburgerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 4h12M2 8h12M2 12h12" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
    <path d="M7.5 7.5V8h.5v.5A.5.5 0 0 0 8.5 9H9a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5z"/>
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
    <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
  </svg>
);

const LeaveIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 3L14 7.5L9 12M14 7.5H5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 2H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" strokeLinecap="round" />
  </svg>
);

const AccessIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 1.5L2 4v4.5C2 11.5 4.5 14 7.5 14S13 11.5 13 8.5V4L7.5 1.5z" />
    <path d="M5.5 7.5l1.5 1.5 2.5-2.5" />
  </svg>
);

const PinIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <path d="M9.5 1a.5.5 0 0 1 .354.146l4 4a.5.5 0 0 1-.122.805L10.25 7.5l-.25 1.5-3 3-1.5-.5L4 13l-2-2 1.5-1.5-.5-1.5 3-3 1.5-.25 2.005-3.364A.5.5 0 0 1 9.5 1zM9.5 2.207 7.617 5.39a.5.5 0 0 1-.26.213L5.947 6.03l-.37 2.22-2.537 2.537.963.963 2.537-2.537 2.22-.37.427-1.41a.5.5 0 0 1 .213-.26L12.793 5.5 9.5 2.207z"/>
  </svg>
);

const BookmarkHeaderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 14 14" fill="currentColor">
    <path d="M2 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.777.416L7 10.101l-4.223 2.815A.5.5 0 0 1 2 12.5V2zm1 0v9.566l3.723-2.482a.5.5 0 0 1 .554 0L11 11.566V2H3z"/>
  </svg>
);

const SearchMessagesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2.5A.5.5 0 0 1 2.5 2h11a.5.5 0 0 1 0 1h-11A.5.5 0 0 1 2 2.5zm0 3A.5.5 0 0 1 2.5 5h6a.5.5 0 0 1 0 1h-6A.5.5 0 0 1 2 5.5zm0 3A.5.5 0 0 1 2.5 8h4a.5.5 0 0 1 0 1h-4A.5.5 0 0 1 2 8.5zm7.5 1.5a3 3 0 1 1 2.121 5.121A3 3 0 0 1 9.5 10zm3.854 2.146a.5.5 0 0 0-.708 0L11.5 13.293l-.646-.647a.5.5 0 0 0-.708.708l1 1a.5.5 0 0 0 .708 0l1.5-1.5a.5.5 0 0 0 0-.708z"/>
  </svg>
);

const MediaIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
    <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13zm13 1a.5.5 0 0 1 .5.5v6l-3.775-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12v.55A.505.505 0 0 1 1 12.5v-9a.5.5 0 0 1 .5-.5h13z"/>
  </svg>
);

const InviteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H1s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C9.516 10.68 8.289 10 6 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>
    <path fillRule="evenodd" d="M13.5 5a.5.5 0 0 1 .5.5V7h1.5a.5.5 0 0 1 0 1H14v1.5a.5.5 0 0 1-1 0V8h-1.5a.5.5 0 0 1 0-1H13V5.5a.5.5 0 0 1 .5-.5z"/>
  </svg>
);

const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
  </svg>
);

const ShieldHeaderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M5.338 1.59a61.44 61.44 0 0 0-2.837.856.481.481 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.725 10.725 0 0 0 2.287 2.233c.346.244.652.42.893.533.12.057.218.095.293.118a.55.55 0 0 0 .101.025.615.615 0 0 0 .1-.025c.076-.023.174-.061.294-.118.24-.113.547-.29.893-.533a10.726 10.726 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524zM5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.775 11.775 0 0 1-2.517 2.453 7.159 7.159 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7.158 7.158 0 0 1-1.048-.625 11.777 11.777 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 62.456 62.456 0 0 1 5.072.56z"/>
  </svg>
);

const ProfileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>
  </svg>
);

const MuteOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
    <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
    <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
  </svg>
);

const MuteOnIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zm7.137 2.096a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708l4-4a.5.5 0 0 1 .708 0zm-4 0a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708z"/>
  </svg>
);

const EventLogIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11zM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11z"/>
    <path d="M4 5.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 5.5zm0 3a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5A.5.5 0 0 1 4 8.5zm0 3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5z"/>
  </svg>
);

const ThreadsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2.5 2A.5.5 0 0 0 2 2.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-11A.5.5 0 0 0 13.5 2h-11zM1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11z"/>
    <path d="M3 5.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 5.5zm2 2a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 5 7.5zm2 2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/>
  </svg>
);

const PhoneCallIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 11a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18H5a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/>
  </svg>
);

const VideoCallIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="23 7 16 12 23 17 23 7"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>
);

const WhiteboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M15 1H1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h5.5l-1.5 2h5l-1.5-2H15a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 11H1V2h14v10z"/>
    <path d="M9.646 5.646a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L10 6.707V10.5a.5.5 0 0 1-1 0V6.707L7.354 8.354a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0z"/>
    <path d="M3.5 6a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5zm1.5-1a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4A.5.5 0 0 1 5 5z"/>
  </svg>
);

/** Spatial audio — concentric rings with a centre dot */
const SpatialIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.3" strokeLinecap="round" aria-hidden>
    <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="8" cy="8" r="4"/>
    <circle cx="8" cy="8" r="7"/>
  </svg>
);

/** Breakout rooms — two overlapping squares */
const BreakoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M1 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2zm1 0v6h6V2H2z"/>
    <path d="M7 7v1h1V7H7zm1 1v1h1V8H8zm1-1h1V6h-1v1zm0-1V6h-1v1h1zm1 0h1V6h-1v1zm0 2h1V8h-1v1zm-1 0v1h1V9h-1zm-1 0H8v1H9V9zm1 0h1v1H9V9z" opacity=".5"/>
    <path d="M7 9a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zm2-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H9z"/>
  </svg>
);

const GoLiveIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
  </svg>
);

const StopStreamIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>
);

const MembersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
    <circle cx="3.5" cy="7.5" r="1.25" />
    <circle cx="7.5" cy="7.5" r="1.25" />
    <circle cx="11.5" cy="7.5" r="1.25" />
  </svg>
);

// ── NotifyLevelButton ──────────────────────────────────────────────────────────

function NotifyLevelButton({ channel }: { channel: string }) {
  const channelNotify    = useOnyxStore(s => s.channelNotify);
  const setChannelNotify = useOnyxStore(s => s.setChannelNotify);

  const level = channelNotify.get(channel.toLowerCase()) ?? 'all';

  const LEVELS: Array<'all' | 'mentions' | 'none'> = ['all', 'mentions', 'none'];
  const LEVEL_META: Record<'all' | 'mentions' | 'none', { label: string; tooltip: string; icon: React.ReactNode }> = {
    all:      { label: 'All Messages',  tooltip: 'Notify: All messages',   icon: <BellAllIcon /> },
    mentions: { label: 'Mentions Only', tooltip: 'Notify: Mentions only',  icon: <BellMentionIcon /> },
    none:     { label: 'Muted',         tooltip: 'Notify: Muted',          icon: <BellMuteIcon /> },
  };

  const handleCycle = () => {
    const idx = LEVELS.indexOf(level);
    const next = LEVELS[(idx + 1) % LEVELS.length];
    setChannelNotify(channel, next);
  };

  const meta = LEVEL_META[level];

  return (
    <Tooltip text={meta.tooltip} side="bottom">
      <button
        className={`ch-head-btn ch-head-btn--notify ch-head-btn--notify-${level}`}
        aria-label={`Notification level: ${meta.label} — click to change`}
        onClick={handleCycle}
        type="button"
      >
        {meta.icon}
      </button>
    </Tooltip>
  );
}

function BellAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

function BellMentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

function BellMuteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      <path d="M18.63 13A17.888 17.888 0 0 1 18 8"/>
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
      <path d="M18 8a6 6 0 0 0-9.33-5"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}
