// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Photo vs file policy for composer attachments.
 *
 * Photo path (camera/gallery images we treat as photos): strip EXIF.
 * File / Send original: keep the bytes, including EXIF.
 * Compact is optional and never silent — callers must show sizes.
 */

import { formatAttachmentBytes } from './attachmentCaps';

export type PhotoQuality = 'original' | 'compact';
export type AttachmentTreatAs = 'photo' | 'file';

export type PhotoQualityOption = {
  quality: PhotoQuality;
  label: string;
  bytes: number;
};

const PHOTO_MIME = /^image\/(jpeg|jpg|pjpeg|png|webp)$/i;
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;
const JPEG_EXIF_MAGIC = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // Exif\0\0

export function isPhotoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return PHOTO_MIME.test(file.type) || PHOTO_EXT.test(file.name);
}

export function hasJpegExif(data: Uint8Array): boolean {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return false;
    const marker = data[offset + 1];
    if (marker === undefined) return false;
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) return false;
    const length = ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0);
    if (length < 2 || offset + 2 + length > data.length) return false;
    if (marker === 0xe1 && length >= 8) {
      const payload = data.subarray(offset + 4, offset + 10);
      if (matchesBytes(payload, JPEG_EXIF_MAGIC)) return true;
    }
    offset += 2 + length;
  }
  return false;
}

export function hasPngExif(data: Uint8Array): boolean {
  if (!isPng(data)) return false;
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = readU32(data, offset);
    const type = chunkType(data, offset + 4);
    if (offset + 12 + length > data.length) return false;
    if (type === 'eXIf') return true;
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return false;
}

export function stripJpegExif(data: Uint8Array): Uint8Array {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return data;
  const parts: Uint8Array[] = [data.subarray(0, 2)];
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      parts.push(data.subarray(offset));
      break;
    }
    let markerAt = offset + 1;
    while (markerAt < data.length && data[markerAt] === 0xff) markerAt += 1;
    const marker = data[markerAt];
    if (marker === undefined) break;
    const start = markerAt - 1;
    if (marker === 0xd9) {
      parts.push(data.subarray(start, start + 2));
      break;
    }
    if (marker === 0xda) {
      parts.push(data.subarray(start));
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      parts.push(data.subarray(start, start + 2));
      offset = start + 2;
      continue;
    }
    if (start + 4 > data.length) {
      parts.push(data.subarray(start));
      break;
    }
    const length = ((data[start + 2] ?? 0) << 8) | (data[start + 3] ?? 0);
    const end = start + 2 + length;
    if (length < 2 || end > data.length) {
      parts.push(data.subarray(start));
      break;
    }
    if (marker !== 0xe1) parts.push(data.subarray(start, end));
    offset = end;
  }
  return concatBytes(parts);
}

export function stripPngExif(data: Uint8Array): Uint8Array {
  if (!isPng(data)) return data;
  const parts: Uint8Array[] = [data.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = readU32(data, offset);
    const type = chunkType(data, offset + 4);
    const end = offset + 12 + length;
    if (end > data.length) break;
    if (type !== 'eXIf') parts.push(data.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return concatBytes(parts);
}

/** Strip EXIF from a photo File. File / Send original callers must not use this. */
export async function stripPhotoExif(file: File): Promise<File> {
  const data = new Uint8Array(await file.arrayBuffer());
  const stripped = file.type === 'image/png' || /\.png$/i.test(file.name)
    ? stripPngExif(data)
    : stripJpegExif(data);
  if (stripped === data || sameBytes(stripped, data)) return file;
  return new File([toArrayBuffer(stripped)], file.name, {
    type: file.type || 'image/jpeg',
    lastModified: file.lastModified,
  });
}

/** File chips and Send original keep the bytes, including EXIF. */
export function keepOriginalFile(file: File): File {
  return file;
}

export type CompactPhotoResult = {
  file: File;
  originalBytes: number;
  compactBytes: number;
};

/**
 * Optional Compact path. Returns null when the environment cannot recompress
 * (tests, missing canvas). Never silently replaces the original.
 */
export async function compactPhoto(file: File): Promise<CompactPhotoResult | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.72);
  });
  if (!blob) return null;
  const name = file.name.replace(/\.[^.]+$/u, '') || 'photo';
  return {
    file: new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }),
    originalBytes: file.size,
    compactBytes: blob.size,
  };
}

export function photoQualityOptions(
  originalBytes: number,
  compactBytes: number | null,
): PhotoQualityOption[] {
  const options: PhotoQualityOption[] = [{
    quality: 'original',
    label: `Original · ${formatAttachmentBytes(originalBytes)}`,
    bytes: originalBytes,
  }];
  if (compactBytes !== null) {
    options.push({
      quality: 'compact',
      label: `Compact · ${formatAttachmentBytes(compactBytes)}`,
      bytes: compactBytes,
    });
  }
  return options;
}

function isPng(data: Uint8Array): boolean {
  return data.length >= 8
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47
    && data[4] === 0x0d
    && data[5] === 0x0a
    && data[6] === 0x1a
    && data[7] === 0x0a;
}

function chunkType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  );
}

function readU32(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 24)
    | ((data[offset + 1] ?? 0) << 16)
    | ((data[offset + 2] ?? 0) << 8)
    | (data[offset + 3] ?? 0);
}

function matchesBytes(data: Uint8Array, expected: readonly number[]): boolean {
  if (data.length < expected.length) return false;
  return expected.every((value, index) => data[index] === value);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
