// ── Sticker data ───────────────────────────────────────────────────────────────

export interface Sticker {
  id: string;
  name: string;
  pack: string;
  url: string;    // SVG data URI or external URL (empty = use emoji fallback)
  emoji: string;  // fallback emoji representation
}

export const STICKER_PACKS: { name: string; stickers: Sticker[] }[] = [
  {
    name: 'Reactions',
    stickers: [
      { id: 'thumbsup',    name: 'Thumbs Up',   pack: 'Reactions', url: '', emoji: '👍' },
      { id: 'thumbsdown',  name: 'Thumbs Down', pack: 'Reactions', url: '', emoji: '👎' },
      { id: 'heart',       name: 'Heart',       pack: 'Reactions', url: '', emoji: '❤️' },
      { id: 'fire',        name: 'Fire',        pack: 'Reactions', url: '', emoji: '🔥' },
      { id: 'party',       name: 'Party',       pack: 'Reactions', url: '', emoji: '🎉' },
      { id: 'crying',      name: 'Crying',      pack: 'Reactions', url: '', emoji: '😭' },
      { id: 'mind_blown',  name: 'Mind Blown',  pack: 'Reactions', url: '', emoji: '🤯' },
      { id: 'cool',        name: 'Cool',        pack: 'Reactions', url: '', emoji: '😎' },
    ],
  },
  {
    name: 'Ocean',
    stickers: [
      { id: 'wave',    name: 'Wave',    pack: 'Ocean', url: '', emoji: '🌊' },
      { id: 'anchor',  name: 'Anchor',  pack: 'Ocean', url: '', emoji: '⚓' },
      { id: 'fish',    name: 'Fish',    pack: 'Ocean', url: '', emoji: '🐟' },
      { id: 'dolphin', name: 'Dolphin', pack: 'Ocean', url: '', emoji: '🐬' },
      { id: 'whale',   name: 'Whale',   pack: 'Ocean', url: '', emoji: '🐋' },
      { id: 'shark',   name: 'Shark',   pack: 'Ocean', url: '', emoji: '🦈' },
    ],
  },
];

// Stickers are sent as a special message format: [STICKER:pack/id:emoji]
export function stickerToMessage(sticker: Sticker): string {
  return `[STICKER:${sticker.pack}/${sticker.id}:${sticker.emoji}]`;
}

export const STICKER_PATTERN = /^\[STICKER:([^/]+)\/([^:]+):([^\]]+)\]$/;
