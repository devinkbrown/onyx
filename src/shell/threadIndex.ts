// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * threadIndex.ts — pure "does this message have replies?" index for the log.
 *
 * A thread indicator is shown on any message that at least one other message
 * replies to. Computing that per rendered row with `messages.some(...)` is an
 * O(rows × total) scan — on a large channel every new frame re-scans the whole
 * buffer for every visible row, which is quadratic and janks scroll.
 *
 * Instead we take ONE O(total) pass to collect the set of parent ids that have
 * replies, then each row answers in O(1) via `Set.has`. Pure and side-effect
 * free so the math is unit-testable in isolation from SolidJS/DOM.
 */

/** Minimal shape needed to index reply relationships. */
export interface ReplyLike {
  readonly replyTo?: { readonly id: string } | undefined;
}

/**
 * Collect the ids of messages that are the target of at least one reply.
 * A message `m` contributes `m.replyTo.id` (the parent it replies to).
 */
export function threadParentIds(messages: readonly ReplyLike[]): ReadonlySet<string> {
  const parents = new Set<string>();
  for (const m of messages) {
    const parentId = m.replyTo?.id;
    if (parentId) parents.add(parentId);
  }
  return parents;
}
