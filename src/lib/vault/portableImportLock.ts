// SPDX-License-Identifier: AGPL-3.0-or-later

export const PORTABLE_IMPORT_LOCK_NAME = 'onyx:portable-vault-import';

export type PortableImportLockResult<T> =
  | { state: 'completed'; value: T; coordinated: boolean }
  | { state: 'contended' };

export class PortableImportLockError extends Error {
  constructor() {
    super('Portable vault import lock request failed');
    this.name = 'PortableImportLockError';
  }
}

function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = navigator.locks;
  if (!locks || typeof locks.request !== 'function') return null;
  return locks;
}

export function supportsPortableImportLock(): boolean {
  return lockManager() !== null;
}

export async function withPortableImportLock<T>(
  operation: () => Promise<T>,
): Promise<PortableImportLockResult<T>> {
  const locks = lockManager();
  if (!locks) {
    return {
      state: 'completed',
      value: await operation(),
      coordinated: false,
    };
  }

  let operationStarted = false;
  try {
    return await locks.request(
      PORTABLE_IMPORT_LOCK_NAME,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) return { state: 'contended' } as const;
        operationStarted = true;
        return {
          state: 'completed',
          value: await operation(),
          coordinated: true,
        } as const;
      },
    );
  } catch (error) {
    if (operationStarted) throw error;
    throw new PortableImportLockError();
  }
}
