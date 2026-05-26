'use client';

import { useRef, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ChannelFolder } from '@/lib/store';
import type { Channel } from '@/lib/irc/types';

interface Props {
  channels: Channel[];
  activeChannel: string | null;
  onChannelClick: (ch: string) => void;
  onChannelContextMenu: (ch: string, e: React.MouseEvent) => void;
}

interface DragState {
  channel: string;
  sourceFolderId: string;
}

// ── Folder header context menu ─────────────────────────────────────────────────

interface FolderMenuState {
  folderId: string;
  x: number;
  y: number;
}

function FolderContextMenu({
  folderId,
  folderName,
  x,
  y,
  isDefault,
  onClose,
}: {
  folderId: string;
  folderName: string;
  x: number;
  y: number;
  isDefault: boolean;
  onClose: () => void;
}) {
  const renameFolder = useOnyxStore(s => s.renameFolder);
  const deleteFolder = useOnyxStore(s => s.deleteFolder);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(folderName);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleRename = () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== folderName) {
      renameFolder(folderId, trimmed.toUpperCase());
    }
    onClose();
  };

  const handleDelete = () => {
    deleteFolder(folderId);
    onClose();
  };

  return (
    <>
      <div className="fcm-backdrop" onClick={onClose} />
      <div
        ref={menuRef}
        className="fcm-menu"
        style={{ top: y, left: x }}
        role="menu"
      >
        {renaming ? (
          <div className="fcm-rename-form">
            <input
              className="fcm-rename-input"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') onClose();
              }}
              autoFocus
            />
            <button className="fcm-item" onClick={handleRename}>Save</button>
          </div>
        ) : (
          <>
            <button className="fcm-item" role="menuitem" onClick={() => setRenaming(true)}>
              <span className="fcm-icon">✏️</span>
              Rename folder
            </button>
            {!isDefault && (
              <button className="fcm-item fcm-item--danger" role="menuitem" onClick={handleDelete}>
                <span className="fcm-icon">🗑</span>
                Delete folder
              </button>
            )}
          </>
        )}
      </div>
      <style>{`
        .fcm-backdrop {
          position: fixed; inset: 0; z-index: 299;
        }
        .fcm-menu {
          position: fixed; z-index: 300;
          background: var(--bg-float, var(--bg-overlay));
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          padding: 4px;
          min-width: 160px;
          animation: fcm-pop 0.08s ease both;
        }
        @keyframes fcm-pop {
          from { opacity: 0; transform: scale(0.96) translateY(-3px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .fcm-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 10px;
          border-radius: 5px; border: none;
          background: none; color: var(--text-primary);
          font-size: 13px; font-weight: 500;
          cursor: pointer; text-align: left;
          font-family: inherit;
          transition: background 80ms;
        }
        .fcm-item:hover { background: var(--accent-subtle, rgba(14,165,233,0.12)); }
        .fcm-item--danger { color: var(--danger, #f04747); }
        .fcm-item--danger:hover { background: rgba(240,71,71,0.1); }
        .fcm-icon { font-size: 13px; flex-shrink: 0; line-height: 1; }
        .fcm-rename-form {
          display: flex; flex-direction: column; gap: 4px; padding: 4px;
        }
        .fcm-rename-input {
          padding: 5px 8px;
          background: var(--bg-void);
          border: 1px solid var(--border-normal);
          border-radius: 4px;
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
        }
        .fcm-rename-input:focus { outline: none; border-color: var(--accent); }
      `}</style>
    </>
  );
}

// ── Move-to-folder submenu ─────────────────────────────────────────────────────

