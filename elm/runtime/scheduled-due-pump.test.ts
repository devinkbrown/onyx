import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduledDuePump, selectDueScheduledRows } from './scheduled-due-pump';

describe('scheduled due pump', () => {
  afterEach(() => vi.useRealTimers());

  it('runs due queue and guarded flush work on cadence, then stops on retirement', async () => {
    vi.useFakeTimers();
    const queue = vi.fn(async () => 'accepted' as const);
    const flush = vi.fn(async () => 'transport-admitted' as const);
    const dispatchDue = async () => {
      const rows = selectDueScheduledRows([
        { scheduleRef: 'sched-1712345678901-1', revision: 1, conversationId: '#room', state: 'scheduled', dueAtMs: Date.now() - 1 },
        { scheduleRef: 'sched-1712345678901-2', revision: 1, conversationId: '#room', state: 'delivery-unknown', dueAtMs: 0 },
      ], Date.now());
      for (const row of rows) {
        expect(row.scheduleRef).toBe('sched-1712345678901-1');
        if (await queue() === 'accepted') await flush();
      }
    };
    const pump = createScheduledDuePump({ runDue: dispatchDue });
    pump.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    pump.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a slow dispatch tick', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const runDue = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const pump = createScheduledDuePump({ runDue });
    pump.start();
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runDue).toHaveBeenCalledTimes(1);
    finish();
    await vi.runOnlyPendingTimersAsync();
    expect(runDue).toHaveBeenCalledTimes(2);
    pump.dispose();
  });
});
