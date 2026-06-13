'use client';

import { useState, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import NewGroupDMModal from '@/components/ui/NewGroupDMModal';
import OfflineMessagesBanner from '@/components/ui/OfflineMessagesBanner';
import ServerStatsWidget from '@/components/ui/ServerStatsWidget';
import { stripIrcFormatting } from '@/lib/ircColors';
import type { ChatMessage } from '@/lib/irc/types';
import SkeletonChannel from './SkeletonChannel';
import SkeletonMessage from './SkeletonMessage';

function SearchHintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13 13l-2.5-2.5" />
    </svg>
  );
}

export default function HomeView() {
  const ourNick            = useOnyxStore(s => s.ourNick);
  const server             = useOnyxStore(s => s.server);
  const channels           = useOnyxStore(s => s.channels);
  const dms                = useOnyxStore(s => s.dms);
  const navigate           = useOnyxStore(s => s.navigate);
  const joinChannel        = useOnyxStore(s => s.joinChannel);
  const client             = useOnyxStore(s => s.client);
  const networkName        = useOnyxStore(s => s.networkName);
  const openChannelBrowser = useOnyxStore(s => s.openChannelBrowser);
  const openSearchOverlay  = useOnyxStore(s => s.openSearchOverlay);
  const openPinnedMessages = useOnyxStore(s => s.openPinnedMessages);
  const joinHistory        = useOnyxStore(s => s.joinHistory);
  const toggleSpotlight    = useOnyxStore(s => s.toggleSpotlight);
  const openFriendsPanel   = useOnyxStore(s => s.openFriendsPanel);
  const openServices       = useOnyxStore(s => s.openServices);
  const openNotificationCenter = useOnyxStore(s => s.openNotificationCenter);
  const openScheduledMessages  = useOnyxStore(s => s.openScheduledMessages);
  const openThemeModal     = useOnyxStore(s => s.openThemeModal);
  const openSoundSettings  = useOnyxStore(s => s.openSoundSettings);
  const openHighlightModal = useOnyxStore(s => s.openHighlightModal);
  const openCustomEmojiModal = useOnyxStore(s => s.openCustomEmojiModal);
  const openConnectionProfiles = useOnyxStore(s => s.openConnectionProfiles);
  const openServerInfo     = useOnyxStore(s => s.openServerInfo);
  const openServerStats    = useOnyxStore(s => s.openServerStats);
  const openKeyboardShortcuts = useOnyxStore(s => s.openKeyboardShortcuts);
  const openAnnouncementsPanel = useOnyxStore(s => s.openAnnouncementsPanel);
  const openPollCreate     = useOnyxStore(s => s.openPollCreate);
  const channelUnread      = useOnyxStore(s => s.channelUnread);
  const totalUnreadMentions = useOnyxStore(s => s.totalUnreadMentions);
  const voiceChannels      = useOnyxStore(s => s.voiceChannels);
  const streams            = useOnyxStore(s => s.streams);
  const latencyMs          = useOnyxStore(s => s.latencyMs);
  const connectedAt        = useOnyxStore(s => s.connectedAt);
  const status             = useOnyxStore(s => s.status);
  const connectionStatus   = useOnyxStore(s => s.connectionStatus);
  const reconnectNow       = useOnyxStore(s => s.reconnectNow);

  const [showGroupDM,    setShowGroupDM]    = useState(false);
  const [showInviteTip,  setShowInviteTip]  = useState(false);
  const [inviteCopied,   setInviteCopied]   = useState(false);
  const [addFriendNick,  setAddFriendNick]  = useState('');
  const [showNewDM,      setShowNewDM]      = useState(false);

  const dmList = [...dms.values()].sort((a, b) => {
    const aLast = a.messages.at(-1)?.time.getTime() ?? 0;
    const bLast = b.messages.at(-1)?.time.getTime() ?? 0;
    return bLast - aLast;
  });

  const channelList = [...channels.values()]
    .filter(c => !c.modes.includes('V'))
    .sort((a, b) => {
      const aLast = a.messages.at(-1)?.time.getTime() ?? 0;
      const bLast = b.messages.at(-1)?.time.getTime() ?? 0;
      return bLast - aLast;
    })
    .slice(0, 8);

  const totalUnread = Object.values(channelUnread).reduce((sum, value) => sum + value, 0) +
    dmList.reduce((sum, dm) => sum + (dm.unread ?? 0), 0);

  const liveStreams = [...streams.values()].filter(stream => stream.live);
  const homeLoading = (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') &&
    dmList.length === 0 &&
    channelList.length === 0;
  const homeError = status === 'error';
  const connectedSince = connectedAt
    ? connectedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
  const latencyLabel = latencyMs == null ? '—' : `${latencyMs}ms`;

  const launchGroups = [
    {
      label: 'Talk',
      items: [
        { title: 'Friends', meta: `${dmList.length} chats`, icon: <IconDM />, action: openFriendsPanel },
        { title: 'Services', meta: 'NickServ / ChanServ', icon: <IconServices />, action: () => openServices() },
        { title: 'Notifications', meta: totalUnread ? `${totalUnread} unread` : 'All clear', icon: <IconBell />, action: openNotificationCenter },
        { title: 'Scheduled', meta: 'Message queue', icon: <IconClock />, action: openScheduledMessages },
      ],
    },
    {
      label: 'Create',
      items: [
        { title: 'Poll', meta: 'Ask the room', icon: <IconPoll />, action: openPollCreate },
        { title: 'Group DM', meta: 'Private room', icon: <IconGroup />, action: () => setShowGroupDM(true) },
        { title: 'Emoji', meta: 'Custom set', icon: <IconSparkle />, action: openCustomEmojiModal },
        { title: 'Highlights', meta: 'Watch words', icon: <IconSearch />, action: openHighlightModal },
      ],
    },
    {
      label: 'Tune',
      items: [
        { title: 'Appearance', meta: 'Theme and layout', icon: <IconPalette />, action: openThemeModal },
        { title: 'Sound', meta: 'Alerts and volume', icon: <IconSound />, action: openSoundSettings },
        { title: 'Profiles', meta: 'Saved servers', icon: <IconLink />, action: openConnectionProfiles },
        { title: 'Shortcuts', meta: 'Keyboard map', icon: <IconKeyboard />, action: openKeyboardShortcuts },
      ],
    },
    {
      label: 'Server',
      items: [
        { title: 'Info', meta: networkName || 'Network', icon: <IconInfo />, action: openServerInfo },
        { title: 'Stats', meta: latencyLabel, icon: <IconPulse />, action: openServerStats },
        { title: 'Announcements', meta: 'Network posts', icon: <IconMegaphone />, action: openAnnouncementsPanel },
        { title: 'Channels', meta: `${channels.size} joined`, icon: <IconChannels />, action: openChannelBrowser },
      ],
    },
  ];

  // Recent activity feed across all channels
  const recentActivity = useMemo(() => {
    const events: Array<{ channel: string; msg: ChatMessage }> = [];
    channels.forEach((ch, name) => {
      ch.messages.slice(-5).forEach(msg => {
        events.push({ channel: name, msg });
      });
    });
    return events
      .sort((a, b) => b.msg.time.getTime() - a.msg.time.getTime())
      .slice(0, 20);
  }, [channels]);

  // Server feature badges to show
  const featureBadges: string[] = [];
  const negCaps = client?.negotiatedCaps;
  if (negCaps?.has('draft/chathistory') || negCaps?.has('chathistory')) featureBadges.push('CHATHISTORY');
  if (client?.isupport?.IRCX)                                           featureBadges.push('IRCX');
  if (negCaps?.has('sasl'))                                             featureBadges.push('SASL');
  if (negCaps?.has('server-time'))                                      featureBadges.push('SERVER-TIME');
  if (negCaps?.has('message-tags'))                                     featureBadges.push('MSG-TAGS');
  if (client?.isupport?.SUIMYAKUMEDIA)                                     featureBadges.push('SUIMYAKU');

  const handleCopyInvite = () => {
    navigator.clipboard?.writeText('/invite #channel-name').catch(() => undefined);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const handleNewDMSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nick = addFriendNick.trim();
    if (!nick || !client) return;
    client.sendRaw('PRIVMSG', 'NickServ', `INFO ${nick}`);
    navigate({ kind: 'dm', nick });
    setAddFriendNick('');
    setShowNewDM(false);
  };

  return (
    <div className="hv-root">
      <OfflineMessagesBanner />

      {/* ── Hero section ──────────────────────────────────────────── */}
      <div className="hv-hero animate-fade-in">
        <div className="hv-hero-glow" aria-hidden />

        <div className="hv-hero-wave">
          <OceanHeroWave />
        </div>

        <div className="hv-hero-eyebrow">Midnight IRC</div>
        <h1 className="hv-hero-title">
          <span className="hv-hero-gradient">Ocean</span>
        </h1>
        <p className="hv-hero-subtitle">
          {ourNick
            ? <>Connected as <strong>{ourNick}</strong> on {networkName || 'your network'}</>
            : 'A quiet command center for channels, DMs, and network signals'}
        </p>

        {/* Spotlight shortcut hint */}
        <button className="hv-spotlight-hint" onClick={toggleSpotlight} aria-label="Open spotlight search">
          <SearchHintIcon />
          <span className="hv-spotlight-hint-text">Search channels, people, messages…</span>
          <kbd className="hv-kbd">Ctrl</kbd>
          <span className="hv-kbd-sep">+</span>
          <kbd className="hv-kbd">K</kbd>
        </button>

        {/* Stats row */}
        <div className="hv-stats-row">
          <div className="hv-stat">
            <span className="hv-stat-value">{channels.size}</span>
            <span className="hv-stat-label">Channels</span>
          </div>
          <div className="hv-stat-divider" aria-hidden />
          <div className="hv-stat">
            <span className="hv-stat-value">{networkName || 'Ocean'}</span>
            <span className="hv-stat-label">Server</span>
          </div>
          <div className="hv-stat-divider" aria-hidden />
          <div className="hv-stat">
            <span className="hv-stat-value">{ourNick || '—'}</span>
            <span className="hv-stat-label">You</span>
          </div>
        </div>

        {/* Quick action cards */}
        <div className="hv-quick-cards">
          <button className="hv-quick-card hv-quick-card--0" onClick={openChannelBrowser}>
            <span className="hv-quick-card-icon"><IconChannels /></span>
            <span className="hv-quick-card-title">Browse Channels</span>
            <span className="hv-quick-card-desc">Explore all available channels</span>
            <span className="hv-quick-card-cta">Open</span>
          </button>
          <button className="hv-quick-card hv-quick-card--1" onClick={() => setShowNewDM(v => !v)}>
            <span className="hv-quick-card-icon"><IconDM /></span>
            <span className="hv-quick-card-title">Start a DM</span>
            <span className="hv-quick-card-desc">Message someone directly</span>
            <span className="hv-quick-card-cta">Compose</span>
          </button>
          <button className="hv-quick-card hv-quick-card--2" onClick={openSearchOverlay}>
            <span className="hv-quick-card-icon"><IconSearch /></span>
            <span className="hv-quick-card-title">Search Messages</span>
            <span className="hv-quick-card-desc">Find messages across channels</span>
            <span className="hv-quick-card-cta">Search</span>
          </button>
          <button className="hv-quick-card hv-quick-card--3" onClick={() => setShowGroupDM(true)}>
            <span className="hv-quick-card-icon"><IconGroup /></span>
            <span className="hv-quick-card-title">Group DM</span>
            <span className="hv-quick-card-desc">Chat with multiple people</span>
            <span className="hv-quick-card-cta">Create</span>
          </button>
        </div>
      </div>

      <section className="hv-command-strip animate-fade-in" aria-label="Workspace status" style={{ animationDelay: '70ms' }}>
        <button className="hv-signal-card" onClick={openNotificationCenter}>
          <span className="hv-signal-icon hv-signal-icon--mentions"><IconBell /></span>
          <span className="hv-signal-copy">
            <span className="hv-signal-value">{totalUnreadMentions}</span>
            <span className="hv-signal-label">Mentions</span>
          </span>
        </button>
        <button className="hv-signal-card" onClick={openSearchOverlay}>
          <span className="hv-signal-icon hv-signal-icon--unread"><IconSearch /></span>
          <span className="hv-signal-copy">
            <span className="hv-signal-value">{totalUnread}</span>
            <span className="hv-signal-label">Unread</span>
          </span>
        </button>
        <button className="hv-signal-card" onClick={liveStreams[0] ? () => navigate({ kind: 'channel', channel: liveStreams[0].channel }) : openServerStats}>
          <span className="hv-signal-icon hv-signal-icon--live"><IconPulse /></span>
          <span className="hv-signal-copy">
            <span className="hv-signal-value">{liveStreams.length}</span>
            <span className="hv-signal-label">Live</span>
          </span>
        </button>
        <button className="hv-signal-card" onClick={openServerInfo}>
          <span className="hv-signal-icon hv-signal-icon--server"><IconInfo /></span>
          <span className="hv-signal-copy">
            <span className="hv-signal-value">{latencyLabel}</span>
            <span className="hv-signal-label">Latency</span>
          </span>
        </button>
        <button className="hv-signal-card" onClick={openChannelBrowser}>
          <span className="hv-signal-icon hv-signal-icon--voice"><IconChannels /></span>
          <span className="hv-signal-copy">
            <span className="hv-signal-value">{voiceChannels.length}</span>
            <span className="hv-signal-label">Voice rooms</span>
          </span>
        </button>
        <button className="hv-signal-card" onClick={openServerInfo}>
          <span className="hv-signal-icon hv-signal-icon--uptime"><IconClock /></span>
          <span className="hv-signal-copy">
            <span className="hv-signal-value">{connectedSince}</span>
            <span className="hv-signal-label">Connected</span>
          </span>
        </button>
      </section>

      <div className="hv-layout animate-fade-in" style={{ animationDelay: '100ms' }}>

        {/* ── Left column ─────────────────────────────────────────── */}
        <div className="hv-left">

          {/* DM Inbox */}
          <section className="hv-panel">
            <div className="hv-panel-header">
              <h2 className="hv-panel-title">Direct Messages</h2>
              <button
                className="hv-header-btn"
                onClick={() => setShowNewDM(v => !v)}
                aria-expanded={showNewDM}
                title="New DM"
              >
                <PlusIcon />
                New DM
              </button>
            </div>

            {/* New DM inline form */}
            {showNewDM && (
              <form className="hv-new-dm-form" onSubmit={handleNewDMSubmit}>
                <input
                  className="hv-input"
                  placeholder="Enter a nickname…"
                  value={addFriendNick}
                  onChange={e => setAddFriendNick(e.target.value)}
                  autoFocus
                  aria-label="Nickname to message"
                />
                <button type="submit" className="hv-btn-primary" disabled={!addFriendNick.trim()}>
                  Open
                </button>
                <button type="button" className="hv-btn-ghost" onClick={() => setShowNewDM(false)}>
                  Cancel
                </button>
              </form>
            )}

            {/* DM list */}
            {homeError ? (
              <ErrorState
                title="Direct messages are unavailable"
                message="Ocean could not refresh this inbox from the current connection."
                details={`HomeView direct messages failed while connection status was ${connectionStatus}.`}
                onRetry={reconnectNow}
              />
            ) : homeLoading ? (
              <SkeletonMessage count={3} />
            ) : dmList.length > 0 ? (
              <div className="hv-dm-list">
                {dmList.map(dm => {
                  const last = dm.messages.at(-1);
                  const prefix = last && last.from && last.from !== dm.nick ? `${last.from}: ` : '';
                  const preview = last
                    ? `${prefix}${stripIrcFormatting(last.text).slice(0, 55)}`
                    : 'No messages yet';
                  const statusDot: 'online' | 'idle' | 'unknown' = dm.away === true ? 'idle' : dm.away === false ? 'online' : 'unknown';
                  return (
                    <button
                      key={dm.nick}
                      className="hv-dm-row"
                      onClick={() => navigate({ kind: 'dm', nick: dm.nick })}
                    >
                      <div className="hv-dm-avatar-wrap">
                        <Avatar nick={dm.nick} size={40} />
                        <span className={`hv-status-dot hv-status-dot--${statusDot}`} aria-hidden />
                      </div>
                      <div className="hv-dm-info">
                        <div className="hv-dm-top">
                          <span className="hv-dm-nick">{dm.nick}</span>
                          {last && <span className="hv-dm-time">{formatTime(last.time)}</span>}
                        </div>
                        <p className="hv-dm-preview">{preview}</p>
                      </div>
                      {dm.highlights > 0 && (
                        <span className="hv-badge">{dm.highlights > 99 ? '99+' : dm.highlights}</span>
                      )}
                      {dm.unread > 0 && dm.highlights === 0 && (
                        <span className="hv-unread-dot" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon="~"
                title="No direct messages yet"
                description="Start a private thread when you are ready to talk."
                action={{ label: 'Start a DM', onClick: () => setShowNewDM(true) }}
                size="md"
              />
            )}
          </section>

          {/* Active Channels */}
          <section className="hv-panel">
            <div className="hv-panel-header">
              <h2 className="hv-panel-title">Your Channels</h2>
            </div>

            {homeError ? (
              <ErrorState
                title="Channels are unavailable"
                message="Ocean could not refresh your joined channels from the current connection."
                details={`HomeView channels failed while connection status was ${connectionStatus}.`}
                onRetry={reconnectNow}
              />
            ) : homeLoading ? (
              <SkeletonChannel count={6} />
            ) : channelList.length > 0 ? (
              <>
                <div className="hv-channel-grid">
                  {channelList.map(ch => {
                    const displayName = ch.name.replace(/^[#&]/, '');
                    const topicText = ch.topic ? stripIrcFormatting(ch.topic).slice(0, 60) : null;
                    return (
                      <button
                        key={ch.name}
                        className="hv-ch-card"
                        onClick={() => navigate({ kind: 'channel', channel: ch.name })}
                      >
                        <div className="hv-ch-card-header">
                          <span className="hv-ch-hash">#</span>
                          <span className="hv-ch-name">{displayName}</span>
                          {ch.highlights > 0 && (
                            <span className="hv-badge">{ch.highlights > 99 ? '99+' : ch.highlights}</span>
                          )}
                        </div>
                        {topicText && (
                          <p className="hv-ch-topic">{topicText}</p>
                        )}
                        <span className="hv-ch-count">{ch.users.size} member{ch.users.size !== 1 ? 's' : ''}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="hv-browse-link" onClick={openChannelBrowser}>
                  Browse all channels →
                </button>
              </>
            ) : (
              <EmptyState
                icon="#"
                title="No channels joined"
                description="Browse the network and pin a few rooms to make this deck come alive."
                action={{ label: 'Browse channels', onClick: openChannelBrowser }}
                size="sm"
              />
            )}
          </section>

          {/* Activity Feed */}
          <section className="hv-panel">
            <div className="hv-panel-header">
              <h2 className="hv-panel-title">Recent Activity</h2>
            </div>
            {homeError ? (
              <ErrorState
                title="Recent activity is unavailable"
                message="Ocean could not collect recent messages from this connection."
                details={`HomeView recent activity failed while connection status was ${connectionStatus}.`}
                onRetry={reconnectNow}
              />
            ) : homeLoading ? (
              <SkeletonMessage count={4} />
            ) : recentActivity.length > 0 ? (
              <ul className="activity-feed" role="list">
                {recentActivity.map(({ channel, msg }) => {
                  const isSystem = msg.type !== 'msg' && msg.type !== 'action';
                  const text = stripIrcFormatting(msg.text).slice(0, 100);
                  const displayChannel = channel.startsWith('#') || channel.startsWith('&') ? channel : `#${channel}`;
                  return (
                    <li key={msg.id} className="activity-item" role="listitem">
                      <button
                        className="activity-item-btn"
                        onClick={() => navigate({ kind: 'channel', channel })}
                        aria-label={`Go to ${displayChannel}`}
                      >
                        <div className="activity-item-header">
                          <span className="activity-channel-badge">{displayChannel}</span>
                          <span className="activity-time">{formatTimeAgo(msg.time)}</span>
                        </div>
                        {isSystem ? (
                          <p className="activity-content activity-system">{text}</p>
                        ) : (
                          <p className="activity-content">
                            <span className="activity-nick">{msg.from}</span>
                            {msg.type === 'action' ? <em> {text}</em> : `: ${text}`}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon="."
                title="No recent activity"
                description="Messages from your joined channels will appear here."
                size="sm"
              />
            )}
          </section>
        </div>

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="hv-right">

          {/* Quick Actions */}
          <section className="hv-panel hv-panel--sm">
            <h2 className="hv-panel-title hv-panel-title--sm">Quick Actions</h2>
            <div className="hv-actions">
              <button className="hv-action-row" onClick={openChannelBrowser}>
                <span className="hv-action-icon"><IconChannels /></span>
                <span>Browse channels</span>
              </button>
              <button className="hv-action-row" onClick={openSearchOverlay}>
                <span className="hv-action-icon"><IconSearch /></span>
                <span>Search messages</span>
              </button>
              {openPinnedMessages && (
                <button className="hv-action-row" onClick={openPinnedMessages}>
                  <span className="hv-action-icon"><IconPin /></span>
                  <span>Pinned messages</span>
                </button>
              )}
              <button className="hv-action-row" onClick={() => setShowGroupDM(true)}>
                <span className="hv-action-icon"><IconGroup /></span>
                <span>New group DM</span>
              </button>
              <button
                className="hv-action-row"
                onClick={() => setShowInviteTip(v => !v)}
                aria-expanded={showInviteTip}
              >
                <span className="hv-action-icon"><IconInvite /></span>
                <span>Invite a friend</span>
              </button>
            </div>

            {/* Invite tip */}
            {showInviteTip && (
              <div className="hv-invite-tip">
                <p className="hv-invite-label">Use the IRC INVITE command:</p>
                <div className="hv-invite-code-row">
                  <code className="hv-invite-code">/invite #channel-name</code>
                  <button
                    className={`hv-copy-btn ${inviteCopied ? 'hv-copy-btn--copied' : ''}`}
                    onClick={handleCopyInvite}
                    title="Copy command"
                  >
                    {inviteCopied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Feature launchpad */}
          <section className="hv-panel hv-panel--sm">
            <div className="hv-panel-header">
              <h2 className="hv-panel-title hv-panel-title--sm">Launchpad</h2>
              <button className="hv-header-btn hv-header-btn--subtle" onClick={toggleSpotlight}>
                <SearchHintIcon />
                Command
              </button>
            </div>
            <div className="hv-launchpad">
              {launchGroups.map(group => (
                <div key={group.label} className="hv-launch-group">
                  <div className="hv-launch-label">{group.label}</div>
                  <div className="hv-launch-grid">
                    {group.items.map(item => (
                      <button key={`${group.label}-${item.title}`} className="hv-launch-tile" onClick={item.action}>
                        <span className="hv-launch-icon">{item.icon}</span>
                        <span className="hv-launch-copy">
                          <span className="hv-launch-title">{item.title}</span>
                          <span className="hv-launch-meta">{item.meta}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Recent Channels */}
          {joinHistory.length > 0 && (
            <section className="hv-panel hv-panel--sm">
              <h2 className="hv-panel-title hv-panel-title--sm">Recent Channels</h2>
              <div className="hv-recent-pills">
                {joinHistory.map(ch => {
                  const isActive = channels.has(ch.toLowerCase());
                  return (
                    <button
                      key={ch}
                      className={`hv-recent-pill${isActive ? ' hv-recent-pill--active' : ''}`}
                      onClick={() => {
                        if (isActive) {
                          navigate({ kind: 'channel', channel: ch });
                        } else {
                          joinChannel(ch);
                        }
                      }}
                      title={isActive ? `Switch to ${ch}` : `Rejoin ${ch}`}
                    >
                      <span className="hv-recent-pill-hash">#</span>
                      {ch.replace(/^[#&]/, '')}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Server Info */}
          <section className="hv-panel hv-panel--sm">
            <h2 className="hv-panel-title hv-panel-title--sm">Server Info</h2>
            <div className="hv-server-info">
              <div className="hv-server-logo">
                <OceanLogo size={36} />
              </div>
              <div className="hv-server-details">
                <div className="hv-server-name">{networkName || 'Ocean'}</div>
                <div className="hv-server-account">
                  {server?.account
                    ? <><span className="hv-account-dot" />Signed in as <strong>{server.account}</strong></>
                    : ourNick
                    ? <><span className="hv-account-dot hv-account-dot--guest" />Connected as <strong>{ourNick}</strong></>
                    : <span className="hv-muted">Not connected</span>
                  }
                </div>
              </div>
            </div>

            {featureBadges.length > 0 && (
              <div className="hv-features">
                {featureBadges.map(f => (
                  <span key={f} className="hv-feature-badge">{f}</span>
                ))}
              </div>
            )}

            <ServerStatsWidget />
          </section>
        </div>
      </div>

      {/* Group DM Modal */}
      {showGroupDM && <NewGroupDMModal onClose={() => setShowGroupDM(false)} />}

      <style>{`
        /* ── Layout ─────────────────────────────────────────────────── */
        .hv-root {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          padding: 0 24px 40px;
          align-items: center;
          justify-content: flex-start;
          background:
            radial-gradient(ellipse 80% 35% at 50% 0%, rgba(14,165,233,0.06) 0%, transparent 70%),
            radial-gradient(ellipse 40% 20% at 20% 100%, rgba(103,232,249,0.03) 0%, transparent 70%);
        }

        /* ── Spotlight hint ─────────────────────────────────────────── */
        .hv-spotlight-hint {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-full);
          cursor: pointer;
          font-family: inherit;
          margin-bottom: 28px;
          position: relative;
          z-index: 1;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-spotlight-hint:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          box-shadow: var(--shadow-md);
          transform: translateY(-1px);
          filter: brightness(1.05);
        }
        .hv-spotlight-hint-text {
          font-size: 13px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .hv-kbd {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-overlay);
          border: 1px solid var(--border-normal);
          border-radius: 4px;
          padding: 2px 6px;
          line-height: 1.4;
        }
        .hv-kbd-sep {
          font-size: 11px;
          color: var(--text-muted);
        }

        /* ── Hero ───────────────────────────────────────────────────── */
        .hv-hero {
          width: 100%;
          max-width: 900px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 56px 24px 38px;
          position: relative;
          margin-bottom: 10px;
        }

        .hv-hero-glow {
          position: absolute;
          top: 0; left: 50%;
          transform: translateX(-50%);
          width: 700px;
          height: 340px;
          background: radial-gradient(ellipse at 50% 20%, rgba(14,165,233,0.09) 0%, rgba(103,232,249,0.04) 40%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        .hv-hero-wave {
          position: relative;
          z-index: 1;
          margin-bottom: 20px;
          filter: drop-shadow(var(--glow));
        }

        .hv-hero-eyebrow {
          position: relative;
          z-index: 1;
          margin-bottom: 8px;
          color: var(--gold);
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .hv-hero-title {
          position: relative;
          z-index: 1;
          font-size: 46px;
          font-weight: 800;
          letter-spacing: 0;
          line-height: 1;
          margin: 0 0 12px;
        }

        .hv-hero-gradient {
          background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 60%, var(--gold) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hv-hero-subtitle {
          position: relative;
          z-index: 1;
          max-width: 560px;
          font-size: 15px;
          color: var(--text-muted);
          margin: 0 0 18px;
          font-weight: 400;
          letter-spacing: 0;
          line-height: 1.55;
        }

        .hv-hero-subtitle strong {
          color: var(--text-primary);
          font-weight: 700;
        }

        /* Stats row */
        .hv-stats-row {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-full);
          padding: 9px 22px;
          margin-bottom: 30px;
          box-shadow: var(--shadow-sm);
        }

        .hv-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 0 18px;
        }

        .hv-stat-value {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0;
        }

        .hv-stat-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .hv-stat-divider {
          width: 1px;
          height: 24px;
          background: var(--border-subtle);
          flex-shrink: 0;
        }

        /* Quick action cards */
        .hv-quick-cards {
          position: relative;
          z-index: 1;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .hv-quick-card {
          width: 158px;
          min-height: 158px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-float) 34%, transparent), transparent),
            var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 5px;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          position: relative;
          overflow: hidden;
          transition: transform var(--t-normal) var(--ease-out), filter var(--t-normal) var(--ease-out);
          opacity: 0;
          animation: hv-card-in 350ms var(--ease-out) both;
        }

        .hv-quick-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, var(--accent-border), transparent);
          opacity: 0;
          transition: opacity var(--t-fast);
        }

        .hv-quick-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-lg), 0 0 0 1px var(--accent-border);
          border-color: var(--accent-border);
          filter: brightness(1.04);
        }

        .hv-quick-card:hover::before { opacity: 1; }

        .hv-quick-card--0 { animation-delay: 0ms; }
        .hv-quick-card--1 { animation-delay: 80ms; }
        .hv-quick-card--2 { animation-delay: 160ms; }
        .hv-quick-card--3 { animation-delay: 240ms; }

        @keyframes hv-card-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .hv-quick-card-icon {
          width: 38px;
          height: 38px;
          border-radius: var(--r-md);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 8px;
          flex-shrink: 0;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-quick-card:hover .hv-quick-card-icon {
          background: rgba(14,165,233,0.16);
          border-color: var(--accent);
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        /* Each card gets a distinct hue */
        .hv-quick-card--0 .hv-quick-card-icon { background: rgba(14,165,233,0.1); border-color: rgba(14,165,233,0.22); color: #38bdf8; }
        .hv-quick-card--1 .hv-quick-card-icon { background: rgba(103,232,249,0.08); border-color: rgba(103,232,249,0.2); color: var(--gold); }
        .hv-quick-card--2 .hv-quick-card-icon { background: rgba(124,90,245,0.1); border-color: rgba(124,90,245,0.22); color: #a78bfa; }
        .hv-quick-card--3 .hv-quick-card-icon { background: rgba(52,211,153,0.08); border-color: rgba(52,211,153,0.2); color: #34d399; }

        .hv-quick-card-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
          letter-spacing: 0;
        }

        .hv-quick-card-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.45;
        }

        .hv-quick-card-cta {
          margin-top: auto;
          padding-top: 10px;
          font-size: 11px;
          font-weight: 800;
          color: var(--accent-hover);
          opacity: 0.74;
          transform: translateX(0);
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
        }

        .hv-quick-card:hover .hv-quick-card-cta {
          opacity: 1;
          transform: translateX(3px);
        }

        .hv-command-strip {
          width: 100%;
          max-width: 900px;
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 8px;
          margin: 0 0 20px;
        }

        .hv-signal-card {
          min-width: 0;
          min-height: 64px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0)),
            var(--bg-elevated);
          color: var(--text-secondary);
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          box-shadow: 0 8px 22px rgba(0,0,0,0.12);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }

        .hv-signal-card:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          color: var(--text-primary);
          transform: translateY(-2px);
          filter: brightness(1.04);
        }

        .hv-signal-icon {
          width: 34px;
          height: 34px;
          border-radius: var(--r-md);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
        }
        .hv-signal-icon svg { width: 17px; height: 17px; }
        .hv-signal-icon--mentions { color: #f472b6; background: rgba(244,114,182,0.1); border-color: rgba(244,114,182,0.22); }
        .hv-signal-icon--unread { color: #38bdf8; background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.22); }
        .hv-signal-icon--live { color: #fb7185; background: rgba(251,113,133,0.1); border-color: rgba(251,113,133,0.22); }
        .hv-signal-icon--server { color: #a78bfa; background: rgba(167,139,250,0.1); border-color: rgba(167,139,250,0.22); }
        .hv-signal-icon--voice { color: #34d399; background: rgba(52,211,153,0.1); border-color: rgba(52,211,153,0.22); }
        .hv-signal-icon--uptime { color: var(--gold); background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.22); }

        .hv-signal-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .hv-signal-value {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .hv-signal-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 900px) {
          .hv-command-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        @media (max-width: 520px) {
          .hv-command-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .hv-signal-card { min-height: 58px; }
          .hv-signal-icon { width: 30px; height: 30px; }
        }

        .hv-layout {
          width: 100%;
          max-width: 900px;
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 20px;
          align-items: start;
        }

        .hv-left  { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
        .hv-right { display: flex; flex-direction: column; gap: 16px; }

        @media (max-width: 760px) {
          .hv-layout {
            grid-template-columns: 1fr;
          }
          .hv-right { order: -1; }
        }

        /* ── Panel ──────────────────────────────────────────────────── */
        .hv-panel {
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--bg-float) 18%, transparent), transparent 62%),
            var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: relative;
          overflow: hidden;
        }
        .hv-panel::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border-normal), transparent);
        }
        .hv-panel--sm { padding: 17px; gap: 13px; }

        .hv-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .hv-panel-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0;
        }
        .hv-panel-title--sm {
          font-size: 10px;
          margin-bottom: 2px;
        }

        /* ── Header buttons ─────────────────────────────────────────── */
        .hv-header-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px;
          border-radius: var(--r-md);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
          cursor: pointer; font-size: 12px; font-weight: 600;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-header-btn:hover {
          background: rgba(14,165,233,0.18);
          border-color: var(--accent);
          transform: translateY(-1px);
          filter: brightness(1.06);
        }
        .hv-header-btn--subtle {
          background: var(--bg-deep);
          border-color: var(--border-subtle);
          color: var(--text-secondary);
        }
        .hv-header-btn--subtle:hover {
          background: var(--ch-hover-bg);
          border-color: var(--accent-border);
          color: var(--text-primary);
        }

        /* ── DM list ────────────────────────────────────────────────── */
        .hv-dm-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .hv-dm-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: var(--r-md);
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          width: 100%;
        }
        .hv-dm-row:hover {
          background: var(--ch-hover-bg);
          border-color: var(--border-subtle);
          transform: translateX(2px);
          filter: brightness(1.04);
        }

        .hv-dm-avatar-wrap {
          position: relative;
          flex-shrink: 0;
          width: 40px; height: 40px;
        }

        .hv-status-dot {
          position: absolute;
          bottom: 0; right: 0;
          width: 11px; height: 11px;
          border-radius: 50%;
          border: 2px solid var(--bg-elevated);
        }
        .hv-status-dot--online  { background: var(--status-online); }
        .hv-status-dot--idle    { background: var(--status-idle); }
        .hv-status-dot--unknown { background: var(--status-offline); }

        .hv-dm-info {
          flex: 1;
          min-width: 0;
        }

        .hv-dm-top {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 2px;
        }

        .hv-dm-nick {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .hv-dm-time {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          flex-shrink: 0;
        }

        .hv-dm-preview {
          font-size: 13px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.4;
          margin: 0;
        }

        /* ── Badges / indicators ────────────────────────────────────── */
        .hv-badge {
          background: var(--danger);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: var(--r-full);
          flex-shrink: 0;
        }

        .hv-unread-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--text-secondary);
          flex-shrink: 0;
        }

        /* ── Empty state ────────────────────────────────────────────── */
        .hv-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 34px 18px;
          text-align: center;
          background: color-mix(in srgb, var(--bg-deep) 56%, transparent);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
        }
        .hv-empty--sm { padding: 24px 18px; }

        .hv-empty-art {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 96px;
          height: 64px;
          border-radius: var(--r-xl);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          box-shadow: var(--glow);
        }

        .hv-empty-copy {
          display: grid;
          justify-items: center;
          gap: 6px;
        }

        .hv-empty-title {
          margin: 0;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0;
        }

        .hv-empty-text {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
          margin: 0;
          max-width: 280px;
        }

        .hv-empty-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .hv-mt { margin-top: 4px; }

        /* ── Channel grid ───────────────────────────────────────────── */
        .hv-channel-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 7px;
        }

        .hv-ch-card {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 11px 13px;
          text-align: left;
          cursor: pointer;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          display: flex;
          flex-direction: column;
          gap: 4px;
          position: relative;
          overflow: hidden;
        }
        .hv-ch-card:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          box-shadow: 0 4px 12px rgba(14,165,233,0.08);
          transform: translateY(-1px);
          filter: brightness(1.04);
        }

        /* accent left-edge on hover */
        .hv-ch-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0;
          width: 2px; bottom: 0;
          background: var(--accent);
          opacity: 0;
          transition: opacity var(--t-fast);
          border-radius: var(--r-xs) 0 0 var(--r-xs);
        }
        .hv-ch-card:hover::before { opacity: 1; }

        .hv-ch-card-header {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .hv-ch-hash {
          font-size: 14px;
          font-weight: 700;
          color: var(--accent);
          line-height: 1;
          flex-shrink: 0;
          opacity: 0.7;
        }

        .hv-ch-name {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: 0;
        }

        .hv-ch-topic {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          line-height: 1.4;
          margin: 0;
        }

        .hv-ch-count {
          font-size: 10px;
          color: var(--text-muted);
          font-weight: 500;
          letter-spacing: 0;
        }

        .hv-browse-link {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          font-family: inherit;
          padding: 4px 0 0;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), opacity var(--t-fast) var(--ease-out);
          letter-spacing: 0;
        }
        .hv-browse-link:hover { color: var(--accent-hover); transform: translateX(2px); opacity: 0.9; }

        /* ── Recent Channels ────────────────────────────────────────── */
        .hv-recent-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .hv-recent-pill {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 4px 10px;
          border-radius: var(--r-full, 9999px);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          color: var(--text-secondary);
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          user-select: none;
        }
        .hv-recent-pill:hover {
          background: var(--ch-hover-bg);
          border-color: var(--accent-border);
          color: var(--text-primary);
          transform: translateY(-1px);
          filter: brightness(1.04);
        }
        .hv-recent-pill--active {
          background: rgba(124, 90, 245, 0.1);
          border-color: var(--accent-border);
          color: var(--accent);
        }
        .hv-recent-pill--active:hover {
          background: rgba(124, 90, 245, 0.18);
          color: var(--accent);
        }
        .hv-recent-pill-hash {
          font-weight: 700;
          opacity: 0.6;
          font-size: 11px;
        }

        /* ── Quick Actions ──────────────────────────────────────────── */
        .hv-actions {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .hv-action-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--r-md);
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          width: 100%;
        }
        .hv-action-row:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
          transform: translateX(2px);
          filter: brightness(1.04);
        }

        .hv-action-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }

        /* ── Launchpad ──────────────────────────────────────────────── */
        .hv-launchpad {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .hv-launch-group {
          display: grid;
          gap: 6px;
        }

        .hv-launch-label {
          padding: 0 2px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .hv-launch-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 5px;
        }

        .hv-launch-tile {
          min-width: 0;
          min-height: 48px;
          display: grid;
          grid-template-columns: 32px minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          padding: 8px;
          border: 1px solid transparent;
          border-radius: var(--r-md);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }

        .hv-launch-tile:hover {
          background: var(--ch-hover-bg);
          border-color: var(--border-subtle);
          color: var(--text-primary);
          transform: translateX(2px);
          filter: brightness(1.04);
        }

        .hv-launch-icon {
          width: 32px;
          height: 32px;
          border-radius: var(--r-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--bg-deep) 72%, transparent);
          border: 1px solid var(--border-subtle);
          color: var(--accent);
        }
        .hv-launch-icon svg { width: 17px; height: 17px; }

        .hv-launch-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .hv-launch-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .hv-launch-meta {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.25;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ── Invite tip ─────────────────────────────────────────────── */
        .hv-invite-tip {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .hv-invite-label {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .hv-invite-code-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .hv-invite-code {
          flex: 1;
          font-family: 'Fira Code', 'Cascadia Code', monospace;
          font-size: 13px;
          color: var(--gold);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          padding: 6px 10px;
          user-select: all;
        }

        .hv-copy-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px; height: 30px;
          border-radius: var(--r-sm);
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          cursor: pointer;
          color: var(--text-secondary);
          flex-shrink: 0;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }
        .hv-copy-btn:hover { background: var(--bg-float); color: var(--text-primary); transform: translateY(-1px); filter: brightness(1.06); }
        .hv-copy-btn--copied { color: var(--status-online); border-color: rgba(52,211,153,0.4); }

        /* ── Server Info ────────────────────────────────────────────── */
        .hv-server-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .hv-server-logo { flex-shrink: 0; }

        .hv-server-details { flex: 1; min-width: 0; }

        .hv-server-name {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0;
          margin-bottom: 3px;
        }

        .hv-server-account {
          font-size: 12px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .hv-server-account strong { color: var(--text-secondary); font-weight: 600; }

        .hv-account-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--status-online);
          flex-shrink: 0;
        }
        .hv-account-dot--guest { background: var(--status-idle); }

        .hv-muted { color: var(--text-muted); }

        .hv-features {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .hv-feature-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          padding: 2px 7px;
          border-radius: var(--r-full);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          color: var(--accent);
        }

        /* ── Forms ──────────────────────────────────────────────────── */
        .hv-new-dm-form {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }

        .hv-input {
          flex: 1;
          min-width: 120px;
          padding: 7px 10px;
          border-radius: var(--r-md);
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
        }
        .hv-input:focus { outline: none; border-color: var(--accent-border); }
        .hv-input::placeholder { color: var(--text-muted); }

        .hv-btn-primary {
          padding: 7px 14px;
          border-radius: var(--r-md);
          background: var(--accent);
          color: #fff;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          transition: opacity var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          white-space: nowrap;
        }
        .hv-btn-primary:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); filter: brightness(1.06); }
        .hv-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

        .hv-btn-ghost {
          padding: 7px 12px;
          border-radius: var(--r-md);
          background: none;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
          white-space: nowrap;
        }
        .hv-btn-ghost:hover { color: var(--text-secondary); border-color: var(--border-normal); transform: translateY(-1px); filter: brightness(1.06); }

        /* ── Activity Feed ──────────────────────────────────────────── */
        .activity-feed {
          display: flex;
          flex-direction: column;
          gap: 6px;
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .activity-item {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          overflow: hidden;
          transition: transform var(--t-fast) var(--ease-out), filter var(--t-fast) var(--ease-out);
        }

        .activity-item-btn {
          display: block;
          width: 100%;
          padding: 9px 13px;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
        }
        .activity-item:hover {
          border-color: var(--accent-border);
          background: var(--bg-float);
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .activity-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 3px;
        }

        .activity-channel-badge {
          font-size: 10px;
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          padding: 1px 6px;
          border-radius: var(--r-sm);
          flex-shrink: 0;
          letter-spacing: 0;
        }

        .activity-time {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          flex-shrink: 0;
        }

        .activity-content {
          font-size: 12px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin: 0;
          line-height: 1.4;
        }

        .activity-nick {
          font-weight: 600;
          color: var(--text-primary);
        }

        .activity-system {
          font-style: italic;
          color: var(--text-muted);
        }

        /* ── Animation ──────────────────────────────────────────────── */
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 200ms var(--ease-out) both; }

        .hv-root button:focus-visible,
        .hv-root input:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .hv-root *,
          .hv-root *::before,
          .hv-root *::after {
            animation-duration: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0ms !important;
          }

          .animate-fade-in,
          .hv-quick-card {
            animation: none !important;
            opacity: 1;
          }

          .hv-spotlight-hint:hover,
          .hv-quick-card:hover,
          .hv-quick-card:hover .hv-quick-card-icon,
          .hv-quick-card:hover .hv-quick-card-cta,
          .hv-signal-card:hover,
          .hv-header-btn:hover,
          .hv-dm-row:hover,
          .hv-ch-card:hover,
          .hv-browse-link:hover,
          .hv-recent-pill:hover,
          .hv-action-row:hover,
          .hv-launch-tile:hover,
          .hv-copy-btn:hover,
          .hv-btn-primary:hover,
          .hv-btn-ghost:hover,
          .activity-item:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  const now  = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Sub-components ───────────────────────────────────────────────────────────────

function OceanWatsumugilustration() {
  return (
    <svg width="80" height="48" viewBox="0 0 80 48" fill="none" aria-hidden>
      <ellipse cx="40" cy="40" rx="36" ry="6" fill="var(--accent-subtle)" />
      <path
        d="M4 28 Q14 18 24 28 Q34 38 44 28 Q54 18 64 28 Q74 38 84 28"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
      <path
        d="M4 36 Q14 26 24 36 Q34 46 44 36 Q54 26 64 36 Q74 46 84 36"
        stroke="var(--gold)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.35"
      />
      <circle cx="40" cy="16" r="6" fill="var(--accent-subtle)" stroke="var(--accent-border)" strokeWidth="1.5" />
      <path d="M37 16h6M40 13v6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function OceanLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-label="Ocean">
      <rect width="36" height="36" rx="10" fill="url(#hv-logo-grad)" />
      <path d="M18 8L28 14V22L18 28L8 22V14L18 8Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.08)" />
      <circle cx="18" cy="18" r="4" fill="white" fillOpacity="0.9" />
      <defs>
        <linearGradient id="hv-logo-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5.5 1v9M1 5.5h9" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8l4 4 6-6" />
    </svg>
  );
}

function IconChannels() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="6" height="6" rx="1.5" />
      <rect x="12" y="3" width="6" height="6" rx="1.5" />
      <rect x="2" y="11" width="6" height="6" rx="1.5" />
      <rect x="12" y="11" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function IconDM() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 4.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5.5L2 17v-1.5V5.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M17 17l-3.5-3.5" />
    </svg>
  );
}

function IconGroup() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="7" r="3" />
      <circle cx="13.5" cy="7" r="3" />
      <path d="M1 17c0-3 2.9-5 6.5-5" />
      <path d="M19 17c0-3-2.9-5-6.5-5" />
      <path d="M7.5 12c0-2.5 2.7-4 6-4" strokeOpacity="0" />
      <path d="M10.5 12c1.7 0 3.2.5 4.3 1.3" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.5 2.5L17.5 7.5L13 12L11 18L8 12L2 9L8 7L12.5 2.5Z" />
    </svg>
  );
}

function IconInvite() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3 17c0-3.3 3.1-6 7-6" />
      <path d="M15 13v5M17.5 15.5h-5" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5v3.2L4 13h12l-1.5-2.3V7.5A4.5 4.5 0 0 0 10 3Z" />
      <path d="M8.2 15a2 2 0 0 0 3.6 0" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  );
}

function IconServices() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 2.5 16 6v8l-6 3.5L4 14V6l6-3.5Z" />
      <path d="M10 7v6M7 8.5h6" />
    </svg>
  );
}

function IconPoll() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 15V9M10 15V5M16 15v-3" />
      <path d="M3 17h14" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 2.5 11.7 8l5.3 2-5.3 2L10 17.5 8.3 12 3 10l5.3-2L10 2.5Z" />
    </svg>
  );
}

function IconPalette() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 3a7 7 0 0 0 0 14h1.2a1.8 1.8 0 0 0 1.1-3.2.9.9 0 0 1 .5-1.6H14a3 3 0 0 0 0-6h-.5A7 7 0 0 0 10 3Z" />
      <circle cx="7" cy="8" r=".7" />
      <circle cx="10" cy="6.5" r=".7" />
      <circle cx="13" cy="8.2" r=".7" />
    </svg>
  );
}

function IconSound() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8v4h3l4 3V5L7 8H4Z" />
      <path d="M14 7.5a4 4 0 0 1 0 5M16 5a7 7 0 0 1 0 10" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.5 6.5 10 5a3.5 3.5 0 0 1 5 5l-1.5 1.5" />
      <path d="M11.5 13.5 10 15a3.5 3.5 0 0 1-5-5l1.5-1.5" />
      <path d="M8 12l4-4" />
    </svg>
  );
}

function IconKeyboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="14" height="10" rx="2" />
      <path d="M6 8h.01M9 8h.01M12 8h.01M15 8h.01M6 11h.01M9 11h5" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4M10 6.8h.01" />
    </svg>
  );
}

function IconPulse() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10h3l2-5 4 10 2-5h3" />
    </svg>
  );
}

function IconMegaphone() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 11H3a1.5 1.5 0 0 1 0-3h1l9-3v9l-9-3Z" />
      <path d="M7 12.5 8 16H6l-1-4" />
      <path d="M16 8.2a3 3 0 0 1 0 2.6" />
    </svg>
  );
}

function OceanHeroWave() {
  return (
    <svg width="220" height="80" viewBox="0 0 220 80" fill="none" aria-hidden>
      <defs>
        <linearGradient id="hero-wave-grad1" x1="0" y1="0" x2="220" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="hero-wave-grad2" x1="0" y1="0" x2="220" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      {/* Outer star/burst */}
      <circle cx="110" cy="38" r="28" fill="var(--accent-subtle)" />
      <circle cx="110" cy="38" r="18" fill="rgba(124,90,245,0.08)" stroke="var(--accent-border)" strokeWidth="1" />
      {/* ✦ Star shape */}
      <path
        d="M110 14 L113.2 33.2 L130 24 L118.8 37.2 L132 44 L113.5 42.4 L115 60 L110 44.5 L105 60 L106.5 42.4 L88 44 L101.2 37.2 L90 24 L106.8 33.2 Z"
        fill="var(--accent)"
        opacity="0.6"
      />
      <circle cx="110" cy="38" r="5" fill="var(--accent)" />
      <circle cx="110" cy="38" r="3" fill="var(--gold)" opacity="0.8" />
      {/* Wave lines */}
      <path
        d="M10 60 Q32 50 55 60 Q77 70 100 60 Q122 50 145 60 Q167 70 190 60 Q200 57 210 60"
        stroke="url(#hero-wave-grad1)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M0 70 Q22 62 44 70 Q66 78 88 70 Q110 62 132 70 Q154 78 176 70 Q198 62 220 70"
        stroke="url(#hero-wave-grad2)"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
