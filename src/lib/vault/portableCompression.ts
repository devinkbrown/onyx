// SPDX-License-Identifier: AGPL-3.0-or-later

const MIB = 1024 * 1024;

export const PORTABLE_GZIP_MAX_COMPRESSED_BYTES = 16 * MIB;
export const PORTABLE_GZIP_MAX_JSON_BYTES = 64 * MIB;

export type PortableGzipErrorCode =
  | 'unsupported'
  | 'compressed-limit'
  | 'json-limit'
  | 'invalid-utf8'
  | 'stream';

export class PortableGzipError extends Error {
  constructor(readonly code: PortableGzipErrorCode, message: string) {
    super(message);
    this.name = 'PortableGzipError';
  }
}

export type PortableGzipLimits = {
  maxCompressedBytes?: number;
  maxJsonBytes?: number;
};

function limits(options?: PortableGzipLimits) {
  return {
    maxCompressedBytes: options?.maxCompressedBytes ?? PORTABLE_GZIP_MAX_COMPRESSED_BYTES,
    maxJsonBytes: options?.maxJsonBytes ?? PORTABLE_GZIP_MAX_JSON_BYTES,
  };
}

export function supportsPortableGzip(): boolean {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return false;
  try {
    void new CompressionStream('gzip');
    void new DecompressionStream('gzip');
    return true;
  } catch {
    return false;
  }
}

export function isPortableGzipFile(file: Pick<File, 'name' | 'type'>): boolean {
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  return name.endsWith('.json.gz') || type === 'application/gzip' || type === 'application/x-gzip';
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  limitCode: 'compressed-limit' | 'json-limit',
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size failure remains authoritative even if cancellation rejects.
        }
        throw new PortableGzipError(limitCode, 'Portable gzip byte limit exceeded');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof PortableGzipError) throw error;
    throw new PortableGzipError('stream', 'Portable gzip stream failed');
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function compressPortableJson(
  json: string,
  options?: PortableGzipLimits,
): Promise<Blob> {
  if (!supportsPortableGzip()) {
    throw new PortableGzipError('unsupported', 'Compression Streams are unavailable');
  }
  const bounds = limits(options);
  const encoded = new TextEncoder().encode(json);
  if (encoded.byteLength > bounds.maxJsonBytes) {
    throw new PortableGzipError('json-limit', 'Portable JSON byte limit exceeded');
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'));
  } catch {
    throw new PortableGzipError('stream', 'Portable gzip stream failed');
  }
  const compressed = await readBounded(stream, bounds.maxCompressedBytes, 'compressed-limit');
  const compressedBuffer = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(compressedBuffer).set(compressed);
  return new Blob([compressedBuffer], { type: 'application/gzip' });
}

export async function decompressPortableJson(
  file: File,
  options?: PortableGzipLimits,
): Promise<string> {
  if (!supportsPortableGzip()) {
    throw new PortableGzipError('unsupported', 'Compression Streams are unavailable');
  }
  const bounds = limits(options);
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > bounds.maxCompressedBytes) {
    throw new PortableGzipError('compressed-limit', 'Portable gzip byte limit exceeded');
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  } catch {
    throw new PortableGzipError('stream', 'Portable gzip stream failed');
  }
  const decompressed = await readBounded(stream, bounds.maxJsonBytes, 'json-limit');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
  } catch {
    throw new PortableGzipError('invalid-utf8', 'Portable gzip did not contain UTF-8 JSON');
  }
}
