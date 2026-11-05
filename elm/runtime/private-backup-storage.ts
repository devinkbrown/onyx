import type { OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { OWNED_BACKUPS, openVaultV5, transactionPromise } from './migrations';

export interface EncryptedBackupRow { readonly backupId: string; readonly createdAt: number; readonly bytes: Uint8Array; readonly mediaType: 'application/vnd.onyx.private-backup' }
interface StoredBackup extends EncryptedBackupRow { readonly id: string; readonly ownerKey: string; readonly selectedByUser: true }
export interface PrivateBackupDependencies {
  readonly indexedDB?: IDBFactory;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly validateEncryptedBackup: (bytes: Uint8Array) => boolean;
  readonly now?: () => number;
}
const MAX_BACKUPS = 20;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

/** Ciphertext-only private recovery store. It is intentionally not connected to
 * generic settings import/export and never accepts private keys or plaintext. */
export function createPrivateBackupStorage(deps: PrivateBackupDependencies) {
  const idb = deps.indexedDB ?? globalThis.indexedDB; const now = deps.now ?? Date.now;
  let db: IDBDatabase | null = null; let disposed = false; let opening: Promise<boolean> | null = null;
  const active = new Set<IDBTransaction>();
  const current = (request: RequestContext, ticket: LocalNamespaceTicket): boolean => !disposed && deps.isNamespaceCurrent(ticket, request);
  const open = async (): Promise<boolean> => { if (db) return true; if (!idb || disposed) return false; opening ??= openVaultV5({ indexedDB: idb, onVersionChange: () => { db?.close(); db = null; } }).then((r) => { if (r.kind !== 'ready' || disposed) { if (r.kind === 'ready') r.database.close(); return false; } db = r.database; return true; }).finally(() => { opening = null; }); return opening; };
  const tx = (mode: IDBTransactionMode): IDBTransaction | null => { if (!db || disposed) return null; try { const t = db.transaction(OWNED_BACKUPS, mode); active.add(t); const drop = () => active.delete(t); t.addEventListener('complete', drop, { once: true }); t.addEventListener('abort', drop, { once: true }); return t; } catch { return null; } };
  const requestValid = (request: RequestContext, ticket: LocalNamespaceTicket): boolean => request.schemaVersion === 1 && request.requestId.length >= 22 && current(request, ticket);
  return {
    async save(request: RequestContext & { readonly bytes: Uint8Array; readonly userSelected: true }): Promise<'saved' | 'stale-owner' | 'invalid' | 'unavailable' | 'quota'> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !requestValid(request, ticket)) return 'stale-owner';
      if (ticket.scope.kind === 'guest') return 'unavailable';
      if (request.userSelected !== true || !(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 64 || request.bytes.byteLength > 8 * 1024 * 1024) return 'invalid';
      const snapshot = request.bytes.slice();
      try {
      if (!deps.validateEncryptedBackup(snapshot)) return 'invalid';
      const opened = await open();
      if (!current(request, ticket)) return 'stale-owner';
      if (!opened) return 'unavailable';
      const transaction = tx('readwrite'); if (!transaction) return 'unavailable'; const done = transactionPromise(transaction);
      const backupId = globalThis.crypto.randomUUID();
      const row: StoredBackup = { id: JSON.stringify([ticket.ownerKey, backupId]), ownerKey: ticket.ownerKey, backupId, createdAt: now(), bytes: snapshot.slice(), mediaType: 'application/vnd.onyx.private-backup', selectedByUser: true };
      if (!current(request, ticket)) { transaction.abort(); await done.catch(() => undefined); return 'stale-owner'; }
      const store = transaction.objectStore(OWNED_BACKUPS);
      let existingCount = 0; let existingBytes = 0;
      let limitReached = false;
      const cursor = store.index('by-owner').openCursor(IDBKeyRange.only(ticket.ownerKey));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) { const prior = item.value as StoredBackup; if (prior?.bytes instanceof Uint8Array) { existingCount += 1; existingBytes += prior.bytes.byteLength; } item.continue(); return; }
        if (!current(request, ticket)) { transaction.abort(); return; }
        if (existingCount >= MAX_BACKUPS || existingBytes + snapshot.byteLength > MAX_BACKUP_BYTES) { limitReached = true; transaction.abort(); return; }
        store.add(row);
      };
      try {
        await new Promise<void>((resolve, reject) => { cursor.onerror = () => reject(cursor.error ?? new Error('idb_cursor_failed')); cursor.addEventListener('success', () => { if (!cursor.result || limitReached) resolve(); }); });
        await done; return current(request, ticket) ? 'saved' : 'stale-owner';
      } catch (error) { try { transaction.abort(); } catch { /* ended */ } await done.catch(() => undefined); return limitReached || (error as DOMException)?.name === 'QuotaExceededError' ? 'quota' : current(request, ticket) ? 'unavailable' : 'stale-owner'; }
      } finally { snapshot.fill(0); }
    },
    async listResult(request: RequestContext): Promise<{ readonly status: 'ok' | 'stale-owner' | 'unavailable'; readonly items: readonly Omit<EncryptedBackupRow, 'bytes'>[] }> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !current(request, ticket)) return { status: 'stale-owner', items: [] };
      if (ticket.scope.kind === 'guest') return { status: 'ok', items: [] };
      const opened = await open();
      if (!current(request, ticket)) return { status: 'stale-owner', items: [] };
      if (!opened) return { status: 'unavailable', items: [] };
      if (!current(request, ticket)) return { status: 'stale-owner', items: [] };
      const transaction = tx('readonly'); if (!transaction) return { status: 'unavailable', items: [] }; const done = transactionPromise(transaction); const out: Array<Omit<EncryptedBackupRow, 'bytes'>> = [];
      const cursorRequest = transaction.objectStore(OWNED_BACKUPS).index('by-owner').openCursor(IDBKeyRange.only(ticket.ownerKey));
      try {
        await new Promise<void>((resolve, reject) => { cursorRequest.onsuccess = () => { const cursor = cursorRequest.result; if (!cursor || out.length >= MAX_BACKUPS) { resolve(); return; } const row = cursor.value as StoredBackup; if (current(request, ticket) && row.ownerKey === ticket.ownerKey && row.selectedByUser === true && row.mediaType === 'application/vnd.onyx.private-backup' && row.bytes instanceof Uint8Array) out.push({ backupId: row.backupId, createdAt: row.createdAt, mediaType: row.mediaType }); cursor.continue(); }; cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('idb-request')); });
        await done; return current(request, ticket) ? { status: 'ok', items: out } : { status: 'stale-owner', items: [] };
      } catch { return { status: current(request, ticket) ? 'unavailable' : 'stale-owner', items: [] }; }
    },
    async list(request: RequestContext): Promise<readonly Omit<EncryptedBackupRow, 'bytes'>[]> { return (await this.listResult(request)).items; },
    async load(request: RequestContext & { readonly backupId: string; readonly userSelected: true }): Promise<{ readonly status: 'loaded' | 'stale-owner' | 'invalid' | 'unavailable'; readonly bytes: Uint8Array | null }> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !requestValid(request, ticket)) return { status: 'stale-owner', bytes: null };
      if (ticket.scope.kind === 'guest') return { status: 'unavailable', bytes: null };
      if (request.userSelected !== true || request.backupId.length > 128) return { status: 'invalid', bytes: null };
      const opened = await open();
      if (!current(request, ticket)) return { status: 'stale-owner', bytes: null };
      if (!opened) return { status: 'unavailable', bytes: null };
      if (!current(request, ticket)) return { status: 'stale-owner', bytes: null };
      const transaction = tx('readonly'); if (!transaction) return { status: 'unavailable', bytes: null }; const done = transactionPromise(transaction);
      const key = JSON.stringify([ticket.ownerKey, request.backupId]); const req = transaction.objectStore(OWNED_BACKUPS).get(key);
      let row: StoredBackup | undefined;
      try { row = await new Promise<StoredBackup | undefined>((resolve, reject) => { req.onsuccess = () => resolve(req.result as StoredBackup | undefined); req.onerror = () => reject(req.error); }); await done; }
      catch { return { status: 'unavailable', bytes: null }; }
      if (!current(request, ticket)) return { status: 'stale-owner', bytes: null };
      if (!row || !row.bytes || !deps.validateEncryptedBackup(row.bytes)) return { status: 'invalid', bytes: null };
      const bytes = row.bytes.slice(); if (!current(request, ticket)) { bytes.fill(0); return { status: 'stale-owner', bytes: null }; } return { status: 'loaded', bytes };
    },
    async delete(request: RequestContext & { readonly backupId: string; readonly userSelected: true }): Promise<boolean> {
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !requestValid(request, ticket) || request.userSelected !== true || request.backupId.length > 128 || ticket.scope.kind === 'guest') return false;
      const opened = await open();
      if (!current(request, ticket) || !opened) return false;
      const transaction = tx('readwrite'); if (!transaction) return false; const done = transactionPromise(transaction);
      if (!current(request, ticket)) { transaction.abort(); await done.catch(() => undefined); return false; }
      transaction.objectStore(OWNED_BACKUPS).delete(JSON.stringify([ticket.ownerKey, request.backupId])); try { await done; return current(request, ticket); } catch { return false; }
    },
    dispose(): void { disposed = true; for (const t of active) { try { t.abort(); } catch { /* ended */ } } active.clear(); db?.close(); db = null; },
  };
}
