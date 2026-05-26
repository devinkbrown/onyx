'use client';

import { useState, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import NewGroupDMModal from '@/components/ui/NewGroupDMModal';
import ServerStatsWidget from '@/components/ui/ServerStatsWidget';
import { stripIrcFormatting } from '@/lib/ircColors';
import type { ChatMessage } from '@/lib/irc/types';

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
  if (client?.isupport?.LADONMEDIA)                                     featureBadges.push('LADON');

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
      {/* ── Hero section ──────────────────────────────────────────── */}
      <div className="hv-hero animate-fade-in">
        <div className="hv-hero-glow" aria-hidden />

        <div className="hv-hero-wave">
          <OceanHeroWave />
        </div>

        <h1 className="hv-hero-title">
          <span className="hv-hero-gradient">Welcome to Ocean</span>
        </h1>
        <p className="hv-hero-subtitle">
          {ourNick ? `Connected as ${ourNick}` : 'Select a channel to start chatting'}
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
          </button>
          <button className="hv-quick-card hv-quick-card--1" onClick={() => setShowNewDM(v => !v)}>
            <span className="hv-quick-card-icon"><IconDM /></span>
            <span className="hv-quick-card-title">Start a DM</span>
            <span className="hv-quick-card-desc">Message someone directly</span>
          </button>
          <button className="hv-quick-card hv-quick-card--2" onClick={openSearchOverlay}>
            <span className="hv-quick-card-icon"><IconSearch /></span>
            <span className="hv-quick-card-title">Search Messages</span>
            <span className="hv-quick-card-desc">Find messages across channels</span>
          </button>
          <button className="hv-quick-card hv-quick-card--3" onClick={() => setShowGroupDM(true)}>
            <span className="hv-quick-card-icon"><IconGroup /></span>
            <span className="hv-quick-card-title">Group DM</span>
            <span className="hv-quick-card-desc">Chat with multiple people</span>
          </button>
        </div>
      </div>

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
            {dmList.length > 0 ? (
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
              <div className="hv-empty">
                <OceanWaveIllustration />
                <p className="hv-empty-text">No conversations yet — find someone to message</p>
              </div>
            )}
          </section>

          {/* Active Channels */}
          <section className="hv-panel">
            <div className="hv-panel-header">
              <h2 className="hv-panel-title">Your Channels</h2>
            </div>

            {channelList.length > 0 ? (
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
              <div className="hv-empty hv-empty--sm">
                <p className="hv-empty-text">No channels yet — join one to get started</p>
                <button className="hv-btn-primary hv-mt" onClick={openChannelBrowser}>
                  Browse channels
                </button>
              </div>
            )}
          </section>

          {/* Activity Feed */}
          {recentActivity.length > 0 && (
            <section className="hv-panel">
              <div className="hv-panel-header">
                <h2 className="hv-panel-title">Recent Activity</h2>
              </div>
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
            </section>
          )}
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
          transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
        }
        .hv-spotlight-hint:hover {
          background: var(--bg-float);
          border-color: var(--accent-border);
          box-shadow: 0 4px 16px rgba(14,165,233,0.1);
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
          padding: 48px 24px 36px;
          position: relative;
          margin-bottom: 8px;
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
          margin-bottom: 22px;
        }

        .hv-hero-title {
          position: relative;
          z-index: 1;
          font-size: clamp(28px, 4.5vw, 42px);
          font-weight: 800;
          letter-spacing: -0.8px;
          line-height: 1.1;
          margin: 0 0 10px;
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
          font-size: 14px;
          color: var(--text-muted);
          margin: 0 0 16px;
          font-weight: 400;
          letter-spacing: 0.01em;
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
          padding: 8px 20px;
          margin-bottom: 28px;
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
          letter-spacing: -0.02em;
        }

        .hv-stat-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
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
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .hv-quick-card {
          width: 152px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          padding: 16px 14px 14px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 5px;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          position: relative;
          overflow: hidden;
          transition: transform 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      box-shadow 200ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      border-color 200ms;
          opacity: 0;
          animation: hv-card-in 350ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
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
          box-shadow: 0 10px 28px rgba(14,165,233,0.12), 0 0 0 1px var(--accent-border);
          border-color: var(--accent-border);
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
          font-size: 20px;
          line-height: 1;
          margin-bottom: 4px;
        }

        .hv-quick-card-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
          letter-spacing: -0.01em;
        }

        .hv-quick-card-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.45;
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
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
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
        .hv-panel--sm { padding: 16px; gap: 12px; }

        .hv-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .hv-panel-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.09em;
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
          transition: background var(--t-fast), border-color var(--t-fast);
        }
        .hv-header-btn:hover {
          background: rgba(14,165,233,0.18);
          border-color: var(--accent);
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
          transition: background var(--t-fast), border-color var(--t-fast);
          width: 100%;
        }
        .hv-dm-row:hover {
          background: var(--ch-hover-bg);
          border-color: var(--border-subtle);
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
          gap: 12px;
          padding: 28px 16px;
          text-align: center;
        }
        .hv-empty--sm { padding: 16px; }

        .hv-empty-text {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
          margin: 0;
          max-width: 280px;
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
          transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
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
          letter-spacing: -0.01em;
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
          letter-spacing: 0.02em;
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
          transition: color var(--t-fast);
          letter-spacing: 0.01em;
        }
        .hv-browse-link:hover { color: var(--accent-hover); }

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
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
          user-select: none;
        }
        .hv-recent-pill:hover {
          background: var(--ch-hover-bg);
          border-color: var(--accent-border);
          color: var(--text-primary);
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
          transition: background var(--t-fast), color var(--t-fast);
          width: 100%;
        }
        .hv-action-row:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        .hv-action-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }

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
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
        }
        .hv-copy-btn:hover { background: var(--bg-float); color: var(--text-primary); }
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
          letter-spacing: -0.2px;
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
          letter-spacing: 0.04em;
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
          transition: opacity 120ms;
          white-space: nowrap;
        }
        .hv-btn-primary:hover:not(:disabled) { opacity: 0.85; }
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
          transition: color var(--t-fast), border-color var(--t-fast);
          white-space: nowrap;
        }
        .hv-btn-ghost:hover { color: var(--text-secondary); border-color: var(--border-normal); }

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
          transition: border-color var(--t-fast), background var(--t-fast);
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
          letter-spacing: 0.02em;
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

function OceanWaveIllustration() {
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
