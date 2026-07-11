// SPDX-License-Identifier: AGPL-3.0-or-later
export type MentionRange = Readonly<{
  start: number;
  end: number;
  kind: 'mention' | 'channel';
  value: string;
}>;

export type ParsedMentions = Readonly<{
  mentions: string[];
  channels: string[];
  ranges: MentionRange[];
}>;

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isIrcNickChar(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  if (isAsciiLetterOrDigit(code)) return true;

  switch (char) {
    case '-':
    case '_':
    case '[':
    case ']':
    case '{':
    case '}':
    case '\\':
    case '`':
    case '|':
    case '^':
      return true;
    default:
      return false;
  }
}

function isWordLike(char: string): boolean {
  return char === '_' || /\p{L}|\p{N}/u.test(char);
}

function hasMentionBoundaryBefore(text: string, start: number): boolean {
  if (start === 0) return true;
  return !isWordLike(text[start - 1]!);
}

function isChannelTerminator(char: string): boolean {
  return char === ',' || /\s|[\x00-\x1f\x7f]/u.test(char);
}

function addUnique(values: string[], seen: Set<string>, value: string): void {
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  values.push(value);
}

export function parseMentions(text: string): ParsedMentions {
  const mentions: string[] = [];
  const channels: string[] = [];
  const ranges: MentionRange[] = [];
  const seenMentions = new Set<string>();
  const seenChannels = new Set<string>();

  let cursor = 0;
  while (cursor < text.length) {
    const marker = text[cursor]!;

    if (marker === '@' && hasMentionBoundaryBefore(text, cursor)) {
      let end = cursor + 1;
      while (end < text.length && isIrcNickChar(text[end]!)) {
        end += 1;
      }

      if (end > cursor + 1 && (end === text.length || !isWordLike(text[end]!))) {
        const value = text.slice(cursor + 1, end);
        addUnique(mentions, seenMentions, value);
        ranges.push({ start: cursor, end, kind: 'mention', value });
        cursor = end;
        continue;
      }
    }

    if (marker === '#' || marker === '&') {
      let end = cursor + 1;
      while (end < text.length && !isChannelTerminator(text[end]!)) {
        end += 1;
      }

      if (end > cursor + 1) {
        const value = text.slice(cursor, end);
        addUnique(channels, seenChannels, value);
        ranges.push({ start: cursor, end, kind: 'channel', value });
        cursor = end;
        continue;
      }
    }

    cursor += 1;
  }

  return { mentions, channels, ranges };
}
