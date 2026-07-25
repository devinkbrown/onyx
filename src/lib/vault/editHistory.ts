// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * editHistory.ts — local vault of message edit revisions (client-side).
 *
 * Stores prior plaintext bodies when a message is edited so the user can
 * audit local history. Never ships ciphertext as "plaintext" revisions.
 */

export const MAX_EDIT_REVISIONS_PER_MESSAGE = 12;
export const MAX_EDIT_HISTORY_MESSAGES = 500;
export const MAX_EDIT_BODY_LEN = 8192;

export type EditRevision = {
  body: string;
  editedAt: number;
};

export type EditHistoryMap = Record<string, EditRevision[]>;

export function recordEdit(
  history: EditHistoryMap,
  messageId: string,
  previousBody: string,
  editedAt = Date.now(),
): EditHistoryMap {
  const id = messageId.trim();
  const body = previousBody.slice(0, MAX_EDIT_BODY_LEN);
  if (!id || !body) return history;

  const existing = history[id] ?? [];
  const nextRevs = [...existing, { body, editedAt }].slice(-MAX_EDIT_REVISIONS_PER_MESSAGE);
  const next: EditHistoryMap = { ...history, [id]: nextRevs };

  const keys = Object.keys(next);
  if (keys.length <= MAX_EDIT_HISTORY_MESSAGES) return next;

  // Drop oldest message keys by first revision timestamp.
  const ranked = keys
    .map((key) => ({ key, at: next[key]?.[0]?.editedAt ?? 0 }))
    .sort((a, b) => a.at - b.at);
  const drop = ranked.slice(0, keys.length - MAX_EDIT_HISTORY_MESSAGES);
  const pruned = { ...next };
  for (const row of drop) delete pruned[row.key];
  return pruned;
}

export function revisionsFor(history: EditHistoryMap, messageId: string): EditRevision[] {
  return history[messageId.trim()] ?? [];
}
