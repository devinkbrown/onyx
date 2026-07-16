// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  savePortableVaultFile,
  supportsPortableFileSave,
  type PortableFileSaveRequest,
} from './portableFileSave';

function request(format: 'json' | 'gzip' = 'json'): PortableFileSaveRequest {
  return {
    format,
    suggestedName: format === 'gzip'
      ? 'onyx-portable-2026-07-16.json.gz'
      : 'onyx-portable-2026-07-16.json',
    createBlob: vi.fn().mockResolvedValue(new Blob(['vault'], {
      type: format === 'gzip' ? 'application/gzip' : 'application/json',
    })),
  };
}

describe('portable vault direct file saving', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported without producing a vault payload', async () => {
    const saveRequest = request();
    vi.stubGlobal('showSaveFilePicker', undefined);

    expect(supportsPortableFileSave()).toBe(false);
    await expect(savePortableVaultFile(saveRequest)).resolves.toMatchObject({ state: 'unsupported' });
    expect(saveRequest.createBlob).not.toHaveBeenCalled();
  });

  it('opens the JSON picker before producing and transactionally replaces the destination', async () => {
    const order: string[] = [];
    const truncate = vi.fn(async (_size: number) => { order.push('truncate'); });
    const write = vi.fn(async (_data: Blob) => { order.push('write'); });
    const close = vi.fn(async () => { order.push('close'); });
    const createWritable = vi.fn(async () => {
      order.push('create-writable');
      return { truncate, write, close };
    });
    const picker = vi.fn(async () => {
      order.push('picker');
      return { createWritable };
    });
    vi.stubGlobal('showSaveFilePicker', picker);
    const saveRequest = request();
    saveRequest.createBlob = vi.fn(async () => {
      order.push('produce');
      return new Blob(['vault'], { type: 'application/json' });
    });

    await expect(savePortableVaultFile(saveRequest)).resolves.toMatchObject({ state: 'saved' });

    expect(order).toEqual(['picker', 'produce', 'create-writable', 'truncate', 'write', 'close']);
    expect(picker).toHaveBeenCalledWith({
      excludeAcceptAllOption: true,
      suggestedName: 'onyx-portable-2026-07-16.json',
      types: [{
        description: 'Onyx portable vault (JSON)',
        accept: { 'application/json': ['.json'] },
      }],
    });
    expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false });
    expect(truncate).toHaveBeenCalledWith(0);
    expect(write.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });

  it('uses gzip MIME and compound filename extensions for compressed saves', async () => {
    const writable = {
      truncate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const picker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue(writable),
    });
    vi.stubGlobal('showSaveFilePicker', picker);

    await expect(savePortableVaultFile(request('gzip'))).resolves.toMatchObject({ state: 'saved' });

    expect(picker.mock.calls[0]?.[0]).toMatchObject({
      suggestedName: 'onyx-portable-2026-07-16.json.gz',
      types: [{ accept: { 'application/gzip': ['.json.gz', '.gz'] } }],
    });
    expect((writable.write.mock.calls[0]?.[0] as Blob).type).toBe('application/gzip');
  });

  it('treats picker cancellation as neutral and does not create the export', async () => {
    const picker = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    vi.stubGlobal('showSaveFilePicker', picker);
    const saveRequest = request();

    await expect(savePortableVaultFile(saveRequest)).resolves.toMatchObject({ state: 'cancelled' });
    expect(saveRequest.createBlob).not.toHaveBeenCalled();
  });

  it('aborts a failed writer and allows a later save to retry with a fresh handle', async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const failedWritable = {
      truncate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockRejectedValue(new Error('disk full')),
      close: vi.fn().mockResolvedValue(undefined),
      abort,
    };
    const successfulWritable = {
      truncate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const picker = vi.fn()
      .mockResolvedValueOnce({ createWritable: vi.fn().mockResolvedValue(failedWritable) })
      .mockResolvedValueOnce({ createWritable: vi.fn().mockResolvedValue(successfulWritable) });
    vi.stubGlobal('showSaveFilePicker', picker);

    await expect(savePortableVaultFile(request())).resolves.toMatchObject({ state: 'failed' });
    expect(abort).toHaveBeenCalledOnce();
    expect(failedWritable.close).not.toHaveBeenCalled();
    await expect(savePortableVaultFile(request())).resolves.toMatchObject({ state: 'saved' });
    expect(picker).toHaveBeenCalledTimes(2);
  });

  it('falls back to closing a failed writer when abort is unavailable', async () => {
    const writable = {
      truncate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockRejectedValue(new Error('write failed')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue(writable),
    }));

    await expect(savePortableVaultFile(request())).resolves.toMatchObject({ state: 'failed' });
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it('aborts the temporary write when committing the close fails', async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const writable = {
      truncate: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error('commit failed')),
      abort,
    };
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue(writable),
    }));

    await expect(savePortableVaultFile(request())).resolves.toMatchObject({ state: 'failed' });
    expect(writable.close).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
  });
});
