'use client';

/**
 * BreakoutSidebar
 *
 * Right-edge collapsible panel listing active breakout rooms for the given
 * parent channel.
 *
 * Mobile (< 640 px): renders as a full-screen panel.
 * Desktop: right panel, 280 px wide, slides in from the right.
 *
 * Wraps useBreakout for state and IRC plumbing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBreakout, type BreakoutRoom } from '@/hooks/useBreakout';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h  = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return `${m}:${String(r).padStart(2, '0')}`;
}

const AUTO_CLOSE_PRESETS = [
  { label: 'No timer',  secs: 0 },
  { label: '5 min',     secs:  5 * 60 },
  { label: '10 min',    secs: 10 * 60 },
  { label: '15 min',    secs: 15 * 60 },
  { label: '30 min',    secs: 30 * 60 },
  { label: '1 hour',    secs: 60 * 60 },
];

// ── Icons ─────────────────────────────────────────────────────────────────────

function GroupIcon() {
  return (
    <svg viewBox="0 0 16 14" width="13" height="11" fill="none"
         stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden>
      <circle cx="5.5" cy="4.5" r="2.2"/>
      <path d="M1 13.5c0-2.2 1.8-3.5 4.5-3.5"/>
      <circle cx="11" cy="4.5" r="2.2"/>
      <path d="M7.5 13.5c0-2.2 1.5-3.5 3.5-3.5s3.5 1.3 3.5 3.5"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
         aria-hidden>
      <path d="M3 3l6 6M9 3l-6 6"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
         aria-hidden>
      <path d="M6 2v8M2 6h8"/>
    </svg>
  );
}

// ── Room card ─────────────────────────────────────────────────────────────────

interface RoomCardProps {
  room: BreakoutRoom;
  now: number;
  isActive: boolean;
  isOper: boolean;
  canCloseOwn: boolean;
  onJoin(): void;
  onLeave(): void;
  onClose(): void;
  onRename(next: string): void;
  onRecall(): void;
}

function RoomCard(p: RoomCardProps) {
  const { room, now, isActive, isOper, canCloseOwn,
          onJoin, onLeave, onClose, onRename, onRecall } = p;

  const [renaming,   setRenaming]   = useState(false);
  const [draftName,  setDraftName]  = useState(room.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const remaining = room.autoCloseAt ? room.autoCloseAt - now : null;
  const urgent    = remaining !== null && remaining < 60_000;

  const submitRename = useCallback(() => {
    const n = draftName.trim();
    if (n && n !== room.name) onRename(n);
    setRenaming(false);
  }, [draftName, room.name, onRename]);

  // Auto-focus input when rename mode activates
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  return (
    <div className={`bk-card${isActive ? ' bk-card--active' : ''}`}>
      {/* Name row */}
      <div className="bk-card-name-row">
        <span className="bk-card-icon"><GroupIcon /></span>
        {renaming ? (
          <input
            ref={inputRef}
            className="bk-card-rename-input"
            value={draftName}
            maxLength={31}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  submitRename();
              if (e.key === 'Escape') { setDraftName(room.name); setRenaming(false); }
            }}
            onBlur={() => { setDraftName(room.name); setRenaming(false); }}
            aria-label="Room name"
          />
        ) : (
          <span className="bk-card-name">{room.name}</span>
        )}
        <span className="bk-card-id">#{room.id}</span>
      </div>

      {/* Meta row */}
      <div className="bk-card-meta">
        <span>{room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}</span>
        {room.creator && <span>· {room.creator}</span>}
        {remaining !== null && (
          <span className={urgent ? 'bk-card-urgent' : undefined}>
            · {fmtCountdown(remaining)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="bk-card-actions">
        {isActive ? (
          <button className="bk-btn bk-btn--ghost" onClick={onLeave} type="button">
            Leave
          </button>
        ) : (
          <button className="bk-btn bk-btn--primary" onClick={onJoin} type="button">
            Join
          </button>
        )}
        {(isOper || canCloseOwn) && (
          <button className="bk-btn bk-btn--danger" onClick={onClose} type="button">
            Close
          </button>
        )}
        {isOper && !renaming && (
          <button
            className="bk-btn bk-btn--ghost"
            onClick={() => setRenaming(true)}
            type="button"
          >
            Rename
          </button>
        )}
        {isOper && (
          <button
            className="bk-btn bk-btn--ghost"
            onClick={onRecall}
            title="Force all members back to the parent channel"
            type="button"
          >
            Recall
          </button>
        )}
      </div>
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

interface CreateFormProps {
  onSubmit(name: string, secs: number): void;
  onCancel(): void;
}

function CreateForm({ onSubmit, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');
  const [secs, setSecs] = useState(0);

  const submit = useCallback(() => {
    const n = name.trim();
    if (!n) return;
    onSubmit(n, secs);
  }, [name, secs, onSubmit]);

  return (
    <div className="bk-create-form">
      <div className="bk-create-label">New breakout room</div>
      <input
        className="bk-create-input"
        placeholder="Room name"
        value={name}
        maxLength={31}
        autoFocus
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
        aria-label="Room name"
      />
      <select
        className="bk-create-select"
        value={secs}
        onChange={e => setSecs(Number(e.target.value))}
        aria-label="Auto-close timer"
      >
        {AUTO_CLOSE_PRESETS.map(p => (
          <option key={p.secs} value={p.secs}>{p.label}</option>
        ))}
      </select>
      <div className="bk-create-row">
        <button
          className="bk-btn bk-btn--primary"
          onClick={submit}
          disabled={!name.trim()}
          type="button"
        >
          Create
        </button>
        <button
          className="bk-btn bk-btn--ghost"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

interface BreakoutSidebarProps {
  channel: string;
  onClose(): void;
}

export function BreakoutSidebar({ channel, onClose }: BreakoutSidebarProps) {
  const {
    rooms, activeRoomId, isOper,
    create, join, leave, close, rename, recall,
  } = useBreakout(channel);

  const [showCreate, setShowCreate] = useState(false);
  const [now, setNow] = useState(Date.now);

  // Tick every second for countdown timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleCreate = useCallback((name: string, secs: number) => {
    create(name, secs > 0 ? secs : undefined);
    setShowCreate(false);
  }, [create]);

  return (
    <div className="bk-sidebar" role="complementary" aria-label="Breakout rooms">
      {/* Header */}
      <div className="bk-sidebar-header">
        <div className="bk-sidebar-title">
          <GroupIcon />
          <span>Breakout Rooms</span>
          {rooms.length > 0 && (
            <span className="bk-badge">{rooms.length}</span>
          )}
        </div>
        <div className="bk-sidebar-header-actions">
          {isOper && !showCreate && (
            <button
              className="bk-icon-btn"
              onClick={() => setShowCreate(true)}
              aria-label="Create breakout room"
              title="Create room"
              type="button"
            >
              <PlusIcon />
            </button>
          )}
          <button
            className="bk-icon-btn"
            onClick={onClose}
            aria-label="Close breakout rooms panel"
            title="Close"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bk-sidebar-body">
          <CreateForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {/* Room list */}
      <div className="bk-sidebar-body bk-sidebar-body--scroll">
        {rooms.length === 0 && !showCreate ? (
          <div className="bk-empty">
            <span>No breakout rooms active.</span>
            {isOper && (
              <button
                className="bk-btn bk-btn--primary bk-empty-create"
                onClick={() => setShowCreate(true)}
                type="button"
              >
                Create one
              </button>
            )}
          </div>
        ) : (
          rooms.map(room => (
            <RoomCard
              key={room.id}
              room={room}
              now={now}
              isActive={activeRoomId === room.id}
              isOper={isOper}
              canCloseOwn={room.creator !== null && !!room.creator}
              onJoin={() => join(room.id)}
              onLeave={() => leave()}
              onClose={() => close(room.id)}
              onRename={n => rename(room.id, n)}
              onRecall={() => recall(room.id)}
            />
          ))
        )}
      </div>

      <style>{`
        .bk-sidebar {
          display: flex;
          flex-direction: column;
          width: 280px;
          height: 100%;
          background: var(--bg-deep);
          border-left: 1px solid var(--border-normal);
          overflow: hidden;
          flex-shrink: 0;
          box-shadow: -4px 0 20px rgba(0,0,0,0.35);
        }

        /* Mobile: full-screen panel */
        @media (max-width: 640px) {
          .bk-sidebar {
            position: fixed;
            inset: 0;
            width: 100%;
            z-index: 500;
            border: none;
          }
        }

        .bk-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 13px 14px 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          background: var(--bg-elevated);
        }
        .bk-sidebar-title {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .bk-badge {
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          background: var(--accent-subtle);
          color: var(--accent);
          border-radius: var(--r-full);
          font-size: 10px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--accent-border);
        }
        .bk-sidebar-header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .bk-sidebar-body {
          padding: 10px 12px;
          flex-shrink: 0;
        }
        .bk-sidebar-body--scroll {
          flex: 1;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }

        /* Icon buttons in header */
        .bk-icon-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          border-radius: var(--r-sm);
          cursor: pointer;
          color: var(--text-muted);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .bk-icon-btn:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }

        /* Room card */
        .bk-card {
          padding: 10px 12px;
          margin-bottom: 8px;
          border-radius: var(--r-md);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          transition: border-color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
        }
        .bk-card:hover {
          border-color: var(--border-normal);
          background: var(--bg-float);
        }
        .bk-card--active {
          border-color: var(--accent-border);
          background: var(--bg-float);
          box-shadow: inset 0 0 0 1px var(--accent-border), 0 0 0 1px var(--accent-glow);
        }

        .bk-card-name-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .bk-card-icon {
          color: var(--accent);
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }
        .bk-card-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bk-card-id {
          font-size: 10px;
          color: var(--text-muted);
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
        .bk-card-rename-input {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          background: var(--bg-overlay);
          color: var(--text-primary);
          border: 1px solid var(--accent);
          border-radius: var(--r-xs);
          padding: 2px 6px;
          outline: none;
          min-width: 0;
        }

        .bk-card-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 3px;
          flex-wrap: wrap;
        }
        .bk-card-urgent {
          color: var(--danger) !important;
          font-variant-numeric: tabular-nums;
        }

        .bk-card-actions {
          display: flex;
          gap: 5px;
          margin-top: 8px;
          flex-wrap: wrap;
        }

        /* Buttons */
        .bk-btn {
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: var(--r-sm);
          border: none;
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast), opacity var(--t-fast);
          font-family: inherit;
          line-height: 1.4;
        }
        .bk-btn:disabled { opacity: 0.4; cursor: default; }

        .bk-btn--primary {
          background: var(--accent);
          color: #fff;
        }
        .bk-btn--primary:hover:not(:disabled) { background: var(--accent-hover); }

        .bk-btn--ghost {
          background: var(--bg-float);
          color: var(--text-secondary);
          border: 1px solid var(--border-normal);
        }
        .bk-btn--ghost:hover:not(:disabled) {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        .bk-btn--danger {
          background: transparent;
          color: var(--danger);
          border: 1px solid rgba(248,113,113,0.3);
        }
        .bk-btn--danger:hover:not(:disabled) {
          background: var(--danger-subtle);
        }

        /* Empty state */
        .bk-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 32px 16px;
          text-align: center;
          font-size: 12px;
          color: var(--text-muted);
        }
        .bk-empty-create { align-self: center; }

        /* Create form */
        .bk-create-form {
          padding: 10px;
          margin-bottom: 10px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bk-create-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .bk-create-input, .bk-create-select {
          width: 100%;
          padding: 6px 8px;
          font-size: 12px;
          background: var(--bg-float);
          color: var(--text-primary);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          outline: none;
          box-sizing: border-box;
          font-family: inherit;
        }
        .bk-create-input:focus, .bk-create-select:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-border);
        }
        .bk-create-select option {
          background: var(--bg-float);
        }
        .bk-create-row {
          display: flex;
          gap: 6px;
        }
      `}</style>
    </div>
  );
}
