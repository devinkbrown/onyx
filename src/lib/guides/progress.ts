// SPDX-License-Identifier: AGPL-3.0-or-later

export const GUIDE_PROGRESS_STORAGE_KEY = 'onyx:guides-progress-v1';

export type GuideProgressSummary = {
  complete: number;
  total: number;
  nextId: string | null;
  done: boolean;
};

function allowedProgressIds(
  ids: readonly string[],
  completed: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => completed.has(id));
}

export function guideProgressSummary(
  ids: readonly string[],
  completed: ReadonlySet<string>,
): GuideProgressSummary {
  const allowed = allowedProgressIds(ids, completed);
  return {
    complete: allowed.length,
    total: ids.length,
    nextId: ids.find((id) => !completed.has(id)) ?? null,
    done: allowed.length === ids.length,
  };
}

export function readGuideProgress(
  storage: Pick<Storage, 'getItem'>,
  ids: readonly string[],
): Set<string> {
  try {
    const raw = storage.getItem(GUIDE_PROGRESS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    const allowed = new Set(ids);
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && allowed.has(id)));
  } catch {
    return new Set();
  }
}

export function writeGuideProgress(
  storage: Pick<Storage, 'setItem'>,
  ids: readonly string[],
  completed: ReadonlySet<string>,
): void {
  try {
    storage.setItem(GUIDE_PROGRESS_STORAGE_KEY, JSON.stringify(allowedProgressIds(ids, completed)));
  } catch {
    // The guide remains usable if private browsing or quota policy blocks storage.
  }
}
