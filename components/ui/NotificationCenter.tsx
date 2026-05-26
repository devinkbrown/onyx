'use client';

import { useEffect, useCallback, useState, useRef, type CSSProperties } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { Notification } from '@/lib/store';
import { getNickColor } from '@/lib/nick-color';

// ── Time helpers ──────────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 30) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}

function dateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  return 'Earlier';
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'mentions' | 'dms' | 'system';

// ── Highlight @mention word ───────────────────────────────────────────────────

function HighlightMention({ text }: { text: string }) {
  const parts = text.split(/(@\S+)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <mark key={i} className="nc-mention-hl">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Type icon ─────────────────────────────────────────────────────────────────

function TypeIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'mention': return <MentionIcon />;
    case 'dm':      return <DMIcon />;
    case 'error':   return <ErrorIcon />;
    default:        return <SystemIcon />;
  }
}

// ── Swipeable notification card ───────────────────────────────────────────────

interface CardProps {
  note: Notification;
  isRead: boolean;
  onActivate: (note: Notification) => void;
  onDismiss: (id: string) => void;
}

function NotificationCard({ note, isRead, onActivate, onDismiss }: CardProps) {
  const touchStartX = useRef<number>(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  const nickColor = note.from ? getNickColor(note.from) : 'var(--text-muted)';
  const preview = note.text.length > 100 ? note.text.slice(0, 100) + '…' : note.text;

  const borderColor = {
    mention: 'var(--gold, #e8b84b)',
    dm:      '#8b5cf6',
    system:  '#3b82f6',
    error:   'var(--danger, #ed4245)',
  }[note.type] ?? 'var(--border-normal)';

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientX - touchStartX.current;
    if (delta < 0) setSwipeOffset(Math.max(delta, -200));
  };

  const handleTouchEnd = () => {
    if (swipeOffset < -80) {
      setDismissing(true);
      setTimeout(() => onDismiss(note.id), 280);
    } else {
      setSwipeOffset(0);
    }
  };

  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissing(true);
    setTimeout(() => onDismiss(note.id), 280);
  };

  return (
    <div
      className={[
        'nc-card-wrap',
        isRead ? 'nc-card--read' : 'nc-card--unread',
        dismissing ? 'nc-card--dismissing' : '',
      ].filter(Boolean).join(' ')}
      style={{ transform: `translateX(${dismissing ? '-100%' : swipeOffset + 'px'})` }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe delete stripe */}
      <div className="nc-card-delete-stripe" aria-hidden>
        <TrashIcon />
      </div>

      <button
        className="nc-card"
        onClick={() => onActivate(note)}
        aria-label={`${note.type} notification${note.from ? ` from ${note.from}` : ''}: ${note.text}`}
        style={{ '--nc-type-color': borderColor } as unknown as CSSProperties}
      >
        {/* Colored left border */}
        <span className="nc-card-border" aria-hidden />

        {/* Unread dot */}
        {!isRead && <span className="nc-card-dot" aria-hidden />}

        {/* Avatar */}
        <span className="nc-card-avatar" style={{ background: `linear-gradient(135deg, ${nickColor}, color-mix(in oklch, ${nickColor} 60%, #000))` }}>
          {note.from
            ? note.from.replace(/^[~@+.]+/, '').charAt(0).toUpperCase()
            : <TypeIcon type={note.type} />
          }
        </span>

        {/* Body */}
        <span className="nc-card-body">
          <span className="nc-card-meta">
            {note.from && (
              <span className="nc-card-from" style={{ color: nickColor }}>
                {note.from}
              </span>
            )}
            {note.channel && (
              <span className="nc-card-channel">{note.channel}</span>
            )}
          </span>
          <span className="nc-card-preview">
            <HighlightMention text={preview} />
          </span>
        </span>

        {/* Timestamp + arrow */}
        <span className="nc-card-aside">
          <span className="nc-card-time">{relativeTime(note.at)}</span>
          <span className="nc-card-arrow" aria-hidden>→</span>
        </span>
      </button>
    </div>
  );
}

// ── Channel group (collapsed stack) ──────────────────────────────────────────

interface ChannelGroupProps {
  channel: string;
  notes: Notification[];
  readIds: Set<string>;
  onActivate: (note: Notification) => void;
  onDismiss: (id: string) => void;
}

