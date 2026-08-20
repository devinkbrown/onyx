// SPDX-License-Identifier: AGPL-3.0-or-later
/** Fail-closed, endpoint-and-owner-scoped durable OGC signer pins. */

import { fromB64url, toB64url } from './dmCipher';
import type { TrustedGroupSignerStore } from './trustedGroupSigner';

export const TRUSTED_GROUP_SIGNER_MAX_RECORDS = 1_024;
export const TRUSTED_GROUP_SIGNER_DB = 'onyx-trusted-group-signers';
const STORE = 'pins';
const VERSION = 1;
const ACCOUNT = /^[a-z0-9_.@-]{1,64}$/u;
const DEVICE = /^[A-Za-z0-9_.-]{1,32}$/u;

type StoredPin = {
  key: string;
  v: 1;
  scope: string;
  localAccount: string;
  remoteAccount: string;
  remoteDeviceId: string;
  signerPub: string | null;
  deleted: boolean;
};

export type TrustedGroupSignerStoreScope = Readonly<{
  endpoint: string;
  localAccount: string;
}>;

function canonicalAccount(value: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT.test(normalized) ? normalized : null;
}

function canonicalSigner(value: string): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  const bytes = fromB64url(value);
  return bytes?.byteLength === 32 && toB64url(bytes) === value ? value : null;
}

function exactEndpoint(value: string): string | null {
  if (typeof value !== 'string') return null;
  const endpoint = value.trim();
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
      || parsed.username || parsed.password || parsed.hash) return null;
    return endpoint;
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Trusted signer storage requires Web Crypto.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Trusted signer storage is unavailable.'));
      return;
    }
    try {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const request = indexedDB.open(TRUSTED_GROUP_SIGNER_DB, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      request.onblocked = () => fail(new Error('Trusted signer storage is blocked.'));
      request.onerror = () => fail(request.error ?? new Error('Trusted signer storage failed to open.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        if (!db.objectStoreNames.contains(STORE)) {
          db.close();
          fail(new Error('Trusted signer storage schema is corrupt.'));
          return;
        }
        const schemaTx = db.transaction(STORE, 'readonly');
        const objectStore = schemaTx.objectStore(STORE);
        if (objectStore.keyPath !== 'key' || objectStore.autoIncrement) {
          try { schemaTx.abort(); } catch { /* already inactive */ }
          db.close();
          fail(new Error('Trusted signer storage schema is corrupt.'));
          return;
        }
        db.onversionchange = () => db.close();
        settled = true;
        resolve(db);
      };
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Trusted signer storage failed to open.'));
    }
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Trusted signer storage request failed.'));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Trusted signer transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Trusted signer transaction aborted.'));
  });
}

function isStoredPin(value: unknown, expected: Omit<StoredPin, 'signerPub' | 'deleted' | 'v'>): value is StoredPin {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StoredPin>;
  if (row.v !== 1 || row.key !== expected.key || row.scope !== expected.scope
    || row.localAccount !== expected.localAccount || row.remoteAccount !== expected.remoteAccount
    || row.remoteDeviceId !== expected.remoteDeviceId || typeof row.deleted !== 'boolean') return false;
  if (row.signerPub !== null && (typeof row.signerPub !== 'string' || canonicalSigner(row.signerPub) !== row.signerPub)) return false;
  return row.signerPub === null ? row.deleted : true;
}

function abort(transaction: IDBTransaction): void {
  try { transaction.abort(); } catch { /* transaction may already be aborting */ }
}

export function createTrustedGroupSignerStore(scope: TrustedGroupSignerStoreScope): TrustedGroupSignerStore {
  const endpoint = exactEndpoint(scope.endpoint);
  const localAccount = canonicalAccount(scope.localAccount);
  if (!endpoint || !localAccount) throw new Error('Invalid trusted signer storage scope.');

  const scopePromise = sha256(endpoint);
  const identity = async (remoteAccountValue: string, remoteDeviceId: string) => {
    const remoteAccount = canonicalAccount(remoteAccountValue);
    if (!remoteAccount || !DEVICE.test(remoteDeviceId)) throw new Error('Invalid trusted signer owner.');
    const scopeDigest = await scopePromise;
    const key = JSON.stringify([scopeDigest, localAccount, remoteAccount, remoteDeviceId]);
    return { key, scope: scopeDigest, localAccount, remoteAccount, remoteDeviceId };
  };

  return {
    async get(account, deviceId) {
      const expected = await identity(account, deviceId);
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, 'readonly');
        const done = transactionResult(tx);
        let value: unknown;
        try {
          value = await requestResult(tx.objectStore(STORE).get(expected.key)) as unknown;
        } catch (error) {
          void done.catch(() => undefined);
          throw error;
        }
        await done;
        if (value === undefined) return null;
        if (!isStoredPin(value, expected)) throw new Error('Trusted signer pin is corrupt.');
        return {
          account: expected.remoteAccount,
          deviceId: expected.remoteDeviceId,
          signerPub: value.signerPub ?? '',
          ...(value.deleted ? { deleted: true } : {}),
        };
      } finally {
        db.close();
      }
    },

    async put(pin) {
      const expected = await identity(pin.account, pin.deviceId);
      const signerPub = canonicalSigner(pin.signerPub);
      if (!signerPub || pin.deleted) throw new Error('Invalid trusted signer pin.');
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const done = transactionResult(tx);
        try {
          const store = tx.objectStore(STORE);
          const current = await requestResult(store.get(expected.key)) as unknown;
          if (current !== undefined) {
            if (!isStoredPin(current, expected)) throw new Error('Trusted signer pin is corrupt.');
            if (current.deleted || current.signerPub !== signerPub) throw new Error('Trusted signer key changed.');
          } else {
            const count = await requestResult(store.count());
            if (count >= TRUSTED_GROUP_SIGNER_MAX_RECORDS) throw new Error('Trusted signer storage is full.');
            await requestResult(store.add({ ...expected, v: 1, signerPub, deleted: false } satisfies StoredPin));
          }
        } catch (error) {
          abort(tx);
          void done.catch(() => undefined);
          throw error;
        }
        await done;
      } finally {
        db.close();
      }
    },

    async delete(account, deviceId) {
      const expected = await identity(account, deviceId);
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const done = transactionResult(tx);
        try {
          const store = tx.objectStore(STORE);
          const current = await requestResult(store.get(expected.key)) as unknown;
          let signerPub: string | null = null;
          if (current !== undefined) {
            if (!isStoredPin(current, expected)) throw new Error('Trusted signer pin is corrupt.');
            signerPub = current.signerPub;
          } else {
            const count = await requestResult(store.count());
            if (count >= TRUSTED_GROUP_SIGNER_MAX_RECORDS) throw new Error('Trusted signer storage is full.');
          }
          await requestResult(store.put({ ...expected, v: 1, signerPub, deleted: true } satisfies StoredPin));
        } catch (error) {
          abort(tx);
          void done.catch(() => undefined);
          throw error;
        }
        await done;
      } finally {
        db.close();
      }
    },
  };
}
