// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dispatch.ts — pure decision for the scheduled-message ("send later") queue.
 *
 * The store models a queue of `{ id, channel, text, sendAt }` entries. This
 * module answers the one question the dispatcher needs, with no clock and no
 * side effects, so it is exhaustively unit-testable: given the queue, the
 * current time, and whether we can reach the server right now, which entries
 * are DUE (send + drop) and which stay PENDING?
 *
 * Invariants encoded here:
 *  - Offline ⇒ NOTHING is due. Past-due entries stay pending until reconnect,
 *    so a message written while offline is never dropped.
 *  - `now` is injected — the caller passes Date.now() (or a fixed test clock).
 *  - Inputs are never mutated; both output arrays are fresh.
 */

export interface ScheduledMessage {
  readonly id: string;
  readonly channel: string;
  readonly text: string;
  /** Epoch milliseconds at which the message should be sent. */
  readonly sendAt: number;
}

export interface DispatchDecision {
  /** Entries whose time has come — send now, then remove from the queue. */
  readonly due: ScheduledMessage[];
  /** Entries to keep queued (future, or all of them while offline). */
  readonly pending: ScheduledMessage[];
}

/**
 * Split the queue into due-now vs still-pending.
 *
 * @param messages  the current queue (never mutated)
 * @param now       epoch ms to compare `sendAt` against (inject Date.now())
 * @param connected whether the client is connected AND ready to send
 */
export function selectDueMessages(
  messages: readonly ScheduledMessage[],
  now: number,
  connected: boolean,
): DispatchDecision {
  // Offline: hold everything. Never let a past-due entry be dropped just
  // because we happened to tick while disconnected.
  if (!connected) return { due: [], pending: [...messages] };

  const due: ScheduledMessage[] = [];
  const pending: ScheduledMessage[] = [];
  for (const m of messages) {
    if (m.sendAt <= now) due.push(m);
    else pending.push(m);
  }
  return { due, pending };
}
