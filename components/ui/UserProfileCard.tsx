'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOnyxStore } from '@/lib/store';
import Avatar from './Avatar';
import UserNotesModal from '@/components/modals/UserNotesModal';
import { getNickColor } from '@/lib/nick-color';
import { parseActivity } from '@/lib/activity';

// ── Nick color helpers ─────────────────────────────────────────────────────────

function nickHue(nick: string): number {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(hash) % 360;
}

function bannerGradient(nick: string): string {
  const hue = nickHue(nick);
  return `linear-gradient(135deg, hsl(${hue},55%,25%) 0%, hsl(${(hue + 40) % 360},45%,15%) 100%)`;
}

// ── Blocked nicks localStorage helpers ────────────────────────────────────────

const BLOCKED_KEY = 'ocean-blocked';

function loadBlocked(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(BLOCKED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.map(n => n.toLowerCase()) : []);
  } catch {
    return new Set();
  }
}

function saveBlocked(blocked: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BLOCKED_KEY, JSON.stringify([...blocked]));
  } catch {
    // Storage quota exceeded — silently degrade
  }
}

// ── Idle time formatter ────────────────────────────────────────────────────────

function formatIdle(secs: number | undefined): string {
  if (secs === undefined) return '';
  if (secs < 60) return `${secs}s idle`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m idle`;
  return `${Math.floor(secs / 3600)}h idle`;
}

// ── Channel badge ─────────────────────────────────────────────────────────────

interface ChannelBadgeProps {
  name: string;
  onClick: () => void;
}

function ChannelBadge({ name, onClick }: ChannelBadgeProps) {
  return (
    <button className="upc-channel-pill" onClick={onClick} title={`Go to ${name}`}>
      {name}
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  nick: string;
  anchor: { x: number; y: number };
}

// ── Component ─────────────────────────────────────────────────────────────────

const CARD_W = 300;
const CARD_H = 440; // estimated max height for clamping

export default function UserProfileCard({ nick, anchor }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  const channels           = useOnyxStore(s => s.channels);
  const dms                = useOnyxStore(s => s.dms);
  const userProps          = useOnyxStore(s => s.userProps);
  const whoisData          = useOnyxStore(s => s.whoisData);
  const ourNick            = useOnyxStore(s => s.ourNick);
  const userStatus         = useOnyxStore(s => s.userStatus);
  const client             = useOnyxStore(s => s.client);
  const navigate           = useOnyxStore(s => s.navigate);
  const addFriend          = useOnyxStore(s => s.addFriend);
  const removeFriend       = useOnyxStore(s => s.removeFriend);
  const friends            = useOnyxStore(s => s.friends);
  const getUserProfile     = useOnyxStore(s => s.getUserProfile);
  const closeUserProfileCard    = useOnyxStore(s => s.closeUserProfileCard);
  const nickColorOverrides       = useOnyxStore(s => s.nickColorOverrides);
  const setNickColorOverride     = useOnyxStore(s => s.setNickColorOverride);
  const clearNickColorOverride   = useOnyxStore(s => s.clearNickColorOverride);
  const displayNameOverrides     = useOnyxStore(s => s.displayNameOverrides);
  const setDisplayNameOverride   = useOnyxStore(s => s.setDisplayNameOverride);
  const clearDisplayNameOverride = useOnyxStore(s => s.clearDisplayNameOverride);

  // ── Nick color ────────────────────────────────────────────────────────────
  const effectiveNickColor = nickColorOverrides.get(nick.toLowerCase()) ?? getNickColor(nick);
  const hasColorOverride   = nickColorOverrides.has(nick.toLowerCase());

  // ── Display name ──────────────────────────────────────────────────────────
  const currentDisplayName    = displayNameOverrides[nick] ?? '';
  const hasDisplayNameOverride = currentDisplayName !== '';
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput]     = useState(currentDisplayName);

  const handleSaveDisplayName = useCallback(() => {
    const trimmed = displayNameInput.trim();
    if (trimmed && trimmed !== nick) {
      setDisplayNameOverride(nick, trimmed);
    } else if (!trimmed) {
      clearDisplayNameOverride(nick);
    }
    setEditingDisplayName(false);
  }, [displayNameInput, nick, setDisplayNameOverride, clearDisplayNameOverride]);

  const handleDisplayNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSaveDisplayName();
    if (e.key === 'Escape') { setEditingDisplayName(false); setDisplayNameInput(currentDisplayName); }
  }, [handleSaveDisplayName, currentDisplayName]);

  // ── Blocked state (localStorage only, not in store) ──────────────────────

  const [blocked, setBlocked] = useState<Set<string>>(() => loadBlocked());
  const isBlocked = blocked.has(nick.toLowerCase());

  const toggleBlock = useCallback(() => {
    setBlocked(prev => {
      const next = new Set(prev);
      const key = nick.toLowerCase();
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveBlocked(next);
      return next;
    });
  }, [nick]);

  // ── User note ──────────────────────────────────────────────────────────

  const userNotes       = useOnyxStore(s => s.userNotes);
  const userNote        = userNotes.get(nick.toLowerCase()) ?? '';
  const [showNoteModal, setShowNoteModal] = useState(false);

  // ── Friend state ──────────────────────────────────────────────────────────

  const isFriend = friends.has(nick.toLowerCase());

  const toggleFriend = useCallback(() => {
    if (isFriend) {
      removeFriend(nick);
    } else {
      addFriend(nick);
    }
  }, [isFriend, addFriend, removeFriend, nick]);

  // ── WHOIS data ────────────────────────────────────────────────────────────

  const whois = whoisData.get(nick.toLowerCase());
  const dmConv = dms.get(nick.toLowerCase());
  const props = userProps.get(nick.toLowerCase()) ?? {};
  const accountName = whois?.account ?? dmConv?.account ?? props.ACCOUNT ?? null;
  const idleSecs = whois?.idleSecs;

  // ── Activity / rich presence ──────────────────────────────────────────────
  const userActivities = useOnyxStore(s => s.userActivities);
  const storedActivity = userActivities[nick.toLowerCase()];
  const statusText = props.STATUS ?? props.Status ?? '';
  const activity = storedActivity ?? parseActivity(statusText);

  // Trigger WHOIS on mount — skip if profile is fresh (signonTime set within last 5 min)
  useEffect(() => {
    if (!client || !nick) return;
    const profile = getUserProfile(nick);
    const STALE_THRESHOLD = 300; // 5 minutes in seconds
    const nowSecs = Date.now() / 1000;
    const isStale = !profile?.signonTime || (nowSecs - profile.signonTime) > STALE_THRESHOLD;
    if (isStale) {
      client.sendRaw('WHOIS', nick, nick);
    }
  }, [client, nick]);

  // ── Shared channels ───────────────────────────────────────────────────────

  const sharedChannels: string[] = [];
  for (const [, ch] of channels) {
    if (ch.users.has(nick.toLowerCase()) && ch.users.has(ourNick.toLowerCase())) {
      sharedChannels.push(ch.name);
      if (sharedChannels.length >= 4) break;
    }
  }

  // ── Online / away indicator ───────────────────────────────────────────────

  const isAway = dmConv?.away ?? false;
  const nickStatus: 'online' | 'idle' | 'offline' =
    nick.toLowerCase() === ourNick.toLowerCase()
      ? (userStatus === 'offline' ? 'offline' : userStatus === 'idle' ? 'idle' : 'online')
      : isAway ? 'offline' : 'online';

  const STATUS_COLORS: Record<string, string> = {
    online:  'var(--status-online)',
    idle:    'var(--status-idle)',
    offline: 'var(--status-offline)',
  };
  const STATUS_LABELS: Record<string, string> = {
    online:  'Online',
    idle:    'Idle',
    offline: 'Offline',
  };

  // ── Card position — clamp to viewport ────────────────────────────────────

  const vw = typeof window !== 'undefined' ? window.innerWidth  : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const GAP = 12;
  const left = Math.max(GAP, Math.min(anchor.x + GAP, vw - CARD_W - GAP));
  const top  = Math.max(GAP, Math.min(anchor.y,        vh - CARD_H - GAP));

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        closeUserProfileCard();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeUserProfileCard]);

  // ── Close on Escape ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeUserProfileCard();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeUserProfileCard]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleMessage = useCallback(() => {
    navigate({ kind: 'dm', nick });
    closeUserProfileCard();
  }, [navigate, nick, closeUserProfileCard]);

  const handleWhois = useCallback(() => {
    client?.sendRaw('WHOIS', nick, nick);
  }, [client, nick]);

  const handleChannelClick = useCallback((ch: string) => {
    navigate({ kind: 'channel', channel: ch });
    closeUserProfileCard();
  }, [navigate, closeUserProfileCard]);

  // ── Render ────────────────────────────────────────────────────────────────

  const card = (
    <div
      ref={cardRef}
      className="upc-card"
      style={{ left, top, transformOrigin: `${anchor.x < left ? 'left' : 'right'} top` }}
      role="dialog"
      aria-label={`${nick} profile`}
      aria-modal="false"
    >
      {/* Close button */}
      <button
        className="upc-close"
        onClick={closeUserProfileCard}
        aria-label="Close profile card"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
      </button>

      {/* Banner */}
      <div className="upc-banner" style={{ background: bannerGradient(nick) }} aria-hidden />

      {/* Avatar overlapping banner */}
      <div className="upc-avatar-wrap">
        <Avatar nick={nick} size={56} status={nickStatus} />
      </div>

      {/* Body */}
      <div className="upc-body">
        {/* Display name + nick */}
        <div className="upc-name-row">
          <div className="upc-nick">{hasDisplayNameOverride ? currentDisplayName : nick}</div>
          <button
            className="upc-edit-displayname-btn"
            onClick={() => { setDisplayNameInput(currentDisplayName); setEditingDisplayName(true); }}
            aria-label="Set local display name"
            title="Set a local display name for this person"
          >
            ✏️
          </button>
        </div>
        {hasDisplayNameOverride && (
          <div className="upc-actual-nick">{nick}</div>
        )}
        {editingDisplayName && (
          <div className="upc-displayname-edit">
            <input
              className="upc-displayname-input"
              value={displayNameInput}
              onChange={e => setDisplayNameInput(e.target.value)}
              onKeyDown={handleDisplayNameKeyDown}
              placeholder={nick}
              maxLength={64}
              autoFocus
              aria-label="Display name"
            />
            <div className="upc-displayname-actions">
              <button className="upc-displayname-save" onClick={handleSaveDisplayName}>Save</button>
              {hasDisplayNameOverride && (
                <button
                  className="upc-displayname-clear"
                  onClick={() => { clearDisplayNameOverride(nick); setEditingDisplayName(false); }}
                >
                  Clear
                </button>
              )}
              <button
                className="upc-displayname-cancel"
                onClick={() => { setEditingDisplayName(false); setDisplayNameInput(currentDisplayName); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {accountName && <div className="upc-account">@{accountName}</div>}

        {/* Status row */}
        <div className="upc-status-row">
          <span
            className="upc-status-dot"
            style={{ background: STATUS_COLORS[nickStatus] }}
            aria-hidden
          />
          <span className="upc-status-label">{STATUS_LABELS[nickStatus]}</span>
          {idleSecs !== undefined && idleSecs > 0 && (
            <span className="upc-idle">{formatIdle(idleSecs)}</span>
          )}
        </div>

        {/* Activity card (rich presence) */}
        {activity && (
          <div className="upc-activity-card" aria-label={`Activity: ${activity.typeLabel}`}>
            <div className="upc-activity-header">
              <span className="upc-activity-emoji" aria-hidden>{activity.emoji}</span>
              <span className="upc-activity-type">{activity.typeLabel}</span>
            </div>
            <div className="upc-activity-text">{activity.text}</div>
          </div>
        )}

        {/* Shared channel badges */}
        {sharedChannels.length > 0 && (
          <div className="upc-channels">
            {sharedChannels.map(ch => (
              <ChannelBadge key={ch} name={ch} onClick={() => handleChannelClick(ch)} />
            ))}
          </div>
        )}

        {/* Personal note preview */}
        {userNote && (
          <div className="upc-note-preview">
            <div className="upc-note-label">📝 Personal note</div>
            <div className="upc-note-text">
              &ldquo;{userNote.length > 80 ? `${userNote.slice(0, 80)}…` : userNote}&rdquo;
            </div>
          </div>
        )}

        {/* Primary actions */}
        <div className="upc-actions">
          <button
            className="upc-btn upc-btn--primary"
            onClick={handleMessage}
            aria-label={`Send message to ${nick}`}
          >
            Send Message
          </button>
          <button
            className="upc-btn"
            onClick={handleWhois}
            aria-label={`Run WHOIS on ${nick}`}
          >
            WHOIS
          </button>
        </div>

        {/* Secondary actions */}
        <div className="upc-secondary">
          <button
            className={`upc-btn-ghost ${isFriend ? 'upc-btn-ghost--active' : ''}`}
            onClick={toggleFriend}
            aria-pressed={isFriend}
          >
            {isFriend ? '★ Friend' : '☆ Add Friend'}
          </button>
          <button
            className="upc-btn-ghost"
            onClick={() => setShowNoteModal(true)}
            aria-label={userNote ? `Edit note about ${nick}` : `Add note about ${nick}`}
          >
            {userNote ? '📝 Edit note' : '📝 Add note'}
          </button>
          <button
            className={`upc-btn-ghost upc-btn-ghost--danger ${isBlocked ? 'upc-btn-ghost--blocked' : ''}`}
            onClick={toggleBlock}
            aria-pressed={isBlocked}
          >
            {isBlocked ? '⊘ Unblock' : '⊘ Block'}
          </button>
        </div>

        {/* Nick color override row */}
        <div className="upc-color-row">
          <span className="upc-color-label">🎨 Nick color</span>
          <div className="upc-color-controls">
            <label
              className="upc-color-swatch"
              style={{ background: effectiveNickColor }}
              title="Click to change nick color"
              aria-label="Change nick color"
            >
              <input
                type="color"
                className="upc-color-input"
                value={effectiveNickColor}
                onChange={e => setNickColorOverride(nick, e.target.value)}
                aria-label={`Nick color for ${nick}`}
              />
            </label>
            {hasColorOverride && (
              <button
                className="upc-color-reset"
                onClick={() => clearNickColorOverride(nick)}
                aria-label="Reset nick color to default"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return (
    <>
      {createPortal(card, document.body)}
      {showNoteModal && (
        <UserNotesModal nick={nick} onClose={() => setShowNoteModal(false)} />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = `
  .upc-card {
    position: fixed;
    width: ${CARD_W}px;
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    z-index: 1300;
    animation: upc-in 160ms var(--ease-out) both;
  }

  @keyframes upc-in {
    from { opacity: 0; transform: scale(0.9); }
    to   { opacity: 1; transform: scale(1);   }
  }

  .upc-close {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    width: 26px;
    height: 26px;
    border-radius: var(--r-full);
    background: rgba(0,0,0,0.35);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.7);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .upc-close:hover {
    background: rgba(0,0,0,0.6);
    color: #fff;
  }

  .upc-banner {
    height: 72px;
    flex-shrink: 0;
  }

  .upc-avatar-wrap {
    padding: 0 14px;
    margin-top: -30px;
    display: inline-flex;
    position: relative;
  }

  .upc-body {
    padding: 6px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .upc-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  .upc-nick {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upc-actual-nick {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: -3px;
    margin-bottom: 2px;
  }

  .upc-edit-displayname-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--r-sm);
    opacity: 0;
    transition: opacity var(--t-fast), background var(--t-fast);
    font-size: 13px;
    line-height: 1;
  }
  .upc-card:hover .upc-edit-displayname-btn { opacity: 1; }
  .upc-edit-displayname-btn:hover { background: var(--bg-elevated); }

  .upc-displayname-edit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0 4px;
  }

  .upc-displayname-input {
    width: 100%;
    background: var(--bg-elevated);
    border: 1px solid var(--accent-border);
    border-radius: var(--r-sm);
    padding: 5px 9px;
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
    box-sizing: border-box;
  }
  .upc-displayname-input::placeholder { color: var(--text-muted); }

  .upc-displayname-actions {
    display: flex;
    gap: 6px;
  }

  .upc-displayname-save {
    flex: 1;
    background: var(--accent);
    border: none;
    border-radius: var(--r-sm);
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--t-fast);
  }
  .upc-displayname-save:hover { background: var(--accent-hover, color-mix(in srgb, var(--accent) 85%, #fff)); }

  .upc-displayname-clear {
    background: none;
    border: 1px solid var(--border-normal);
    border-radius: var(--r-sm);
    padding: 4px 10px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: color var(--t-fast), border-color var(--t-fast);
  }
  .upc-displayname-clear:hover { color: var(--status-dnd, #f04747); border-color: var(--status-dnd, #f04747); }

  .upc-displayname-cancel {
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 4px 10px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: color var(--t-fast), border-color var(--t-fast);
  }
  .upc-displayname-cancel:hover { color: var(--text-primary); border-color: var(--border-normal); }

  .upc-account {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: -2px;
  }

  .upc-status-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  .upc-status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--r-full);
    flex-shrink: 0;
  }

  .upc-status-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .upc-idle {
    font-size: 11px;
    color: var(--text-muted);
    margin-left: 4px;
  }

  .upc-activity-card {
    background: var(--bg-overlay, rgba(255,255,255,0.05));
    border-radius: 8px;
    padding: 10px 12px;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .upc-activity-header {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .upc-activity-emoji {
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }

  .upc-activity-type {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .upc-activity-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-left: 18px;
  }

  .upc-channels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .upc-channel-pill {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    padding: 2px 8px;
    border-radius: var(--r-full);
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .upc-channel-pill:hover {
    background: var(--accent);
    color: #fff;
  }

  .upc-actions {
    display: flex;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
    margin-top: 6px;
  }

  .upc-btn {
    flex: 1;
    background: var(--bg-float);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-sm);
    padding: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
  }
  .upc-btn:hover {
    background: var(--bg-overlay);
    color: var(--text-primary);
  }

  .upc-btn--primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }
  .upc-btn--primary:hover {
    background: var(--accent-hover, color-mix(in srgb, var(--accent) 85%, #fff));
    border-color: transparent;
    color: #fff;
  }

  .upc-note-preview {
    background: rgba(251,191,36,0.06);
    border: 1px solid rgba(251,191,36,0.15);
    border-radius: 6px;
    padding: 8px 10px;
    margin-top: 6px;
  }

  .upc-note-label {
    font-size: 11px;
    font-weight: 600;
    color: rgba(251,191,36,0.7);
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .upc-note-text {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
    word-break: break-word;
  }

  .upc-secondary {
    display: flex;
    gap: 8px;
    margin-top: 2px;
    flex-wrap: wrap;
  }

  .upc-btn-ghost {
    flex: 1;
    background: none;
    border: none;
    padding: 5px 4px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    border-radius: var(--r-sm);
    transition: background var(--t-fast), color var(--t-fast);
  }
  .upc-btn-ghost:hover {
    background: var(--bg-float);
    color: var(--text-primary);
  }
  .upc-btn-ghost--active {
    color: var(--gold, #e8b84b);
  }
  .upc-btn-ghost--danger {
    color: var(--text-muted);
  }
  .upc-btn-ghost--danger:hover {
    color: var(--status-dnd, #f04747);
    background: var(--bg-float);
  }
  .upc-btn-ghost--blocked {
    color: var(--status-dnd, #f04747);
  }

  .upc-color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0 2px;
    gap: 8px;
  }

  .upc-color-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .upc-color-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .upc-color-swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--border-normal);
    cursor: pointer;
    flex-shrink: 0;
    display: block;
    position: relative;
    overflow: hidden;
    transition: border-color var(--t-fast, 150ms);
  }
  .upc-color-swatch:hover {
    border-color: var(--accent);
  }

  .upc-color-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    border: none;
    padding: 0;
  }

  .upc-color-reset {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-xs, 4px);
    padding: 2px 8px;
    cursor: pointer;
    transition: color var(--t-fast, 150ms), border-color var(--t-fast, 150ms), background var(--t-fast, 150ms);
    font-family: inherit;
  }
  .upc-color-reset:hover {
    color: var(--text-primary);
    border-color: var(--border-normal);
    background: var(--bg-float, rgba(255,255,255,0.06));
  }
`;
