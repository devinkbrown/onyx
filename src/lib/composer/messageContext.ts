// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * messageContext.ts — pure helpers for composer reply/edit context.
 *
 * Reply and edit banners must only arm against the conversation they came
 * from. A global `replyingTo` / `editingMessage` pointer is fine for state,
 * but the active target is the gate: a reply armed in #ops must never tag a
 * send into #general, and an edit for one room must not load into another.
 */

import type { ChatMessage } from '@/lib/irc/types';

/** True when a message context belongs to the active composer target. */
export function messageContextMatchesTarget(
  msg: Pick<ChatMessage, 'target'> | null | undefined,
  target: string | null | undefined,
): boolean {
  if (!msg || !target) return false;
  return msg.target.toLowerCase() === target.toLowerCase();
}

/**
 * Return the armed reply only when it targets the conversation being sent to.
 * Fail closed: a mismatched or missing target yields null (no reply tag).
 */
export function activeReplyForTarget(
  replyingTo: ChatMessage | null | undefined,
  target: string | null | undefined,
): ChatMessage | null {
  if (!replyingTo || !messageContextMatchesTarget(replyingTo, target)) return null;
  return replyingTo;
}
