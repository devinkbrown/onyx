// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * outboxFlushDecision.ts — pure terminal decision for offline outbox flush.
 *
 * flushOutbox walks durable rows and tallies sent / expired / waiting /
 * pruneFailed. The *end* of that walk must not treat a transient connection
 * drop as a permanent delivery failure: reconnect's 001 already re-arms the
 * retry budget and re-flushes. This helper isolates that classification so
 * store code and tests share one truth.
 */

/** Auto-retry attempts after the first flush on a connection. */
export const OUTBOX_AUTO_RETRY_LIMIT = 5;
/** Delay between auto-retry flushes while still connected. */
export const OUTBOX_AUTO_RETRY_DELAY_MS = 4000;

export type OutboxFlushTerminalInput = {
  /** Rows still durable after this flush (join wait, admission fail, prune stuck, drop). */
  waiting: number;
  /** Subset of waiting that is storage-prune failure after wire admission. */
  pruneFailed: number;
  /** Auto-retries already used on this connection (`_outboxRetries`). */
  retriesUsed: number;
  maxAutoRetries?: number;
  retryDelayMs?: number;
  /**
   * Live connection at the *end* of the flush. When false, remaining work is
   * offline queue — not a terminal delivery failure.
   */
  connected: boolean;
};

export type OutboxFlushTerminalDecision =
  | { action: 'clear-failed' }
  | { action: 'defer' }
  | { action: 'schedule-retry'; nextRetries: number; delayMs: number }
  | { action: 'mark-failed'; deliveryWaiting: number };

/**
 * Classify how flushOutbox should finish after walking the durable queue.
 *
 * - No waiting rows → clear sticky failure chrome.
 * - Still waiting but no longer connected → defer (do not burn budget / fail).
 * - Connected + budget remaining → schedule another auto-retry.
 * - Connected + budget exhausted → mark delivery failed for composer/Home.
 */
export function decideOutboxFlushTerminal(
  input: OutboxFlushTerminalInput,
): OutboxFlushTerminalDecision {
  const waiting = Math.max(0, Math.floor(input.waiting));
  const pruneFailed = Math.max(0, Math.floor(input.pruneFailed));
  const retriesUsed = Math.max(0, Math.floor(input.retriesUsed));
  const maxAutoRetries = Math.max(
    0,
    Math.floor(input.maxAutoRetries ?? OUTBOX_AUTO_RETRY_LIMIT),
  );
  const delayMs = Math.max(
    0,
    Math.floor(input.retryDelayMs ?? OUTBOX_AUTO_RETRY_DELAY_MS),
  );

  if (waiting <= 0) return { action: 'clear-failed' };

  // Transient drop / reconnect in flight: keep durable rows, leave chrome in
  // the offline "will send on reconnect" path, and do not consume auto-retry
  // budget (reconnect 001 resets it and flushes again).
  if (!input.connected) return { action: 'defer' };

  if (retriesUsed < maxAutoRetries) {
    return {
      action: 'schedule-retry',
      nextRetries: retriesUsed + 1,
      delayMs,
    };
  }

  return {
    action: 'mark-failed',
    deliveryWaiting: Math.max(0, waiting - pruneFailed),
  };
}
