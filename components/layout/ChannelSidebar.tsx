'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import SkeletonChannel from '@/components/chat/SkeletonChannel';
import type { Channel } from '@/lib/irc/types';
import type { DMConversation } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import AvatarStack from '@/components/ui/AvatarStack';
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

  const channelList   = [...channels.values()];
  // IRC +V mode = LADON voice channel; also channels with '+' prefix (IRCX voice)
  const ircVoiceChannels = channelList.filter(c =>
    c.modes.includes('V') ||
    c.name.startsWith('+') ||
    voiceChannels.includes(c.name.toLowerCase())
  );

  // ── Keyboard navigation: Up/Down navigate channels when sidebar has focus ─────
  const navRef = useRef<HTMLElement>(null);
  const navItems = useMemo((): Array<{ kind: 'channel'; channel: string } | { kind: 'dm'; nick: string }> => {
    const chans = [...channels.values()]
      .filter(c => !c.modes.includes('V') && !c.name.startsWith('+') && !voiceChannels.includes(c.name.toLowerCase()))
      .map(c => ({ kind: 'channel' as const, channel: c.name }));
    const dmsArr = [...dms.values()].map(d => ({ kind: 'dm' as const, nick: d.nick }));
    return [...chans, ...dmsArr];
  }, [channels, dms, voiceChannels]);

  const handleSidebarKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();

    const currentIdx = navItems.findIndex(item =>
      item.kind === 'channel'
        ? activeView.kind === 'channel' && item.channel.toLowerCase() === activeView.channel.toLowerCase()
        : activeView.kind === 'dm' && item.nick.toLowerCase() === activeView.nick.toLowerCase()
    );

    if (e.key === 'Enter' && currentIdx >= 0) {
      // Already navigated — do nothing (already selected)
      return;
    }

    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = navItems[(currentIdx + dir + navItems.length) % navItems.length];
    if (next) {
      navigate(next);
      onNavigate?.();
    }
  }, [navItems, activeView, navigate, onNavigate]);

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
  const dmList = [...dms.values()]
    .filter(dm => dm.nick) // defensive: skip ghost entries with blank nick
    .sort((a, b) => b.highlights - a.highlights || b.unread - a.unread || a.nick.localeCompare(b.nick));

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

      <nav className="ch-scroll" aria-label="Channel navigation" ref={navRef} onKeyDown={handleSidebarKeyDown} tabIndex={-1}>

        {/* ── Skeleton during initial connection ───────────────────────── */}
        {connectionStatus === 'connecting' && (
          <SkeletonChannel count={7} />
        )}

        {/* ── Sort control ─────────────────────────────────────────────── */}
        {compactSidebar && connectionStatus !== 'connecting' && textLikeChannels.length > 1 && (
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
          const starredUnread = starredList.reduce((sum, c) => sum + (channelUnread[c.name.toLowerCase()] ?? 0), 0);
          return (
            <Section
              label="Starred"
              expanded={!collapsed.has('__starred__')}
              onToggle={() => toggleCategory('__starred__')}
              compact={compactSidebar}
              unreadBadge={starredUnread}
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
          unreadBadge={dmList.reduce((sum, dm) => sum + (dm.unread ?? 0), 0)}
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

      {/* Server tools */}
      {!compactSidebar && (
        <div className="ch-footer-tools" aria-label="Server tools">
          <button className="ch-browse-btn" onClick={openChannelBrowser}>
            <BrowseIcon />
            Browse channels
          </button>

          <button className="ch-browse-btn" onClick={openServerStats} aria-label="Show server stats">
            <StatsIcon />
            Server stats
          </button>

          <button className="ch-spotlight-btn" onClick={openSpotlight} aria-label="Open quick navigation (Ctrl+K)">
            <SearchSmallIcon />
            <span className="ch-spotlight-label">Quick jump</span>
            <kbd className="ch-spotlight-kbd">⌘K</kbd>
          </button>
        </div>
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
          background: color-mix(in srgb, var(--bg-void) 92%, var(--bg-deep));
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
          height: var(--header-h);
          min-height: var(--header-h);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px 0 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          cursor: pointer;
          gap: 8px;
          box-sizing: border-box;
          background: color-mix(in srgb, var(--bg-deep) 76%, transparent);
          box-shadow:
            inset 0 -1px 0 color-mix(in srgb, var(--bg-void) 70%, transparent),
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .ch-header:hover { background: color-mix(in srgb, var(--bg-base) 78%, var(--ch-hover-bg)); }

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
          letter-spacing: 0;
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
          padding: 10px 6px 14px;
          min-height: 0;
          scrollbar-gutter: stable;
          background: transparent;
          scrollbar-color: var(--bg-overlay) transparent;
          scrollbar-width: thin;
        }
        .ch-scroll::-webkit-scrollbar { width: 8px; }
        .ch-scroll::-webkit-scrollbar-track { background: transparent; }
        .ch-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--bg-overlay) 78%, transparent);
          border: 2px solid transparent;
          border-radius: var(--r-full);
          background-clip: padding-box;
        }
        .ch-scroll::-webkit-scrollbar-thumb:hover {
          background: color-mix(in srgb, var(--accent-border) 52%, var(--bg-overlay));
          background-clip: padding-box;
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
          padding: 7px 12px 8px 28px;
          margin: 1px 6px 2px;
          border-radius: var(--r-sm);
          background: color-mix(in srgb, var(--bg-deep) 58%, transparent);
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
          width: calc(100% - 20px);
          min-height: 34px;
          margin: 2px 10px 0;
          padding: 7px 10px;
          background: transparent;
          border: 1px solid transparent;
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
          border-color: var(--border-subtle);
          color: var(--text-primary);
        }
        .ch-browse-btn svg {
          flex-shrink: 0;
          opacity: 0.7;
        }
        .ch-browse-btn:hover svg { opacity: 1; }

        .ch-footer-tools {
          display: grid;
          gap: 4px;
          margin: 6px 10px 2px;
          padding: 6px;
          border: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent);
          border-radius: var(--r-md);
          background: var(--elev-tint-1, color-mix(in srgb, var(--bg-deep) 92%, var(--accent) 2%));
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-1, 0 12px 24px rgba(0,0,0,.24));
          flex-shrink: 0;
        }
        .ch-footer-tools .ch-browse-btn,
        .ch-footer-tools .ch-spotlight-btn {
          width: 100%;
          margin: 0;
          border-color: transparent;
        }
        .ch-footer-tools .ch-spotlight-btn {
          background: color-mix(in srgb, var(--bg-deep) 72%, transparent);
          border-color: var(--border-subtle);
        }

        .ch-status-area {
          padding: 4px 10px 0;
          flex-shrink: 0;
        }

        .ch-join {
          padding: 6px 10px 8px;
          flex-shrink: 0;
        }
        @media (max-width: 768px) {
          .ch-join { display: none; }
        }

        .ch-join-input {
          width: 100%;
          padding: 6px 10px;
          background: transparent;
          border: 1px dashed var(--border-subtle);
          border-radius: var(--r-sm);
          font-size: 12px;
          color: var(--text-muted);
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color var(--t-fast), color var(--t-fast), background var(--t-fast);
        }
        .ch-join-input:focus {
          outline: none;
          border-color: var(--accent-border);
          border-style: solid;
          color: var(--text-secondary);
          background: var(--bg-deep);
        }
        .ch-join-input::placeholder { color: var(--text-muted); opacity: 0.65; }

        .ch-spotlight-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          width: calc(100% - 20px);
          min-height: 34px;
          margin: 2px 10px 2px;
          padding: 6px 10px;
          background: color-mix(in srgb, var(--bg-void) 70%, transparent);
          border: 1px solid var(--border-subtle);
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
          border-color: var(--border-normal);
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
          width: 36px;
          height: 36px;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
          margin-left: 4px;
          -webkit-tap-highlight-color: transparent;
        }
        .ch-mobile-close:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }
        @media (max-width: 768px) {
          .ch-mobile-close {
            width: 44px;
            height: 44px;
          }
        }

        @media (min-width: 769px) {
          .ch-mobile-close { display: none; }
        }

        /* ── Sort bar ── */
        .ch-sort-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px 6px;
          margin: 0 2px 7px;
          border-bottom: 1px solid var(--border-subtle);
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
          border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-deep) 70%, transparent);
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          flex-shrink: 0;
          padding: 0;
        }
        .ch-sort-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
          transform: translateY(-1px);
        }

        /* Draggable wrapper */
        .ch-draggable-wrap {
          cursor: grab;
        }
        .ch-draggable-wrap:active {
          cursor: grabbing;
          opacity: 0.75;
        }

        /* ── Shared channel list polish ─────────────────────────────── */
        .ch-section {
          margin: 8px 0 10px;
        }
        .ch-section + .ch-section {
          border-top: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
          margin-top: 10px;
          padding-top: 8px;
        }
        .ch-section-header,
        .cfp-folder-header {
          min-height: 28px;
          margin: 0 2px 4px;
          padding: var(--sp-1, 4px) var(--sp-2, 8px);
          border: 1px solid transparent;
          border-radius: var(--r-md);
          background: transparent;
          transition:
            background var(--t-micro, 90ms) var(--ease-out),
            border-color var(--t-micro, 90ms) var(--ease-out);
        }
        .ch-section-header:hover,
        .cfp-folder-header:hover {
          background: color-mix(in srgb, var(--bg-elevated) 54%, var(--ch-hover-bg));
          border-color: var(--border-subtle);
        }
        .ch-section-label,
        .cfp-folder-name {
          font-size: 10px;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          font-weight: 800;
          color: var(--text-muted);
        }
        .ch-section-header:hover .ch-section-label,
        .cfp-folder-header:hover .cfp-folder-name {
          color: var(--text-secondary);
        }
        .ch-section-count,
        .cfp-folder-count {
          background: color-mix(in srgb, var(--bg-float) 58%, transparent);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent);
        }
        .ch-section-unread-badge {
          background: var(--unread, var(--lux, #d8b96a));
          color: color-mix(in srgb, var(--bg-void) 88%, black);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .ch-section-items,
        .cfp-folder-body {
          gap: 2px;
        }

        .cfp-root {
          gap: 2px;
        }
        .cfp-folder {
          margin: 0 0 9px;
        }
        .cfp-folder-body {
          padding: 0 0 2px;
        }
        .cfp-row,
        .ch-row,
        .dm-row,
        .vch-row {
          position: relative;
          border: 1px solid transparent;
          box-shadow: none;
          transition:
            background var(--t-micro, 90ms) var(--ease-out),
            border-color var(--t-micro, 90ms) var(--ease-out),
            color var(--t-micro, 90ms) var(--ease-out),
            transform var(--t-micro, 90ms) var(--ease-out);
        }
        .cfp-row {
          min-height: 32px;
          padding: 0 var(--sp-2, 8px) 0 var(--sp-3, 12px);
          margin: 0 4px;
          border-left: 0;
        }
        .ch-row {
          border-left: 0;
        }
        .ch-row,
        .dm-row {
          margin: 0 2px;
          width: calc(100% - 4px);
        }
        .ch-row:hover,
        .cfp-row:hover,
        .dm-row:hover,
        .vch-wrap:hover .vch-row {
          background: color-mix(in srgb, var(--bg-elevated) 66%, var(--ch-hover-bg));
          border-color: var(--border-subtle);
        }
        .ch-row--active,
        .cfp-row--active,
        .dm-row--active,
        .vch-row--active {
          background: var(--elev-tint-2, color-mix(in srgb, var(--bg-elevated) 86%, var(--lux, #d8b96a) 4%)) !important;
          border-color: color-mix(in srgb, var(--lux, #d8b96a) 22%, transparent) !important;
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-1, 0 10px 20px rgba(0,0,0,.22));
        }
        .ch-row--active::before,
        .cfp-row--active::before,
        .dm-row--active::before,
        .vch-row--active::before {
          content: '';
          position: absolute;
          left: 4px;
          top: 7px;
          bottom: 7px;
          width: 2px;
          border-radius: 999px;
          background: var(--lux, #d8b96a);
        }
        .ch-row--unread:not(.ch-row--active),
        .cfp-row--unread:not(.cfp-row--active) {
          background: var(--elev-tint-1, color-mix(in srgb, var(--bg-deep) 90%, var(--lux, #d8b96a) 3%));
          border-color: color-mix(in srgb, var(--lux, #d8b96a) 14%, transparent);
        }
        .ch-row--unread:not(.ch-row--active)::after,
        .cfp-row--unread:not(.cfp-row--active)::after {
          content: '';
          position: absolute;
          left: 7px;
          top: 50%;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--unread, var(--lux, #d8b96a));
          transform: translateY(-50%);
        }
        .ch-row--compact {
          justify-content: center;
          padding: 0;
          min-height: 32px;
          width: calc(100% - 8px);
          margin: 0 4px;
        }
        .ch-row--compact .ch-row-dot {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
        }
        .ch-row--compact.ch-row--active {
          border-left-color: transparent !important;
        }
        .ch-row-hash,
        .cfp-hash {
          color: color-mix(in srgb, var(--text-muted) 82%, transparent);
        }
        .ch-row--unread .ch-row-hash,
        .cfp-row--unread .cfp-hash,
        .ch-row--active .ch-row-hash,
        .cfp-row--active .cfp-hash {
          color: var(--lux, #d8b96a);
        }
        .ch-row-name,
        .cfp-name,
        .dm-nick {
          letter-spacing: 0;
        }
        .ch-last-preview {
          color: color-mix(in srgb, var(--text-muted) 82%, transparent);
        }
        .ch-last-preview--unread {
          color: var(--text-secondary);
        }
        .ch-row-count {
          color: var(--text-secondary);
        }
        .ch-row-dot {
          background: var(--unread, var(--lux, #d8b96a));
          box-shadow: none;
        }
        .ch-row-dot--highlight {
          background: var(--danger);
          box-shadow: none;
        }
        .ch-row .unread-badge,
        .cfp-badge,
        .dm-row .unread-badge {
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-1, 0 6px 14px rgba(0,0,0,.24));
        }
        .ch-row .unread-badge--unread,
        .cfp-badge--unread {
          background: var(--unread, var(--lux, #d8b96a));
          color: color-mix(in srgb, var(--bg-void) 90%, black);
        }
        .ch-row .unread-badge--mention,
        .cfp-badge--mention,
        .dm-row .unread-badge {
          background: var(--danger);
          box-shadow: var(--elev-shadow-1, 0 6px 14px rgba(0,0,0,.24));
        }
        .ch-row-actions {
          background: color-mix(in srgb, var(--bg-elevated) 90%, transparent);
          border-radius: var(--r-sm);
        }
        .ch-row-action-btn {
          border-radius: var(--r-xs);
        }
        .ch-row-action-btn:hover {
          background: var(--bg-overlay);
        }

        .cfp-folder-header--drag-over,
        .cfp-row--drag-over {
          background: var(--accent-subtle);
          outline: 1px dashed var(--accent-border);
          outline-offset: -2px;
          box-shadow: inset 0 0 0 1px var(--accent-border);
        }
        .cfp-empty {
          margin: 0 6px 2px;
          padding: 7px 12px 7px 28px;
          background: color-mix(in srgb, var(--bg-deep) 58%, transparent);
          border: 1px dashed var(--border-subtle);
        }
        .cfp-add-folder {
          min-height: 30px;
          margin: 7px 6px 4px;
          background: color-mix(in srgb, var(--bg-deep) 48%, transparent);
          border-color: var(--border-subtle);
        }
        .cfp-add-folder:hover {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
        }

        .vch-wrap {
          margin: 0 4px 2px;
        }
        .vch-row {
          min-height: 32px;
          border-left: 0;
        }
        .vch-wrap--active {
          background: transparent;
        }
        .vch-wrap--active .vch-row {
          box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent);
        }
        .vch-avatars {
          padding-top: 2px;
        }
        .ch-section-header {
          display: flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          user-select: none;
        }
        .ch-section-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ch-section-add {
          width: 16px; height: 16px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); font-size: 16px; line-height: 1;
          border-radius: 2px; opacity: 0;
          transition: opacity var(--t-micro, 90ms) var(--ease-out), color var(--t-micro, 90ms);
          padding: 0;
        }
        .ch-section-header:hover .ch-section-add { opacity: 1; }
        .ch-section-add:hover { color: var(--text-primary); }
        .ch-section-unread-badge {
          min-width: 18px;
          height: 16px;
          padding: 0 5px;
          font-size: 10px;
          font-weight: 800;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          line-height: 1;
          letter-spacing: 0;
          animation: ch-badge-pop var(--t-surface, 220ms) var(--ease-spring, cubic-bezier(0.34,1.4,0.4,1)) both;
        }
        @keyframes ch-badge-pop {
          from { transform: scale(0.6); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        .ch-section-items { display: flex; flex-direction: column; gap: 2px; }

        .ch-row {
          display: flex; align-items: center; gap: 6px;
          padding: 0 var(--sp-2, 8px) 0 var(--sp-3, 12px);
          min-height: 32px;
          height: auto;
          border-radius: var(--r-sm);
          background: none; cursor: pointer;
          text-align: left; width: 100%;
          -webkit-tap-highlight-color: transparent;
        }
        @media (max-width: 768px) {
          .ch-row { min-height: 40px; }
          .dm-row { min-height: 40px; }
          .vch-row { min-height: 40px; }
        }
        .ch-drag-handle {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
          opacity: 0;
          cursor: grab;
          user-select: none;
          transition: opacity var(--t-micro, 90ms);
          line-height: 1;
          padding: 0 2px;
        }
        .ch-row:hover .ch-drag-handle { opacity: 0.5; }
        .ch-drag-handle:hover { opacity: 1 !important; }
        .ch-row-nsfw-badge { font-size: 11px; flex-shrink: 0; }
        .ch-row-hash {
          font-size: 17px; font-weight: 500;
          color: var(--text-muted);
          flex-shrink: 0; line-height: 1;
          transition: color var(--t-micro, 90ms);
        }
        .ch-row-hash--forum { font-size: 13px; }
        .ch-row-main {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .ch-row-name {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: var(--text-sm, 13px); font-weight: 500;
          color: var(--ch-read); transition: color var(--t-micro, 90ms) var(--ease-out);
          line-height: 1.3;
        }
        .ch-row--unread .ch-row-name { color: var(--text-primary); font-weight: 650; }
        .ch-row:hover .ch-row-name,
        .ch-row--active .ch-row-name { color: var(--text-primary); }
        .ch-row-name--unread { font-weight: 700; color: var(--text-primary) !important; }
        .ch-last-preview {
          font-size: var(--text-2xs, 11px);
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
        .ch-row-muted { font-size: 11px; flex-shrink: 0; opacity: 0.5; }
        .ch-row-dot {
          width: 8px; height: 8px; border-radius: 50%;
          flex-shrink: 0;
          opacity: 0.85;
        }
        .ch-row-count {
          font-size: 11px; color: var(--text-muted);
          flex-shrink: 0; min-width: 16px; text-align: right;
          opacity: 0; transition: opacity var(--t-micro, 90ms);
        }
        .ch-row:hover .ch-row-count,
        .ch-row--active .ch-row-count { opacity: 1; }
        .ch-row-actions {
          display: flex; align-items: center; gap: 2px;
          flex-shrink: 0;
          min-width: 42px;
          justify-content: flex-end;
          opacity: 0; transition: opacity var(--t-micro, 90ms);
        }
        .ch-row:hover .ch-row-actions,
        .ch-row--active .ch-row-actions { opacity: 1; }
        .ch-row-action-btn {
          display: flex; align-items: center; justify-content: center;
          width: 18px; height: 18px;
          border-radius: 3px;
          color: var(--text-muted);
          cursor: pointer;
          transition: color var(--t-micro, 90ms), background var(--t-micro, 90ms);
          flex-shrink: 0;
        }
        .ch-row-action-btn:hover { color: var(--text-primary); background: var(--bg-overlay); }
        .ch-row-action-btn--star { color: var(--lux, #d8b96a); }
        .ch-row-action-btn--auto { color: var(--accent); }
        .ch-row .unread-badge {
          min-width: 16px; height: 16px;
          border-radius: 8px; padding: 0 4px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800;
          color: #fff;
          flex-shrink: 0;
          transition: transform var(--t-surface, 220ms) var(--ease-spring, cubic-bezier(0.34,1.4,0.4,1));
        }
        .ch-row .unread-badge--mention { background: var(--danger, #ed4245); }
        .ch-row--active .unread-badge { transform: scale(0.85); }

        .vch-wrap {
          display: flex; flex-direction: column;
          border-radius: var(--r-sm);
        }
        .vch-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 6px;
          padding: 0 var(--sp-2, 8px) 0 var(--sp-3, 12px);
          background: none; cursor: pointer;
          text-align: left; width: 100%;
          border-radius: var(--r-sm);
        }
        .vch-row:focus-visible { outline: 2px solid var(--lux, #d8b96a); outline-offset: 1px; }
        .vch-row-left {
          display: flex; align-items: center; gap: 6px;
          overflow: hidden; flex: 1; min-width: 0;
        }
        .vch-row-right {
          display: flex; align-items: center; gap: 4px;
          flex-shrink: 0;
        }
        .vch-facepile :global(.avatar-stack-item) {
          width: 20px;
          height: 20px;
          font-size: 9px;
          border-color: var(--bg-void);
        }
        .vch-active-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--lux, #d8b96a);
          flex-shrink: 0;
        }
        .vch-name {
          flex: 1; font-size: var(--text-sm, 13px); font-weight: 500; color: var(--text-secondary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          opacity: 0.88;
        }
        .vch-wrap:hover .vch-name,
        .vch-wrap--active .vch-name { color: var(--text-primary); opacity: 1; }
        .vch-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
        .vch-join-hint {
          font-size: 11px; font-weight: 700;
          color: var(--lux, #d8b96a);
          padding: 1px 6px; border-radius: var(--r-full);
          background: color-mix(in srgb, var(--lux, #d8b96a) 10%, transparent);
          white-space: nowrap;
        }
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
          transition: transform var(--t-micro, 90ms);
        }
        .vch-avatar-wrap > :first-child {
          border-radius: 50%;
          overflow: hidden;
          display: block;
        }
        .vch-avatar-wrap:hover { transform: scale(1.08); }
        .vch-avatar-wrap--speaking { border-color: var(--status-online, #22c55e); }
        .vch-avatar-speaking-ring {
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 2px solid var(--status-online, #22c55e);
          pointer-events: none;
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
        .ch-row--voice-connected {
          background: color-mix(in srgb, var(--status-online, #23a55a) 12%, transparent) !important;
          color: var(--status-online, #23a55a) !important;
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
          background: var(--status-online, #23a55a);
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
          background: color-mix(in srgb, var(--danger, #ed4245) 16%, transparent);
          color: var(--danger, #ed4245);
          cursor: pointer;
          font-size: 10px;
          line-height: 1;
          transition: background var(--t-micro, 90ms), color var(--t-micro, 90ms);
          flex-shrink: 0;
          padding: 0;
        }
        .vc-leave-btn:hover {
          background: color-mix(in srgb, var(--danger, #ed4245) 28%, transparent);
          color: #ff5f62;
        }
        .dm-row {
          display: flex; align-items: center; gap: 8px;
          padding: 0 var(--sp-2, 8px);
          min-height: 32px;
          height: auto;
          border-radius: var(--r-sm); cursor: pointer;
          text-align: left; width: 100%;
          background: transparent;
        }
        .dm-nick {
          flex: 1; font-size: var(--text-sm, 13px); font-weight: 500;
          color: var(--ch-read);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          transition: color var(--t-micro, 90ms) var(--ease-out);
        }
        .dm-nick--unread { color: var(--text-primary); font-weight: 650; }
        .dm-row:hover .dm-nick,
        .dm-row--active .dm-nick { color: var(--text-primary); }
        .dm-avatar-wrap {
          position: relative;
          width: 24px; height: 24px;
          flex-shrink: 0;
        }
        .dm-status-dot {
          position: absolute;
          bottom: -1px; right: -1px;
          width: 8px; height: 8px;
          border-radius: 50%;
          border: 2px solid var(--bg-deep);
        }
        .dm-status--online  { background: var(--status-online); }
        .dm-status--idle    { background: var(--status-idle); }
        .dm-status--unknown { background: var(--status-offline); }
        .dm-row--muted .dm-nick { opacity: 0.55; }
        .dm-muted-icon { font-size: 12px; opacity: 0.6; flex-shrink: 0; }
        .dm-ctx-backdrop { position: fixed; inset: 0; z-index: 299; }
        .dm-ctx-menu {
          position: fixed; z-index: 300;
          background: var(--elev-tint-3, var(--bg-float));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            var(--elev-shadow-3, 0 20px 50px rgba(0,0,0,.45));
          padding: 4px;
          min-width: 140px;
          animation: dm-ctx-pop var(--t-micro, 90ms) var(--ease-out) both;
        }
        @keyframes dm-ctx-pop {
          from { opacity: 0; transform: scale(0.96); }
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
          transition: background var(--t-micro, 90ms);
        }
        .dm-ctx-item:hover { background: var(--ch-hover-bg); }

        @media (prefers-reduced-motion: reduce) {
          .ch-sort-btn:hover {
            transform: none;
          }
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
  /** Total unread count — shown as a badge on the header when collapsed */
  unreadBadge?: number;
}

function Section({ label, expanded, onToggle, onAdd, children, compact, unreadBadge }: SectionProps) {
  const showBadge = !expanded && (unreadBadge ?? 0) > 0;
  return (
    <div className="ch-section">
      {!compact && (
        <div
          className="ch-section-header"
          onClick={onToggle}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        >
          <ChevronIcon open={expanded} />
          <span className="ch-section-label">{label}</span>
          {showBadge && (
            <span
              className="ch-section-unread-badge"
              aria-label={`${unreadBadge} unread`}
              title={`${unreadBadge} unread message${(unreadBadge ?? 0) === 1 ? '' : 's'}`}
            >
              {(unreadBadge ?? 0) > 99 ? '99+' : unreadBadge}
            </span>
          )}
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
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
  const facepileNicks = participants && participants.size > 0
    ? Array.from(participants)
    : users.map(u => u.nick);

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
          {facepileNicks.length > 0 && (
            <span className="vch-facepile" aria-hidden>
              <AvatarStack nicks={facepileNicks} max={4} />
            </span>
          )}
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
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M1 1l7 7M8 1l-7 7"/>
              </svg>
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
    </>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 200ms cubic-bezier(0.16,1,0.3,1)', color: 'var(--text-muted)' }}>
      <path d="M3 2l4 3-4 3V2z" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ color: 'var(--status-online, #23a55a)', flexShrink: 0, opacity: 0.85 }}>
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
