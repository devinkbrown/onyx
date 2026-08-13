// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Serialized, authenticated E2EEKEY LIST snapshot broker.  IRC framing and
 * prefix authentication stay with the caller; this broker admits only a
 * caller-labelled server reply body for the active connection generation.
 */
import {
  GroupDeviceDirectoryCollector,
  parseGroupDeviceDirectorySnapshotLine,
  type GroupDeviceDirectorySnapshot,
} from './groupDeviceDirectory';

export const GROUP_DIRECTORY_MAX_QUEUED_ACCOUNTS = 64;
export const GROUP_DIRECTORY_MAX_CACHED_ACCOUNTS = 64;
export const GROUP_DIRECTORY_TIMEOUT_MS = 8_000;
export const GROUP_DIRECTORY_CACHE_TTL_MS = 30_000;
/** Same-account callers share one wire request, but never an unbounded promise chain. */
export const GROUP_DIRECTORY_MAX_WAITERS_PER_ACCOUNT = 64;

export type GroupDirectoryBrokerResult =
  | { ok: true; snapshot: GroupDeviceDirectorySnapshot }
  | { ok: false; reason: 'invalid-account' | 'capacity' | 'timeout' | 'aborted' | 'stale-generation' | 'incomplete' | 'transport' };

export type GroupDirectoryBrokerDependencies = Readonly<{
  sendList: (account: string) => boolean | void | Promise<boolean | void>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}>;

type Waiter = { resolve: (result: GroupDirectoryBrokerResult) => void; signal?: AbortSignal; abort?: () => void };
type Pending = { account: string; generation: number; collector: GroupDeviceDirectoryCollector; waiters: Map<number, Waiter>; nextWaiter: number; timer?: ReturnType<typeof setTimeout>; draining: boolean };
type CacheEntry = { snapshot: GroupDeviceDirectorySnapshot; expires: number };
const ACCOUNT = /^[A-Za-z0-9_.@-]{1,64}$/u;
function accountKey(account: string): string | null { const normalized = account.trim().toLowerCase(); return ACCOUNT.test(normalized) ? normalized : null; }

/** Exact server command parameters. The IRC client owns CRLF framing and the
 * authenticated NOTICE/FAIL dispatch; this helper deliberately does neither. */
export function groupDirectoryListParameters(account: string): readonly ['LIST', string] | null {
  const normalized = accountKey(account);
  return normalized ? ['LIST', normalized] : null;
}

export class GroupDirectoryBroker {
  private generation = 0;
  private readonly pendingByAccount = new Map<string, Pending>();
  private readonly queue: Pending[] = [];
  private active: Pending | null = null;
  /** Prevent `finish`-style dispatch while a generation transition retires the
   * entire old admission set. JavaScript is single-threaded, but promises and
   * waiter resolution can synchronously queue more work. */
  private transitioning = false;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly setTimer: NonNullable<GroupDirectoryBrokerDependencies['setTimer']>;
  private readonly clearTimer: NonNullable<GroupDirectoryBrokerDependencies['clearTimer']>;

  constructor(private readonly dependencies: GroupDirectoryBrokerDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
  }