function MoveToFolderMenu({
  channel,
  folders,
  x,
  y,
  onClose,
}: {
  channel: string;
  folders: ChannelFolder[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const addChannelToFolder = useOnyxStore(s => s.addChannelToFolder);
  const createFolder = useOnyxStore(s => s.createFolder);
  const channelFolders = useOnyxStore(s => s.channelFolders);

  const handleMove = (folderId: string) => {
    addChannelToFolder(channel, folderId);
    onClose();
  };

  const handleNewFolder = () => {
    const name = prompt('Folder name:');
    if (!name?.trim()) { onClose(); return; }
    const folderName = name.trim().toUpperCase();
    createFolder(folderName);
    // Move after the store updates — use a short defer
    setTimeout(() => {
      const latest = useOnyxStore.getState().channelFolders;
      const newFolder = latest.find(f => f.name === folderName && f.channels.length === 0);
      if (newFolder) addChannelToFolder(channel, newFolder.id);
    }, 0);
    onClose();
  };

  return (
    <>
      <div className="mfm-backdrop" onClick={onClose} />
      <div className="mfm-menu" style={{ top: y, left: x }} role="menu">
        {folders.map(f => (
          <button key={f.id} className="mfm-item" role="menuitem" onClick={() => handleMove(f.id)}>
            <span className="mfm-icon">📁</span>
            {f.name}
            {f.channels.some(c => c.toLowerCase() === channel.toLowerCase()) && (
              <span className="mfm-check">✓</span>
            )}
          </button>
        ))}
        <div className="mfm-sep" />
        <button className="mfm-item mfm-item--new" role="menuitem" onClick={handleNewFolder}>
          <span className="mfm-icon">➕</span>
          New folder…
        </button>
      </div>
      <style>{`
        .mfm-backdrop { position: fixed; inset: 0; z-index: 299; }
        .mfm-menu {
          position: fixed; z-index: 300;
          background: var(--bg-float, var(--bg-overlay));
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          padding: 4px;
          min-width: 160px;
          animation: mfm-pop 0.08s ease both;
        }
        @keyframes mfm-pop {
          from { opacity: 0; transform: scale(0.96) translateY(-3px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .mfm-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 7px 10px;
          border-radius: 5px; border: none;
          background: none; color: var(--text-primary);
          font-size: 13px; font-weight: 500;
          cursor: pointer; text-align: left;
          font-family: inherit;
          transition: background 80ms;
        }
        .mfm-item:hover { background: var(--accent-subtle, rgba(14,165,233,0.12)); }
        .mfm-item--new { color: var(--accent); }
        .mfm-icon { font-size: 13px; flex-shrink: 0; line-height: 1; }
        .mfm-check { margin-left: auto; color: var(--accent); font-weight: 700; font-size: 13px; }
        .mfm-sep { height: 1px; background: var(--border-subtle); margin: 4px 6px; }
      `}</style>
    </>
  );
}

// ── Channel row within a folder ────────────────────────────────────────────────

function FolderChannelRow({
  channelName,
  active,
  onClick,
  onContextMenu,
  onMoveContextMenu,
  draggable,
  onDragStart,
  onDragEnd,
  isDragOver,
}: {
  channelName: string;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMoveContextMenu: (e: React.MouseEvent) => void;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  isDragOver: boolean;
}) {
  const forumChannels   = useOnyxStore(s => s.forumChannels);
  const channelUnread   = useOnyxStore(s => s.channelUnread);
  const channelMentions = useOnyxStore(s => s.channelMentions);
  const channelNotify   = useOnyxStore(s => s.channelNotify);
  const displayName = channelName.replace(/^[#&]/, '');
  const isForum = forumChannels.has(channelName.toLowerCase());
  const key = channelName.toLowerCase();
  const muted = channelNotify.get(key) === 'none';
  const unreadCount = muted ? 0 : (channelUnread[key] ?? 0);
  const mentionCount = muted ? 0 : (channelMentions[key] ?? 0);
  const hasUnread = unreadCount > 0;
  const hasMention = mentionCount > 0;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onMoveContextMenu(e);
  };

  return (
    <div
      className={`cfp-row${active ? ' cfp-row--active' : ''}${isDragOver ? ' cfp-row--drag-over' : ''}${hasUnread && !active ? ' cfp-row--unread' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      role="listitem"
      aria-current={active ? 'page' : undefined}
    >
      <span className="cfp-drag-handle" title="Drag to reorder" aria-hidden>⠿</span>
      <span className={`cfp-hash${isForum ? ' cfp-hash--forum' : ''}`} aria-hidden>
        {isForum ? '📋' : '#'}
      </span>
      <span className={`cfp-name${hasUnread && !active ? ' cfp-name--unread' : ''}`}>{displayName}</span>
      {hasMention && !active && (
        <span className="cfp-badge cfp-badge--mention" aria-label={`${mentionCount} mentions`}>
          {mentionCount > 99 ? '99+' : mentionCount}
        </span>
      )}
      {hasUnread && !hasMention && !active && (
        <span className="cfp-badge cfp-badge--unread" aria-label={`${unreadCount} unread`}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </div>
  );
}

// ── Folder section ─────────────────────────────────────────────────────────────

function FolderSection({
  folder,
  channelObjects,
  activeChannel,
  onChannelClick,
  onChannelContextMenu,
  dragRef,
}: {
  folder: ChannelFolder;
  channelObjects: Map<string, Channel>;
  activeChannel: string | null;
  onChannelClick: (ch: string) => void;
  onChannelContextMenu: (ch: string, e: React.MouseEvent) => void;
  dragRef: React.MutableRefObject<DragState | null>;
}) {
  const toggleFolderCollapsed = useOnyxStore(s => s.toggleFolderCollapsed);
  const setChannelFolders = useOnyxStore(s => s.setChannelFolders);
  const channelFolders = useOnyxStore(s => s.channelFolders);

  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number } | null>(null);
  const [moveMenu, setMoveMenu] = useState<{ channel: string; x: number; y: number } | null>(null);
  const [dragOverChannel, setDragOverChannel] = useState<string | null>(null);
  const [isDragOverFolder, setIsDragOverFolder] = useState(false);

  const isDefault = folder.id === 'default';
  const isCollapsed = folder.collapsed;

  const handleFolderHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setFolderMenu({ x: e.clientX, y: e.clientY });
  };

  const handleLongPress = useCallback(() => {
    // Long-press opens rename/delete menu via a timer
  }, []);
  void handleLongPress;

  const handleDragStart = (channel: string, folderId: string) => (e: React.DragEvent) => {
    dragRef.current = { channel, sourceFolderId: folderId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', channel);
  };

  const handleDragEnd = () => (_e: React.DragEvent) => {
    setDragOverChannel(null);
    setIsDragOverFolder(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverFolder(true);
  };

  const handleDragOverChannel = (channel: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverChannel(channel);
  };

  const handleDragLeave = () => {
    setIsDragOverFolder(false);
    setDragOverChannel(null);
  };

  const handleDrop = (targetChannel: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverChannel(null);
    setIsDragOverFolder(false);

    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    if (drag.sourceFolderId === folder.id) {
      // Reorder within same folder
      const chans = [...folder.channels];
      const fromIdx = chans.findIndex(c => c.toLowerCase() === drag.channel.toLowerCase());
      if (fromIdx === -1) return;
      const removed = chans.splice(fromIdx, 1)[0];
      if (targetChannel) {
        const toIdx = chans.findIndex(c => c.toLowerCase() === targetChannel.toLowerCase());
        if (toIdx === -1) {
          chans.push(removed);
        } else {
          chans.splice(toIdx, 0, removed);
        }
      } else {
        chans.push(removed);
      }
      const updated = channelFolders.map(f =>
        f.id === folder.id ? { ...f, channels: chans } : f
      );
      setChannelFolders(updated);
    } else {
      // Move from another folder into this folder
      const updated = channelFolders.map(f => {
        if (f.id === drag.sourceFolderId) {
          return { ...f, channels: f.channels.filter(c => c.toLowerCase() !== drag.channel.toLowerCase()) };
        }
        if (f.id === folder.id) {
          const chans = [...f.channels];
          if (targetChannel) {
            const toIdx = chans.findIndex(c => c.toLowerCase() === targetChannel.toLowerCase());
            if (toIdx === -1) {
              chans.push(drag.channel);
            } else {
              chans.splice(toIdx, 0, drag.channel);
            }
          } else {
            chans.push(drag.channel);
          }
          return { ...f, channels: chans };
        }
        return f;
      });
      setChannelFolders(updated);
    }
  };

  return (
    <div className="cfp-folder">
      {/* Folder header */}
      <div
        className={`cfp-folder-header${isDragOverFolder ? ' cfp-folder-header--drag-over' : ''}`}
        onClick={() => toggleFolderCollapsed(folder.id)}
        onContextMenu={handleFolderHeaderContextMenu}
        role="button"
        aria-expanded={!isCollapsed}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop(null)}
      >
        <span className="cfp-chevron" aria-hidden style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>▶</span>
        <span className="cfp-folder-name">{folder.name}</span>
        <span className="cfp-folder-count">{folder.channels.length}</span>
      </div>

      {/* Folder body */}
      {!isCollapsed && (
        <div
          className="cfp-folder-body"
          role="list"
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={handleDrop(null)}
        >
          {folder.channels.map(ch => {
            const chan = channelObjects.get(ch.toLowerCase());
            const displayName = ch;
            void chan;
            return (
              <FolderChannelRow
                key={ch}
                channelName={displayName}
                active={activeChannel?.toLowerCase() === ch.toLowerCase()}
                onClick={() => onChannelClick(ch)}
                onContextMenu={e => onChannelContextMenu(ch, e)}
                onMoveContextMenu={e => { e.stopPropagation(); setMoveMenu({ channel: ch, x: e.clientX, y: e.clientY }); }}
                draggable
                onDragStart={handleDragStart(ch, folder.id)}
                onDragEnd={handleDragEnd()}
                isDragOver={dragOverChannel?.toLowerCase() === ch.toLowerCase()}
              />
            );
          })}
          {folder.channels.length === 0 && (
            <span
              className={`cfp-empty${isDragOverFolder ? ' cfp-empty--drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(null)}
            >
              {isDragOverFolder ? 'Drop here' : 'No channels'}
            </span>
          )}
        </div>
      )}

      {/* Folder context menu */}
      {folderMenu && (
        <FolderContextMenu
          folderId={folder.id}
          folderName={folder.name}
          x={folderMenu.x}
          y={folderMenu.y}
          isDefault={isDefault}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {/* Move-to-folder context menu */}
      {moveMenu && (
        <MoveToFolderMenu
          channel={moveMenu.channel}
          folders={channelFolders}
          x={moveMenu.x}
          y={moveMenu.y}
          onClose={() => setMoveMenu(null)}
        />
      )}

      <style>{`
        .cfp-folder { margin-bottom: 6px; }

        .cfp-folder-header {
          display: flex; align-items: center; gap: 4px;
          padding: 5px 6px 3px 6px;
          cursor: pointer;
          user-select: none;
          border-radius: var(--r-sm, 4px);
          transition: background 80ms;
        }
        .cfp-folder-header:hover { background: var(--ch-hover-bg, rgba(255,255,255,0.04)); }
        .cfp-folder-header--drag-over {
          background: var(--accent-subtle, rgba(14,165,233,0.12));
          outline: 1px dashed var(--accent, #0ea5e9);
          outline-offset: -1px;
        }

        .cfp-chevron {
          font-size: 8px;
          color: var(--text-muted);
          flex-shrink: 0;
          line-height: 1;
          transition: transform 150ms;
          display: inline-block;
        }

        .cfp-folder-name {
          flex: 1;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-secondary);
          transition: color 80ms;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .cfp-folder-header:hover .cfp-folder-name { color: var(--text-primary); }

        .cfp-folder-count {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          flex-shrink: 0;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-full);
          padding: 0 5px;
          min-width: 16px;
          height: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .cfp-folder-body {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .cfp-empty {
          display: block;
          padding: 3px 12px 3px 28px;
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
          border-radius: var(--r-sm, 4px);
          transition: background 80ms;
        }
        .cfp-empty--drag-over {
          background: var(--accent-subtle, rgba(14,165,233,0.12));
          color: var(--accent, #0ea5e9);
          font-style: normal;
        }

        .cfp-row {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 8px 4px 12px;
          border-radius: var(--r-sm, 4px);
          margin: 0 6px;
          cursor: pointer;
          user-select: none;
          transition: background 80ms;
        }
        .cfp-row:hover { background: var(--ch-hover-bg, rgba(255,255,255,0.04)); }
        .cfp-row--active { background: var(--ch-active-bg, rgba(124,90,245,0.2)) !important; }
        .cfp-row--drag-over {
          background: var(--accent-subtle, rgba(14,165,233,0.12));
          outline: 1px dashed var(--accent, #0ea5e9);
          outline-offset: -1px;
        }

        .cfp-drag-handle {
          font-size: 13px;
          color: var(--text-muted);
          cursor: grab;
          flex-shrink: 0;
          opacity: 0;
          transition: opacity 80ms;
          line-height: 1;
        }
        .cfp-row:hover .cfp-drag-handle { opacity: 1; }
        .cfp-row:active .cfp-drag-handle { cursor: grabbing; }

        .cfp-hash {
          font-size: 16px;
          font-weight: 500;
          color: var(--text-muted);
          flex-shrink: 0;
          line-height: 1;
          transition: color 80ms;
        }
        .cfp-hash--forum { font-size: 12px; }
        .cfp-row:hover .cfp-hash,
        .cfp-row--active .cfp-hash { color: var(--text-secondary); }

        .cfp-name {
          flex: 1;
          font-size: 14px;
          font-weight: 500;
          color: var(--ch-read, var(--text-secondary));
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          transition: color 80ms;
        }
        .cfp-row:hover .cfp-name,
        .cfp-row--active .cfp-name { color: var(--ch-unread, var(--text-primary)); }
        .cfp-name--unread { color: var(--text-normal, var(--text-primary)); font-weight: 600; }

        .cfp-badge {
          min-width: 16px; height: 16px;
          border-radius: 8px; padding: 0 4px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }
        .cfp-badge--mention { background: var(--danger, #ed4245); }
        .cfp-badge--unread  { background: var(--text-muted); }
      `}</style>
    </div>
  );
}

// ── Unassigned channels drop zone (channels not in any folder) ─────────────────
// They automatically appear in the first/default folder

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function ChannelFoldersPanel({
  channels,
  activeChannel,
  onChannelClick,
  onChannelContextMenu,
}: Props) {
  const channelFolders = useOnyxStore(s => s.channelFolders);
  const addChannelToFolder = useOnyxStore(s => s.addChannelToFolder);
  const createFolder = useOnyxStore(s => s.createFolder);
  const channelFolders2 = useOnyxStore(s => s.channelFolders);

  const dragRef = useRef<DragState | null>(null);

  // Build a map of channel name (lower) → Channel object
  const channelMap = new Map<string, Channel>();
  for (const ch of channels) {
    channelMap.set(ch.name.toLowerCase(), ch);
  }

  // Determine which channels are unassigned (not in any folder)
  const assignedChannels = new Set<string>();
  for (const folder of channelFolders) {
    for (const ch of folder.channels) {
      assignedChannels.add(ch.toLowerCase());
    }
  }

  const unassigned = channels.filter(ch => !assignedChannels.has(ch.name.toLowerCase()));

  // Auto-assign unassigned channels to the default folder on first render
  // (We do this imperatively; React's render phase should stay pure)
  const [autoAssigned, setAutoAssigned] = useState(false);
  if (!autoAssigned && unassigned.length > 0) {
    setAutoAssigned(true);
    // Defer to next tick to avoid state updates during render
    setTimeout(() => {
      const defaultFolder = channelFolders2.find(f => f.id === 'default') ?? channelFolders2[0];
      if (!defaultFolder) return;
      for (const ch of unassigned) {
        addChannelToFolder(ch.name, defaultFolder.id);
      }
    }, 0);
  }

  const handleNewFolder = () => {
    const name = prompt('New folder name:');
    if (name?.trim()) createFolder(name.trim().toUpperCase());
  };

  return (
    <div className="cfp-root">
      {channelFolders.map(folder => (
        <FolderSection
          key={folder.id}
          folder={folder}
          channelObjects={channelMap}
          activeChannel={activeChannel}
          onChannelClick={onChannelClick}
          onChannelContextMenu={onChannelContextMenu}
          dragRef={dragRef}
        />
      ))}

      <button className="cfp-add-folder" onClick={handleNewFolder} title="Add folder">
        + Add folder
      </button>

      <style>{`
        .cfp-root {
          display: flex;
          flex-direction: column;
        }

        .cfp-add-folder {
          display: flex; align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 5px 10px;
          margin: 4px 6px 2px;
          background: none;
          border: 1px dashed var(--border-normal);
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--text-muted);
          border-radius: var(--r-sm, 4px);
          font-family: inherit;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          text-align: center;
        }
        .cfp-add-folder:hover {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          color: var(--accent);
        }
      `}</style>
    </div>
  );
}
