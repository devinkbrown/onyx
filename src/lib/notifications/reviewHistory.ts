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

export function readReviewHistory(): ReviewHistoryEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(REVIEW_HISTORY_KEY);
    const parsed = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isReviewHistoryEntry)
      .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
      .slice(0, REVIEW_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function recordReviewHistory(entry: ReviewHistoryEntry): ReviewHistoryEntry[] {
  const store = storage();
  if (!store) return [entry];

  const key = `${entry.kind}:${entry.target.toLowerCase()}:${entry.firstMessageId}`;
  const next = [
    entry,
    ...readReviewHistory().filter((item) =>
      `${item.kind}:${item.target.toLowerCase()}:${item.firstMessageId}` !== key,
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
