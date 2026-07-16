// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compressPortableJson,
  decompressPortableJson,
  isPortableGzipFile,
  PortableGzipError,
  supportsPortableGzip,
} from './portableCompression';

describe('portable vault gzip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips UTF-8 JSON through browser gzip streams', async () => {
    const json = JSON.stringify({ kind: 'onyx-vault', text: 'portable 石' });
    const compressed = await compressPortableJson(json);
    const file = new File([compressed], 'onyx-portable.json.gz', { type: 'application/gzip' });

    expect(compressed.type).toBe('application/gzip');
    await expect(decompressPortableJson(file)).resolves.toBe(json);
    expect(isPortableGzipFile(file)).toBe(true);
  });

  it('rejects compressed metadata over the ceiling before opening a stream', async () => {
    const stream = vi.fn();
    const file = {
      name: 'oversized.json.gz',
      type: 'application/gzip',
      size: 17,
      stream,
    } as unknown as File;

    await expect(decompressPortableJson(file, { maxCompressedBytes: 16 })).rejects.toMatchObject({
      code: 'compressed-limit',
    });
    expect(stream).not.toHaveBeenCalled();
  });

  it('cancels decompression when decoded JSON crosses its byte ceiling', async () => {
    const json = JSON.stringify({ text: 'x'.repeat(256) });
    const compressed = await compressPortableJson(json, {
      maxCompressedBytes: 1024,
      maxJsonBytes: 1024,
    });
    const file = new File([compressed], 'bounded.json.gz', { type: 'application/gzip' });

    await expect(decompressPortableJson(file, {
      maxCompressedBytes: 1024,
      maxJsonBytes: 32,
    })).rejects.toMatchObject({ code: 'json-limit' });
  });

  it('reports unsupported streams without exposing a partially working path', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);

    expect(supportsPortableGzip()).toBe(false);
    await expect(compressPortableJson('{}')).rejects.toBeInstanceOf(PortableGzipError);
  });
});
