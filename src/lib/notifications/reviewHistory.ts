export type ReviewHistoryKind = 'channel' | 'dm';

export interface ReviewHistoryEntry {
  target: string;
  name: string;
  kind: ReviewHistoryKind;
  firstMessageId: string;
  firstAt: string;
  reviewedAt: string;
  messageCount: number;
  mentionCount: number;
  preview: string;
}

export const REVIEW_HISTORY_KEY = 'onyx:home-review-history';
const REVIEW_HISTORY_LIMIT = 5;

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function isReviewHistoryEntry(value: unknown): value is ReviewHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.target === 'string'
    && typeof item.name === 'string'
    && (item.kind === 'channel' || item.kind === 'dm')
    && typeof item.firstMessageId === 'string'
    && typeof item.firstAt === 'string'
    && typeof item.reviewedAt === 'string'
    && typeof item.messageCount === 'number'
    && typeof item.mentionCount === 'number'
    && typeof item.preview === 'string';
}

function reviewHistoryKey(entry: ReviewHistoryEntry): string {
  return `${entry.kind}:${entry.target.toLowerCase()}:${entry.firstMessageId}`;
}

export function parseReviewHistoryEntries(value: unknown): ReviewHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isReviewHistoryEntry)
    .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    .slice(0, REVIEW_HISTORY_LIMIT);
}

export function readReviewHistory(): ReviewHistoryEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(REVIEW_HISTORY_KEY);
    const parsed = JSON.parse(raw ?? '[]');
    return parseReviewHistoryEntries(parsed);
  } catch {
    return [];
  }
}

export function latestReviewForTarget(
  target: string,
  kind?: ReviewHistoryKind,
): ReviewHistoryEntry | null {
  const key = target.toLowerCase();
  return readReviewHistory().find((entry) =>
    entry.target.toLowerCase() === key && (kind === undefined || entry.kind === kind),
  ) ?? null;
}

export function recordReviewHistory(entry: ReviewHistoryEntry): ReviewHistoryEntry[] {
  const store = storage();
  if (!store) return [entry];

  const key = reviewHistoryKey(entry);
  const next = [
    entry,
    ...readReviewHistory().filter((item) =>
      reviewHistoryKey(item) !== key,
    ),
  ]
    .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    .slice(0, REVIEW_HISTORY_LIMIT);

  try {
    store.setItem(REVIEW_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or disabled; keep the in-memory result for this render.
  }
  return next;
}

export function mergeReviewHistory(entries: readonly unknown[]): { imported: number; total: number } {
  const imported = parseReviewHistoryEntries(entries);
  const store = storage();
  if (!store) return { imported: imported.length, total: imported.length };

  const byKey = new Map<string, ReviewHistoryEntry>();
  for (const entry of [...readReviewHistory(), ...imported]) {
    const key = reviewHistoryKey(entry);
    const current = byKey.get(key);
    if (!current || Date.parse(entry.reviewedAt) > Date.parse(current.reviewedAt)) {
      byKey.set(key, entry);
    }
  }
  const next = [...byKey.values()]
    .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    .slice(0, REVIEW_HISTORY_LIMIT);

  try {
    store.setItem(REVIEW_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or disabled; report the in-memory merge.
  }
  return { imported: imported.length, total: next.length };
}
