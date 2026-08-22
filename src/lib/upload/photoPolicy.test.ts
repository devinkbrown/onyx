// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  hasJpegExif,
  hasPngExif,
  isPhotoFile,
  keepOriginalFile,
  photoQualityOptions,
  stripJpegExif,
  stripPngExif,
  stripPhotoExif,
} from './photoPolicy';

function jpegWithExif(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x10,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x02, 0x00, 0x03,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xff, 0xd9,
  ]);
}

function pngWithExif(): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrData = [
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x00, 0x00, 0x00, 0x00,
  ];
  const ihdr = chunk('IHDR', ihdrData);
  const exif = chunk('eXIf', [0x00, 0x00, 0x00, 0x00]);
  const iend = chunk('IEND', []);
  return Uint8Array.from([...signature, ...ihdr, ...exif, ...iend]);
}

function fileFromBytes(bytes: Uint8Array, name: string, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

function chunk(type: string, data: number[]): number[] {
  const length = [
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
  ];
  const typeBytes = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
  return [...length, ...typeBytes, ...data, 0, 0, 0, 0];
}

describe('photoPolicy', () => {
  it('treats camera stills as photos and documents as files', () => {
    expect(isPhotoFile({ name: 'IMG_0102.jpg', type: 'image/jpeg' })).toBe(true);
    expect(isPhotoFile({ name: 'harbour.png', type: 'image/png' })).toBe(true);
    expect(isPhotoFile({ name: 'notes.pdf', type: 'application/pdf' })).toBe(false);
    expect(isPhotoFile({ name: 'scan.gif', type: 'image/gif' })).toBe(false);
  });

  it('strips JPEG EXIF on the photo path and keeps it on Send original / file', async () => {
    const bytes = jpegWithExif();
    expect(hasJpegExif(bytes)).toBe(true);
    const stripped = stripJpegExif(bytes);
    expect(hasJpegExif(stripped)).toBe(false);
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);

    const original = fileFromBytes(bytes, 'harbour.jpg', 'image/jpeg');
    const photo = await stripPhotoExif(original);
    expect(hasJpegExif(new Uint8Array(await photo.arrayBuffer()))).toBe(false);
    expect(keepOriginalFile(original)).toBe(original);
    expect(hasJpegExif(new Uint8Array(await keepOriginalFile(original).arrayBuffer()))).toBe(true);
  });

  it('strips PNG eXIf on the photo path and keeps it on the file path', async () => {
    const bytes = pngWithExif();
    expect(hasPngExif(bytes)).toBe(true);
    expect(hasPngExif(stripPngExif(bytes))).toBe(false);

    const original = fileFromBytes(bytes, 'harbour.png', 'image/png');
    const photo = await stripPhotoExif(original);
    expect(hasPngExif(new Uint8Array(await photo.arrayBuffer()))).toBe(false);
    expect(hasPngExif(new Uint8Array(await keepOriginalFile(original).arrayBuffer()))).toBe(true);
  });

  it('labels Original and Compact with sizes when Compact exists', () => {
    const options = photoQualityOptions(2 * 1024 * 1024, 840 * 1024);
    expect(options[0]).toMatchObject({ quality: 'original', label: 'Original · 2.0 MB' });
    expect(options[1]).toMatchObject({ quality: 'compact', label: 'Compact · 840 KB' });
    expect(photoQualityOptions(2048, null)).toEqual([
      { quality: 'original', label: 'Original · 2.0 KB', bytes: 2048 },
    ]);
  });
});
