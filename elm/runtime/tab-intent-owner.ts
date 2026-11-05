// SPDX-License-Identifier: AGPL-3.0-or-later
import type { NetworkId } from './contracts';

declare const tabIntentBrand: unique symbol;
declare const tabLeaseBrand: unique symbol;
export type TabIntentRef = string & { readonly [tabIntentBrand]: true };
export type TabIntentLeaseId = string & { readonly [tabLeaseBrand]: true };

export interface SavedTabIntentMetadata {
  readonly intentRef: TabIntentRef;
  readonly networkId: NetworkId;
  readonly createdAtMs: number;
  readonly state: 'fresh' | 'restore-required' | 'retired';
}
export type TabIntentResult =
  | { readonly kind: 'created' | 'restorable' | 'acquired'; readonly intentRef: TabIntentRef; readonly leaseId?: TabIntentLeaseId }
  | { readonly kind: 'busy' | 'blocked' | 'stale' | 'unavailable'; readonly intentRef: TabIntentRef | null; readonly reason: 'intent-busy' | 'explicit-restore-required' | 'lease-lost' | 'storage-unavailable' | 'invalid-intent' | 'randomness-unavailable' };
export type IntentOperationOutcome = 'definitively-unadmitted' | 'accepted' | 'unknown';
export interface TabIntentAuthorityLost { readonly networkId: NetworkId; readonly intentRef: TabIntentRef; readonly leaseId: TabIntentLeaseId; readonly reason: 'pagehide' | 'freeze' | 'lease-expired' | 'lease-replaced' | 'storage-failure' | 'retired' }

interface IntentRow extends SavedTabIntentMetadata {
  readonly schemaVersion: 1;
  readonly holderNonce: string | null;
  readonly leaseNonce: string | null;
  readonly leaseUntilMs: number | null;
  readonly operationStarted: boolean;
}
interface LeaseRecord { readonly intentRef: TabIntentRef; readonly leaseId: TabIntentLeaseId; releaseLock: (() => void) | null; readonly lockHold: Promise<void> | null; timer: ReturnType<typeof setInterval> | null; leaseUntilMs: number; released: boolean }
interface LockManagerLike { request<T>(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown | null) => Promise<T>): Promise<T> }

const DB_NAME = 'onyx-tab-intents';
const DB_VERSION = 1;
const STORE = 'intents';
const HEARTBEAT_MS = 4_000;
const LEASE_MS = 15_000;

function randomToken(bytes = 24): string | null {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) return null;
  const data = new Uint8Array(bytes); crypto.getRandomValues(data);
  return [...data].map(value => value.toString(16).padStart(2, '0')).join('');
}
function validRef(value: string): value is TabIntentRef { return /^[a-f0-9]{48}$/u.test(value); }
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb-request-failed'));
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('indexeddb-transaction-failed'));
  });
}

/**
 * Per-document, per-network intent ownership. This service stores only opaque
 * IDs and liveness metadata; credential material is never read or returned.
 */
