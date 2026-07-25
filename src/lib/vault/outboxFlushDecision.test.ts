// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  OUTBOX_AUTO_RETRY_DELAY_MS,
  OUTBOX_AUTO_RETRY_LIMIT,
  decideOutboxFlushTerminal,
} from './outboxFlushDecision';

describe('decideOutboxFlushTerminal', () => {
  it('clears sticky failure when nothing remains waiting', () => {
    expect(decideOutboxFlushTerminal({
      waiting: 0,
      pruneFailed: 0,
      retriesUsed: 5,
      connected: true,
    })).toEqual({ action: 'clear-failed' });
  });

  it('defers on connection drop even when the auto-retry budget is exhausted', () => {
    // Residual false-positive: a mid-flush drop used to mark deliveryFailed
    // once retriesUsed >= limit. Offline queue must not look like a permanent
    // send failure — reconnect re-arms the budget and flushes again.
    expect(decideOutboxFlushTerminal({
      waiting: 2,
      pruneFailed: 0,
      retriesUsed: OUTBOX_AUTO_RETRY_LIMIT,
      connected: false,
    })).toEqual({ action: 'defer' });
  });

  it('defers on drop without burning a retry slot', () => {
    expect(decideOutboxFlushTerminal({
      waiting: 1,
      pruneFailed: 0,
      retriesUsed: 0,
      connected: false,
    })).toEqual({ action: 'defer' });
  });

  it('schedules an auto-retry while still connected and under budget', () => {
    expect(decideOutboxFlushTerminal({
      waiting: 1,
      pruneFailed: 0,
      retriesUsed: 2,
      connected: true,
    })).toEqual({
      action: 'schedule-retry',
      nextRetries: 3,
      delayMs: OUTBOX_AUTO_RETRY_DELAY_MS,
    });
  });

  it('marks delivery failed only when connected and the budget is exhausted', () => {
    expect(decideOutboxFlushTerminal({
      waiting: 3,
      pruneFailed: 1,
      retriesUsed: OUTBOX_AUTO_RETRY_LIMIT,
      connected: true,
    })).toEqual({
      action: 'mark-failed',
      deliveryWaiting: 2,
    });
  });

  it('never reports negative deliveryWaiting when pruneFailed exceeds waiting', () => {
    expect(decideOutboxFlushTerminal({
      waiting: 1,
      pruneFailed: 4,
      retriesUsed: OUTBOX_AUTO_RETRY_LIMIT,
      connected: true,
    })).toEqual({
      action: 'mark-failed',
      deliveryWaiting: 0,
    });
  });

  it('floors fractional counters and honors custom limits', () => {
    expect(decideOutboxFlushTerminal({
      waiting: 1.9,
      pruneFailed: 0.4,
      retriesUsed: 0.8,
      maxAutoRetries: 1,
      retryDelayMs: 100,
      connected: true,
    })).toEqual({
      action: 'schedule-retry',
      nextRetries: 1,
      delayMs: 100,
    });
  });
});
