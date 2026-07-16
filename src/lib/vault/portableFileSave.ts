// SPDX-License-Identifier: AGPL-3.0-or-later

export type PortableFileSaveFormat = 'json' | 'gzip';

export type PortableFileSaveRequest = {
  format: PortableFileSaveFormat;
  suggestedName: string;
  createBlob: () => Promise<Blob>;
  /** Live owner/component guard checked across picker and writable awaits. */
  isCurrent?: () => boolean;
};

export type PortableFileSaveResult = {
  state: 'saved' | 'cancelled' | 'unsupported' | 'failed';
  detail: string;
};

type PortableWritable = {
  abort?: (reason?: unknown) => Promise<void>;
  close: () => Promise<void>;
  truncate: (size: number) => Promise<void>;
  write: (data: Blob) => Promise<void>;
};

type PortableFileHandle = {
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<PortableWritable>;
};

type PortableFilePickerOptions = {
  excludeAcceptAllOption: boolean;
  suggestedName: string;
  types: Array<{
    accept: Record<string, string[]>;
    description: string;
  }>;
};

type PortableFilePicker = (
  options: PortableFilePickerOptions,
) => Promise<PortableFileHandle>;

function portableFilePicker(): PortableFilePicker | null {
  if (typeof window === 'undefined') return null;
  try {
    const picker = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    return typeof picker === 'function'
      ? picker.bind(window) as PortableFilePicker
      : null;
  } catch {
    return null;
  }
}

export function supportsPortableFileSave(): boolean {
  return portableFilePicker() !== null;
}

function pickerOptions(request: PortableFileSaveRequest): PortableFilePickerOptions {
  const compressed = request.format === 'gzip';
  return {
    excludeAcceptAllOption: true,
    suggestedName: request.suggestedName,
    types: [{
      description: compressed
        ? 'Onyx portable vault (compressed JSON)'
        : 'Onyx portable vault (JSON)',
      accept: compressed
        ? { 'application/gzip': ['.json.gz', '.gz'] }
        : { 'application/json': ['.json'] },
    }],
  };
}

function isPickerCancellation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

class PortableFileSaveStaleError extends Error {
  constructor() {
    super('Portable vault file save owner changed');
    this.name = 'PortableFileSaveStaleError';
  }
}

function requestIsCurrent(request: PortableFileSaveRequest): boolean {
  try {
    return request.isCurrent?.() !== false;
  } catch {
    return false;
  }
}

function staleSaveResult(): PortableFileSaveResult {
  return {
    state: 'failed',
    detail: 'The active account changed before the portable vault was written. Choose a file again.',
  };
}

async function discardWritable(writable: PortableWritable, reason: unknown): Promise<void> {
  if (typeof writable.abort === 'function') {
    try {
      await writable.abort(reason);
      return;
    } catch {
      // Some implementations reject abort after a failed write. Closing is the fallback.
    }
  }
  try {
    await writable.close();
  } catch {
    // Preserve the original write failure; cleanup is best-effort.
  }
}

/**
 * Opens the picker before the first async suspension so callers can invoke this directly from
 * a click handler without losing transient user activation. The returned handle is never stored.
 */
export async function savePortableVaultFile(
  request: PortableFileSaveRequest,
): Promise<PortableFileSaveResult> {
  const picker = portableFilePicker();
  if (!picker) {
    return {
      state: 'unsupported',
      detail: 'Direct file saving is unavailable. Export the portable vault download instead.',
    };
  }

  let handle: PortableFileHandle;
  try {
    // This must remain the first awaited operation: it consumes the click's user activation.
    handle = await picker(pickerOptions(request));
  } catch (error) {
    if (isPickerCancellation(error)) {
      return {
        state: 'cancelled',
        detail: 'Portable vault save cancelled. No file was changed.',
      };
    }
    return {
      state: 'failed',
      detail: 'The browser could not open a destination for the portable vault.',
    };
  }
  if (!requestIsCurrent(request)) return staleSaveResult();

  let writable: PortableWritable | null = null;
  try {
    const blob = await request.createBlob();
    if (!requestIsCurrent(request)) throw new PortableFileSaveStaleError();
    writable = await handle.createWritable({ keepExistingData: false });
    if (!requestIsCurrent(request)) throw new PortableFileSaveStaleError();
    await writable.truncate(0);
    if (!requestIsCurrent(request)) throw new PortableFileSaveStaleError();
    await writable.write(blob);
    if (!requestIsCurrent(request)) throw new PortableFileSaveStaleError();
    await writable.close();
    writable = null;
    return {
      state: 'saved',
      detail: 'Portable vault saved.',
    };
  } catch (error) {
    if (writable) await discardWritable(writable, error);
    if (error instanceof PortableFileSaveStaleError) return staleSaveResult();
    return {
      state: 'failed',
      detail: 'The portable vault could not be written. The download export remains available.',
    };
  }
}
