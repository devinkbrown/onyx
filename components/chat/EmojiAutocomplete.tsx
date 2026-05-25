'use client';

import { useEffect, useRef, useState } from 'react';
import { useOnyxStore } from '@/lib/store';

export interface EmojiAutocompleteProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export const EMOJI_MAP: Array<[string, string[]]> = [
  ['😀', ['grinning', 'grin', 'happy']],
  ['😂', ['joy', 'laugh', 'lol']],
  ['😍', ['heart_eyes', 'love']],
  ['😎', ['sunglasses', 'cool']],
  ['😭', ['sob', 'crying']],
  ['😊', ['blush', 'smile']],
  ['😜', ['wink', 'tongue']],
  ['😅', ['sweat_smile']],
  ['🤔', ['thinking', 'hmm']],
  ['😬', ['grimacing']],
  ['👍', ['thumbsup', 'thumbs_up', '+1', 'like']],
  ['👎', ['thumbsdown', 'thumbs_down', '-1', 'dislike']],
  ['👋', ['wave', 'hi', 'hello', 'bye']],
  ['🙏', ['pray', 'please', 'thanks']],
  ['❤️', ['heart', 'love', 'red_heart']],
  ['🔥', ['fire', 'hot']],
  ['💯', ['100', 'perfect']],
  ['✅', ['check', 'done', 'yes']],
  ['❌', ['x', 'no', 'cross']],
  ['⭐', ['star']],
  ['🎉', ['tada', 'celebrate', 'party']],
  ['🎊', ['confetti', 'party']],
  ['🚀', ['rocket', 'launch']],
  ['💡', ['bulb', 'idea']],
  ['🐛', ['bug']],
  ['🔧', ['wrench', 'fix', 'tool']],
  ['⚡', ['zap', 'lightning', 'fast']],
  ['🌊', ['ocean', 'wave', 'water']],
  ['🎯', ['target', 'bullseye']],
  ['🤝', ['handshake', 'deal', 'agree']],
  ['👀', ['eyes', 'looking', 'watch']],
  ['💪', ['muscle', 'strong']],
  ['🤦', ['facepalm']],
  ['🤷', ['shrug']],
  ['🙃', ['upside_down', 'silly']],
  ['😴', ['sleeping', 'zzz']],
  ['🤢', ['sick', 'nausea']],
  ['😡', ['angry', 'rage', 'mad']],
  ['😱', ['scream', 'shocked']],
  ['🥳', ['partying', 'celebrate']],
  ['🤩', ['star_struck', 'wow']],
  ['😇', ['innocent', 'halo']],
  ['🤖', ['robot']],
  ['👾', ['alien_monster', 'game']],
  ['💀', ['skull', 'dead', 'rip']],
  ['🦄', ['unicorn']],
  ['🐧', ['penguin']],
  ['🦊', ['fox']],
  ['🐸', ['frog']],
  ['🌈', ['rainbow']],
  ['☀️', ['sun', 'sunny']],
  ['🌙', ['moon', 'night']],
  ['🍕', ['pizza']],
  ['🍔', ['burger', 'hamburger']],
  ['🍺', ['beer', 'cheers']],
  ['☕', ['coffee', 'cafe']],
  ['🎵', ['music', 'note']],
  ['🎮', ['game', 'controller']],
  ['📱', ['phone', 'mobile']],
  ['💻', ['laptop', 'computer']],
  ['📸', ['camera', 'photo']],
  ['🔒', ['lock', 'secure']],
  ['🔑', ['key']],
  ['📌', ['pin', 'pinned']],
  ['📝', ['memo', 'note', 'write']],
  ['📊', ['chart', 'stats']],
  ['🗑️', ['trash', 'delete']],
  ['✨', ['sparkles', 'magic']],
  ['🎁', ['gift', 'present']],
  ['🏆', ['trophy', 'winner']],
  ['🥇', ['gold', 'first']],
  ['💬', ['speech', 'comment']],
  ['📢', ['megaphone', 'announce']],
  ['🔔', ['bell', 'notification']],
  ['🔕', ['no_bell', 'mute']],
  ['🆕', ['new']],
  ['🆘', ['sos', 'help']],
  ['ℹ️', ['info', 'information']],
  ['⚠️', ['warning', 'warn', 'caution']],
];

export interface CustomEmojiEntry {
  name: string;
  url: string;
}

/**
 * Returns up to 8 [emoji, primaryName] pairs matching the query.
 * Custom emoji are appended after standard matches; they display as `:name:` in chat.
 */
export function searchEmoji(
  query: string,
  customEmoji: CustomEmojiEntry[] = [],
): Array<[string, string]> {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results: Array<[string, string]> = [];

  // Standard emoji
  for (const [emoji, names] of EMOJI_MAP) {
    const match = names.find(n => n.startsWith(q));
    if (match) {
      results.push([emoji, names[0]]);
      if (results.length >= 8) break;
    }
  }

  // Custom emoji (fill remaining slots up to 8 total)
  if (results.length < 8) {
    for (const ce of customEmoji) {
      if (ce.name.toLowerCase().startsWith(q)) {
        // Represent custom emoji as :name: so the message input can resolve it
        results.push([`:${ce.name}:`, ce.name]);
        if (results.length >= 8) break;
      }
    }
  }

  return results;
}

export default function EmojiAutocomplete({ query, onSelect, onClose, anchorRef }: EmojiAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const customEmoji = useOnyxStore(s => s.customEmoji);
  const results = searchEmoji(query, customEmoji);

  // Position above the anchor
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left,
    });
  }, [anchorRef]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (results.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + results.length) % results.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        onSelect(results[selectedIndex][0]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [results, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (results.length === 0 || !pos) return null;

  return (
    <div
      ref={listRef}
      className="emoji-ac-popup"
      role="listbox"
      aria-label="Emoji suggestions"
      style={{ bottom: pos.bottom, left: pos.left }}
    >
      {results.map(([emoji, name], i) => (
        <button
          key={name}
          className={`emoji-ac-item${i === selectedIndex ? ' emoji-ac-item--selected' : ''}`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseDown={e => {
            e.preventDefault();
            onSelect(emoji);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="emoji-ac-char" aria-hidden="true">{emoji}</span>
          <span className="emoji-ac-name">:{name}:</span>
        </button>
      ))}
      <style>{`
        .emoji-ac-popup {
          position: fixed;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: var(--shadow-md);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          z-index: 8000;
          min-width: 180px;
          max-width: 280px;
        }
        .emoji-ac-item {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 34px;
          padding: 0 10px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background var(--t-fast, 100ms);
          flex-shrink: 0;
          width: 100%;
        }
        .emoji-ac-item:hover {
          background: var(--ch-hover-bg, rgba(255,255,255,0.05));
        }
        .emoji-ac-item--selected {
          background: var(--accent-subtle, rgba(124,90,245,0.15));
        }
        .emoji-ac-char {
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
          width: 24px;
          text-align: center;
        }
        .emoji-ac-name {
          font-size: 13px;
          color: var(--text-secondary, #aaa);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .emoji-ac-item--selected .emoji-ac-name {
          color: var(--accent, #7c5af5);
        }
      `}</style>
    </div>
  );
}
