// SPDX-License-Identifier: AGPL-3.0-or-later
import { PORTABLE_GZIP_MAX_JSON_BYTES } from './portableCompression';

export const PORTABLE_SHARE_MAX_JSON_BYTES = PORTABLE_GZIP_MAX_JSON_BYTES;

export type PortableShareResult = {
  state: 'shared' | 'cancelled' | 'unsupported' | 'rejected' | 'too-large';
  detail: string;
};

export type PortableShareOptions = {
  maxJsonBytes?: number;
  now?: Date;
};

function portableShareNavigator(): Navigator | null {
  if (typeof navigator === 'undefined') return null;
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return null;
    return navigator;
  } catch {
    return null;
  }
}

export function supportsPortableFileShare(): boolean {
  return portableShareNavigator() !== null && typeof File === 'function';
}

function utf8BytesWithin(text: string, maxBytes: number): number | null {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return null;
  const encoder = new TextEncoder();
  const chunkCodeUnits = 32 * 1024;
  let total = 0;
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + chunkCodeUnits, text.length);
    const lastCodeUnit = text.charCodeAt(end - 1);
    if (end < text.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1;
    const encoded = encoder.encode(text.slice(offset, end));
    total += encoded.byteLength;
    if (total > maxBytes) return null;
    offset = end;
  }
  return total;
}

function safePortableName(now: Date): string {
  const date = Number.isFinite(now.getTime())
    ? now.toISOString().slice(0, 10)
    : 'export';
  return `onyx-portable-${date}.json`;
}

function cancelledShare(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export async function sharePortableVaultJson(
  json: string,
  options?: PortableShareOptions,
): Promise<PortableShareResult> {
  const shareNavigator = portableShareNavigator();
  if (!shareNavigator || typeof File !== 'function') {
    return {
      state: 'unsupported',
      detail: 'This browser does not support sharing portable vault files. Export ordinary JSON instead.',
    };
  }

  const maxJsonBytes = options?.maxJsonBytes ?? PORTABLE_SHARE_MAX_JSON_BYTES;
  if (utf8BytesWithin(json, maxJsonBytes) === null) {
    return {
      state: 'too-large',
      detail: 'The portable vault exceeds the 64 MiB JSON sharing limit. Export the ordinary JSON file instead.',
    };
  }

  const file = new File(
    [json],
    safePortableName(options?.now ?? new Date()),
    { type: 'application/json' },
  );
  const fileData: ShareData = {
    files: [file],
  };

  try {
    if (!shareNavigator.canShare(fileData)) {
      return {
        state: 'unsupported',
        detail: 'This browser cannot share the generated portable vault file. Export ordinary JSON instead.',
      };
    }
  } catch {
    return {
      state: 'unsupported',
      detail: 'This browser could not confirm portable vault file sharing. Export ordinary JSON instead.',
    };
  }

  try {
    await shareNavigator.share({
      ...fileData,
      title: 'Onyx portable vault',
    });
    return {
      state: 'shared',
      detail: 'Portable vault file shared.',
    };
  } catch (error) {
    if (cancelledShare(error)) {
      return {
        state: 'cancelled',
        detail: 'Portable vault sharing cancelled.',
      };
    }
    return {
      state: 'rejected',
      detail: 'The browser rejected portable vault sharing. Export ordinary JSON instead.',
    };
  }
}
