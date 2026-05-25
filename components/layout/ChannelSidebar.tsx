'use client';

import { useState, useMemo, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import SkeletonChannel from '@/components/chat/SkeletonChannel';
import type { Channel } from '@/lib/irc/types';
import type { DMConversation } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import ChannelContextMenu from '@/components/ui/ChannelContextMenu';
import ChannelFoldersPanel from '@/components/layout/ChannelFoldersPanel';
import UserStatusBadge from '@/components/ui/UserStatusBadge';
import StageChannelBadge from '@/components/voice/StageChannelBadge';
import SpeakingBars from '@/components/voice/SpeakingBars';

interface SidebarProps {
  onNavigate?: () => void;
  onMobileClose?: () => void;
}

// ── Channel categorization ─────────────────────────────────────────────────────

type CategoryType = 'text' | 'voice' | 'announcement' | 'stage';

interface Category {
  name: string;
  channels: Channel[];
  type: CategoryType;
}

function categorizeChannels(channels: Channel[]): Category[] {
  const voice: Channel[] = [];
  const announce: Channel[] = [];
  const stage: Channel[] = [];
  const text: Channel[] = [];

  for (const ch of channels) {
    const lower = ch.name.toLowerCase().replace(/^[#&]/, '');
    if (/^(voice|vc$|vc-|.*-vc$|.*-voice$)/.test(lower)) {
      voice.push(ch);
    } else if (/^(announce|news|update|blog)/.test(lower)) {
      announce.push(ch);
    } else if (/^stage/.test(lower)) {
      stage.push(ch);
    } else {
      text.push(ch);
    }
  }

  const result: Category[] = [];
  if (announce.length) result.push({ name: 'Announcements', channels: announce, type: 'announcement' });
  if (text.length)     result.push({ name: 'Text Channels', channels: text, type: 'text' });
  if (voice.length)    result.push({ name: 'Voice Channels', channels: voice, type: 'voice' });
  if (stage.length)    result.push({ name: 'Stage Channels', channels: stage, type: 'stage' });
  return result;
}

// ── Collapsed state (localStorage-persisted) ───────────────────────────────────

const LS_KEY = 'ocean-sidebar-collapsed';

function loadCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const saved = localStorage.getItem(LS_KEY);
    return new Set(JSON.parse(saved ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...set]));
  } catch {
    // ignore quota errors
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChannelSidebar({ onNavigate, onMobileClose }: SidebarProps) {
  const channels           = useOnyxStore(s => s.channels);
  const dms                = useOnyxStore(s => s.dms);
  const activeView         = useOnyxStore(s => s.activeView);
  const navigate           = useOnyxStore(s => s.navigate);
  const joinChannel        = useOnyxStore(s => s.joinChannel);
  const connectionStatus   = useOnyxStore(s => s.connectionStatus);
  const voice              = useOnyxStore(s => s.voice);
  const joinVoiceChannel   = useOnyxStore(s => s.joinVoiceChannel);
  const leaveVoiceChannel  = useOnyxStore(s => s.leaveVoiceChannel);
  const voiceChannelParticipants = useOnyxStore(s => s.voiceChannelParticipants);
  const client             = useOnyxStore(s => s.client);
  const networkName          = useOnyxStore(s => s.networkName);
  const ourNick              = useOnyxStore(s => s.ourNick);
  const currentNickIsAlias   = useOnyxStore(s => s.currentNickIsAlias);
  const openServerSettings   = useOnyxStore(s => s.openServerSettings);
  const openChannelBrowser   = useOnyxStore(s => s.openChannelBrowser);
  const openServerStats      = useOnyxStore(s => s.openServerStats);
  const openSpotlight        = useOnyxStore(s => s.openSpotlight);
  const starredChannels      = useOnyxStore(s => s.starredChannels);
  const starChannel          = useOnyxStore(s => s.starChannel);
  const unstarChannel        = useOnyxStore(s => s.unstarChannel);
  const autoJoinChannels     = useOnyxStore(s => s.autoJoinChannels);
  const addAutoJoin          = useOnyxStore(s => s.addAutoJoin);
  const removeAutoJoin       = useOnyxStore(s => s.removeAutoJoin);
  const compactSidebar       = useOnyxStore(s => s.compactSidebar);
  const setCompactSidebar    = useOnyxStore(s => s.setCompactSidebar);
  const channelColors        = useOnyxStore(s => s.channelColors);
  const mutedDMs             = useOnyxStore(s => s.mutedDMs);
  const muteDM               = useOnyxStore(s => s.muteDM);
  const unmuteDM             = useOnyxStore(s => s.unmuteDM);
  const forumChannels        = useOnyxStore(s => s.forumChannels);

  // Collapsed categories (localStorage-persisted)
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [dmExpanded, setDmExpanded] = useState(true);
  const [joinInput, setJoinInput] = useState('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channel: string } | null>(null);
  const [dmContextMenu, setDmContextMenu] = useState<{ x: number; y: number; nick: string } | null>(null);

  const handleChannelContextMenu = (e: React.MouseEvent, channelName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel: channelName });
  };

  function toggleCategory(name: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      saveCollapsed(next);
      return next;
    });
  }

  const channelNotify        = useOnyxStore(s => s.channelNotify);
  const channelSortOrder     = useOnyxStore(s => s.channelSortOrder);
  const setChannelSortOrder  = useOnyxStore(s => s.setChannelSortOrder);
  const channelLastActivity  = useOnyxStore(s => s.channelLastActivity);
  const voiceChannels        = useOnyxStore(s => s.voiceChannels);
  const speakingNicks        = useOnyxStore(s => s.speakingNicks);
  const channelUnread        = useOnyxStore(s => s.channelUnread);
  const channelMentions      = useOnyxStore(s => s.channelMentions);
  const channelOrder         = useOnyxStore(s => s.channelOrder);
  const setChannelOrder      = useOnyxStore(s => s.setChannelOrder);
  const nsfwChannels         = useOnyxStore(s => s.nsfwChannels);
  const nsfwAcknowledged     = useOnyxStore(s => s.nsfwAcknowledged);
  const markChannelNsfw      = useOnyxStore(s => s.markChannelNsfw);
  const unmarkChannelNsfw    = useOnyxStore(s => s.unmarkChannelNsfw);
  const acknowledgeNsfw      = useOnyxStore(s => s.acknowledgeNsfw);

  const channelList   = [...channels.values()];
  // IRC +V mode = LADON voice channel; also channels with '+' prefix (IRCX voice)
  const ircVoiceChannels = channelList.filter(c =>
    c.modes.includes('V') ||
    c.name.startsWith('+') ||
    voiceChannels.includes(c.name.toLowerCase())
  );

  // Drag-and-drop state
  const dragChannelRef = useRef<string | null>(null);

  const handleDragStart = (channelName: string) => {
    dragChannelRef.current = channelName;
  };

  const handleDrop = (targetChannelName: string, currentList: Channel[]) => {
    const dragName = dragChannelRef.current;
    if (!dragName || dragName === targetChannelName) return;
    const names = currentList.map(c => c.name);
    const fromIdx = names.indexOf(dragName);
    const toIdx = names.indexOf(targetChannelName);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...names];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragName);
    setChannelOrder(next);
    dragChannelRef.current = null;
  };

  const textLikeChannels = useMemo(() => {
    const chans = channelList.filter(c =>
      !c.modes.includes('V') &&
      !c.name.startsWith('+') &&
      !voiceChannels.includes(c.name.toLowerCase())
    );
    // If channelOrder has entries, sort by that order first (user drag order)
    if (channelOrder.length > 0) {
      const orderMap = new Map(channelOrder.map((name, i) => [name.toLowerCase(), i]));
      return chans.sort((a, b) => {
        const ai = orderMap.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
      });
    }
    if (channelSortOrder === 'alpha') {
      return chans.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (channelSortOrder === 'unread') {
      return chans.sort((a, b) => {
        const aScore = a.highlights * 100 + a.unread;
        const bScore = b.highlights * 100 + b.unread;
        return bScore - aScore || a.name.localeCompare(b.name);
      });
    }
    // 'activity'
    return chans.sort((a, b) => {
      const aTime = channelLastActivity.get(a.name.toLowerCase()) ?? 0;
      const bTime = channelLastActivity.get(b.name.toLowerCase()) ?? 0;
      return bTime - aTime;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, channelSortOrder, channelLastActivity, voiceChannels, channelOrder]);
  const dmList = [...dms.values()].sort(
    (a, b) => b.highlights - a.highlights || b.unread - a.unread || a.nick.localeCompare(b.nick)
  );

  const isActiveChannel = (name: string) =>
    activeView.kind === 'channel' && activeView.channel.toLowerCase() === name.toLowerCase();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const ch = joinInput.trim();
    if (!ch) return;
    const name = ch.startsWith('#') || ch.startsWith('&') ? ch : `#${ch}`;
    joinChannel(name);
    setJoinInput('');
  };

  return (
    <div className={`ch-sidebar${compactSidebar ? ' ch-sidebar--compact' : ''}`}>
      {/* Server header */}
      <div className="ch-header" onClick={openServerSettings} role="button" aria-label="Open server settings" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openServerSettings(); } }}>
        {!compactSidebar && (
          <div className="ch-header-info">
            <div className="ch-header-top">
              <span className="ch-header-name">{networkName}</span>
              <span
                className={`ch-conn-dot ch-conn-dot--${connectionStatus}`}
                title={connectionStatus}
                aria-label={`Connection: ${connectionStatus}`}
              />
            </div>
            {ourNick && (
              <div className="ch-header-nick">
                <span className="ch-header-nick-text">{ourNick}</span>
                {currentNickIsAlias && (
                  <span className="ch-header-alias-badge" title="Using a fallback nick">alias</span>
                )}
              </div>
            )}
          </div>
        )}
        {!compactSidebar && <ServerMenuIcon />}
        <button
          className="ch-compact-btn"
          onClick={e => { e.stopPropagation(); setCompactSidebar(!compactSidebar); }}
          title={compactSidebar ? 'Expand sidebar' : 'Compact sidebar'}
          aria-label={compactSidebar ? 'Expand sidebar' : 'Compact sidebar'}
        >
          {compactSidebar ? '»' : '«'}
        </button>
        {onMobileClose && (
          <button
            className="ch-mobile-close"
            onClick={e => { e.stopPropagation(); onMobileClose(); }}
            aria-label="Close sidebar"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <nav className="ch-scroll" aria-label="Channel navigation">

        {/* ── Skeleton during initial connection ───────────────────────── */}
        {connectionStatus === 'connecting' && (
          <SkeletonChannel count={7} />
        )}

        {/* ── Sort control ─────────────────────────────────────────────── */}
        {connectionStatus !== 'connecting' && textLikeChannels.length > 1 && (
          <div className="ch-sort-bar">
            <span className="ch-sort-label">Channels</span>
            <SortCycleButton order={channelSortOrder} onClick={() => {
              const next: Record<typeof channelSortOrder, typeof channelSortOrder> = {
                alpha: 'unread',
                unread: 'activity',
                activity: 'alpha',
              };
              setChannelSortOrder(next[channelSortOrder]);
            }} />
          </div>
        )}

        {/* ── Channel list — hidden while connecting ───────────────────── */}
        {connectionStatus !== 'connecting' && (<>

        {/* ── Starred section ─────────────────────────────────────────── */}
        {starredChannels.size > 0 && (() => {
          const starredList = channelList.filter(c => starredChannels.has(c.name.toLowerCase()));
          if (starredList.length === 0) return null;
          return (
            <Section
              label="Starred"
              expanded={!collapsed.has('__starred__')}
              onToggle={() => toggleCategory('__starred__')}
              compact={compactSidebar}
            >
              {starredList.map(ch => (
                <ChannelRow
                  key={ch.name}
                  channel={ch}
                  active={isActiveChannel(ch.name)}
                  onClick={() => { navigate({ kind: 'channel', channel: ch.name }); onNavigate?.(); }}
                  onContextMenu={e => handleChannelContextMenu(e, ch.name)}
                  starred
                  autoJoin={autoJoinChannels.includes(ch.name.toLowerCase())}
                  onToggleStar={() => unstarChannel(ch.name.toLowerCase())}
                  onToggleAutoJoin={() => autoJoinChannels.includes(ch.name.toLowerCase()) ? removeAutoJoin(ch.name.toLowerCase()) : addAutoJoin(ch.name.toLowerCase())}
                  muted={channelNotify.get(ch.name.toLowerCase()) === 'none'}
                  channelColor={channelColors.get(ch.name.toLowerCase())}
                  compact={compactSidebar}
                  forumIcon={forumChannels.has(ch.name.toLowerCase())}
                  unreadCount={channelUnread[ch.name.toLowerCase()] ?? 0}
                  mentionCount={channelMentions[ch.name.toLowerCase()] ?? 0}
                  isNsfw={nsfwChannels.has(ch.name.toLowerCase())}
                />
              ))}
            </Section>
          );
        })()}

        {/* ── Channel Folders (text channels) ─────────────────────────── */}
        {!compactSidebar && (
          <ChannelFoldersPanel
            channels={textLikeChannels}
            activeChannel={activeView.kind === 'channel' ? activeView.channel : null}
            onChannelClick={ch => { navigate({ kind: 'channel', channel: ch }); onNavigate?.(); }}
            onChannelContextMenu={(ch, e) => handleChannelContextMenu(e, ch)}
          />
        )}

        {/* Compact sidebar: plain flat list without folder UI */}
        {compactSidebar && textLikeChannels.map(ch => (
          <div
            key={ch.name}
            draggable
            onDragStart={() => handleDragStart(ch.name)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => handleDrop(ch.name, textLikeChannels)}
            className="ch-draggable-wrap"
          >
            <ChannelRow
              channel={ch}
              active={isActiveChannel(ch.name)}
              onClick={() => { navigate({ kind: 'channel', channel: ch.name }); onNavigate?.(); }}
              onContextMenu={e => handleChannelContextMenu(e, ch.name)}
              starred={starredChannels.has(ch.name.toLowerCase())}
              autoJoin={autoJoinChannels.includes(ch.name.toLowerCase())}
              onToggleStar={() => starredChannels.has(ch.name.toLowerCase()) ? unstarChannel(ch.name.toLowerCase()) : starChannel(ch.name.toLowerCase())}
              onToggleAutoJoin={() => autoJoinChannels.includes(ch.name.toLowerCase()) ? removeAutoJoin(ch.name.toLowerCase()) : addAutoJoin(ch.name.toLowerCase())}
              muted={channelNotify.get(ch.name.toLowerCase()) === 'none'}
              channelColor={channelColors.get(ch.name.toLowerCase())}
              compact
              forumIcon={forumChannels.has(ch.name.toLowerCase())}
              unreadCount={channelUnread[ch.name.toLowerCase()] ?? 0}
              mentionCount={channelMentions[ch.name.toLowerCase()] ?? 0}
              isNsfw={nsfwChannels.has(ch.name.toLowerCase())}
            />
          </div>
        ))}

        {/* IRC +V / IRCX + prefix / LADON voice channels in their own section */}
        {(ircVoiceChannels.length > 0 || client?.isupport.LADONMEDIA) && (
          <Section
            label="Voice Channels"
            expanded={!collapsed.has('__voice__')}
            onToggle={() => toggleCategory('__voice__')}
            compact={compactSidebar}
          >
            {ircVoiceChannels.map(ch => {
              const isInThisChannel = voice.callChannel?.toLowerCase() === ch.name.toLowerCase();
              const withVideo = /(video|cam|webcam)/i.test(ch.name);
              const handleVoiceClick = async () => {
                if (isInThisChannel) return;
                if (voice.callChannel) {
                  leaveVoiceChannel();
                }
                await joinVoiceChannel(ch.name, withVideo);
              };
              return (
                <VoiceChannelRow
                  key={ch.name}
                  channel={ch}
                  active={isInThisChannel}
                  speakingNicks={speakingNicks}
                  participants={voiceChannelParticipants.get(ch.name.toLowerCase())}
                  ourNick={ourNick}
                  onClick={handleVoiceClick}
                  onLeave={leaveVoiceChannel}
                />
              );
            })}
          </Section>
        )}

        </>)}

        {/* DMs — never categorized */}
        <Section
          label="Direct Messages"
          expanded={dmExpanded}
          onToggle={() => setDmExpanded(e => !e)}
          compact={compactSidebar}
        >
          {dmList.map(dm => (
            <DMRow
              key={dm.nick}
              dm={dm}
              active={activeView.kind === 'dm' && activeView.nick.toLowerCase() === dm.nick.toLowerCase()}
              muted={mutedDMs.has(dm.nick.toLowerCase())}
              onClick={() => { navigate({ kind: 'dm', nick: dm.nick }); onNavigate?.(); }}
              onContextMenu={e => { e.preventDefault(); setDmContextMenu({ x: e.clientX, y: e.clientY, nick: dm.nick }); }}
            />
          ))}
          {dmList.length === 0 && !compactSidebar && (
            <div className="ch-dm-empty">
              <span className="ch-dm-empty-text">No direct messages</span>
              <button
                className="ch-dm-empty-start"
                onClick={openSpotlight}
                aria-label="Start a new direct message"
              >
                Start one
              </button>
            </div>
          )}
          {dmList.length === 0 && compactSidebar && (
            <span className="ch-empty">—</span>
          )}
        </Section>
      </nav>

      {/* Browse channels link */}
      {!compactSidebar && (
        <button className="ch-browse-btn" onClick={openChannelBrowser}>
          <BrowseIcon />
          Browse channels
        </button>
      )}

      {/* Server stats widget trigger */}
      {!compactSidebar && (
        <button className="ch-browse-btn" onClick={openServerStats} aria-label="Show server stats">
          <StatsIcon />
          Server stats
        </button>
      )}

      {/* Spotlight search trigger */}
      {!compactSidebar && (
        <button className="ch-spotlight-btn" onClick={openSpotlight} aria-label="Open quick navigation (Ctrl+K)">
          <SearchSmallIcon />
          <span className="ch-spotlight-label">Quick jump</span>
          <kbd className="ch-spotlight-kbd">⌘K</kbd>
        </button>
      )}

      {/* User away / status badge */}
      {!compactSidebar && (
        <div className="ch-status-area">
          <UserStatusBadge />
        </div>
      )}

      {/* Join channel input */}
      {!compactSidebar && (
        <form className="ch-join" onSubmit={handleJoin}>
          <input
            className="ch-join-input"
            type="text"
            placeholder="Join #channel…"
            value={joinInput}
            onChange={e => setJoinInput(e.target.value)}
          />
        </form>
      )}

      {/* Channel context menu */}
      {contextMenu && (
        <ChannelContextMenu
          channel={contextMenu.channel}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* DM context menu */}
      {dmContextMenu && (
        <DMContextMenu
          nick={dmContextMenu.nick}
          x={dmContextMenu.x}
          y={dmContextMenu.y}
          muted={mutedDMs.has(dmContextMenu.nick.toLowerCase())}
          onMute={() => { muteDM(dmContextMenu.nick); setDmContextMenu(null); }}
          onUnmute={() => { unmuteDM(dmContextMenu.nick); setDmContextMenu(null); }}
          onClose={() => setDmContextMenu(null)}
        />
      )}

      <style>{`
        .ch-sidebar {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
        }

        /* ── Compact sidebar mode ── */
        .ch-sidebar--compact {
          width: 52px;
          flex: none;
        }

        .ch-compact-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px; height: 22px;
          border-radius: 4px;
          border: none;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
          padding: 0;
          margin-left: auto;
        }
        .ch-compact-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .ch-header {
          min-height: var(--header-h);
          height: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px 6px 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          cursor: pointer;
          gap: 6px;
        }
        .ch-header:hover { background: var(--ch-hover-bg); }

        .ch-header-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ch-header-top {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ch-header-name {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ch-conn-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ch-conn-dot--connected    { background: var(--status-online, #3ba55d); }
        .ch-conn-dot--connecting   { background: var(--warning, #faa61a); animation: ch-pulse 1.2s ease-in-out infinite; }
        .ch-conn-dot--reconnecting { background: var(--warning, #faa61a); animation: ch-pulse 1.2s ease-in-out infinite; }
        .ch-conn-dot--disconnected { background: var(--text-muted, rgba(255,255,255,0.35)); }
        @keyframes ch-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .ch-header-nick {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .ch-header-nick-text {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--font-mono, monospace);
        }
        .ch-header-alias-badge {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(250,166,26,0.18);
          color: var(--warning, #faa61a);
          border: 1px solid rgba(250,166,26,0.35);
          flex-shrink: 0;
        }

        .ch-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 8px 0;
        }

        .ch-empty {
          display: block;
          padding: 4px 12px 4px 28px;
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }

        .ch-dm-empty {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px 4px 28px;
        }

        .ch-dm-empty-text {
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }

        .ch-dm-empty-start {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          font-family: inherit;
          padding: 0;
          transition: opacity var(--t-fast);
        }
        .ch-dm-empty-start:hover { opacity: 0.75; }

        .ch-browse-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          width: calc(100% - 16px);
          margin: 2px 8px 0;
          padding: 7px 10px;
          background: none;
          border: none;
          border-radius: var(--r-sm);
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          font-family: inherit;
          text-align: left;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .ch-browse-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }
        .ch-browse-btn svg {
          flex-shrink: 0;
          opacity: 0.7;
        }
        .ch-browse-btn:hover svg { opacity: 1; }

        .ch-status-area {
          padding: 2px 8px 0;
          flex-shrink: 0;
        }

        .ch-join {
          padding: 4px 8px 4px;
          flex-shrink: 0;
        }

        .ch-join-input {
          width: 100%;
          padding: 7px 10px;
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          font-size: 13px;
          color: var(--text-primary);
          font-family: inherit;
        }
        .ch-join-input:focus { outline: none; border-color: var(--accent-border); }
        .ch-join-input::placeholder { color: var(--text-muted); }

        .ch-spotlight-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          width: calc(100% - 16px);
          margin: 0 8px 2px;
          padding: 6px 10px;
          background: none;
          border: none;
          border-radius: var(--r-sm);
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          font-family: inherit;
          text-align: left;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .ch-spotlight-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }
        .ch-spotlight-btn svg { flex-shrink: 0; opacity: 0.7; }
        .ch-spotlight-btn:hover svg { opacity: 1; }
        .ch-spotlight-label { flex: 1; }
        .ch-spotlight-kbd {
          font-size: 11px;
          font-family: inherit;
          color: var(--text-muted);
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: 3px;
          padding: 1px 5px;
          flex-shrink: 0;
        }

        /* Category count badge */
        .ch-section-count {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
          margin-right: 2px;
        }

        /* Mobile close button — only visible when rendered */
        .ch-mobile-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
          margin-left: 4px;
        }
        .ch-mobile-close:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        @media (min-width: 769px) {
          .ch-mobile-close { display: none; }
        }

        /* ── Sort bar ── */
        .ch-sort-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 2px 10px 0 10px;
          margin-bottom: 2px;
        }
        .ch-sort-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .ch-sort-btn {
          width: 22px;
          height: 22px;
          border-radius: 4px;
          border: none;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
          padding: 0;
        }
        .ch-sort-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* Draggable wrapper */
        .ch-draggable-wrap {
          cursor: grab;
        }
        .ch-draggable-wrap:active {
          cursor: grabbing;
          opacity: 0.75;
        }
      `}</style>
    </div>
  );
}

// ── SortCycleButton ────────────────────────────────────────────────────────────

const SORT_META: Record<string, { icon: string; tooltip: string }> = {
  alpha:    { icon: '🔤', tooltip: 'Sort: Alphabetical' },
  unread:   { icon: '🔔', tooltip: 'Sort: Unread first' },
  activity: { icon: '🕐', tooltip: 'Sort: Recent activity' },
};

function SortCycleButton({ order, onClick }: { order: string; onClick: () => void }) {
  const meta = SORT_META[order] ?? SORT_META['alpha'];
  return (
    <button
      className="ch-sort-btn"
      onClick={onClick}
      title={meta.tooltip}
      aria-label={meta.tooltip}
    >
      {meta.icon}
    </button>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

interface SectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  children: React.ReactNode;
  compact?: boolean;
}

function Section({ label, expanded, onToggle, onAdd, children, compact }: SectionProps) {
  return (
    <div className="ch-section">
      {!compact && (
        <div className="ch-section-header" onClick={onToggle}>
          <ChevronIcon open={expanded} />
          <span className="ch-section-label">{label}</span>
          {onAdd && (
            <button
              className="ch-section-add"
              onClick={e => { e.stopPropagation(); onAdd(); }}
              aria-label={`Add ${label}`}
            >
              +
            </button>
          )}
        </div>
      )}
      {(expanded || compact) && <div className="ch-section-items" role="list">{children}</div>}

      <style>{`
        .ch-section { margin-bottom: 8px; }

        .ch-section-header {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 6px 4px 6px;
          cursor: pointer;
          user-select: none;
        }
        .ch-section-header:hover .ch-section-label { color: var(--text-primary); }
        .ch-section-header:hover .ch-section-add { opacity: 1; }

        .ch-section-label {
          flex: 1;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-secondary);
          transition: color var(--t-fast);
        }

        .ch-section-add {
          width: 16px; height: 16px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer;
          color: var(--text-secondary); font-size: 16px; line-height: 1;
          border-radius: 2px; opacity: 0; transition: opacity var(--t-fast);
          padding: 0;
        }
        .ch-section-add:hover { color: var(--text-primary); }

        .ch-section-items { display: flex; flex-direction: column; gap: 1px; }
      `}</style>
    </div>
  );
}

// ── ChannelRow icons (defined before use to satisfy strict TS) ────────────────

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1l1.8 3.6L14 5.3l-3 2.9.7 4.1L8 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7z" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M8 1l1.8 3.6L14 5.3l-3 2.9.7 4.1L8 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7z" />
    </svg>
  );
}

