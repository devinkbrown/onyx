export type EmojiEntry = {
  emoji: string;
  shortcode: string;
  keywords: readonly string[];
};

export const EMOJI_LIST = [
  { emoji: '😀', shortcode: 'grinning', keywords: ['smile', 'happy'] },
  { emoji: '😂', shortcode: 'joy', keywords: ['laugh', 'lol'] },
  { emoji: '😊', shortcode: 'blush', keywords: ['smile', 'warm'] },
  { emoji: '😍', shortcode: 'heart_eyes', keywords: ['love', 'crush'] },
  { emoji: '😎', shortcode: 'sunglasses', keywords: ['cool'] },
  { emoji: '😭', shortcode: 'sob', keywords: ['cry', 'sad'] },
  { emoji: '😅', shortcode: 'sweat_smile', keywords: ['nervous', 'relief'] },
  { emoji: '👍', shortcode: 'thumbsup', keywords: ['approve', 'yes'] },
  { emoji: '👎', shortcode: 'thumbsdown', keywords: ['no', 'disapprove'] },
  { emoji: '🙏', shortcode: 'pray', keywords: ['thanks', 'please'] },
  { emoji: '👏', shortcode: 'clap', keywords: ['applause'] },
  { emoji: '🔥', shortcode: 'fire', keywords: ['lit', 'hot'] },
  { emoji: '✨', shortcode: 'sparkles', keywords: ['magic', 'shine'] },
  { emoji: '🎉', shortcode: 'tada', keywords: ['party', 'celebrate'] },
  { emoji: '❤️', shortcode: 'heart', keywords: ['love'] },
  { emoji: '💙', shortcode: 'blue_heart', keywords: ['love', 'ocean'] },
  { emoji: '💡', shortcode: 'bulb', keywords: ['idea'] },
  { emoji: '✅', shortcode: 'white_check_mark', keywords: ['done', 'ok'] },
  { emoji: '❌', shortcode: 'x', keywords: ['cancel', 'no'] },
  { emoji: '⚠️', shortcode: 'warning', keywords: ['alert'] },
  { emoji: '📎', shortcode: 'paperclip', keywords: ['attachment', 'file'] },
  { emoji: '🧵', shortcode: 'thread', keywords: ['reply'] },
  { emoji: '🌊', shortcode: 'ocean', keywords: ['wave', 'water'] },
  { emoji: '🌙', shortcode: 'moon', keywords: ['night'] },
  { emoji: '🚀', shortcode: 'rocket', keywords: ['ship', 'launch'] },
  { emoji: '👀', shortcode: 'eyes', keywords: ['look', 'watch'] },
  { emoji: '💬', shortcode: 'speech_balloon', keywords: ['chat'] },
  { emoji: '🫡', shortcode: 'saluting_face', keywords: ['salute', 'roger'] },
] as const satisfies readonly EmojiEntry[];

export function searchEmojis(query: string, limit = 48): EmojiEntry[] {
  const needle = query.trim().replace(/^:/, '').replace(/:$/, '').toLowerCase();
  if (!needle) return EMOJI_LIST.slice(0, limit);

  return EMOJI_LIST.filter((entry) => {
    if (entry.shortcode.includes(needle)) return true;
    return entry.keywords.some((keyword) => keyword.includes(needle));
  }).slice(0, limit);
}
