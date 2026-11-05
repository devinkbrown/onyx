import { canonicalTupleKey } from './contracts';

export const VAULT_DATABASE = 'onyx-vault';
export const VAULT_VERSION = 5;
export const LEGACY_MESSAGES = 'messages';
export const LEGACY_OUTBOX = 'outbox';
export const SCHEDULED = 'scheduled';
export const VAULT_META = 'vault_meta';
export const OWNED_MESSAGES = 'messages_owned';
export const OWNED_OUTBOX = 'outbox_owned';
export const QUARANTINE_DECISIONS = 'quarantine_decisions';
export const OWNED_DRAFTS = 'drafts_owned';
export const OWNED_READ_ANCHORS = 'read_anchors_owned';
export const OWNED_SETTINGS = 'settings_owned';
export const OWNED_BACKUPS = 'private_backups_owned';

export interface DatabaseOpenOptions {
  readonly indexedDB: IDBFactory;
  readonly onVersionChange?: () => void;
}

export type OpenDatabaseResult =
  | { readonly kind: 'ready'; readonly database: IDBDatabase }
  | { readonly kind: 'blocked' | 'unavailable' | 'incompatible' };

function createOwnedStore(database: IDBDatabase, name: string): void {
  const store = database.createObjectStore(name, { keyPath: 'id' });
  store.createIndex('by-owner', 'ownerKey', { unique: false });
  store.createIndex('by-owner-target', ['ownerKey', 'targetKey'], { unique: false });
}

/** Additive v5 migration. Legacy v1-v3 message/outbox rows and the
 * scheduled queue are intentionally untouched and remain quarantine input. */
export function openVaultV5(options: DatabaseOpenOptions): Promise<OpenDatabaseResult> {
  return new Promise((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = (result: OpenDatabaseResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    deadline = setTimeout(() => finish({ kind: 'unavailable' }), 10_000);
    let request: IDBOpenDBRequest;
    try {
      request = options.indexedDB.open(VAULT_DATABASE, VAULT_VERSION);
    } catch {
      finish({ kind: 'unavailable' });
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LEGACY_MESSAGES)) {
        const messages = database.createObjectStore(LEGACY_MESSAGES, { keyPath: 'id' });
        messages.createIndex('by-target', 'target', { unique: false });
      }
      if (!database.objectStoreNames.contains(LEGACY_OUTBOX)) database.createObjectStore(LEGACY_OUTBOX, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(SCHEDULED)) database.createObjectStore(SCHEDULED, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(VAULT_META)) database.createObjectStore(VAULT_META, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(OWNED_MESSAGES)) createOwnedStore(database, OWNED_MESSAGES);
      if (!database.objectStoreNames.contains(OWNED_OUTBOX)) createOwnedStore(database, OWNED_OUTBOX);
      const outbox = request.transaction?.objectStore(OWNED_OUTBOX);
      if (outbox && !outbox.indexNames.contains('by-owner-intent')) outbox.createIndex('by-owner-intent', ['ownerKey', 'clientIntentId'], { unique: true });
      if (!database.objectStoreNames.contains(OWNED_DRAFTS)) createOwnedStore(database, OWNED_DRAFTS);
      if (!database.objectStoreNames.contains(OWNED_READ_ANCHORS)) createOwnedStore(database, OWNED_READ_ANCHORS);
      if (!database.objectStoreNames.contains(OWNED_SETTINGS)) {
        const settings = database.createObjectStore(OWNED_SETTINGS, { keyPath: 'id' });
        settings.createIndex('by-installation', 'installationKey', { unique: true });
        settings.createIndex('by-owner', 'ownerKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(OWNED_BACKUPS)) createOwnedStore(database, OWNED_BACKUPS);
      if (!database.objectStoreNames.contains(QUARANTINE_DECISIONS)) {
        const decisions = database.createObjectStore(QUARANTINE_DECISIONS, { keyPath: 'id' });
        decisions.createIndex('by-store', 'storeName', { unique: false });
      }
    };
    request.onblocked = () => finish({ kind: 'blocked' });
    request.onerror = () => finish({ kind: 'unavailable' });
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      const required = [LEGACY_MESSAGES, LEGACY_OUTBOX, SCHEDULED, VAULT_META, OWNED_MESSAGES, OWNED_OUTBOX, OWNED_DRAFTS, OWNED_READ_ANCHORS, OWNED_SETTINGS, OWNED_BACKUPS, QUARANTINE_DECISIONS];
      let complete = required.every((name) => database.objectStoreNames.contains(name));
      if (complete) {
        try {
          const check = database.transaction([OWNED_MESSAGES, OWNED_OUTBOX, OWNED_DRAFTS, OWNED_READ_ANCHORS, OWNED_SETTINGS, OWNED_BACKUPS], 'readonly');
          complete = ['by-owner', 'by-owner-target'].every((name) => check.objectStore(OWNED_MESSAGES).indexNames.contains(name))
            && ['by-owner', 'by-owner-intent'].every((name) => check.objectStore(OWNED_OUTBOX).indexNames.contains(name))
            && check.objectStore(OWNED_DRAFTS).indexNames.contains('by-owner')
            && check.objectStore(OWNED_READ_ANCHORS).indexNames.contains('by-owner')
            && check.objectStore(OWNED_BACKUPS).indexNames.contains('by-owner')
            && check.objectStore(OWNED_SETTINGS).indexNames.contains('by-installation');
        } catch { complete = false; }
      }
      database.onversionchange = () => {
        database.close();
        options.onVersionChange?.();
      };
      if (!complete) { database.close(); finish({ kind: 'incompatible' }); }
      else finish({ kind: 'ready', database });
    };
  });
}

export function ownerStorageKey(networkId: string, accountId: string | null, ownerRef: string, connectionGeneration: number): string {
  return accountId === null
    ? canonicalTupleKey([networkId, 'guest-physical-epoch', ownerRef])
    : canonicalTupleKey([networkId, 'account', accountId]);
}

export function scopedRecordId(ownerKey: string, id: string): string {
  return canonicalTupleKey([ownerKey, id]);
}

export function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'));
  });
}

export function transactionPromise(transaction: IDBTransaction): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb_transaction_failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb_transaction_aborted'));
  });
  void promise.catch(() => undefined);
  return promise;
}