function AutoJoinIcon({ active }: { active: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v6l3 2" />
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

// ── Last message preview helper ───────────────────────────────────────────────

function getLastMessagePreview(channel: Channel): string | null {
  const msgs = channel.messages;
  if (!msgs.length) return null;
  const msg = msgs[msgs.length - 1];
  if (msg.type === 'msg') {
    const text = msg.text.slice(0, 40) + (msg.text.length > 40 ? '...' : '');
    return `${msg.from}: ${text}`;
  }
  if (msg.type === 'action') {
    return `* ${msg.from} ${msg.text.slice(0, 35)}`;
  }
  return null;
}

// ── ChannelRow ─────────────────────────────────────────────────────────────────

function ChannelRow({ channel, active, onClick, onContextMenu, starred, autoJoin, onToggleStar, onToggleAutoJoin, muted, channelColor, compact, forumIcon, unreadCount, mentionCount, isNsfw, onDragStart, onDragOver, onDrop }: {
  channel: Channel; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void;
  starred?: boolean; autoJoin?: boolean; onToggleStar?: () => void; onToggleAutoJoin?: () => void;
  muted?: boolean; channelColor?: string; compact?: boolean; forumIcon?: boolean;
  unreadCount?: number; mentionCount?: number; isNsfw?: boolean;
  onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void;
}) {
  const hasUnread = !muted && (channel.unread > 0 || (unreadCount ?? 0) > 0);
  const hasHighlight = !muted && (channel.highlights > 0 || (mentionCount ?? 0) > 0);
  const effectiveMentionCount = mentionCount ?? channel.highlights;
  const effectiveUnreadCount = unreadCount ?? channel.unread;
  const memberCount = channel.users.size;
  const channelName = channel.name.replace(/^[#&]/, '');
  const lastPreview = compact ? null : getLastMessagePreview(channel);
  const ariaLabel = muted
    ? `Muted: ${channelName}`
    : hasUnread
    ? `Unread: ${channelName}`
    : hasHighlight
    ? `Mention in: ${channelName}`
    : channelName;

  if (compact) {
    return (
      <Tooltip text={channelName} side="right">
        <button
          role="listitem"
          className={`ch-row ch-row--compact ${active ? 'ch-row--active' : ''} ${hasUnread ? 'ch-row--unread' : ''}`}
          onClick={onClick}
          onContextMenu={onContextMenu}
          aria-current={active ? 'page' : undefined}
          aria-label={ariaLabel}
        >
          {isNsfw
            ? <span className="ch-row-hash ch-row-nsfw-badge" aria-label="NSFW" title="NSFW channel">🔞</span>
            : channelColor
            ? <span className="ch-color-dot" style={{ background: channelColor }} aria-hidden />
            : forumIcon
            ? <span className="ch-row-hash ch-row-hash--forum" aria-hidden>📋</span>
            : <span className="ch-row-hash" aria-hidden>#</span>
          }
          {hasHighlight && <span className="ch-row-dot ch-row-dot--highlight" />}
          {hasUnread && !hasHighlight && <span className="ch-row-dot" />}
          <style>{`
            .ch-row--compact {
              justify-content: center;
              padding: 8px 0;
              margin: 0 4px;
              width: calc(100% - 8px);
              position: relative;
            }
            .ch-row--compact .ch-row-dot {
              position: absolute;
              top: 4px; right: 4px;
              width: 6px; height: 6px;
            }
            .ch-row--compact .ch-row-dot--highlight {
              background: var(--danger, #f04747);
            }
          `}</style>
        </button>
      </Tooltip>
    );
  }

  return (
    <button
      role="listitem"
      className={`ch-row ${active ? 'ch-row--active' : ''} ${hasUnread ? 'ch-row--unread' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
    >
      <span className="ch-drag-handle" aria-hidden title="Drag to reorder">⋮⋮</span>
      {channelColor && <span className="ch-color-dot" style={{ background: channelColor }} aria-hidden />}
      <span className={`ch-row-hash${forumIcon ? ' ch-row-hash--forum' : ''}`} aria-hidden>
        {isNsfw ? '🔞' : forumIcon ? '📋' : '#'}
      </span>
      <span className="ch-row-main">
        <span className={`ch-row-name${hasUnread || hasHighlight ? ' ch-row-name--unread' : ''}`}>{channelName}</span>
        {lastPreview && (
          <span className={`ch-last-preview${hasUnread || hasHighlight ? ' ch-last-preview--unread' : ''}`}>{lastPreview}</span>
        )}
      </span>
      <StageChannelBadge channelName={channel.name} listenerCount={memberCount} />
      {muted && <span className="ch-row-muted" aria-label="Muted" title="Notifications muted">🔕</span>}
      {hasHighlight && (
        <span className="unread-badge unread-badge--mention" aria-label={`${effectiveMentionCount} mentions`}>
          {effectiveMentionCount > 99 ? '99+' : effectiveMentionCount}
        </span>
      )}
      {hasUnread && !hasHighlight && effectiveUnreadCount > 0 && (
        <span className="unread-badge unread-badge--unread" aria-label={`${effectiveUnreadCount} unread`}>
          {effectiveUnreadCount > 99 ? '99+' : effectiveUnreadCount}
        </span>
      )}
      {hasUnread && !hasHighlight && effectiveUnreadCount === 0 && <span className="ch-row-dot" />}
      {!hasUnread && !hasHighlight && !muted && memberCount > 0 && (
        <span className="ch-row-count">{memberCount}</span>
      )}
      <span className="ch-row-actions" onClick={e => e.stopPropagation()}>
        {onToggleAutoJoin && (
          <Tooltip text={autoJoin ? 'Remove auto-join' : 'Auto-join on connect'} side="right">
            <span
              className={`ch-row-action-btn${autoJoin ? ' ch-row-action-btn--auto' : ''}`}
              role="button"
              aria-label={autoJoin ? 'Remove auto-join' : 'Auto-join on connect'}
              tabIndex={0}
              onClick={onToggleAutoJoin}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleAutoJoin(); } }}
            >
              <AutoJoinIcon active={!!autoJoin} />
            </span>
          </Tooltip>
        )}
        {onToggleStar && (
          <Tooltip text={starred ? 'Unstar channel' : 'Star channel'} side="right">
            <span
              className={`ch-row-action-btn${starred ? ' ch-row-action-btn--star' : ''}`}
              role="button"
              aria-label={starred ? 'Unstar channel' : 'Star channel'}
              tabIndex={0}
              onClick={onToggleStar}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleStar(); } }}
            >
              <StarIcon filled={!!starred} />
            </span>
          </Tooltip>
        )}
      </span>

      <style>{`
        .ch-row {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 8px 5px 4px;
          border-radius: var(--r-sm);
          margin: 0 6px;
          background: none; border: none; cursor: pointer;
          text-align: left; width: calc(100% - 12px);
          transition: background 150ms ease, border-color 150ms ease;
        }
        .ch-row:hover { background: var(--ch-hover-bg); }
        .ch-row--active { background: var(--ch-active-bg) !important; }

        .ch-drag-handle {
          font-size: 11px;
          letter-spacing: -1px;
          color: var(--text-muted);
          flex-shrink: 0;
          opacity: 0;
          cursor: grab;
          user-select: none;
          transition: opacity var(--t-fast);
          line-height: 1;
          padding: 0 2px;
        }
        .ch-row:hover .ch-drag-handle { opacity: 0.5; }
        .ch-drag-handle:hover { opacity: 1 !important; }

        .ch-row-nsfw-badge {
          font-size: 11px;
          flex-shrink: 0;
        }

        .ch-row-hash {
          font-size: 17px; font-weight: 500;
          color: var(--text-muted);
          flex-shrink: 0; line-height: 1;
          transition: color var(--t-fast);
        }
        .ch-row:hover .ch-row-hash, .ch-row--active .ch-row-hash { color: var(--text-secondary); }
        .ch-row-hash--forum { font-size: 13px; }

        .ch-row-main {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column;
          overflow: hidden;
        }

        .ch-row-name {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 14px; font-weight: 500;
          color: var(--ch-read); transition: color var(--t-fast);
        }
        .ch-row--unread .ch-row-name, .ch-row:hover .ch-row-name,
        .ch-row--active .ch-row-name { color: var(--ch-unread); }
        .ch-row-name--unread { font-weight: 600; color: var(--text-primary) !important; }

        .ch-last-preview {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
          line-height: 1.3;
          margin-top: 1px;
        }
        .ch-last-preview--unread { font-weight: 600; }

        .ch-color-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-right: 2px;
        }

        .ch-row-muted {
          font-size: 11px;
          flex-shrink: 0;
          opacity: 0.5;
        }

        .ch-row-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--text-primary); flex-shrink: 0;
        }
        .ch-row-count {
          font-size: 11px; color: var(--text-muted);
          flex-shrink: 0; min-width: 16px; text-align: right;
          opacity: 0; transition: opacity var(--t-fast);
        }
        .ch-row:hover .ch-row-count,
        .ch-row--active .ch-row-count { opacity: 1; }

        .ch-row-actions {
          display: flex; align-items: center; gap: 2px;
          flex-shrink: 0;
          opacity: 0; transition: opacity var(--t-fast);
        }
        .ch-row:hover .ch-row-actions,
        .ch-row--active .ch-row-actions { opacity: 1; }

        .ch-row-action-btn {
          display: flex; align-items: center; justify-content: center;
          width: 18px; height: 18px;
          border-radius: 3px;
          color: var(--text-muted);
          cursor: pointer;
          transition: color var(--t-fast), background var(--t-fast);
          flex-shrink: 0;
        }
        .ch-row-action-btn:hover { color: var(--text-primary); background: var(--bg-overlay); }
        .ch-row-action-btn--star { color: #e8b84b; }
        .ch-row-action-btn--star:hover { color: #f0c95c; }
        .ch-row-action-btn--auto { color: var(--accent); }
        .ch-row-action-btn--auto:hover { color: var(--accent); }

        /* Unread badge transition — springs down slightly when channel becomes active */
        .ch-row .unread-badge {
          min-width: 16px; height: 16px;
          border-radius: 8px; padding: 0 4px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .ch-row .unread-badge--mention {
          background: var(--danger, #ed4245);
        }
        .ch-row .unread-badge--unread {
          background: var(--text-muted);
        }
        .ch-row--active .unread-badge {
          transform: scale(0.85);
        }

        @media (prefers-reduced-motion: reduce) {
          .ch-row .unread-badge { transition: none; }
          .ch-row--active .unread-badge { transform: none; }
        }
      `}</style>
    </button>
  );
}

// ── VoiceChannelRow ────────────────────────────────────────────────────────────

const MAX_AVATARS = 4;

function VoiceChannelRow({ channel, active, onClick, speakingNicks, participants, ourNick, onLeave }: {
  channel: Channel;
  active: boolean;
  onClick: () => void | Promise<void>;
  speakingNicks?: Set<string>;
  participants?: Set<string>;
  ourNick?: string | null;
  onLeave?: (() => void) | undefined;
}) {
  const [hovered, setHovered] = useState(false);
  const users = [...channel.users.values()];
  const displayUsers = users.slice(0, MAX_AVATARS);
  const overflow = users.length - MAX_AVATARS;
  const hasUsers = users.length > 0;

  // Channel display name without sigils
  const displayName = channel.name.replace(/^[#&+]/, '');

  // Count how many channel members are currently speaking
  const speakingCount = speakingNicks
    ? users.filter(u => speakingNicks.has(u.nick.toLowerCase())).length
    : 0;

  const participantCount = participants?.size ?? 0;

  return (
    <div
      className={`vch-wrap ${active ? 'vch-wrap--active' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`vch-row ${active ? 'vch-row--active ch-row--voice-connected' : ''}`}
        onClick={onClick}
        aria-label={active ? `Connected to ${displayName}` : `Join ${displayName}`}
      >
        <div className="vch-row-left">
          {active && <span className="vch-active-dot" aria-hidden />}
          <VoiceIcon />
          <span className="vch-name">{displayName}</span>
          {participantCount > 0 && (
            <span className="vc-participant-count">({participantCount})</span>
          )}
        </div>

        <div className="vch-row-right">
          {speakingCount > 0 && (
            <SpeakingBars speaking size="sm" />
          )}
          {active && onLeave && (
            <button
              className="vc-leave-btn"
              onClick={e => { e.stopPropagation(); onLeave(); }}
              aria-label="Leave voice channel"
              title="Leave voice"
            >
              ✕
            </button>
          )}
          {!hovered && !active && hasUsers && (
            <span className="vch-count">{channel.users.size}</span>
          )}
          {hovered && !active && (
            <Tooltip text="Join Voice" side="left">
              <span className="vch-join-hint" aria-hidden>Join</span>
            </Tooltip>
          )}
        </div>
      </button>

      {/* Participant sub-list — Discord style */}
      {participantCount > 0 && participants && (
        <ul className="vc-participant-list" aria-label={`${displayName} participants`}>
          {Array.from(participants).map(nick => (
            <li key={nick} className="vc-participant-row">
              <span className="vc-participant-dot" />
              <span className="vc-participant-nick">{nick}</span>
              {ourNick && nick.toLowerCase() === ourNick.toLowerCase() && (
                <span className="vc-you-badge">You</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Member avatars with speaking ring */}
      {hasUsers && (
        <div className="vch-avatars">
          {displayUsers.map(u => {
            const isSpeaking = speakingNicks?.has(u.nick.toLowerCase()) ?? false;
            return (
              <Tooltip key={u.nick} text={u.nick} side="right">
                <span className={`vch-avatar-wrap${isSpeaking ? ' vch-avatar-wrap--speaking' : ''}`}>
                  <Avatar nick={u.nick} size={20} />
                  {isSpeaking && <span className="vch-avatar-speaking-ring" aria-hidden />}
                </span>
              </Tooltip>
            );
          })}
          {overflow > 0 && (
            <span className="vch-avatar-overflow">+{overflow}</span>
          )}
        </div>
      )}

      <style>{`
        .vch-wrap {
          display: flex; flex-direction: column;
          margin: 0 6px;
          border-radius: var(--r-sm);
        }
        .vch-wrap:hover { background: var(--ch-hover-bg); }
        .vch-wrap--active { background: var(--ch-active-bg); }

        .vch-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 6px;
          padding: 5px 8px 5px 12px;
          background: none; border: none; cursor: pointer;
          text-align: left; width: 100%;
          border-radius: var(--r-sm);
        }
        .vch-row:focus-visible { outline: 2px solid var(--accent); }

        .vch-row-left {
          display: flex; align-items: center; gap: 6px;
          overflow: hidden; flex: 1; min-width: 0;
        }
        .vch-row-right {
          display: flex; align-items: center; gap: 4px;
          flex-shrink: 0;
        }

        .vch-active-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--status-online);
          flex-shrink: 0;
          box-shadow: 0 0 0 0 rgba(34,197,94,0.5);
          animation: vch-pulse 2s ease-in-out infinite;
        }
        @keyframes vch-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          70%  { box-shadow: 0 0 0 5px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }

        .vch-name {
          flex: 1; font-size: 14px; font-weight: 500; color: var(--ch-read);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          transition: color var(--t-fast);
        }
        .vch-wrap:hover .vch-name,
        .vch-wrap--active .vch-name { color: var(--ch-unread); }

        .vch-count {
          font-size: 11px; color: var(--text-muted); flex-shrink: 0;
        }

        .vch-join-hint {
          font-size: 11px; font-weight: 600;
          color: var(--status-online);
          padding: 1px 6px; border-radius: var(--r-full);
          border: 1px solid rgba(34,197,94,0.3);
          background: rgba(34,197,94,0.08);
          white-space: nowrap;
          transition: background var(--t-fast), border-color var(--t-fast);
        }
        .vch-wrap:hover .vch-join-hint {
          background: rgba(34,197,94,0.14);
          border-color: rgba(34,197,94,0.5);
        }

        /* Avatars row */
        .vch-avatars {
          display: flex; align-items: center;
          gap: 3px;
          padding: 0 12px 6px 34px;
          flex-wrap: wrap;
        }
        .vch-avatar-wrap {
          position: relative;
          display: block;
          border-radius: 50%;
          overflow: visible;
          border: 1.5px solid var(--bg-deep);
          transition: transform var(--t-fast);
        }
        .vch-avatar-wrap > :first-child {
          border-radius: 50%;
          overflow: hidden;
          display: block;
        }
        .vch-avatar-wrap:hover { transform: scale(1.1); }

        .vch-avatar-wrap--speaking {
          border-color: var(--status-online, #22c55e);
        }

        .vch-avatar-speaking-ring {
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 2px solid var(--status-online, #22c55e);
          pointer-events: none;
          animation: vch-speak-ring 900ms ease-in-out infinite;
        }

        @keyframes vch-speak-ring {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; box-shadow: 0 0 0 3px rgba(34,197,94,0); }
        }

        .vch-avatar-overflow {
          font-size: 10px; font-weight: 700;
          color: var(--text-muted);
          min-width: 20px; height: 20px;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-overlay);
          border-radius: 50%;
          border: 1.5px solid var(--bg-deep);
        }

        /* ── Voice channel presence / participant UI ── */
        .ch-row--voice-connected {
          background: rgba(35, 165, 90, 0.12) !important;
          color: #23a55a !important;
        }

        .vc-participant-count {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: 2px;
          flex-shrink: 0;
        }

        .vc-participant-list {
          list-style: none;
          margin: 0;
          padding: 0 0 4px 24px;
        }
        .vc-participant-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 4px;
          border-radius: 4px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .vc-participant-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #23a55a;
          flex-shrink: 0;
        }
        .vc-you-badge {
          font-size: 10px;
          color: var(--text-muted);
          background: var(--bg-surface);
          padding: 0 4px;
          border-radius: 3px;
        }

        .vc-leave-btn {
          display: flex; align-items: center; justify-content: center;
          width: 18px; height: 18px;
          border: none; border-radius: 3px;
          background: rgba(237, 66, 69, 0.15);
          color: #ed4245;
          cursor: pointer;
          font-size: 10px;
          line-height: 1;
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
          padding: 0;
        }
        .vc-leave-btn:hover {
          background: rgba(237, 66, 69, 0.3);
          color: #ff5f62;
        }
      `}</style>
    </div>
  );
}

// ── DMRow ──────────────────────────────────────────────────────────────────────

function DMRow({ dm, active, muted, onClick, onContextMenu }: {
  dm: DMConversation;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const statusClass = dm.away === true ? 'dm-status--idle' : dm.away === false ? 'dm-status--online' : 'dm-status--unknown';
  return (
    <button className={`dm-row ${active ? 'dm-row--active' : ''} ${muted ? 'dm-row--muted' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
      <span className="dm-avatar-wrap">
        <Avatar nick={dm.nick} size={28} />
        <span className={`dm-status-dot ${statusClass}`} aria-hidden />
      </span>
      <span className={`dm-nick ${!muted && dm.unread > 0 ? 'dm-nick--unread' : ''}`}>{dm.nick}</span>
      {muted && <span className="dm-muted-icon" aria-label="Muted" title="Notifications muted">🔕</span>}
      {!muted && dm.highlights > 0 && <span className="unread-badge">{dm.highlights > 99 ? '99+' : dm.highlights}</span>}

      <style>{`
        .dm-row {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 8px 4px 12px;
          border-radius: var(--r-sm); margin: 0 6px;
          background: none; border: none; cursor: pointer;
          text-align: left; width: calc(100% - 12px);
          transition: background var(--t-fast);
        }
        .dm-row:hover { background: var(--ch-hover-bg); }
        .dm-row--active { background: var(--ch-active-bg); }
        .dm-nick { flex: 1; font-size: 14px; font-weight: 500; color: var(--ch-read); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dm-nick--unread, .dm-row:hover .dm-nick, .dm-row--active .dm-nick { color: var(--ch-unread); }

        .dm-avatar-wrap {
          position: relative;
          width: 28px; height: 28px;
          flex-shrink: 0;
        }
        .dm-status-dot {
          position: absolute;
          bottom: -1px; right: -1px;
          width: 9px; height: 9px;
          border-radius: 50%;
          border: 2px solid var(--bg-deep);
        }
        .dm-status--online  { background: var(--status-online); }
        .dm-status--idle    { background: var(--status-idle); }
        .dm-status--unknown { background: var(--status-offline); }
        .dm-row--muted .dm-nick { opacity: 0.55; }
        .dm-muted-icon { font-size: 12px; opacity: 0.6; flex-shrink: 0; }
      `}</style>
    </button>
  );
}

// ── DMContextMenu ──────────────────────────────────────────────────────────────

function DMContextMenu({ nick, x, y, muted, onMute, onUnmute, onClose }: {
  nick: string;
  x: number;
  y: number;
  muted: boolean;
  onMute: () => void;
  onUnmute: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="dm-ctx-backdrop" onClick={onClose} />
      <div
        className="dm-ctx-menu"
        style={{ top: y, left: x }}
        role="menu"
        aria-label={`Options for ${nick}`}
      >
        <button className="dm-ctx-item" role="menuitem" onClick={muted ? onUnmute : onMute}>
          {muted ? '🔔 Unmute DM' : '🔕 Mute DM'}
        </button>
      </div>
      <style>{`
        .dm-ctx-backdrop {
          position: fixed; inset: 0; z-index: 299;
        }
        .dm-ctx-menu {
          position: fixed; z-index: 300;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          padding: 4px;
          min-width: 140px;
          animation: dm-ctx-pop 0.1s ease both;
        }
        @keyframes dm-ctx-pop {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        .dm-ctx-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%;
          padding: 7px 10px;
          font-size: 13px;
          color: var(--text-primary);
          background: none; border: none; cursor: pointer;
          border-radius: var(--r-sm);
          text-align: left;
          transition: background var(--t-fast);
        }
        .dm-ctx-item:hover { background: var(--ch-hover-bg); }
      `}</style>
    </>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 150ms', color: 'var(--text-muted)' }}>
      <path d="M3 2l4 3-4 3V2z" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
      <path d="M7.5 1a2 2 0 0 0-2 2v4.5a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 6.5a4.5 4.5 0 0 0 9 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 11v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ServerMenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
      <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BrowseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: 'var(--text-muted)' }}>
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" />
      <path d="M7 4.5v5M4.5 7h5" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
      <path d="M2 12l3-4 3 2 3-5 3 3" />
      <path d="M2 14h12" />
    </svg>
  );
}

function SearchSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: 'var(--text-muted)' }}>
      <circle cx="7" cy="7" r="5" />
      <path d="M12 12l2.5 2.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}