function ChannelGroup({ channel, notes, readIds, onActivate, onDismiss }: ChannelGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const unreadInGroup = notes.filter(n => !readIds.has(n.id)).length;

  if (notes.length === 1) {
    return (
      <NotificationCard
        note={notes[0]}
        isRead={readIds.has(notes[0].id)}
        onActivate={onActivate}
        onDismiss={onDismiss}
      />
    );
  }

  if (expanded) {
    return (
      <div className="nc-channel-group nc-channel-group--expanded">
        <button className="nc-group-collapse" onClick={() => setExpanded(false)}>
          <span>{channel} · {notes.length} notifications</span>
          <span className="nc-group-collapse-icon">▲</span>
        </button>
        {notes.map(note => (
          <NotificationCard
            key={note.id}
            note={note}
            isRead={readIds.has(note.id)}
            onActivate={onActivate}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="nc-channel-group">
      <NotificationCard
        note={notes[0]}
        isRead={readIds.has(notes[0].id)}
        onActivate={onActivate}
        onDismiss={onDismiss}
      />
      <button className="nc-group-stack" onClick={() => setExpanded(true)}>
        <span className="nc-group-avatars">
          {notes.slice(1, 4).map(n => (
            <span
              key={n.id}
              className="nc-group-mini-avatar"
              style={{
                background: n.from
                  ? `linear-gradient(135deg, ${getNickColor(n.from)}, color-mix(in oklch, ${getNickColor(n.from)} 60%, #000))`
                  : 'var(--bg-overlay)'
              }}
            >
              {n.from ? n.from.replace(/^[~@+.]+/, '').charAt(0).toUpperCase() : '•'}
            </span>
          ))}
        </span>
        <span className="nc-group-more">
          {unreadInGroup > 0 && <span className="nc-group-more-badge">{unreadInGroup}</span>}
          +{notes.length - 1} more in {channel}
        </span>
        <span className="nc-group-expand-icon">▼</span>
      </button>
    </div>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
  return <div className="nc-group-label">{label}</div>;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="nc-empty" role="status" aria-label="No notifications">
      {/* Depth rings */}
      <div className="nc-empty-rings" aria-hidden>
        <div className="nc-empty-ring nc-empty-ring--1" />
        <div className="nc-empty-ring nc-empty-ring--2" />
        <div className="nc-empty-ring nc-empty-ring--3" />
      </div>
      <div className="nc-empty-icon-wrap" aria-hidden>
        <div className="nc-empty-icon-glow" />
        <div className="nc-empty-icon">🔔</div>
      </div>
      <div className="nc-empty-title">All clear</div>
      <div className="nc-empty-desc">No new mentions or DMs. You&apos;re up to date.</div>
    </div>
  );
}

// ── Overflow banner ───────────────────────────────────────────────────────────

function OverflowBanner({ count, onShowAll }: { count: number; onShowAll: () => void }) {
  return (
    <div className="nc-overflow">
      <span className="nc-overflow-label">10+ unread notifications</span>
      <button className="nc-overflow-btn" onClick={onShowAll}>Show all</button>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

const VISIBLE_LIMIT = 20;
const OVERFLOW_THRESHOLD = 10;
const OLDER_FOLD_AFTER = 10;

export default function NotificationCenter({ onClose }: Props) {
  const notifications           = useOnyxStore(s => s.notifications);
  const readNotificationIds     = useOnyxStore(s => s.readNotificationIds);
  const markNotificationRead    = useOnyxStore(s => s.markNotificationRead);
  const markAllNotificationsRead = useOnyxStore(s => s.markAllNotificationsRead);
  const dismissNotification     = useOnyxStore(s => s.dismissNotification);
  const navigate                = useOnyxStore(s => s.navigate);
  const openSoundSettings       = useOnyxStore(s => s.openSoundSettings);

  const [filter, setFilter]         = useState<FilterTab>('all');
  const [showAll, setShowAll]       = useState(false);
  const [olderExpanded, setOlderExpanded] = useState(false);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Filtered + sorted newest-first
  const filtered = [...notifications]
    .reverse()
    .filter(n => {
      if (filter === 'mentions') return n.type === 'mention';
      if (filter === 'dms')      return n.type === 'dm';
      if (filter === 'system')   return n.type === 'system' || n.type === 'error';
      return true;
    });

  const unreadCount = notifications.filter(n => !readNotificationIds.has(n.id)).length;

  // Cap display unless user asked for all
  const displayNotes = showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT);

  // Group by date label
  const groups: Array<{ label: string; items: Notification[] }> = [];
  for (const note of displayNotes) {
    const label = dateGroup(note.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(note);
    } else {
      groups.push({ label, items: [note] });
    }
  }

  // Split first group into recent vs older
  const firstGroup = groups[0];
  const recentItems = firstGroup?.items.slice(0, OLDER_FOLD_AFTER) ?? [];
  const olderItems  = firstGroup?.items.slice(OLDER_FOLD_AFTER) ?? [];

  // Within a date group, cluster consecutive notifications from the same channel/source
  function clusterByChannel(items: Notification[]): Array<{ key: string; channel: string; notes: Notification[] }> {
    const clusters: Array<{ key: string; channel: string; notes: Notification[] }> = [];
    for (const note of items) {
      const key = note.channel ?? note.from ?? `__solo_${note.id}`;
      const last = clusters[clusters.length - 1];
      if (last && last.key === key) {
        last.notes.push(note);
      } else {
        clusters.push({ key, channel: note.channel ?? note.from ?? '', notes: [note] });
      }
    }
    return clusters;
  }

  const handleActivate = useCallback((note: Notification) => {
    markNotificationRead(note.id);
    if (note.type === 'dm' && note.from) {
      navigate({ kind: 'dm', nick: note.from });
      onClose();
    } else if (note.channel) {
      navigate({ kind: 'channel', channel: note.channel });
      onClose();
    }
  }, [markNotificationRead, navigate, onClose]);

  const handleDismiss = useCallback((id: string) => {
    dismissNotification(id);
  }, [dismissNotification]);

  const handleClearAll = useCallback(() => {
    [...notifications].forEach(n => dismissNotification(n.id));
  }, [notifications, dismissNotification]);

  return (
    <>
      {/* Backdrop */}
      <div className="nc-backdrop" onClick={onClose} aria-hidden />

      <aside
        className="nc-panel animate-nc-in"
        role="complementary"
        aria-label="Notification center"
      >
        {/* Header */}
        <div className="nc-header">
          <div className="nc-header-left">
            <span className="nc-header-title">Notifications</span>
            {unreadCount > 0 && (
              <span className="nc-header-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="nc-header-right">
            {unreadCount > 0 && (
              <button
                className="nc-mark-all"
                onClick={markAllNotificationsRead}
                title="Mark all as read"
              >
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                className="nc-clear-all"
                onClick={handleClearAll}
                title="Clear all notifications"
              >
                Clear all
              </button>
            )}
            <button
              className="nc-close"
              onClick={onClose}
              aria-label="Close notification center"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="nc-tabs" role="tablist" aria-label="Filter notifications">
          {(['all', 'mentions', 'dms', 'system'] as FilterTab[]).map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={filter === tab}
              className={`nc-tab ${filter === tab ? 'nc-tab--active' : ''}`}
              onClick={() => setFilter(tab)}
            >
              {tab === 'all' ? 'All' : tab === 'mentions' ? 'Mentions' : tab === 'dms' ? 'DMs' : 'System'}
            </button>
          ))}
        </div>

        {/* Overflow banner */}
        {!showAll && unreadCount > OVERFLOW_THRESHOLD && (
          <OverflowBanner count={unreadCount} onShowAll={() => setShowAll(true)} />
        )}

        {/* Content */}
        <div className="nc-body">
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            groups.map((group, gi) => (
              <div key={group.label} className="nc-group">
                <GroupHeader label={group.label} />

                {gi === 0 ? (
                  <>
                    {clusterByChannel(recentItems).map(cluster => (
                      <ChannelGroup
                        key={cluster.key}
                        channel={cluster.channel}
                        notes={cluster.notes}
                        readIds={readNotificationIds}
                        onActivate={handleActivate}
                        onDismiss={handleDismiss}
                      />
                    ))}
                    {olderItems.length > 0 && !olderExpanded && (
                      <button className="nc-older-toggle" onClick={() => setOlderExpanded(true)}>
                        {olderItems.length} older notification{olderItems.length !== 1 ? 's' : ''} ▼
                      </button>
                    )}
                    {olderItems.length > 0 && olderExpanded && (
                      <>
                        {clusterByChannel(olderItems).map(cluster => (
                          <ChannelGroup
                            key={cluster.key}
                            channel={cluster.channel}
                            notes={cluster.notes}
                            readIds={readNotificationIds}
                            onActivate={handleActivate}
                            onDismiss={handleDismiss}
                          />
                        ))}
                        <button className="nc-older-toggle" onClick={() => setOlderExpanded(false)}>
                          Collapse ▲
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  clusterByChannel(group.items).map(cluster => (
                    <ChannelGroup
                      key={cluster.key}
                      channel={cluster.channel}
                      notes={cluster.notes}
                      readIds={readNotificationIds}
                      onActivate={handleActivate}
                      onDismiss={handleDismiss}
                    />
                  ))
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer: settings shortcut */}
        <div className="nc-footer">
          <button className="nc-settings-link" onClick={() => { openSoundSettings(); onClose(); }}>
            <BellSettingsIcon />
            Notification Settings →
          </button>
        </div>
      </aside>

      <style>{`
        /* ── Backdrop ── */
        .nc-backdrop {
          position: fixed;
          inset: 0;
          z-index: 619;
          background: rgba(0,0,0,0.35);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          animation: nc-backdrop-in 200ms ease both;
        }
        @keyframes nc-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* ── Panel ── */
        .nc-panel {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
          width: 340px;
          max-height: 100vh;
          z-index: 620;
          background: var(--bg-float, #1a2c40);
          border-left: 1px solid var(--border-normal);
          display: flex;
          flex-direction: column;
          box-shadow: -12px 0 48px rgba(0,0,0,0.65), -4px 0 16px rgba(0,0,0,0.35);
          overflow: hidden;
        }

        @keyframes nc-slide-in {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .animate-nc-in {
          animation: nc-slide-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        /* ── Header ── */
        .nc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          height: 52px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .nc-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .nc-header-right {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .nc-header-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.03em;
          color: var(--text-primary);
        }
        .nc-header-badge {
          background: var(--gold, #e8b84b);
          color: #1a1510;
          font-size: 10px;
          font-weight: 800;
          line-height: 1;
          padding: 3px 7px;
          border-radius: 20px;
          min-width: 20px;
          text-align: center;
          letter-spacing: 0.02em;
        }
        .nc-mark-all {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent, #0ea5e9);
          background: color-mix(in srgb, var(--accent, #0ea5e9) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent, #0ea5e9) 25%, transparent);
          cursor: pointer;
          padding: 4px 10px;
          border-radius: var(--r-sm, 4px);
          font-family: inherit;
          transition: background var(--t-fast, 150ms), border-color var(--t-fast, 150ms);
          white-space: nowrap;
          letter-spacing: 0.01em;
        }
        .nc-mark-all:hover {
          background: color-mix(in srgb, var(--accent, #0ea5e9) 18%, transparent);
          border-color: color-mix(in srgb, var(--accent, #0ea5e9) 40%, transparent);
        }
        .nc-mark-all:focus-visible {
          outline: 2px solid var(--accent, #0ea5e9);
          outline-offset: 2px;
        }
        .nc-clear-all {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 6px;
          border-radius: var(--r-sm, 4px);
          font-family: inherit;
          transition: color var(--t-fast, 150ms);
          white-space: nowrap;
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-color: transparent;
        }
        .nc-clear-all:hover {
          color: var(--danger, #f04747);
          text-decoration-color: currentColor;
        }
        .nc-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--r-sm, 4px);
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
          flex-shrink: 0;
        }
        .nc-close:hover { background: var(--bg-overlay); color: var(--text-primary); }

        /* ── Filter tabs ── */
        .nc-tabs {
          display: flex;
          gap: 0;
          padding: 0 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .nc-tab {
          position: relative;
          padding: 10px 12px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: color var(--t-fast, 150ms);
          letter-spacing: 0.02em;
        }
        .nc-tab:hover { color: var(--text-secondary); }
        .nc-tab--active { color: var(--text-primary); }
        .nc-tab--active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--gold, #e8b84b);
          border-radius: 2px 2px 0 0;
        }

        /* ── Overflow banner ── */
        .nc-overflow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: color-mix(in oklch, var(--gold, #e8b84b) 8%, transparent);
          border-bottom: 1px solid color-mix(in oklch, var(--gold, #e8b84b) 20%, transparent);
          flex-shrink: 0;
        }
        .nc-overflow-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--gold, #e8b84b);
        }
        .nc-overflow-btn {
          font-size: 11px;
          font-weight: 700;
          color: var(--gold, #e8b84b);
          background: color-mix(in oklch, var(--gold, #e8b84b) 15%, transparent);
          border: 1px solid color-mix(in oklch, var(--gold, #e8b84b) 30%, transparent);
          border-radius: 4px;
          padding: 3px 10px;
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-fast, 150ms);
        }
        .nc-overflow-btn:hover {
          background: color-mix(in oklch, var(--gold, #e8b84b) 25%, transparent);
        }

        /* ── Body ── */
        .nc-body {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 8px;
        }
        .nc-body::-webkit-scrollbar { width: 4px; }
        .nc-body::-webkit-scrollbar-track { background: transparent; }
        .nc-body::-webkit-scrollbar-thumb { background: var(--border-normal); border-radius: 2px; }

        /* ── Date group ── */
        .nc-group {
          margin-top: 4px;
        }
        .nc-group-label {
          padding: 10px 16px 4px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        /* ── Card wrap (swipe container) ── */
        .nc-card-wrap {
          position: relative;
          overflow: hidden;
          transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease;
        }
        .nc-card-wrap.nc-card--dismissing {
          opacity: 0;
          max-height: 0;
          margin: 0;
          padding: 0;
          overflow: hidden;
          transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease, max-height 200ms ease 200ms;
        }

        /* Swipe delete stripe (visible as card is swiped) */
        .nc-card-delete-stripe {
          position: absolute;
          right: 0;
          top: 0;
          bottom: 0;
          width: 48px;
          background: var(--danger, #ed4245);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 14px;
          z-index: 0;
        }

        /* ── Card button ── */
        .nc-card {
          position: relative;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          min-height: 44px;
          padding: 10px 12px 10px 16px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: background var(--t-fast, 150ms);
          z-index: 1;
        }
        .nc-card:hover {
          background: var(--bg-elevated);
        }
        .nc-card:hover .nc-card-arrow { opacity: 1; }

        .nc-card--unread .nc-card {
          background: var(--accent-subtle);
        }

        /* Left type border — 2px for unread accent */
        .nc-card-border {
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 2px;
          background: var(--nc-type-color, var(--accent));
          border-radius: 0 2px 2px 0;
        }
        .nc-card--read .nc-card-border {
          opacity: 0.3;
        }

        /* Unread dot */
        .nc-card-dot {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent, #0ea5e9);
          box-shadow: 0 0 6px color-mix(in oklch, var(--accent, #0ea5e9) 60%, transparent);
        }

        /* Avatar */
        .nc-card-avatar {
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          margin-top: 2px;
        }

        /* Body */
        .nc-card-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .nc-card-meta {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .nc-card-from {
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 120px;
        }
        .nc-card-channel {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90px;
        }
        .nc-card-preview {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.45;
          word-break: break-word;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .nc-card--unread .nc-card-preview {
          color: var(--text-primary);
        }

        /* Mention highlight */
        .nc-mention-hl {
          background: color-mix(in oklch, var(--gold, #e8b84b) 20%, transparent);
          color: var(--gold, #e8b84b);
          border-radius: 3px;
          padding: 0 2px;
        }

        /* Aside: time + arrow */
        .nc-card-aside {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          flex-shrink: 0;
          padding-top: 1px;
          margin-left: 4px;
        }
        .nc-card-time {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .nc-card-arrow {
          font-size: 14px;
          color: var(--text-muted);
          opacity: 0;
          transition: opacity var(--t-fast, 150ms), transform var(--t-fast, 150ms);
        }
        .nc-card:hover .nc-card-arrow {
          opacity: 1;
          transform: translateX(2px);
        }

        /* ── Channel group clustering ── */
        .nc-channel-group {
          position: relative;
        }
        .nc-group-stack {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 6px 12px 6px 52px;
          background: color-mix(in oklch, var(--bg-overlay) 40%, transparent);
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: background var(--t-fast, 150ms);
        }
        .nc-group-stack:hover { background: var(--bg-overlay); }
        .nc-group-avatars {
          display: flex;
          gap: -4px;
        }
        .nc-group-mini-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          border: 1.5px solid var(--bg-deep);
          margin-left: -4px;
        }
        .nc-group-mini-avatar:first-child { margin-left: 0; }
        .nc-group-more {
          font-size: 11px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .nc-group-more-badge {
          background: var(--accent, #0ea5e9);
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 10px;
        }
        .nc-group-expand-icon, .nc-group-collapse-icon {
          font-size: 9px;
          color: var(--text-muted);
          margin-left: auto;
        }
        .nc-group-collapse {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 6px 16px;
          background: color-mix(in oklch, var(--bg-overlay) 40%, transparent);
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          cursor: pointer;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          transition: background var(--t-fast, 150ms);
        }
        .nc-group-collapse:hover { background: var(--bg-overlay); }

        /* ── Older toggle ── */
        .nc-older-toggle {
          display: block;
          width: calc(100% - 32px);
          margin: 6px 16px;
          padding: 7px 12px;
          background: color-mix(in oklch, var(--bg-overlay) 50%, transparent);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          text-align: center;
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
        }
        .nc-older-toggle:hover {
          background: var(--bg-overlay);
          color: var(--text-secondary);
        }

        /* ── Empty state ── */
        .nc-empty {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 24px 48px;
          gap: 8px;
          height: 100%;
          min-height: 280px;
          overflow: hidden;
        }

        /* Depth rings */
        .nc-empty-rings {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .nc-empty-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid var(--accent, #0ea5e9);
        }
        .nc-empty-ring--1 { width: 80px;  height: 80px;  opacity: 0.07; }
        .nc-empty-ring--2 { width: 140px; height: 140px; opacity: 0.04; }
        .nc-empty-ring--3 { width: 200px; height: 200px; opacity: 0.02; }

        /* Icon glow */
        .nc-empty-icon-wrap {
          position: relative;
          width: 60px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 4px;
          z-index: 1;
        }
        .nc-empty-icon-glow {
          position: absolute;
          inset: -10px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--accent-glow, rgba(14,165,233,0.15)) 0%, transparent 70%);
          filter: blur(4px);
        }
        .nc-empty-icon {
          position: relative;
          z-index: 1;
          font-size: 36px;
          line-height: 1;
        }
        .nc-empty-title {
          position: relative;
          z-index: 1;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0.01em;
        }
        .nc-empty-desc {
          position: relative;
          z-index: 1;
          font-size: 13px;
          color: var(--text-muted);
          text-align: center;
          max-width: 200px;
          line-height: 1.55;
        }

        /* ── Footer ── */
        .nc-footer {
          flex-shrink: 0;
          padding: 10px 14px;
          border-top: 1px solid var(--border-subtle);
        }
        .nc-settings-link {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 10px;
          background: none;
          border: none;
          border-radius: 6px;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
          text-align: left;
        }
        .nc-settings-link:hover {
          background: var(--bg-overlay);
          color: var(--text-secondary);
        }

        @media (max-width: 480px) {
          .nc-panel { width: 100%; }
        }
      `}</style>
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function MentionIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm0 6.5c2.1 0 3.9.9 5.1 2.3A5.98 5.98 0 0 1 8 14a5.98 5.98 0 0 1-5.1-2.2A6.48 6.48 0 0 1 8 9.5z" />
    </svg>
  );
}

function DMIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3 2v-2H3a1 1 0 0 1-1-1V3zm2 1v5h2v1.4l1.4-1.4H12V4H4z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-1 4h2v4H7V7z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7.12 1.54a1 1 0 0 1 1.76 0l6.3 11.46A1 1 0 0 1 14.3 14.5H1.7a1 1 0 0 1-.88-1.5l6.3-11.46zM8 6a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 6zm0 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.5 1a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zM3 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1H12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4H3.5a.5.5 0 0 1-.5-.5zM5 4v8h6V4H5z" />
    </svg>
  );
}

function BellSettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2a2 2 0 0 1 2 2v.5A5 5 0 0 1 13 9v3l1.5 1.5H1.5L3 12V9a5 5 0 0 1 3-4.5V4a2 2 0 0 1 2-2z" />
      <path d="M6.5 14.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}
