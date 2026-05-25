'use client';

import { useOnyxStore } from '@/lib/store';
import Tooltip from '@/components/ui/Tooltip';

export default function ServerBar() {
  const server                   = useOnyxStore(s => s.server);
  const navigate                 = useOnyxStore(s => s.navigate);
  const activeView               = useOnyxStore(s => s.activeView);
  const channels                 = useOnyxStore(s => s.channels);
  const dms                      = useOnyxStore(s => s.dms);
  const connectionStatus         = useOnyxStore(s => s.connectionStatus);
  const notifications            = useOnyxStore(s => s.notifications);
  const readNotificationIds      = useOnyxStore(s => s.readNotificationIds);
  const openNotificationCenter   = useOnyxStore(s => s.openNotificationCenter);
  const showNotificationCenter   = useOnyxStore(s => s.showNotificationCenter);
  const friends                  = useOnyxStore(s => s.friends);
  const showFriendsPanel         = useOnyxStore(s => s.showFriendsPanel);
  const openFriendsPanel         = useOnyxStore(s => s.openFriendsPanel);
  const bookmarks                = useOnyxStore(s => s.bookmarks);
  const showBookmarks            = useOnyxStore(s => s.showBookmarks);
  const openBookmarks            = useOnyxStore(s => s.openBookmarks);
  const openThemeModal           = useOnyxStore(s => s.openThemeModal);
  const showThemeModal           = useOnyxStore(s => s.showThemeModal);
  const openKeyboardShortcuts    = useOnyxStore(s => s.openKeyboardShortcuts);
  const announcements            = useOnyxStore(s => s.announcements);
  const showAnnouncementsPanel   = useOnyxStore(s => s.showAnnouncementsPanel);
  const openAnnouncementsPanel        = useOnyxStore(s => s.openAnnouncementsPanel);
  const openConnectionProfiles        = useOnyxStore(s => s.openConnectionProfiles);
  const showConnectionProfiles        = useOnyxStore(s => s.showConnectionProfiles);
  const totalUnreadMentions           = useOnyxStore(s => s.totalUnreadMentions);

  // Total highlights across all channels and DMs
  const totalHighlights = (() => {
    let n = 0;
    for (const ch of channels.values()) n += ch.highlights;
    for (const dm of dms.values()) n += dm.highlights;
    return n;
  })();

  // Total unread (no highlight) for a softer dot indicator
  const totalUnread = (() => {
    let n = 0;
    for (const ch of channels.values()) n += ch.unread;
    for (const dm of dms.values()) n += dm.unread;
    return n;
  })();

  const unreadNotifications = notifications.filter(n => !readNotificationIds.has(n.id)).length;
  const unreadAnnouncements = announcements.filter(a => !a.read).length;

  const onlineFriendCount = (() => {
    let n = 0;
    for (const f of friends.values()) if (f.online) n++;
    return n;
  })();

  return (
    <div className="server-bar">
      {/* Home / DMs button */}
      <Tooltip text="Direct Messages" side="right">
        <button
          className={`server-btn server-btn--home ${activeView.kind === 'home' ? 'server-btn--active' : ''}`}
          onClick={() => navigate({ kind: 'home' })}
          aria-label="Direct Messages"
        >
          <HomeIcon />
        </button>
      </Tooltip>

      <div className="server-separator" />

      {/* Server buttons */}
      {server && (
        <Tooltip text={server.name} side="right">
          <div className="server-btn-wrap">
            <button
              className={`server-btn ${activeView.kind === 'channel' ? 'server-btn--active' : ''}`}
              style={{ background: server.icon }}
              onClick={() => navigate({ kind: 'channel', channel: '' })}
              aria-label={server.name}
            >
              <span className="server-btn-initial">{server.name.slice(0, 2).toUpperCase()}</span>
            </button>
            {/* Connection status dot */}
            <span
              className={`server-conn-dot server-conn-dot--${connectionStatus}`}
              aria-label={connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Connecting...' : connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
            />
            {totalUnreadMentions > 0 && (
              <span className="server-badge server-badge--ping" aria-label={`${totalUnreadMentions} mentions`}>
                {totalUnreadMentions > 99 ? '99+' : totalUnreadMentions}
              </span>
            )}
            {totalUnreadMentions === 0 && totalHighlights > 0 && (
              <span className="server-badge server-badge--ping" aria-label={`${totalHighlights} mentions`}>
                {totalHighlights > 99 ? '99+' : totalHighlights}
              </span>
            )}
            {totalUnreadMentions === 0 && totalHighlights === 0 && totalUnread > 0 && (
              <span className="server-badge server-badge--dot" aria-label="Unread messages" />
            )}
          </div>
        </Tooltip>
      )}

      <div className="server-spacer" />

      {/* Friends panel button */}
      <Tooltip text="Friends" side="right">
        <div className="server-btn-wrap">
          <button
            className={`server-btn server-btn--friends ${showFriendsPanel ? 'server-btn--active' : ''}`}
            onClick={openFriendsPanel}
            aria-label={`Friends${onlineFriendCount > 0 ? ` (${onlineFriendCount} online)` : ''}`}
          >
            <PeopleIcon />
          </button>
          {onlineFriendCount > 0 && (
            <span className="server-badge server-badge--online" aria-label={`${onlineFriendCount} friends online`}>
              {onlineFriendCount > 99 ? '99+' : onlineFriendCount}
            </span>
          )}
        </div>
      </Tooltip>

      {/* Bookmarks button */}
      <Tooltip text={bookmarks.length > 0 ? `Bookmarks (${bookmarks.length})` : 'Bookmarks'} side="right">
        <div className="server-btn-wrap">
          <button
            className={`server-btn server-btn--bookmark ${showBookmarks ? 'server-btn--active' : ''}`}
            onClick={openBookmarks}
            aria-label={`Bookmarks${bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}`}
          >
            <ServerBarBookmarkIcon />
          </button>
          {bookmarks.length > 0 && (
            <span className="server-badge server-badge--gold" aria-label={`${bookmarks.length} bookmarks`}>
              {bookmarks.length > 99 ? '99+' : bookmarks.length}
            </span>
          )}
        </div>
      </Tooltip>

      {/* Announcements button */}
      <Tooltip text="Server Announcements" side="right">
        <div className="server-btn-wrap">
          <button
            className={`server-btn server-btn--announce ${showAnnouncementsPanel ? 'server-btn--active' : ''}`}
            onClick={openAnnouncementsPanel}
            aria-label={`Server Announcements${unreadAnnouncements > 0 ? ` (${unreadAnnouncements} unread)` : ''}`}
          >
            <AnnounceIcon />
          </button>
          {unreadAnnouncements > 0 && (
            <span className="server-badge server-badge--announce-pulse" aria-label={`${unreadAnnouncements} unread announcements`} />
          )}
        </div>
      </Tooltip>

      {/* Notification Center bell */}
      <Tooltip text="Notifications" side="right">
        <div className="server-btn-wrap">
          <button
            className={`server-btn server-btn--bell ${showNotificationCenter ? 'server-btn--active' : ''}`}
            onClick={openNotificationCenter}
            aria-label={`Notifications${unreadNotifications > 0 ? ` (${unreadNotifications} unread)` : ''}`}
          >
            <BellIcon />
          </button>
          {unreadNotifications > 0 && (
            <span className="server-badge server-badge--ping" aria-label={`${unreadNotifications} unread notifications`}>
              {unreadNotifications > 99 ? '99+' : unreadNotifications}
            </span>
          )}
        </div>
      </Tooltip>

      {/* Appearance / theme picker */}
      <Tooltip text="Appearance" side="right">
        <button
          className={`server-btn server-btn--theme ${showThemeModal ? 'server-btn--active' : ''}`}
          onClick={openThemeModal}
          aria-label="Appearance"
        >
          <PaletteIcon />
        </button>
      </Tooltip>

      {/* Connection profiles */}
      <Tooltip text="Connection Profiles" side="right">
        <button
          className={`server-btn server-btn--connprofile ${showConnectionProfiles ? 'server-btn--active' : ''}`}
          onClick={openConnectionProfiles}
          aria-label="Connection profiles"
        >
          <ServerPlugIcon />
        </button>
      </Tooltip>

      {/* Add server placeholder */}
      <Tooltip text="Add a server" side="right">
        <button className="server-btn server-btn--add" aria-label="Add server">
          <PlusIcon />
        </button>
      </Tooltip>

      {/* Keyboard shortcuts hint */}
      <Tooltip text="Keyboard Shortcuts  (?)" side="right">
        <button
          className="server-btn server-btn--help"
          onClick={openKeyboardShortcuts}
          aria-label="Keyboard shortcuts"
        >
          <HelpIcon />
        </button>
      </Tooltip>

      <style>{`
        .server-bar {
          width: var(--server-bar-w);
          flex-shrink: 0;
          background: var(--bg-void);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px 0;
          gap: 8px;
          overflow-y: auto;
          overflow-x: hidden;
          border-right: 1px solid var(--border-subtle);
        }
        .server-bar::-webkit-scrollbar { display: none; }

        .server-btn {
          width: 48px;
          height: 48px;
          border-radius: var(--r-xl);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: border-radius var(--t-normal), background var(--t-fast);
          position: relative;
          flex-shrink: 0;
        }
        .server-btn:hover { border-radius: var(--r-md); }
        .server-btn--active { border-radius: var(--r-md) !important; }

        /* Active indicator bar on the left */
        .server-btn::before {
          content: '';
          position: absolute;
          left: -12px;
          width: 4px;
          background: var(--text-primary);
          border-radius: 0 var(--r-xs) var(--r-xs) 0;
          transition: height var(--t-normal), opacity var(--t-fast);
          opacity: 0;
          height: 0;
        }
        .server-btn:hover::before { height: 20px; opacity: 1; }
        .server-btn--active::before { height: 40px; opacity: 1; }

        .server-btn--home {
          background: var(--bg-deep);
          color: var(--text-primary);
        }
        .server-btn--home:hover { background: var(--accent); }
        .server-btn--home.server-btn--active { background: var(--accent); color: #fff; }

        .server-btn--add {
          background: var(--bg-deep);
          color: var(--success);
        }
        .server-btn--add:hover { background: var(--success); color: #fff; border-radius: var(--r-md); }

        .server-btn--bell {
          background: var(--bg-deep);
          color: var(--text-secondary);
        }
        .server-btn--bell:hover { background: var(--bg-overlay); color: var(--text-primary); border-radius: var(--r-md); }
        .server-btn--bell.server-btn--active { background: var(--accent); color: #fff; }

        .server-btn--theme {
          background: var(--bg-deep);
          color: var(--text-secondary);
        }
        .server-btn--theme:hover { background: var(--bg-overlay); color: var(--text-primary); border-radius: var(--r-md); }
        .server-btn--theme.server-btn--active { background: var(--accent); color: #fff; }

        .server-btn--connprofile {
          background: var(--bg-deep);
          color: var(--text-secondary);
        }
        .server-btn--connprofile:hover { background: var(--bg-overlay); color: var(--text-primary); border-radius: var(--r-md); }
        .server-btn--connprofile.server-btn--active { background: var(--accent); color: #fff; }

        .server-btn--help {
          background: var(--bg-deep);
          color: var(--text-muted);
        }
        .server-btn--help:hover { background: var(--bg-overlay); color: var(--text-secondary); border-radius: var(--r-md); }

        .server-btn--friends {
          background: var(--bg-deep);
          color: var(--text-secondary);
        }
        .server-btn--friends:hover { background: var(--bg-overlay); color: var(--text-primary); border-radius: var(--r-md); }
        .server-btn--friends.server-btn--active { background: var(--accent); color: #fff; }

        .server-badge--online {
          background: var(--success, #3ba55d);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
          padding: 2px 4px;
          border-radius: var(--r-full);
          min-width: 16px;
          text-align: center;
          border: 2px solid var(--bg-void);
          position: absolute;
          bottom: -2px;
          right: -4px;
          pointer-events: none;
        }

        .server-spacer {
          flex: 1;
        }

        .server-btn-initial {
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
        }

        .server-separator {
          width: 32px;
          height: 2px;
          background: var(--border-normal);
          border-radius: var(--r-full);
          flex-shrink: 0;
          margin: 2px 0;
        }

        /* Wrapper for badge positioning */
        .server-btn-wrap {
          position: relative;
          flex-shrink: 0;
        }

        /* Mention count badge */
        .server-badge {
          position: absolute;
          bottom: -2px;
          right: -4px;
          pointer-events: none;
        }
        .server-badge--ping {
          background: var(--danger);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
          padding: 2px 4px;
          border-radius: var(--r-full);
          min-width: 16px;
          text-align: center;
          border: 2px solid var(--bg-void);
        }
        .server-badge--dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--text-primary);
          border: 2px solid var(--bg-void);
        }
        .server-badge--gold {
          background: var(--gold, #e8b84b);
          color: #000;
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
          padding: 2px 4px;
          border-radius: var(--r-full);
          min-width: 16px;
          text-align: center;
          border: 2px solid var(--bg-void);
        }

        .server-btn--bookmark {
          background: var(--bg-deep);
          color: var(--text-secondary);
        }
        .server-btn--bookmark:hover { background: var(--bg-overlay); color: var(--text-primary); border-radius: var(--r-md); }
        .server-btn--bookmark.server-btn--active { background: var(--gold, #e8b84b); color: #000; }

        .server-btn--announce {
          background: var(--bg-deep);
          color: var(--text-secondary);
        }
        .server-btn--announce:hover { background: var(--bg-overlay); color: #e8b84b; border-radius: var(--r-md); }
        .server-btn--announce.server-btn--active { background: #e8b84b; color: #000; }

        .server-badge--announce-pulse {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #e8b84b;
          border: 2px solid var(--bg-void);
          pointer-events: none;
          animation: announce-pulse 1.8s ease-in-out infinite;
        }
        @keyframes announce-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.55; transform: scale(0.85); }
        }

        /* Connection status dot on server icon */
        .server-conn-dot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid var(--bg-void);
          pointer-events: none;
        }
        .server-conn-dot--connected {
          background: var(--success, #3ba55d);
        }
        .server-conn-dot--connecting,
        .server-conn-dot--reconnecting {
          background: #fbbf24;
          animation: conn-dot-pulse 1.2s ease-in-out infinite;
        }
        .server-conn-dot--disconnected {
          background: var(--danger, #ed4245);
        }
        @keyframes conn-dot-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.707 2.293a1 1 0 0 0-1.414 0l-7 7A1 1 0 0 0 3 11h1v6a1 1 0 0 0 1 1h4v-4h2v4h4a1 1 0 0 0 1-1v-6h1a1 1 0 0 0 .707-1.707l-7-7z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <path d="M9 1a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H2a1 1 0 1 1 0-2h6V2a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.615 16.428a1.224 1.224 0 0 1-.01-.132C1.605 12.803 4.05 10.5 7 10.5s5.395 2.303 5.395 5.796c0 .047-.003.092-.01.132A9.952 9.952 0 0 1 7 18a9.952 9.952 0 0 1-5.385-1.572zM14.5 11c.374 0 .734.046 1.079.133A5.485 5.485 0 0 1 18.5 16.5H14.5v-5.5z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.5a1.5 1.5 0 0 1 1.5 1.5v.6A5.5 5.5 0 0 1 14.5 9v3.5l1.5 1.5v.5H2v-.5l1.5-1.5V9a5.5 5.5 0 0 1 4-5.4V3A1.5 1.5 0 0 1 9 1.5z" />
      <path d="M7 15a2 2 0 0 0 4 0" />
    </svg>
  );
}

function ServerBarBookmarkIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 14 14" fill="currentColor">
      <path d="M2 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10.5a.5.5 0 0 1-.777.416L7 10.101l-4.223 2.815A.5.5 0 0 1 2 12.5V2zm1 0v9.566l3.723-2.482a.5.5 0 0 1 .554 0L11 11.566V2H3z"/>
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2a8 8 0 1 0 0 16 4 4 0 0 0 0-8h-.5A1.5 1.5 0 0 1 8 8.5v-.08A6 6 0 0 1 10 2z" />
      <circle cx="5.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="4.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="M7.5 7.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-2.5 2.5V11" />
      <circle cx="10" cy="14" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AnnounceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 3v9M18 3L4 7v5l14 4M4 12v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function ServerPlugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4M8 2v4" />
      <rect x="5" y="6" width="10" height="6" rx="2" />
      <path d="M10 12v3" />
      <path d="M7.5 15h5" />
      <path d="M10 15v2" />
    </svg>
  );
}
