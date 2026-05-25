'use client';
import { useOnyxStore } from '@/lib/store';

type Panel = 'channels' | 'chat' | 'members' | 'settings';

const TABS: Array<{ id: Panel; icon: string; label: string }> = [
  { id: 'channels', icon: '☰', label: 'Channels' },
  { id: 'chat',     icon: '💬', label: 'Chat' },
  { id: 'members',  icon: '👥', label: 'Members' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

export default function MobileBottomNav() {
  const mobilePanel    = useOnyxStore(s => s.mobilePanel);
  const setMobilePanel = useOnyxStore(s => s.setMobilePanel);

  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {TABS.map(tab => {
        const active = mobilePanel === tab.id;
        return (
          <button
            key={tab.id}
            className={`mbn-tab${active ? ' mbn-tab--active' : ''}`}
            onClick={() => setMobilePanel(tab.id)}
            aria-label={tab.label}
            aria-pressed={active}
          >
            <span className="mbn-icon" aria-hidden="true">{tab.icon}</span>
            <span className="mbn-label">{tab.label}</span>
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
          }
        }
        .mbn-tab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px 4px;
          color: var(--text-muted);
          transition: color var(--t-fast, 150ms);
          border-top: 2px solid transparent;
          transition: color 150ms, border-color 150ms;
        }
        .mbn-tab:hover {
          color: var(--text-secondary);
        }
        .mbn-tab--active {
          color: var(--accent);
          border-top-color: var(--accent);
        }
        .mbn-icon {
          font-size: 18px;
          line-height: 1;
        }
        .mbn-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
        }
      `}</style>
    </nav>
  );
}
