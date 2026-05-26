'use client';

import { useState, useRef, useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import EmojiPicker from '@/components/ui/EmojiPicker';

interface QuickReactBarProps {
  msgId: string;
  msgFrom: string;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onMore: (e: React.MouseEvent) => void;
}

const DEFAULT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'] as const;

// 20 most common emojis to show in the configure dropdown
const CONFIGURE_POOL = [
  '👍','❤️','😂','😮','😢','🙏','🔥','✅','❌','👏',
  '🎉','🤔','💯','😍','🥺','💪','👀','🚀','✨','🙌',
];

export default function QuickReactBar({ onReact, onReply, onMore }: QuickReactBarProps) {
  const favoriteEmojis    = useOnyxStore(s => s.favoriteEmojis);
  const setFavoriteEmojis = useOnyxStore(s => s.setFavoriteEmojis);

  const [showQuickEmoji, setShowQuickEmoji] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [showConfigure,  setShowConfigure]  = useState(false);
  const popupRef       = useRef<HTMLDivElement>(null);
  const fullPickerRef  = useRef<HTMLDivElement>(null);
  const configureRef   = useRef<HTMLDivElement>(null);

  // Merge default + favorites, deduplicate, keep max ~10 visible
  const allQuick = Array.from(new Set([...DEFAULT_EMOJIS, ...favoriteEmojis])).slice(0, 10);

  useEffect(() => {
    if (!showQuickEmoji && !showFullPicker && !showConfigure) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPopup   = popupRef.current?.contains(target);
      const inFull    = fullPickerRef.current?.contains(target);
      const inConfig  = configureRef.current?.contains(target);
      if (!inPopup && !inFull && !inConfig) {
        setShowQuickEmoji(false);
        setShowFullPicker(false);
        setShowConfigure(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showQuickEmoji, showFullPicker, showConfigure]);

  const handleQuickEmoji = (emoji: string) => {
    onReact(emoji);
    setShowQuickEmoji(false);
  };

  const handleMoreEmoji = () => {
    setShowQuickEmoji(false);
    setShowFullPicker(true);
  };

  const toggleFavorite = (emoji: string) => {
    const current = favoriteEmojis;
    if (current.includes(emoji)) {
      setFavoriteEmojis(current.filter(e => e !== emoji));
    } else if (current.length < 6) {
      setFavoriteEmojis([...current, emoji]);
    } else {
      // Replace the last favourite
      setFavoriteEmojis([...current.slice(0, 5), emoji]);
    }
  };

  return (
    <div className="quick-react-bar" role="toolbar" aria-label="Quick actions">
      {/* Quick emoji popup */}
      {showQuickEmoji && (
        <div ref={popupRef} className="quick-emoji-popup" role="listbox" aria-label="Quick reactions">
          {allQuick.map((emoji) => (
            <button
              key={emoji}
              className="quick-emoji-btn"
              aria-label={`React with ${emoji}`}
              onClick={() => handleQuickEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
          <button
            className="quick-emoji-btn quick-emoji-btn--more"
            aria-label="More reactions"
            onClick={handleMoreEmoji}
            title="More reactions"
          >
            +
          </button>
        </div>
      )}

      {/* Full emoji picker */}
      {showFullPicker && (
        <div ref={fullPickerRef} className="quick-react-full-picker">
          <EmojiPicker
            onPick={(emoji) => {
              onReact(emoji);
              setShowFullPicker(false);
            }}
            onClose={() => setShowFullPicker(false)}
          />
        </div>
      )}

      {/* Configure favorites dropdown */}
      {showConfigure && (
        <div ref={configureRef} className="qrb-configure-popup" role="listbox" aria-label="Configure favorite emojis">
          <div className="qrb-configure-title">Favorite emojis ({favoriteEmojis.length}/6)</div>
          <div className="qrb-configure-grid">
            {CONFIGURE_POOL.map(emoji => {
              const active = favoriteEmojis.includes(emoji);
              return (
                <button
                  key={emoji}
                  className={`qrb-configure-btn ${active ? 'qrb-configure-btn--active' : ''}`}
                  onClick={() => toggleFavorite(emoji)}
                  aria-pressed={active}
                  aria-label={`${active ? 'Remove' : 'Add'} ${emoji} as favorite`}
                  title={active ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* +😊 react button */}
      <button
        className="qrb-btn"
        aria-label="Add reaction"
        title="Add reaction"
        onClick={() => {
          setShowFullPicker(false);
          setShowConfigure(false);
          setShowQuickEmoji(p => !p);
        }}
      >
        +😊
      </button>

      <div className="qrb-divider" aria-hidden />

      {/* Reply button */}
      <button
        className="qrb-btn"
        aria-label="Reply"
        title="Reply"
        onClick={onReply}
      >
        ↩
      </button>

      <div className="qrb-divider" aria-hidden />

      {/* Configure favorites gear */}
      <button
        className={`qrb-btn ${showConfigure ? 'qrb-btn--active' : ''}`}
        aria-label="Configure favorite reactions"
        title="Configure favorites"
        onClick={() => {
          setShowQuickEmoji(false);
          setShowFullPicker(false);
          setShowConfigure(p => !p);
        }}
      >
        ⚙
      </button>

      <div className="qrb-divider" aria-hidden />

      {/* More button */}
      <button
        className="qrb-btn"
        aria-label="More options"
        title="More options"
        onClick={onMore}
      >
        ⋯
      </button>

      <style>{quickReactStyles}</style>
    </div>
  );
}

const quickReactStyles = `
  .quick-react-bar {
    position: absolute;
    top: -18px;
    right: 8px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 1px;
    background: var(--bg-float, #1a2c40);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-full, 9999px);
    padding: 3px 7px;
    box-shadow: var(--shadow-md, 0 4px 16px rgba(0,0,0,0.5));
    animation: qrb-in 130ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }
  @keyframes qrb-in {
    from { opacity: 0; transform: translateY(4px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .qrb-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: background 120ms, color 120ms, transform 120ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
    font-family: inherit;
  }
  .qrb-btn:hover {
    background: var(--bg-elevated);
    color: var(--text-primary);
    transform: scale(1.12);
  }
  .qrb-btn--active {
    background: var(--accent-subtle);
    color: var(--accent);
  }
  .qrb-divider {
    width: 1px;
    height: 14px;
    background: var(--border-subtle);
    margin: 0 2px;
    flex-shrink: 0;
  }
  .quick-emoji-popup {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: var(--bg-float, #1a2c40);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-lg, 12px);
    padding: 6px 9px;
    display: flex;
    gap: 2px;
    align-items: center;
    box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.65));
    animation: qrb-in 110ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
    z-index: 30;
  }
  .quick-emoji-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm, 6px);
    border: none;
    background: none;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 100ms, transform 150ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
  }
  .quick-emoji-btn:hover {
    background: var(--bg-elevated);
    transform: scale(1.2);
  }
  .quick-emoji-btn--more {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-muted);
    border-left: 1px solid var(--border-subtle);
    border-radius: 0 var(--r-sm, 6px) var(--r-sm, 6px) 0;
    margin-left: 3px;
    padding-left: 3px;
    width: 32px;
  }
  .quick-emoji-btn--more:hover {
    color: var(--text-primary);
    transform: none;
  }
  .quick-react-full-picker {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 30;
  }

  /* Configure favorites popup */
  .qrb-configure-popup {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: var(--bg-float, #1a2c40);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-lg, 12px);
    padding: 11px 11px 9px;
    box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.65));
    animation: qrb-in 110ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
    z-index: 30;
    width: 224px;
  }
  .qrb-configure-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-muted);
    margin-bottom: 9px;
    padding: 0 2px;
  }
  .qrb-configure-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }
  .qrb-configure-btn {
    width: 36px; height: 36px;
    border-radius: var(--r-sm, 6px);
    border: 1px solid transparent;
    background: none;
    font-size: 19px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 100ms, border-color 100ms, transform 150ms var(--ease-spring, cubic-bezier(0.175,0.885,0.32,1.275));
  }
  .qrb-configure-btn:hover {
    background: var(--bg-elevated);
    transform: scale(1.18);
  }
  .qrb-configure-btn--active {
    background: var(--accent-subtle);
    border-color: var(--accent-border);
  }
  .qrb-configure-btn--active:hover {
    background: var(--accent-subtle);
    border-color: var(--accent);
    transform: scale(1.12);
  }
`;
