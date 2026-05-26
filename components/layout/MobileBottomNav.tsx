'use client';
import { useOnyxStore } from '@/lib/store';

// Tab definitions — 5 tabs with proper icons
type Tab = 'channels' | 'dms' | 'search' | 'notifications' | 'settings';

interface TabDef {
  id: Tab;
  label: string;
  icon: (active: boolean) => React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: 'channels',
    label: 'Channels',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: 'dms',
    label: 'DMs',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'search',
    label: 'Search',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    label: 'Alerts',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export default function MobileBottomNav() {
  const mobilePanel          = useOnyxStore(s => s.mobilePanel);
  const setMobilePanel       = useOnyxStore(s => s.setMobilePanel);
  const openSpotlight        = useOnyxStore(s => s.openSpotlight);
  const openSettings         = useOnyxStore(s => s.openSettings);
  const openNotificationCenter = useOnyxStore(s => s.openNotificationCenter);
  const channelUnread        = useOnyxStore(s => s.channelUnread);
  const channelMentions      = useOnyxStore(s => s.channelMentions);
  const dms                  = useOnyxStore(s => s.dms);

  // Aggregate unread counts for badges
  const totalChannelUnread = Object.values(channelUnread).reduce((a, b) => a + b, 0);
  const totalChannelMentions = Object.values(channelMentions).reduce((a, b) => a + b, 0);
  const totalDmUnread = [...dms.values()].reduce((a, dm) => a + (dm.unread ?? 0), 0);
  const totalDmMentions = [...dms.values()].reduce((a, dm) => a + (dm.highlights ?? 0), 0);
  const channelBadge = totalChannelMentions > 0 ? totalChannelMentions : totalChannelUnread > 0 ? totalChannelUnread : 0;
  const dmBadge = totalDmMentions > 0 ? totalDmMentions : totalDmUnread > 0 ? totalDmUnread : 0;

  const handleTab = (id: Tab) => {
    if (id === 'search') {
      openSpotlight();
      return;
    }
    if (id === 'notifications') {
      openNotificationCenter();
      return;
    }
    if (id === 'settings') {
      openSettings();
      return;
    }
    // 'channels' → open sidebar overlay; 'dms' → navigate to dm panel
    if (id === 'channels') {
      setMobilePanel('channels');
      return;
    }
    if (id === 'dms') {
      setMobilePanel('chat');
      return;
    }
  };

  // Determine visual active state (search/notifications/settings don't have a persistent "active" visual)
  const getActive = (id: Tab): boolean => {
    if (id === 'channels') return mobilePanel === 'channels';
    if (id === 'dms') return mobilePanel === 'chat';
    return false;
  };

  const getBadge = (id: Tab): number => {
    if (id === 'channels') return channelBadge;
    if (id === 'dms') return dmBadge;
    return 0;
  };

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {TABS.map(tab => {
        const active = getActive(tab.id);
        const badge = getBadge(tab.id);
        const badgeStr = badge > 99 ? '99+' : String(badge);
        return (
          <button
            key={tab.id}
            className={`mbn-tab${active ? ' mbn-tab--active' : ''}`}
            onClick={() => handleTab(tab.id)}
            aria-label={`${tab.label}${badge > 0 ? `, ${badge} unread` : ''}`}
            aria-pressed={active}
          >
            <span className="mbn-icon-wrap">
              {tab.icon(active)}
              {badge > 0 && (
                <span className={`mbn-badge${badge > 0 && ['channels', 'dms'].includes(tab.id) && Object.values(channelMentions).some(v => v > 0) ? ' mbn-badge--mention' : ''}`} aria-hidden>
                  {badgeStr}
                </span>
              )}
            </span>
            <span className="mbn-label">{tab.label}</span>
            {active && <span className="mbn-active-dot" aria-hidden />}
          </button>
        );
      })}

      <style>{`
        .mobile-bottom-nav {
          display: none;
        }

        @media (max-width: 768px) {
          .mobile-bottom-nav {
            display: flex;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: calc(60px + env(safe-area-inset-bottom, 0px));
            padding-bottom: env(safe-area-inset-bottom, 0px);
            background: var(--bg-void);
            border-top: 1px solid var(--border-subtle);
            z-index: 210;
            box-shadow: 0 -4px 32px rgba(0,0,0,0.6);
          }
        }

        .mbn-tab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 8px 4px 6px;
          color: var(--text-muted);
          position: relative;
          min-height: 44px;
          min-width: 44px;
          transition: color 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)),
                      background 150ms;
          -webkit-tap-highlight-color: transparent;
        }

        .mbn-tab:active .mbn-icon-wrap {
          transform: scale(0.86);
          transition: transform 80ms ease;
        }

        .mbn-tab:hover {
          color: var(--text-secondary);
          background: rgba(255,255,255,0.03);
        }

        .mbn-tab--active {
          color: var(--accent);
        }

        .mbn-icon-wrap {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          transition: transform 150ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
        }

        .mbn-tab--active .mbn-icon-wrap {
          transform: scale(1.1);
        }

        .mbn-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          line-height: 1;
        }

        /* Active indicator bar at the top of the tab */
        .mbn-active-dot {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 28px;
          height: 2px;
          border-radius: 0 0 2px 2px;
          background: var(--accent);
          box-shadow: 0 0 8px rgba(14, 165, 233, 0.6);
          animation: mbn-bar-in 200ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275)) both;
        }

        @keyframes mbn-bar-in {
          from { transform: translateX(-50%) scaleX(0); opacity: 0; }
          to   { transform: translateX(-50%) scaleX(1); opacity: 1; }
        }

        /* Unread badge */
        .mbn-badge {
          position: absolute;
          top: -2px;
          right: -4px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--accent);
          color: #fff;
          border-radius: var(--r-full, 9999px);
          font-size: 10px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          box-shadow: 0 1px 6px rgba(0,0,0,0.5);
          border: 1.5px solid var(--bg-void);
        }

        .mbn-badge--mention {
          background: var(--danger, #ed4245);
          box-shadow: 0 1px 6px rgba(237,66,69,0.5);
        }

        @media (prefers-reduced-motion: reduce) {
          .mbn-tab:active .mbn-icon-wrap { transform: none; }
          .mbn-tab--active .mbn-icon-wrap { transform: none; }
          .mbn-active-dot { animation: none; }
        }
      `}</style>
    </nav>
  );
}
