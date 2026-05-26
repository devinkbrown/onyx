'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOnyxStore } from '@/lib/store';
import Avatar from './Avatar';

// ── Nick hue helpers ──────────────────────────────────────────────────────────

function nickHue(nick: string): number {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash) % 360;
}

function bannerGradient(nick: string): string {
  const hue = nickHue(nick);
  return `linear-gradient(135deg, hsl(${hue},55%,25%) 0%, hsl(${(hue + 40) % 360},45%,15%) 100%)`;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  online:  'var(--status-online)',
  idle:    'var(--status-idle)',
  dnd:     'var(--status-dnd)',
  offline: 'var(--status-offline)',
};

const STATUS_LABELS: Record<string, string> = {
  online:  'Online',
  idle:    'Idle',
  dnd:     'Do Not Disturb',
  offline: 'Offline',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  nick: string;
  anchorEl: HTMLElement;
  onClose: () => void;
  onOpenProfile: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MiniUserCard({ nick, anchorEl, onClose, onOpenProfile }: Props) {
  const cardRef       = useRef<HTMLDivElement>(null);
  const mouseLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const channels       = useOnyxStore(s => s.channels);
  const dms            = useOnyxStore(s => s.dms);
  const userProps      = useOnyxStore(s => s.userProps);
  const navigate       = useOnyxStore(s => s.navigate);
  const ourNick        = useOnyxStore(s => s.ourNick);
  const userStatus     = useOnyxStore(s => s.userStatus);
  const customStatus   = useOnyxStore(s => s.customStatus);

  // ── Derive card position from anchor bounding rect ────────────────────────

  const rect   = anchorEl.getBoundingClientRect();
  const vw     = typeof window !== 'undefined' ? window.innerWidth  : 1200;
  const vh     = typeof window !== 'undefined' ? window.innerHeight : 800;

  const cardW  = 240;
  const gap    = 8;

  // Default: right of anchor; fall back to left when near right edge
  const spaceRight = vw - rect.right;
  const spaceLeft  = rect.left;

  let left: number;
  let top: number = Math.min(rect.top, vh - 420);

  if (spaceRight >= cardW + gap) {
    left = rect.right + gap;
  } else if (spaceLeft >= cardW + gap) {
    left = rect.left - cardW - gap;
  } else {
    // Centre horizontally as a fallback
    left = Math.max(8, Math.min(rect.left, vw - cardW - 8));
    top  = rect.bottom + gap;
  }

  // ── IRCX props for this nick ──────────────────────────────────────────────

  const props      = userProps.get(nick.toLowerCase()) ?? {};
  const bio        = props.BIO   ?? props.Bio   ?? '';
  const statusText = props.STATUS ?? props.Status ?? '';

  // Determine user's status in DMs or channel
  const dmConv        = dms.get(nick.toLowerCase());
  const isAway        = dmConv?.away;

  const nickStatus: 'online' | 'idle' | 'dnd' | 'offline' =
    nick.toLowerCase() === ourNick.toLowerCase()
      ? userStatus
      : isAway ? 'offline' : 'online';

  // ── Shared channels: channels where both ourNick and this nick appear ─────

  const sharedChannels: string[] = [];
  for (const [, ch] of channels) {
    if (
      ch.users.has(nick.toLowerCase()) &&
      ch.users.has(ourNick.toLowerCase())
    ) {
      sharedChannels.push(ch.name);
      if (sharedChannels.length >= 3) break;
    }
  }

  // Account name from DM conversation or IRCX props
  const accountName = dmConv?.account ?? props.ACCOUNT ?? null;

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node) &&
          !anchorEl.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorEl, onClose]);

  // ── Close on Escape ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Mouse-leave timeout (300ms) ───────────────────────────────────────────

  const handleMouseLeave = useCallback(() => {
    mouseLeaveRef.current = setTimeout(onClose, 300);
  }, [onClose]);

  const handleMouseEnter = useCallback(() => {
    if (mouseLeaveRef.current) {
      clearTimeout(mouseLeaveRef.current);
      mouseLeaveRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (mouseLeaveRef.current) clearTimeout(mouseLeaveRef.current);
  }, []);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleMessage = useCallback(() => {
    navigate({ kind: 'dm', nick });
    onClose();
  }, [navigate, nick, onClose]);

  const handleMention = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('ocean:mention', { detail: { nick } })
    );
    onClose();
  }, [nick, onClose]);

  const handleViewProfile = useCallback(() => {
    onOpenProfile();
    onClose();
  }, [onOpenProfile, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  const card = (
    <div
      ref={cardRef}
      className="mini-card"
      style={{ left, top }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="dialog"
      aria-label={`${nick} profile card`}
    >
      {/* Banner strip */}
      <div
        className="mini-card-banner"
        style={{ background: bannerGradient(nick) }}
        aria-hidden
      />

      {/* Avatar overlapping banner */}
      <div className="mini-card-avatar-wrap">
        <Avatar nick={nick} size={52} status={nickStatus} />
      </div>

      {/* Body */}
      <div className="mini-card-body">
        {/* Nick + account */}
        <div className="mini-card-nick">{nick}</div>
        {accountName && (
          <div className="mini-card-account">@{accountName}</div>
        )}

        {/* Status row */}
        <div className="mini-card-status-row">
          <span
            className="mini-card-status-dot"
            style={{ background: STATUS_COLORS[nickStatus] }}
            aria-hidden
          />
          <span className="mini-card-status-label">
            {STATUS_LABELS[nickStatus]}
          </span>
        </div>

        {/* Custom / IRCX status text */}
        {(statusText || (nick.toLowerCase() === ourNick.toLowerCase() && customStatus)) && (
          <div className="mini-card-custom-status">
            {nick.toLowerCase() === ourNick.toLowerCase() ? customStatus : statusText}
          </div>
        )}

        {/* Bio — 2-line clamp */}
        {bio && (
          <p className="mini-card-bio">{bio}</p>
        )}

        {/* Shared channels */}
        {sharedChannels.length > 0 && (
          <div className="mini-card-channels">
            {sharedChannels.map(ch => (
              <span key={ch} className="mini-card-channel-pill">{ch}</span>
            ))}
          </div>
        )}

        {/* Action row */}
        <div className="mini-card-actions">
          <button
            className="mini-card-btn mini-card-btn--primary"
            onClick={handleMessage}
            aria-label={`Send message to ${nick}`}
          >
            Message
          </button>
          <button
            className="mini-card-btn"
            onClick={handleMention}
            aria-label={`Mention ${nick}`}
          >
            Mention
          </button>
        </div>

        {/* View full profile link */}
        <button
          className="mini-card-profile-link"
          onClick={handleViewProfile}
        >
          View Full Profile →
        </button>
      </div>

      <style>{styles}</style>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(card, document.body);
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = `
  .mini-card {
    position: fixed;
    width: 240px;
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    z-index: 1200;
    animation: mini-card-in 150ms var(--ease-out) both;
    transform-origin: top left;
  }

  @keyframes mini-card-in {
    from { opacity: 0; transform: scale(0.92); }
    to   { opacity: 1; transform: scale(1);    }
  }

  .mini-card-banner {
    height: 64px;
    flex-shrink: 0;
  }

  .mini-card-avatar-wrap {
    position: relative;
    padding: 0 12px;
    margin-top: -28px;
    display: inline-flex;
  }

  .mini-card-body {
    padding: 6px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mini-card-nick {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    margin-top: 4px;
  }

  .mini-card-account {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: -2px;
  }

  .mini-card-status-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  .mini-card-status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--r-full);
    flex-shrink: 0;
  }

  .mini-card-status-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .mini-card-custom-status {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    line-height: 1.4;
  }

  .mini-card-bio {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 4px 0 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .mini-card-channels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .mini-card-channel-pill {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    padding: 2px 7px;
    border-radius: var(--r-full);
  }

  .mini-card-actions {
    display: flex;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
    margin-top: 8px;
    /* Hidden by default, revealed on hover */
    opacity: 0;
    transform: translateY(4px);
    transition: opacity var(--t-fast), transform var(--t-fast);
  }
  .mini-card:hover .mini-card-actions {
    opacity: 1;
    transform: translateY(0);
  }

  .mini-card-btn {
    flex: 1;
    background: var(--bg-float);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-sm);
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
  }

  .mini-card-btn:hover {
    background: var(--bg-overlay);
    color: var(--text-primary);
    border-color: var(--border-normal);
  }

  .mini-card-btn--primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .mini-card-btn--primary:hover {
    background: var(--accent-hover);
    border-color: transparent;
    color: #fff;
  }

  .mini-card-profile-link {
    background: none;
    border: none;
    padding: 4px 0;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    transition: color var(--t-fast);
  }

  .mini-card-profile-link:hover {
    color: var(--accent);
  }
`;
