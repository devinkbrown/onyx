// SPDX-License-Identifier: AGPL-3.0-or-later
/** Durable, explicitly-scoped TOFU pins for group device directory entries. */
import { encodeGroupDeviceDirectoryEntry, type GroupDeviceDirectoryEntry } from './groupDeviceDirectory';

export const GROUP_TRUST_MAX_PINS = 1024;
const DB = 'onyx-group-trust'; const STORE = 'pins'; const VERSION = 1;
const ACCOUNT = /^[A-Za-z0-9_.@-]{1,64}$/u;
export type GroupTrustStatus = 'pinned' | 'known' | 'changed' | 'forgotten' | 'full' | 'unavailable' | 'invalid';
export type GroupTrustResult = Readonly<{ status: GroupTrustStatus }>;
export type GroupTrustScope = Readonly<{ endpoint: string; localAccount: string; remoteAccount: string; remoteDevice: string }>;
type Pin = { v: 1; directory: string; tombstone: boolean };
function normalizedAccount(value: string): string | null { const out = value.trim().toLowerCase(); return ACCOUNT.test(out) ? out : null; }
function scopeKey(scope: GroupTrustScope): string | null {
  try {
    const url = new URL(scope.endpoint);
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) || url.origin === 'null') return null;
    const endpoint = url.origin.toLowerCase(); const local = normalizedAccount(scope.localAccount); const remote = normalizedAccount(scope.remoteAccount);
    if (!local || !remote || !/^[A-Za-z0-9_.-]{1,32}$/u.test(scope.remoteDevice)) return null;
    return JSON.stringify([endpoint, local, remote, scope.remoteDevice]);
  } catch { return null; }
}
function openDb(): Promise<IDBDatabase | null> { return new Promise((resolve) => { try { if (typeof indexedDB === 'undefined') return resolve(null); const req = indexedDB.open(DB, VERSION); req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); }; req.onsuccess = () => resolve(req.result); req.onerror = req.onblocked = () => resolve(null); } catch { resolve(null); } }); }
/** Resolve a write outcome only after IndexedDB commits it.  Reporting a TOFU
 * pin before `oncomplete` would let an aborted transaction become a silent
 * trust success for this call. */
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (result: T) => void) => void): Promise<T | null> {
  const db = await openDb(); if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode); let candidate: T | undefined; let settled = false;
      const finish = (result: T | null) => { if (!settled) { settled = true; db.close(); resolve(result); } };
      run(tx.objectStore(STORE), (result) => { candidate = result; });
      tx.oncomplete = () => finish(candidate ?? null);
      tx.onerror = tx.onabort = () => finish(null);
    } catch { db.close(); resolve(null); }
  });
}

export class GroupTrustStore {
  async verify(scope: GroupTrustScope, entry: GroupDeviceDirectoryEntry): Promise<GroupTrustResult> {
    const key = scopeKey(scope); const directory = encodeGroupDeviceDirectoryEntry(entry); if (!key || !directory) return { status: 'invalid' };
    const outcome = await transaction<GroupTrustStatus>('readwrite', (store, done) => { const get = store.get(key); get.onerror = () => done('unavailable'); get.onsuccess = () => { const current = get.result as unknown; if (current !== undefined && !isPin(current)) return done('unavailable'); const pin = current as Pin | undefined; if (pin?.tombstone) return done('forgotten'); if (pin) return done(pin.directory === directory ? 'known' : 'changed'); const count = store.count(); count.onerror = () => done('unavailable'); count.onsuccess = () => { if (count.result >= GROUP_TRUST_MAX_PINS) return done('full'); try { store.put({ v: 1, directory, tombstone: false } satisfies Pin, key); done('pinned'); } catch { done('unavailable'); } }; }; });
    return { status: outcome ?? 'unavailable' };
  }
  async forget(scope: GroupTrustScope): Promise<GroupTrustResult> {
    const key = scopeKey(scope); if (!key) return { status: 'invalid' };
    const outcome = await transaction<GroupTrustStatus>('readwrite', (store, done) => {
      const get = store.get(key);
      get.onerror = () => done('unavailable');
      get.onsuccess = () => {
        // Replacing a pin/tombstone does not consume a row; creating a new
        // tombstone does, and must obey the same global hard bound.
        if (get.result !== undefined) {
          if (!isPin(get.result)) { done('unavailable'); return; }
          try { store.put({ v: 1, directory: '', tombstone: true } satisfies Pin, key); done('forgotten'); } catch { done('unavailable'); }
          return;
        }
        const count = store.count();
        count.onerror = () => done('unavailable');
        count.onsuccess = () => {
          if (count.result >= GROUP_TRUST_MAX_PINS) { done('full'); return; }
          try { store.put({ v: 1, directory: '', tombstone: true } satisfies Pin, key); done('forgotten'); } catch { done('unavailable'); }
        };
      };
    });
    return { status: outcome ?? 'unavailable' };
  }
}
function isPin(value: unknown): value is Pin {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Pin>;
  return candidate.v === 1 && typeof candidate.directory === 'string' && typeof candidate.tombstone === 'boolean';
}
