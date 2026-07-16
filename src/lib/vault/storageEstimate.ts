// SPDX-License-Identifier: AGPL-3.0-or-later

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;
const PIB = 1024 * TIB;

export type OriginStorageEstimateResult = {
  state: 'available' | 'partial' | 'unsupported' | 'error';
  usage: string | null;
  quota: string | null;
  detail: string;
};

function storageEstimator(): Pick<StorageManager, 'estimate'> | null {
  if (typeof navigator === 'undefined') return null;
  const storage = navigator.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  return storage;
}

function boundedBytes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

function decimalUnit(bytes: number, unit: number, suffix: string): string {
  const rounded = Math.round((bytes / unit) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${suffix}`;
}

export function formatOriginStorageBytes(value: unknown): string | null {
  const bytes = boundedBytes(value);
  if (bytes === null) return null;
  if (bytes === 0) return '0 B';
  if (bytes < MIB) return '< 1 MiB';
  if (bytes < GIB) return `${Math.round(bytes / MIB)} MiB`;
  if (bytes < TIB) return decimalUnit(bytes, GIB, 'GiB');
  if (bytes < PIB) return decimalUnit(bytes, TIB, 'TiB');
  return decimalUnit(bytes, PIB, 'PiB');
}

export async function readOriginStorageEstimate(): Promise<OriginStorageEstimateResult> {
  const storage = storageEstimator();
  if (!storage) {
    return {
      state: 'unsupported',
      usage: null,
      quota: null,
      detail: 'This browser does not expose an origin storage estimate. Onyx will not guess how much device storage the local vault uses.',
    };
  }

  try {
    const estimate = await storage.estimate();
    const usage = formatOriginStorageBytes(estimate.usage);
    const quota = formatOriginStorageBytes(estimate.quota);
    if (!usage && !quota) {
      return {
        state: 'error',
        usage: null,
        quota: null,
        detail: 'The browser returned no usable origin storage estimate. Onyx will not infer vault size from missing values.',
      };
    }

    const scope = 'Approximate origin-wide storage, not vault-only; the browser may pad or revise these values.';
    if (usage && quota) {
      return {
        state: 'available',
        usage,
        quota,
        detail: `${usage} used of an estimated ${quota} quota. ${scope}`,
      };
    }
    return {
      state: 'partial',
      usage,
      quota,
      detail: `${usage ? `${usage} estimated used; quota was not reported.` : `${quota ?? 'Unknown'} estimated quota; usage was not reported.`} ${scope}`,
    };
  } catch {
    return {
      state: 'error',
      usage: null,
      quota: null,
      detail: 'The browser storage estimate failed. Onyx cannot report origin usage or quota, and will not assume vault durability.',
    };
  }
}
