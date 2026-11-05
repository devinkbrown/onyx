export interface ScheduledDuePumpDependencies {
  readonly runDue: () => Promise<void>;
  readonly intervalMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface DueScheduledMetadata {
  readonly scheduleRef: string;
  readonly revision: number | null;
  readonly conversationId: string | null;
  readonly dueAtMs: number | null;
  readonly state: string;
}

export function selectDueScheduledRows<T extends DueScheduledMetadata>(rows: readonly T[], nowMs: number, maximum = 4): T[] {
  return rows.filter(row => row.state === 'scheduled' && row.dueAtMs !== null && row.dueAtMs <= nowMs
    && /^[A-Za-z0-9_-]{1,96}$/u.test(row.scheduleRef) && row.revision !== null && row.revision >= 1
    && row.conversationId !== null).slice(0, maximum);
}

/** A single-flight, retireable cadence for private scheduled dispatch work. */
export function createScheduledDuePump(deps: ScheduledDuePumpDependencies) {
  const delay = deps.intervalMs ?? 15_000;
  const setTimer = deps.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? (timer => globalThis.clearTimeout(timer));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let running: number | null = null;
  let disposed = false;

  const schedule = (): void => {
    if (disposed || timer !== null) return;
    const current = ++generation;
    timer = setTimer(() => {
      timer = null;
      if (disposed || current !== generation) return;
      if (running !== null) { schedule(); return; }
      running = current;
      void Promise.resolve().then(deps.runDue).catch(() => undefined).finally(() => {
        if (running === current) running = null;
        if (!disposed && generation === current) schedule();
      });
    }, delay);
  };

  return {
    start(): void { schedule(); },
    stop(): void {
      generation += 1;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    dispose(): void { this.stop(); disposed = true; },
  };
}
