// SPDX-License-Identifier: AGPL-3.0-or-later
export type HighlightRange = {
  start: number;
  end: number;
};

export type FuzzyMatch = {
  score: number;
  ranges: HighlightRange[];
};

export type FuzzyResult<T> = {
  item: T;
  score: number;
  ranges: HighlightRange[];
};

type CandidateMatch = {
  score: number;
  indices: number[];
};

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;

  const previous = text[index - 1];
  const current = text[index];
  if (!previous || !current) return false;

  return /[\s#/@:_-]/.test(previous) || (previous === previous.toLowerCase() && current === current.toUpperCase());
}

function compactRanges(indices: number[]): HighlightRange[] {
  if (indices.length === 0) return [];

  const ranges: HighlightRange[] = [];
  let start = indices[0] ?? 0;
  let end = start + 1;

  for (let index = 1; index < indices.length; index += 1) {
    const current = indices[index] ?? end;
    if (current === end) {
      end += 1;
      continue;
    }

    ranges.push({ start, end });
    start = current;
    end = current + 1;
  }

  ranges.push({ start, end });
  return ranges;
}

function scoreCandidate(text: string, query: string): CandidateMatch | null {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const indices: number[] = [];
  let needleIndex = 0;

  for (let haystackIndex = 0; haystackIndex < haystack.length && needleIndex < needle.length; haystackIndex += 1) {
    if (haystack[haystackIndex] !== needle[needleIndex]) continue;

    indices.push(haystackIndex);
    needleIndex += 1;
  }

  if (needleIndex !== needle.length) return null;

  const first = indices[0] ?? 0;
  let score = 120 - first * 2 + needle.length * 12;

  for (let index = 0; index < indices.length; index += 1) {
    const current = indices[index] ?? 0;
    const previous = indices[index - 1];

    if (isWordBoundary(text, current)) score += 12;
    if (previous !== undefined) {
      const gap = current - previous;
      score += gap === 1 ? 18 : Math.max(0, 10 - gap);
    }
  }

  const substringIndex = haystack.indexOf(needle);
  if (substringIndex >= 0) score += 70 - substringIndex;
  if (haystack.startsWith(needle)) score += 45;

  return { score, indices };
}

export function fuzzyMatch(query: string, title: string, keywords: readonly string[] = []): FuzzyMatch | null {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return { score: 0, ranges: [] };

  const titleMatch = scoreCandidate(title, normalized);
  let best: FuzzyMatch | null = titleMatch
    ? { score: titleMatch.score, ranges: compactRanges(titleMatch.indices) }
    : null;

  for (const keyword of keywords) {
    const keywordMatch = scoreCandidate(keyword, normalized);
    if (!keywordMatch) continue;

    const candidate = { score: keywordMatch.score - 38, ranges: [] };
    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getTitle: (item: T) => string,
  getKeywords: (item: T) => readonly string[] | undefined,
): FuzzyResult<T>[] {
  const normalized = query.trim();

  return items
    .map((item, index) => {
      const match = fuzzyMatch(normalized, getTitle(item), getKeywords(item) ?? []);
      if (!match) return null;
      return { item, score: match.score - index * 0.001, ranges: match.ranges };
    })
    .filter((result): result is FuzzyResult<T> => result !== null)
    .sort((a, b) => b.score - a.score);
}
