// SPDX-License-Identifier: AGPL-3.0-or-later
export type HighlightRange = Readonly<{
  start: number;
  end: number;
  match: boolean;
}>;

export function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightRanges(text: string, query: string): HighlightRange[] {
  if (query.length === 0) {
    return [{ start: 0, end: text.length, match: false }];
  }

  if (text.length === 0 || query.length > text.length) {
    return text.length === 0 ? [] : [{ start: 0, end: text.length, match: false }];
  }

  const pattern = new RegExp(escapeRegExpLiteral(query), 'giu');
  const ranges: HighlightRange[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match !== null) {
    const matchedText = match[0]!;
    const start = match.index;
    const end = start + matchedText.length;

    if (cursor < start) {
      ranges.push({ start: cursor, end: start, match: false });
    }

    ranges.push({ start, end, match: true });
    cursor = end;
    match = pattern.exec(text);
  }

  if (ranges.length === 0) {
    return [{ start: 0, end: text.length, match: false }];
  }

  if (cursor < text.length) {
    ranges.push({ start: cursor, end: text.length, match: false });
  }

  return ranges;
}
