// SPDX-License-Identifier: AGPL-3.0-or-later

export type VaultPersistenceResult = {
  state: 'persisted' | 'not-persisted' | 'granted' | 'denied' | 'unsupported' | 'error';
  detail: string;
};

type PersistenceStorageManager = Pick<StorageManager, 'persisted' | 'persist'>;

function availableStorageManager(): PersistenceStorageManager | null {
  if (typeof navigator === 'undefined') return null;
  const storage = navigator.storage;
  if (!storage || typeof storage.persisted !== 'function' || typeof storage.persist !== 'function') {
    return null;
  }
  return storage;
}

export function supportsVaultPersistenceRequest(): boolean {
  return availableStorageManager() !== null;
}

export async function readVaultPersistence(): Promise<VaultPersistenceResult> {
  const storage = availableStorageManager();
  if (!storage) {
    return {
      state: 'unsupported',
      detail: 'This browser does not expose a persistent-storage request. The local vault may be evicted; portable exports remain the reliable backup path.',
    };
  }

  try {
    const persisted = await storage.persisted();
    return persisted
      ? {
          state: 'persisted',
          detail: 'This browser reports Onyx storage is protected from automatic eviction. Manual clearing and browser or device policy can still remove the local vault.',
        }
      : {
          state: 'not-persisted',
          detail: 'The local vault is available but may be evicted by the browser. Request persistence below or keep a portable export.',
        };
  } catch {
    return {
      state: 'error',
      detail: 'Onyx could not verify this browser’s storage-persistence state. The local vault must not be assumed durable.',
    };
  }
}

export async function requestVaultPersistence(): Promise<VaultPersistenceResult> {
  const storage = availableStorageManager();
  if (!storage) {
    return {
      state: 'unsupported',
      detail: 'This browser does not expose a persistent-storage request. The local vault may be evicted; portable exports remain the reliable backup path.',
    };
  }

  try {
    const granted = await storage.persist();
    return granted
      ? {
          state: 'granted',
          detail: 'Persistent storage was granted for Onyx against automatic eviction. Manual clearing and browser or device policy can still remove the local vault.',
        }
      : {
          state: 'denied',
          detail: 'The browser did not grant persistent storage. The local vault remains usable but may be evicted; keep a portable export.',
        };
  } catch {
    return {
      state: 'error',
      detail: 'The persistent-storage request failed. The local vault remains usable but must not be assumed durable.',
    };
  }
}
