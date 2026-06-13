'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import { showToast } from '@/components/ui/Toast';

interface MemberContextMenuProps {
  nick: string;
  channel: string;
  userMode: Set<string>;
  x: number;
  y: number;
  onClose: () => void;
}

export default function MemberContextMenu({
  nick,
  channel,
  userMode,
  x,
  y,
  onClose,
}: MemberContextMenuProps) {
  const client            = useOnyxStore(s => s.client);
  const ourNick           = useOnyxStore(s => s.ourNick);
  const channels          = useOnyxStore(s => s.channels);
  const openUserProfile   = useOnyxStore(s => s.openUserProfile);
  const softIgnoreList    = useOnyxStore(s => s.softIgnoreList);
  const toggleSoftIgnore  = useOnyxStore(s => s.toggleSoftIgnore);

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos]                 = useState({ x, y });
  const [showKickInput, setShowKickInput] = useState(false);
  const [kickReason, setKickReason]   = useState('');
  const [showBanInput, setShowBanInput]   = useState(false);
  const [banMask, setBanMask]         = useState(`${nick}!*@*`);
  const [showQuietInput, setShowQuietInput] = useState(false);
  const [quietMask, setQuietMask]     = useState(`${nick}!*@*`);

  // Derive whether *we* have op in this channel
  // Orochi PREFIX=(qov).@+  — only q (owner) and o (op) exist; no 'a'.
  const chanKey = channel.toLowerCase();
  const channelData = channels.get(chanKey);
  const ourUser = channelData?.users.get(ourNick.toLowerCase());
  const weAreOp = ourUser
    ? ourUser.modes.has('q') || ourUser.modes.has('o')
    : false;
  const canMode = weAreOp;

  // Target user's current modes
  const targetHasVoice = userMode.has('v');
  const targetHasOp    = userMode.has('o');

  // Clamp to viewport edges after mount
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

  const sendMode = (modeStr: string) => {
    client?.sendRaw('MODE', channel, modeStr, nick);
    onClose();
  };

  const handleWhois = () => {
    client?.whois(nick);
    onClose();
  };

  const handleProfile = () => {
    openUserProfile(nick);
    onClose();
  };

  const handleMessage = () => {
    // Open a DM — use the existing openUserProfile which opens the card;
    // the caller can wire up a DM action from there
    openUserProfile(nick);
    onClose();
  };

  const isNickSoftIgnored = softIgnoreList.has(nick);
  const handleToggleSoftIgnore = () => {
    if (!isNickSoftIgnored) {
      showToast(`Hiding messages from ${nick}`, {
        variant: 'info',
        undoAction: () => toggleSoftIgnore(nick),
      });
    }
    toggleSoftIgnore(nick);
    onClose();
  };

  const handleKickConfirm = () => {
    const reason = kickReason.trim() || 'Kicked';
    client?.kick(channel, nick, reason);
    onClose();
  };

  const handleBanConfirm = () => {
    const mask = banMask.trim() || `${nick}!*@*`;
    client?.sendRaw('MODE', channel, '+b', mask);
    onClose();
  };

  const handleQuietConfirm = () => {
    const mask = quietMask.trim() || `${nick}!*@*`;
    client?.sendRaw('MODE', channel, '+q', mask);
    onClose();
  };

  return (
    <>
      {/* Transparent backdrop to catch outside clicks */}
      <div className="member-ctx-backdrop" onMouseDown={onClose} />

      <div
        ref={menuRef}
        className="member-ctx"
        style={{ left: pos.x, top: pos.y }}
        role="menu"
        aria-label={`Member options for ${nick}`}
      >
        {/* Header */}
        <div className="member-ctx-header">
          <div className="member-ctx-nick">{nick}</div>
        </div>

        {/* General actions */}
        <button className="member-ctx-item" onClick={handleProfile} role="menuitem">
          <span>👤</span> View Profile
        </button>
        <button className="member-ctx-item" onClick={handleWhois} role="menuitem">
          <span>🔍</span> WHOIS
        </button>
        <button className="member-ctx-item" onClick={handleMessage} role="menuitem">
          <span>💬</span> Message
        </button>

        {nick !== ourNick && (
          <button className="member-ctx-item" onClick={handleToggleSoftIgnore} role="menuitem">
            <span>{isNickSoftIgnored ? '👁' : '🙈'}</span>
            {isNickSoftIgnored ? 'Show Messages' : 'Hide Messages'}
          </button>
        )}

        {/* Mode section — only if we have op */}
        {canMode && (
          <>
            <div className="member-ctx-sep" role="separator" />
            <div className="member-ctx-label">Manage</div>

            {/* Voice */}
            <button
              className="member-ctx-item"
              onClick={() => sendMode(targetHasVoice ? '-v' : '+v')}
              role="menuitemcheckbox"
              aria-checked={targetHasVoice}
            >
              <span>{targetHasVoice ? '🔇' : '🎤'}</span>
              {targetHasVoice ? 'Take Voice (−v)' : 'Give Voice (+v)'}
            </button>

            {/* Op — only full ops can give/take op */}
            {weAreOp && (
              <button
                className="member-ctx-item"
                onClick={() => sendMode(targetHasOp ? '-o' : '+o')}
                role="menuitemcheckbox"
                aria-checked={targetHasOp}
              >
                <span>{targetHasOp ? '👇' : '👑'}</span>
                {targetHasOp ? 'Take Op (−o)' : 'Give Op (+o)'}
              </button>
            )}
          </>
        )}

        {/* Kick / Ban / Quiet */}
        {canMode && (
          <>
            <div className="member-ctx-sep" role="separator" />

            {/* Kick */}
            {!showKickInput ? (
              <button
                className="member-ctx-item danger"
                onClick={() => setShowKickInput(true)}
                role="menuitem"
              >
                <span>⚡</span> Kick…
              </button>
            ) : (
              <div className="member-ctx-kick-input">
                <input
                  autoFocus
                  placeholder="Reason (optional)"
                  value={kickReason}
                  onChange={e => setKickReason(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleKickConfirm();
                    if (e.key === 'Escape') setShowKickInput(false);
                  }}
                />
                <button className="member-ctx-kick-btn" onClick={handleKickConfirm}>
                  Kick
                </button>
              </div>
            )}

            {/* Ban */}
            {!showBanInput ? (
              <button
                className="member-ctx-item danger"
                onClick={() => setShowBanInput(true)}
                role="menuitem"
              >
                <span>🚫</span> Ban…
              </button>
            ) : (
              <div className="member-ctx-kick-input">
                <input
                  autoFocus
                  placeholder={`${nick}!*@*`}
                  value={banMask}
                  onChange={e => setBanMask(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleBanConfirm();
                    if (e.key === 'Escape') setShowBanInput(false);
                  }}
                />
                <button className="member-ctx-kick-btn" onClick={handleBanConfirm}>
                  Ban
                </button>
              </div>
            )}

            {/* Quiet */}
            {!showQuietInput ? (
              <button
                className="member-ctx-item danger"
                onClick={() => setShowQuietInput(true)}
                role="menuitem"
              >
                <span>🔇</span> Quiet (+q)…
              </button>
            ) : (
              <div className="member-ctx-kick-input">
                <input
                  autoFocus
                  placeholder={`${nick}!*@*`}
                  value={quietMask}
                  onChange={e => setQuietMask(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleQuietConfirm();
                    if (e.key === 'Escape') setShowQuietInput(false);
                  }}
                />
                <button className="member-ctx-kick-btn" onClick={handleQuietConfirm}>
                  Quiet
                </button>
              </div>
            )}
          </>
        )}

        <style>{`
          .member-ctx-backdrop {
            position: fixed;
            inset: 0;
            z-index: 999;
          }
          .member-ctx {
            position: fixed;
            z-index: 1000;
            background: var(--bg-overlay, #1a2b3d);
            border: 1px solid var(--border-normal);
            border-radius: 8px;
            padding: 4px;
            min-width: 180px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            animation: ctx-in 0.1s ease;
          }
          @keyframes ctx-in {
            from { opacity: 0; transform: scale(0.95); }
            to   { opacity: 1; transform: scale(1); }
          }
          .member-ctx-header {
            padding: 8px 12px 6px;
            border-bottom: 1px solid var(--border-subtle);
            margin-bottom: 4px;
          }
          .member-ctx-nick {
            font-weight: 700;
            font-size: 13px;
            color: var(--text-primary);
          }
          .member-ctx-sep {
            height: 1px;
            background: var(--border-subtle);
            margin: 4px 6px;
          }
          .member-ctx-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 5px;
            border: none;
            background: none;
            cursor: pointer;
            font-size: 13px;
            font-family: inherit;
            color: var(--text-secondary);
            width: 100%;
            text-align: left;
            transition: background 0.1s, color 0.1s;
          }
          .member-ctx-item:hover {
            background: var(--bg-elevated);
            color: var(--text-primary);
          }
          .member-ctx-item.danger { color: #ef4444; }
          .member-ctx-item.danger:hover {
            background: rgba(239,68,68,0.1);
            color: #f87171;
          }
          .member-ctx-label {
            font-size: 10px;
            font-weight: 700;
            color: var(--text-muted);
            padding: 4px 10px 2px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }
          .member-ctx-kick-input {
            margin: 4px 8px;
            display: flex;
            gap: 4px;
          }
          .member-ctx-kick-input input {
            flex: 1;
            background: var(--bg-elevated);
            border: 1px solid var(--border-normal);
            border-radius: 4px;
            padding: 4px 8px;
            color: var(--text-primary);
            font-size: 12px;
            font-family: inherit;
            outline: none;
          }
          .member-ctx-kick-btn {
            padding: 4px 10px;
            border-radius: 4px;
            border: none;
            background: #ef4444;
            color: white;
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            font-weight: 600;
          }
          .member-ctx-kick-btn:hover { background: #dc2626; }
        `}</style>
      </div>
    </>
  );
}