export function createTabIntentOwner(deps: {
  readonly networkId: NetworkId;
  readonly storage?: Storage | null;
  readonly locks?: LockManagerLike | null;
  readonly indexedDB?: IDBFactory | null;
  readonly lifecycle?: EventTarget | null;
  readonly now?: () => number;
  readonly onAuthorityLost?: (event: TabIntentAuthorityLost) => void;
}): {
  createFreshIntent(explicitUserAction: true): Promise<TabIntentResult>;
  listSavedIntentMetadata(): Promise<readonly SavedTabIntentMetadata[]>;
  requestExplicitRestore(intentRef: string): Promise<TabIntentResult>;
  acquire(intentRef: string): Promise<TabIntentResult>;
  assertCurrentLease(intentRef: string): boolean;
  markOperationStarted(intentRef: string): Promise<boolean>;
  settleOperation(intentRef: string, outcome: IntentOperationOutcome): Promise<boolean>;
  retire(intentRef: string): Promise<void>;
  dispose(): void;
} {
  const dbFactory = deps.indexedDB ?? (typeof indexedDB === 'undefined' ? null : indexedDB);
  const locks = deps.locks ?? (typeof navigator !== 'undefined' ? (navigator.locks as unknown as LockManagerLike | undefined) ?? null : null);
  let storage: Storage | null = deps.storage ?? null;
  if (deps.storage === undefined) { try { storage = typeof localStorage === 'undefined' ? null : localStorage; } catch { storage = null; } }
  const lifecycle = deps.lifecycle === undefined ? (typeof window === 'undefined' ? null : window) : deps.lifecycle;
  const now = deps.now ?? (() => Date.now());
  const documentNonce = randomToken();
  const records = new Map<TabIntentRef, LeaseRecord>();
  const restoreApproved = new Set<TabIntentRef>();
  let disposed = false;
  let active = true;
  let lifecycleGeneration = 0;
  const suspended = new Map<TabIntentRef, boolean>();
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> => {
    if (!dbFactory) return Promise.reject(new Error('storage-unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, database?: IDBDatabase) => {
        if (settled) { database?.close(); return; }
        settled = true; clearTimeout(deadline);
        if (error) reject(error); else if (database) resolve(database); else reject(new Error('storage-unavailable'));
      };
      const deadline = setTimeout(() => finish(new Error('storage-timeout')), 5_000);
      const open = dbFactory.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'intentRef' }); };
      open.onsuccess = () => {
        const database = open.result;
        if (disposed) { database.close(); finish(new Error('storage-unavailable')); return; }
        database.onversionchange = () => { database.close(); if (dbPromise) dbPromise = null; };
        finish(undefined, database);
      };
      open.onerror = () => finish(open.error ?? new Error('storage-unavailable'));
      open.onblocked = () => finish(new Error('storage-unavailable'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise!;
  };
  const readAll = async (): Promise<IntentRow[]> => {
    const db = await openDb(); const tx = db.transaction(STORE, 'readonly');
    const [values] = await Promise.all([request(tx.objectStore(STORE).getAll() as IDBRequest<IntentRow[]>), transactionDone(tx)]);
    return values.filter(row => row.schemaVersion === 1 && row.networkId === deps.networkId && validRef(row.intentRef));
  };
  const mutateRow = async (intentRef: TabIntentRef, mutate: (row: IntentRow | undefined) => IntentRow | undefined): Promise<IntentRow | undefined> => {
    const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
    const currentRow = await request(store.get(intentRef) as IDBRequest<IntentRow | undefined>);
    const next = mutate(currentRow);
    if (next) store.put(next); else store.delete(intentRef);
    await transactionDone(tx);
    return next;
  };
  const persistMetadata = (row: IntentRow) => {
    if (!storage) return;
    try {
      const key = `onyx:intent:${deps.networkId}:${row.intentRef}`;
      storage.setItem(key, JSON.stringify({ schemaVersion: 1, intentRef: row.intentRef, networkId: row.networkId, createdAtMs: row.createdAtMs, state: row.state }));
    } catch { /* IndexedDB authority remains; storage is only a UI metadata mirror. */ }
  };
  const leaseName = (ref: TabIntentRef) => `onyx-intent:${deps.networkId}:${ref}`;
  const release = async (ref: TabIntentRef, markRetired: boolean, reason: TabIntentAuthorityLost['reason'] = 'retired') => {
    const record = records.get(ref); if (!record || record.released) return;
    record.released = true;
    if (record.timer) clearInterval(record.timer);
    try { deps.onAuthorityLost?.({ networkId: deps.networkId, intentRef: ref, leaseId: record.leaseId, reason }); } catch { /* authority observers are isolated */ }
    record.releaseLock?.();
    records.delete(ref);
    try {
      await mutateRow(ref, row => {
        if (!row || row.holderNonce !== documentNonce || row.leaseNonce !== record.leaseId) return row;
        return { ...row, state: markRetired ? 'retired' : row.operationStarted ? 'restore-required' : 'fresh', holderNonce: null, leaseNonce: null, leaseUntilMs: null };
      });
      const rows = await readAll(); const row = rows.find(item => item.intentRef === ref); if (row) persistMetadata(row);
    } catch { /* losing a lease is fail-closed */ }
  };
  const retireMetadata = async (ref: TabIntentRef) => {
    try {
      const row = await mutateRow(ref, current => {
        if (!current || current.networkId !== deps.networkId) return current;
        if (current.holderNonce && current.leaseUntilMs !== null && current.leaseUntilMs > now()) return current;
        return { ...current, state: 'retired', holderNonce: null, leaseNonce: null, leaseUntilMs: null };
      });
      if (row) persistMetadata(row);
    } catch { /* metadata retirement failure cannot restore send authority */ }
  };
  const lifecycleRetire = (reason: 'pagehide' | 'freeze') => {
    if (!active) return; active = false; lifecycleGeneration++;
    for (const [ref, record] of [...records]) { suspended.set(ref, record.leaseUntilMs > now()); void release(ref, false, reason); }
  };
  const lifecycleResume = () => {
    if (disposed || active) return; active = true; lifecycleGeneration++;
    for (const [ref, wasHeld] of [...suspended]) { suspended.delete(ref); if (wasHeld) void acquire(ref); }
  };
  const onPageHide = () => lifecycleRetire('pagehide');
  const onFreeze = () => lifecycleRetire('freeze');
  lifecycle?.addEventListener('pagehide', onPageHide);
  lifecycle?.addEventListener('freeze', onFreeze);
  lifecycle?.addEventListener('pageshow', lifecycleResume);
  lifecycle?.addEventListener('resume', lifecycleResume);

  const createFreshIntent = async (_explicitUserAction: true): Promise<TabIntentResult> => {
    if (disposed || !active) return { kind: 'unavailable', intentRef: null, reason: 'storage-unavailable' };
    if (!documentNonce) return { kind: 'unavailable', intentRef: null, reason: 'randomness-unavailable' };
    const token = randomToken(); if (!token) return { kind: 'unavailable', intentRef: null, reason: 'randomness-unavailable' };
    const intentRef = token as TabIntentRef;
    const row: IntentRow = { schemaVersion: 1, intentRef, networkId: deps.networkId, createdAtMs: now(), state: 'fresh', holderNonce: null, leaseNonce: null, leaseUntilMs: null, operationStarted: false };
    const epoch = lifecycleGeneration;
    try { const stored = await mutateRow(intentRef, existing => existing ?? row); if (disposed || !active || epoch !== lifecycleGeneration) return { kind: 'unavailable', intentRef: null, reason: 'storage-unavailable' }; if (!stored) return { kind: 'unavailable', intentRef: null, reason: 'storage-unavailable' }; persistMetadata(stored); return { kind: 'created', intentRef }; }
    catch { return { kind: 'unavailable', intentRef: null, reason: 'storage-unavailable' }; }
  };
  const listSavedIntentMetadata = async (): Promise<readonly SavedTabIntentMetadata[]> => {
    if (disposed || !active) return [];
    const epoch = lifecycleGeneration;
    try { const rows = await readAll(); if (disposed || !active || epoch !== lifecycleGeneration) return []; return rows.filter(row => row.state !== 'retired').map(({ intentRef, networkId, createdAtMs, state }) => ({ intentRef, networkId, createdAtMs, state })); }
    catch { return []; }
  };
  const requestExplicitRestore = async (value: string): Promise<TabIntentResult> => {
    if (!validRef(value)) return { kind: 'stale', intentRef: null, reason: 'invalid-intent' };
    if (disposed || !active) return { kind: 'unavailable', intentRef: value as TabIntentRef, reason: 'storage-unavailable' };
    const ref = value as TabIntentRef;
    const epoch = lifecycleGeneration;
    try {
      const rows = await readAll(); const row = rows.find(item => item.intentRef === ref);
      if (disposed || !active || epoch !== lifecycleGeneration) return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' };
      if (!row || row.networkId !== deps.networkId || row.state === 'retired') return { kind: 'stale', intentRef: ref, reason: 'invalid-intent' };
      restoreApproved.add(ref);
      return { kind: 'restorable', intentRef: ref };
    } catch { return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' }; }
  };
  const acquire = async (value: string): Promise<TabIntentResult> => {
    if (disposed || !active || !documentNonce) return { kind: 'unavailable', intentRef: null, reason: documentNonce ? 'storage-unavailable' : 'randomness-unavailable' };
    if (!validRef(value)) return { kind: 'stale', intentRef: null, reason: 'invalid-intent' };
    const ref = value as TabIntentRef;
    const epoch = lifecycleGeneration;
    const existingLease = records.get(ref);
    if (existingLease) {
      if (assertCurrentLease(ref)) return { kind: 'acquired', intentRef: ref, leaseId: existingLease.leaseId };
      await release(ref, false, 'lease-expired');
      if (!active || disposed || epoch !== lifecycleGeneration) return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' };
    }
    try {
      const rows = await readAll(); const row = rows.find(item => item.intentRef === ref);
      if (disposed || !active || epoch !== lifecycleGeneration) return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' };
      if (!row || row.networkId !== deps.networkId || row.state === 'retired') return { kind: 'stale', intentRef: ref, reason: 'invalid-intent' };
      if (row.holderNonce && row.leaseUntilMs !== null && row.leaseUntilMs > now()) return { kind: 'busy', intentRef: ref, reason: 'intent-busy' };
      if (row.holderNonce && row.operationStarted && !restoreApproved.has(ref)) return { kind: 'blocked', intentRef: ref, reason: 'explicit-restore-required' };
      if (row.state === 'restore-required' && !restoreApproved.has(ref)) return { kind: 'blocked', intentRef: ref, reason: 'explicit-restore-required' };
      const leaseId = (randomToken() ?? '') as TabIntentLeaseId;
      if (!leaseId) return { kind: 'unavailable', intentRef: ref, reason: 'randomness-unavailable' };
      if (locks) {
        let ready!: (acquired: boolean) => void;
        const acquired = new Promise<boolean>(resolve => { ready = resolve; });
        let releaseLock!: () => void;
        const hold = new Promise<void>(resolve => { releaseLock = resolve; });
        const lockHold = locks.request(leaseName(ref), { mode: 'exclusive', ifAvailable: true }, async lock => {
          ready(!!lock);
          if (lock) await hold;
        }).catch(() => { ready(false); });
        let lockTimerId: ReturnType<typeof setTimeout> | null = null;
        const lockTimer = new Promise<boolean>(resolve => { lockTimerId = setTimeout(() => resolve(false), 5_000); });
        const hasLock = await Promise.race([acquired, lockTimer]);
        if (lockTimerId) clearTimeout(lockTimerId);
        if (!hasLock || disposed || !active || epoch !== lifecycleGeneration) { releaseLock(); void lockHold; return { kind: disposed || !active ? 'unavailable' : 'busy', intentRef: ref, reason: disposed || !active ? 'storage-unavailable' : 'intent-busy' }; }
        let claimed: IntentRow | undefined;
        try {
          claimed = await mutateRow(ref, current => {
            if (!current || current.networkId !== deps.networkId || current.state === 'retired') return current;
            if (current.holderNonce && current.leaseUntilMs !== null && current.leaseUntilMs > now()) return current;
            if ((current.operationStarted || current.state === 'restore-required') && !restoreApproved.has(ref)) return current;
            return { ...current, holderNonce: documentNonce, leaseNonce: leaseId, leaseUntilMs: now() + LEASE_MS, state: 'fresh' };
          });
        } catch { releaseLock(); return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' }; }
        if (disposed || !active || epoch !== lifecycleGeneration) {
          releaseLock();
          await mutateRow(ref, current => current?.holderNonce === documentNonce && current.leaseNonce === leaseId ? { ...current, holderNonce: null, leaseNonce: null, leaseUntilMs: null, state: current.operationStarted ? 'restore-required' : 'fresh' } : current);
          return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' };
        }
        if (claimed?.leaseNonce !== leaseId) { releaseLock(); return { kind: 'busy', intentRef: ref, reason: 'intent-busy' }; }
        const record: LeaseRecord = { intentRef: ref, leaseId, releaseLock, lockHold, timer: null, leaseUntilMs: now() + LEASE_MS, released: false };
        records.set(ref, record);
        record.timer = setInterval(() => { void mutateRow(ref, current => current?.holderNonce === documentNonce && current.leaseNonce === leaseId ? { ...current, leaseUntilMs: now() + LEASE_MS } : current).then(updated => { if (!updated || updated.leaseNonce !== leaseId) void release(ref, false, 'lease-replaced'); else record.leaseUntilMs = updated.leaseUntilMs ?? 0; }).catch(() => void release(ref, false, 'storage-failure')); }, HEARTBEAT_MS);
        restoreApproved.delete(ref);
        return { kind: 'acquired', intentRef: ref, leaseId };
      }
      const claimed = await mutateRow(ref, current => {
        if (!current || current.networkId !== deps.networkId || current.state === 'retired') return current;
        if (current.holderNonce && current.leaseUntilMs !== null && current.leaseUntilMs > now()) return current;
        // An expired holder is ambiguous. Explicit restore acknowledges the
        // prior attachment state but does not make its operation replayable.
        if ((current.holderNonce && current.operationStarted || current.state === 'restore-required') && !restoreApproved.has(ref)) return current;
        return { ...current, holderNonce: documentNonce, leaseNonce: leaseId, leaseUntilMs: now() + LEASE_MS, state: 'fresh' };
      });
      if (disposed || !active || epoch !== lifecycleGeneration) {
        await mutateRow(ref, current => current?.holderNonce === documentNonce && current.leaseNonce === leaseId ? { ...current, holderNonce: null, leaseNonce: null, leaseUntilMs: null, state: current.operationStarted ? 'restore-required' : 'fresh' } : current);
        return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' };
      }
      if (claimed?.leaseNonce !== leaseId) return { kind: 'busy', intentRef: ref, reason: 'intent-busy' };
      const record: LeaseRecord = { intentRef: ref, leaseId, releaseLock: null, lockHold: null, timer: null, leaseUntilMs: now() + LEASE_MS, released: false };
      records.set(ref, record);
      record.timer = setInterval(() => { void mutateRow(ref, current => current?.holderNonce === documentNonce && current.leaseNonce === leaseId ? { ...current, leaseUntilMs: now() + LEASE_MS } : current).then(updated => { if (!updated || updated.leaseNonce !== leaseId) void release(ref, false, 'lease-replaced'); else record.leaseUntilMs = updated.leaseUntilMs ?? 0; }).catch(() => void release(ref, false, 'storage-failure')); }, HEARTBEAT_MS);
      restoreApproved.delete(ref);
      return { kind: 'acquired', intentRef: ref, leaseId };
    } catch { return { kind: 'unavailable', intentRef: ref, reason: 'storage-unavailable' }; }
  };
  const assertCurrentLease = (value: string) => {
    if (disposed || !validRef(value)) return false;
    const record = records.get(value as TabIntentRef);
    return active && !!record && !record.released && record.leaseUntilMs > now();
  };
  const markOperationStarted = async (value: string) => {
    if (!assertCurrentLease(value)) return false;
    const ref = value as TabIntentRef; const record = records.get(ref);
    if (!record) return false;
    try {
      const updated = await mutateRow(ref, row => row?.holderNonce === documentNonce && row.leaseNonce === record.leaseId ? { ...row, operationStarted: true } : row);
      return !!updated && updated.leaseNonce === record.leaseId && assertCurrentLease(ref);
    } catch { void release(ref, false); return false; }
  };
  const settleOperation = async (value: string, outcome: IntentOperationOutcome) => {
    if (!assertCurrentLease(value)) return false;
    const ref = value as TabIntentRef; const record = records.get(ref);
    if (!record) return false;
    try {
      const updated = await mutateRow(ref, row => row?.holderNonce === documentNonce && row.leaseNonce === record.leaseId
        ? { ...row, operationStarted: outcome !== 'definitively-unadmitted' } : row);
      return !!updated && updated.leaseNonce === record.leaseId && assertCurrentLease(ref);
    } catch { void release(ref, false, 'storage-failure'); return false; }
  };
  return {
    createFreshIntent,
    listSavedIntentMetadata,
    requestExplicitRestore,
    acquire,
    assertCurrentLease,
    markOperationStarted,
    settleOperation,
    async retire(value) { if (!validRef(value)) return; const ref = value as TabIntentRef; restoreApproved.delete(ref); if (records.has(ref)) await release(ref, true); else await retireMetadata(ref); },
    dispose() {
      if (disposed) return; disposed = true;
      lifecycle?.removeEventListener('pagehide', onPageHide); lifecycle?.removeEventListener('freeze', onFreeze);
      lifecycle?.removeEventListener('pageshow', lifecycleResume); lifecycle?.removeEventListener('resume', lifecycleResume);
      for (const ref of [...records.keys()]) void release(ref, false);
      dbPromise?.then(db => db.close()).catch(() => {}); dbPromise = null;
    },
  };
}
