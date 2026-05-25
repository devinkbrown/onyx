/**
 * activity.ts — parse rich-presence activity from a custom status string.
 *
 * Activity types (matched case-insensitively):
 *   playing <game>         → { type: 'PLAYING A GAME', text: game, emoji: '🎮' }
 *   listening <song> by <artist> → { type: 'LISTENING TO MUSIC', text: 'song - artist', emoji: '🎵' }
 *   watching <show>        → { type: 'WATCHING', text: show, emoji: '📺' }
 *   coding <project>       → { type: 'CODING', text: project, emoji: '💻' }
 *   streaming <title>      → { type: 'LIVE ON STREAM', text: title, emoji: '🔴' }
 *   🎮 <text>              → gaming
 *   💻 <text>              → coding
 *   🎵 <text>              → listening
 *   📺 <text>              → watching
 *   🔴 <text>              → streaming
 */

export interface ParsedActivity {
  emoji: string;
  typeLabel: string;
  text: string;
}

const EMOJI_MAP: Record<string, { typeLabel: string }> = {
  '🎮': { typeLabel: 'PLAYING A GAME' },
  '💻': { typeLabel: 'CODING' },
  '🎵': { typeLabel: 'LISTENING TO MUSIC' },
  '📺': { typeLabel: 'WATCHING' },
  '🔴': { typeLabel: 'LIVE ON STREAM' },
  '📚': { typeLabel: 'STUDYING' },
};

// Regex patterns for keyword-based detection
const KEYWORD_PATTERNS: Array<{
  pattern: RegExp;
  emoji: string;
  typeLabel: string;
  extract: (m: RegExpMatchArray) => string;
}> = [
  {
    pattern: /^playing\s+(.+)/i,
    emoji: '🎮',
    typeLabel: 'PLAYING A GAME',
    extract: m => m[1],
  },
  {
    pattern: /^listening(?:\s+to)?\s+(.+?)\s+by\s+(.+)/i,
    emoji: '🎵',
    typeLabel: 'LISTENING TO MUSIC',
    extract: m => `${m[1]} — ${m[2]}`,
  },
  {
    pattern: /^listening(?:\s+to)?\s+(.+)/i,
    emoji: '🎵',
    typeLabel: 'LISTENING TO MUSIC',
    extract: m => m[1],
  },
  {
    pattern: /^watching\s+(.+)/i,
    emoji: '📺',
    typeLabel: 'WATCHING',
    extract: m => m[1],
  },
  {
    pattern: /^coding(?:\s+on)?\s+(.+)/i,
    emoji: '💻',
    typeLabel: 'CODING',
    extract: m => m[1],
  },
  {
    pattern: /^streaming\s+(.+)/i,
    emoji: '🔴',
    typeLabel: 'LIVE ON STREAM',
    extract: m => m[1],
  },
];

export function parseActivity(status: string): ParsedActivity | null {
  if (!status) return null;

  // Check emoji prefix first (e.g. "🎮 Counter-Strike 2")
  for (const [emoji, meta] of Object.entries(EMOJI_MAP)) {
    if (status.startsWith(emoji)) {
      const text = status.slice(emoji.length).trim();
      if (text) {
        return { emoji, typeLabel: meta.typeLabel, text };
      }
    }
  }

  // Check keyword patterns (e.g. "playing Counter-Strike 2")
  for (const { pattern, emoji, typeLabel, extract } of KEYWORD_PATTERNS) {
    const m = status.match(pattern);
    if (m) {
      return { emoji, typeLabel, text: extract(m) };
    }
  }

  return null;
}

/** Returns a 1–2 word truncation suitable for small badges */
export function activityShort(activity: ParsedActivity): string {
  const words = activity.text.trim().split(/\s+/);
  return words.slice(0, 2).join(' ') + (words.length > 2 ? '…' : '');
}