  request(account: string, signal?: AbortSignal): Promise<GroupDirectoryBrokerResult> {
    const key = accountKey(account);
    if (!key) return Promise.resolve({ ok: false, reason: 'invalid-account' });
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return Promise.resolve({ ok: true, snapshot: cached.snapshot });
    if (cached) this.cache.delete(key);
    if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'aborted' });
    const existing = this.pendingByAccount.get(key);
    if (existing) return this.addWaiter(existing, signal);
    if (this.pendingByAccount.size >= GROUP_DIRECTORY_MAX_QUEUED_ACCOUNTS) return Promise.resolve({ ok: false, reason: 'capacity' });
    const pending: Pending = { account: key, generation: this.generation, collector: new GroupDeviceDirectoryCollector(), waiters: new Map(), nextWaiter: 0, draining: false };
    this.pendingByAccount.set(key, pending); this.queue.push(pending);
    const promise = this.addWaiter(pending, signal);
    this.startNext();
    return promise;
  }

  /** Advance on reconnect/account switch. Old replies can never complete a new request. */
  resetGeneration(): void {
    this.invalidateGeneration();
  }

  /** Only the authenticated IRC reply dispatcher may call this. NOTICE text is never accepted. */
  observeServerReply(generation: number, body: string): boolean {
    const pending = this.active;
    if (!pending || pending.generation !== generation || generation !== this.generation) return false;
    if (pending.draining) {
      // Cancellation cannot unsend a serialized LIST.  Drain exclusively until
      // its authenticated END so the old account's late DEVICE records never
      // become a replacement request's snapshot.
      const line = parseGroupDeviceDirectorySnapshotLine(body);
      if (line?.kind === 'end' && line.account.toLowerCase() === pending.account) this.releaseDrain(pending);
      return line !== null;
    }
    if (!pending.collector.accept(body)) { this.finish(pending, { ok: false, reason: 'incomplete' }); return false; }
    if (!pending.collector.isComplete) return true;
    void pending.collector.complete().then((snapshot) => {
      if (this.active !== pending || !this.isCurrent(pending) || pending.generation !== this.generation) return;
      if (!snapshot || snapshot.account.toLowerCase() !== pending.account) this.finish(pending, { ok: false, reason: 'incomplete' });
      else { this.putCache(pending.account, snapshot); this.finish(pending, { ok: true, snapshot }); }
    });
    return true;
  }

  private startNext(): void {
    if (this.transitioning || this.active) return;
    const next = this.queue.shift(); if (!next) return;
    if (!this.isCurrent(next) || next.waiters.size === 0) { this.startNext(); return; }
    this.active = next;
    next.timer = this.setTimer(() => this.desyncFrom(next, 'timeout'), GROUP_DIRECTORY_TIMEOUT_MS);
    void Promise.resolve(this.dependencies.sendList(next.account)).then((sent) => { if (sent === false && this.active === next && this.isCurrent(next)) this.finish(next, { ok: false, reason: 'transport' }); }).catch(() => { if (this.active === next && this.isCurrent(next)) this.finish(next, { ok: false, reason: 'transport' }); });
  }

  private addWaiter(pending: Pending, signal?: AbortSignal): Promise<GroupDirectoryBrokerResult> {
    if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'aborted' });
    if (pending.waiters.size >= GROUP_DIRECTORY_MAX_WAITERS_PER_ACCOUNT) return Promise.resolve({ ok: false, reason: 'capacity' });
    return new Promise((resolve) => {
      const id = pending.nextWaiter++;
      const waiter: Waiter = { resolve, signal };
      const abort = () => {
        if (!pending.waiters.delete(id)) return;
        signal?.removeEventListener('abort', abort);
        resolve({ ok: false, reason: 'aborted' });
        // A cancelled last waiter cannot observe an in-flight reply. Retire the
        // slot; any late response is ignored because `active` no longer matches.
        if (pending.waiters.size === 0) this.retire(pending);
      };
      waiter.abort = abort;
      pending.waiters.set(id, waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private putCache(account: string, snapshot: GroupDeviceDirectorySnapshot): void {
    if (!this.cache.has(account) && this.cache.size >= GROUP_DIRECTORY_MAX_CACHED_ACCOUNTS) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(account, { snapshot, expires: this.now() + GROUP_DIRECTORY_CACHE_TTL_MS });
  }
  private finish(pending: Pending, result: GroupDirectoryBrokerResult): void {
    if (!this.isCurrent(pending)) return;
    this.pendingByAccount.delete(pending.account);
    if (pending.timer) this.clearTimer(pending.timer);
    if (this.active === pending) this.active = null;
    for (const waiter of pending.waiters.values()) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.resolve(result);
    }
    pending.waiters.clear(); this.startNext();
  }
  private retire(pending: Pending): void {
    if (!this.isCurrent(pending)) return;
    this.pendingByAccount.delete(pending.account);
    if (this.active === pending) {
      // Keep the physical serialized slot occupied. Any old reply must be
      // consumed before a same-account replacement can be issued.
      pending.draining = true;
      return;
    }
    this.startNext();
  }
  private isCurrent(pending: Pending): boolean { return this.pendingByAccount.get(pending.account) === pending; }
  private releaseDrain(pending: Pending): void {
    if (this.active !== pending || !pending.draining) return;
    if (pending.timer) this.clearTimer(pending.timer);
    this.active = null; this.startNext();
  }
  private desyncFrom(pending: Pending, reason: 'timeout'): void {
    // Without END there is no safe reply boundary.  Advance the generation and
    // fail all live waiters rather than allowing a late old reply to be framed
    // as a newer request.
    // A drained cancelled slot intentionally no longer owns the account map;
    // it still owns the physical wire slot and its timeout must invalidate the
    // replacement waiting behind it.
    if (this.active !== pending) return;
    this.invalidateGeneration(pending, reason);
  }
  /** Atomically remove all old-generation admission before resolving any
   * waiter. Crucially this never calls `startNext` per old item. */
  private invalidateGeneration(timeoutPending?: Pending, timeoutReason: 'timeout' = 'timeout'): void {
    this.transitioning = true;
    this.generation += 1;
    const retired = [...this.pendingByAccount.values()];
    this.pendingByAccount.clear();
    this.queue.length = 0;
    this.active = null;
    for (const pending of retired) {
      if (pending.timer) this.clearTimer(pending.timer);
      const result: GroupDirectoryBrokerResult = pending === timeoutPending
        ? { ok: false, reason: timeoutReason }
        : { ok: false, reason: 'stale-generation' };
      this.resolveWaiters(pending, result);
    }
    this.cache.clear();
    this.transitioning = false;
    this.startNext();
  }
  private resolveWaiters(pending: Pending, result: GroupDirectoryBrokerResult): void {
    for (const waiter of pending.waiters.values()) {
      if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.resolve(result);
    }
    pending.waiters.clear();
  }
}
