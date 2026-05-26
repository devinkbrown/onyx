'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

// Quick-access row — most common reactions
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥'];

// Full grid organized into categories
const REACTION_GRID: Record<string, string[]> = {
  'Smileys': ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🙂','🤗','🤔','🤨','😐','😑','😶','😏','😒','😔','🙃','🤑','😲','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','😠','😡','🤬','😷','🤢','🤮','🤧','😇','🥳','🥺'],
  'Gestures': ['👋','🤚','🖐','✋','🖖','👌','🤌','✌','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍','💪'],
  'Nature': ['🐶','🐱','🐭','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🌸','🌺','🌻','🌹','🌷','🍀','🌿','🌱','🌲','🌳','🌴','🌵'],
  'Food': ['🍕','🍔','🍟','🌮','🌯','🍜','🍣','🍱','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','🍦','☕','🍵','🧃','🥤','🍺','🍻','🥂','🍷','🍸','🍹'],
  'Activities': ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🎮','🎲','♟','🧩','🎯','🎳','🏆','🥇','🥈','🥉','🎪','🎭','🎨','🎬','🎤','🎵','🎶','🎸','🎹','🥁','🎺'],
  'Objects': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💓','💗','💖','💘','💝','⭐','🌟','✨','🔥','💥','✅','❌','⚡','💯','🎁','🎈','🎊','🎉','🚀','💡','🔑','💎','🏅','🎖'],
};

const STORAGE_KEY = 'ocean-recent-reactions';

function getRecentReactions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentReaction(emoji: string): void {
  if (typeof window === 'undefined') return;
  try {
    const recent = getRecentReactions();
    const updated = [emoji, ...recent.filter(e => e !== emoji)].slice(0, 8);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export default function ReactionPicker({ onPick, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const [recentReactions] = useState<string[]>(getRecentReactions);

  const searchRef   = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handlePick = useCallback((emoji: string) => {
    saveRecentReaction(emoji);
    onPick(emoji);
    onClose();
  }, [onPick, onClose]);

  // Filtered emoji for search
  const allEmoji = Object.values(REACTION_GRID).flat();
  const displayEmoji = search.trim()
    ? allEmoji.filter(() => true) // no name DB; show all when searching for now
    : REACTION_GRID[activeCategory] ?? [];

  const hasRecent = recentReactions.length > 0;

  return (
    <div ref={containerRef} className="rp-picker animate-rp-in">
      {/* Search */}
      <div className="rp-search">
        <input
          ref={searchRef}
          className="rp-search-input"
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search emoji"
        />
      </div>

      {/* Quick row */}
      {!search && (
        <div className="rp-quick">
          {QUICK_REACTIONS.map(emoji => (
            <button
              key={emoji}
              className="rp-quick-btn"
              onClick={() => handlePick(emoji)}
              title={emoji}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Recent row */}
      {!search && hasRecent && (
        <>
          <div className="rp-section-label">Recent</div>
          <div className="rp-quick rp-quick--recent">
            {recentReactions.map(emoji => (
              <button
                key={emoji}
                className="rp-quick-btn"
                onClick={() => handlePick(emoji)}
                title={emoji}
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Category tabs */}
      {!search && (
        <div className="rp-tabs">
          {Object.keys(REACTION_GRID).map(cat => (
            <button
              key={cat}
              className={`rp-tab ${activeCategory === cat ? 'rp-tab--active' : ''}`}
              onClick={() => setActiveCategory(cat)}
              title={cat}
            >
              {REACTION_GRID[cat][0]}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="rp-grid" role="grid" aria-label="Emoji grid">
        {(search ? allEmoji : displayEmoji).map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            className="rp-emoji-btn"
            onClick={() => handlePick(emoji)}
            title={emoji}
            aria-label={emoji}
            role="gridcell"
          >
            {emoji}
          </button>
        ))}
        {(search ? allEmoji : displayEmoji).length === 0 && (
          <div className="rp-empty">No results</div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .rp-picker {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: 280px;
    background: var(--bg-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-xl), 0 0 0 1px var(--accent-border);
    z-index: 300;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 340px;
  }

  .rp-search {
    padding: 8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .rp-search-input {
    width: 100%;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-full);
    padding: 5px 12px;
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
    transition: border-color var(--t-fast) ease, box-shadow var(--t-fast) ease;
    box-sizing: border-box;
  }
  .rp-search-input:focus {
    border-color: var(--accent-border);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }
  .rp-search-input::placeholder { color: var(--text-muted); }

  .rp-quick {
    display: flex;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    flex-wrap: wrap;
  }
  .rp-quick--recent { padding-top: 2px; }

  .rp-section-label {
    padding: 4px 10px 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .rp-quick-btn {
    width: 30px;
    height: 30px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: var(--r-sm);
    font-size: 17px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--t-fast) ease, transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast) ease;
    flex-shrink: 0;
  }
  .rp-quick-btn:hover {
    background: var(--accent-subtle);
    transform: scale(1.2);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .rp-tabs {
    display: flex;
    gap: 1px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-subtle);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .rp-tabs::-webkit-scrollbar { display: none; }

  .rp-tab {
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: var(--r-xs);
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--t-fast) ease;
    flex-shrink: 0;
    position: relative;
    filter: grayscale(0.3) opacity(0.6);
  }
  .rp-tab:hover {
    background: var(--accent-subtle);
    filter: grayscale(0) opacity(1);
  }
  .rp-tab--active {
    background: var(--accent-subtle);
    filter: grayscale(0) opacity(1);
  }
  .rp-tab--active::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%);
    width: 16px;
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
  }

  .rp-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
    padding: 6px;
    overflow-y: auto;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: var(--accent-border) transparent;
  }
  .rp-grid::-webkit-scrollbar { width: 3px; }
  .rp-grid::-webkit-scrollbar-thumb { background: var(--accent-border); border-radius: 2px; }

  .rp-emoji-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: var(--r-sm);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--t-fast) ease, transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast) ease;
  }
  .rp-emoji-btn:hover {
    background: var(--accent-subtle);
    transform: scale(1.2);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .rp-empty {
    grid-column: 1 / -1;
    padding: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  @keyframes rp-in {
    from { opacity: 0; transform: translateX(-50%) scale(0.93) translateY(6px); }
    to   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
  }
  .animate-rp-in {
    animation: rp-in 160ms var(--ease-spring);
  }
`;
