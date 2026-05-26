'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import type React from 'react';

type NotifyLevel = 'all' | 'mentions' | 'none';

interface Props {
  channel: string;
  x: number;
  y: number;
  onClose: () => void;
}

export default function ChannelContextMenu({ channel, x, y, onClose }: Props) {
  const channelNotify    = useOnyxStore(s => s.channelNotify);
  const setChannelNotify = useOnyxStore(s => s.setChannelNotify);
  const muteChannel      = useOnyxStore(s => s.muteChannel);
  const unmuteChannel    = useOnyxStore(s => s.unmuteChannel);
  const partChannel      = useOnyxStore(s => s.partChannel);
  const channelColors    = useOnyxStore(s => s.channelColors);
  const setChannelColor  = useOnyxStore(s => s.setChannelColor);
  const clearChannelColor = useOnyxStore(s => s.clearChannelColor);
  const nsfwChannels     = useOnyxStore(s => s.nsfwChannels);
  const markChannelNsfw  = useOnyxStore(s => s.markChannelNsfw);
  const unmarkChannelNsfw = useOnyxStore(s => s.unmarkChannelNsfw);

  const current: NotifyLevel = channelNotify.get(channel.toLowerCase()) ?? 'all';
  const currentColor = channelColors.get(channel.toLowerCase()) ?? '#0ea5e9';
  const [notifyOpen, setNotifyOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp position to stay within viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: rect.right > vw ? Math.max(0, vw - rect.width - 8) : x,
      y: rect.bottom > vh ? Math.max(0, vh - rect.height - 8) : y,
    });
  }, [x, y]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleNotify = (level: NotifyLevel) => {
    setChannelNotify(channel, level);
    setNotifyOpen(false);
    onClose();
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(channel).catch(() => {});
    onClose();
  };

  const handleLeave = () => {
    partChannel(channel);
    onClose();
  };

  const handleSetColor = () => {
    colorInputRef.current?.click();
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChannelColor(channel, e.target.value);
    onClose();
  };

  const handleClearColor = () => {
    clearChannelColor(channel);
    onClose();
  };

  const isMuted = current === 'none';
  const handleMuteToggle = () => {
    if (isMuted) {
      unmuteChannel(channel);
    } else {
      muteChannel(channel);
    }
    onClose();
  };

  const hasColor = channelColors.has(channel.toLowerCase());
  const isNsfw = nsfwChannels.has(channel.toLowerCase());

  const handleNsfwToggle = () => {
    if (isNsfw) {
      unmarkChannelNsfw(channel);
    } else {
      markChannelNsfw(channel);
    }
    onClose();
  };

  const notifyLabels: { level: NotifyLevel; icon: string; label: string }[] = [
    { level: 'all',      icon: '🔔', label: 'All messages' },
    { level: 'mentions', icon: '💬', label: 'Mentions only' },
    { level: 'none',     icon: '🔕', label: 'Muted' },
  ];

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label={`Channel options for ${channel}`}
    >
      {/* Notifications trigger */}
      <div className="ctx-item ctx-item--submenu" onClick={() => setNotifyOpen(o => !o)}>
        <span className="ctx-icon">🔔</span>
        Notifications
        <span className="ctx-arrow">{notifyOpen ? '▲' : '▼'}</span>
      </div>

      {notifyOpen && (
        <div className="ctx-submenu">
          {notifyLabels.map(({ level, icon, label }) => (
            <button
              key={level}
              className={`ctx-item ctx-item--sub ${current === level ? 'ctx-item--checked' : ''}`}
              onClick={() => handleNotify(level)}
              role="menuitemradio"
              aria-checked={current === level}
            >
              <span className="ctx-icon">{icon}</span>
              {label}
              {current === level && <span className="ctx-check">✓</span>}
            </button>
          ))}
        </div>
      )}

      <div className="ctx-separator" role="separator" />

      <button
        className={`ctx-item${isMuted ? ' ctx-item--muted-active' : ''}`}
        onClick={handleMuteToggle}
        role="menuitemcheckbox"
        aria-checked={isMuted}
      >
        <span className="ctx-icon">{isMuted ? '🔇' : '🔕'}</span>
        {isMuted ? 'Unmute Channel' : 'Mute Channel'}
      </button>

      <div className="ctx-separator" role="separator" />

      <button className="ctx-item" onClick={handleCopyName} role="menuitem">
        <span className="ctx-icon">📋</span>
        Copy name
      </button>

      <div className="ctx-separator" role="separator" />

      <button className="ctx-item" onClick={handleSetColor} role="menuitem">
        <span className="ctx-icon">🎨</span>
        Set color label
        <input
          ref={colorInputRef}
          type="color"
          value={currentColor}
          onChange={handleColorChange}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
          tabIndex={-1}
          aria-hidden
        />
      </button>
      {hasColor && (
        <button className="ctx-item" onClick={handleClearColor} role="menuitem">
          <span className="ctx-icon">✕</span>
          Clear color label
        </button>
      )}

      <button
        className={`ctx-item${isNsfw ? ' ctx-item--nsfw-active' : ''}`}
        onClick={handleNsfwToggle}
        role="menuitemcheckbox"
        aria-checked={isNsfw}
      >
        <span className="ctx-icon">🔞</span>
        {isNsfw ? 'Unmark as NSFW' : 'Mark as NSFW'}
      </button>

      <div className="ctx-separator" role="separator" />

      <button className="ctx-item ctx-item--danger" onClick={handleLeave} role="menuitem">
        <span className="ctx-icon">🚪</span>
        Leave channel
      </button>

      <style>{`
        .ctx-menu {
          position: fixed;
          z-index: 900;
          min-width: 200px;
          background: var(--bg-float, var(--bg-overlay));
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.5));
          padding: 4px;
          user-select: none;
          animation: ctx-appear 80ms ease-out;
        }
        @keyframes ctx-appear {
          from { opacity: 0; transform: scale(0.97) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        .ctx-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 7px 10px;
          border-radius: 6px;
          border: none;
          background: none;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          text-align: left;
          transition: background 80ms, color 80ms;
          font-family: inherit;
        }
        .ctx-item:hover {
          background: var(--accent-subtle, rgba(14,165,233,0.12));
          color: var(--text-primary);
        }
        .ctx-item--submenu { justify-content: flex-start; }
        .ctx-item--checked { color: var(--accent); }
        .ctx-item--danger { color: var(--danger, #f04747); }
        .ctx-item--danger:hover { background: rgba(240,71,71,0.12); color: var(--danger, #f04747); }
        .ctx-item--muted-active { color: var(--accent); }
        .ctx-item--nsfw-active { color: #f87171; }
        .ctx-item--sub { padding-left: 14px; font-size: 13px; }

        .ctx-icon { font-size: 14px; flex-shrink: 0; line-height: 1; }

        .ctx-arrow {
          margin-left: auto;
          font-size: 10px;
          color: var(--text-muted);
        }
        .ctx-check {
          margin-left: auto;
          color: var(--accent);
          font-weight: 700;
          font-size: 13px;
        }

        .ctx-submenu {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          margin: 2px 4px 4px;
          padding: 2px;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .ctx-separator {
          height: 1px;
          background: var(--border-subtle);
          margin: 4px 6px;
        }
      `}</style>
    </div>
  );
}
