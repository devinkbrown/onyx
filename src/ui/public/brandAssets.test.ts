// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function pngSize(relativePath: string): { width: number; height: number } {
  const bytes = readFileSync(join(root, relativePath));
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('locked public identity assets', () => {
  it('keeps the brand set under public/brand and the share/install derivatives', () => {
    for (const path of [
      'public/brand/mark.png',
      'public/brand/lockup.png',
      'public/brand/mascot.png',
      'public/brand/mascot-wave.png',
      'public/brand/mascot-still.png',
      'public/brand/app-icon.png',
      'public/brand/og.png',
      'public/brand/favicon.png',
      'public/og.png',
      'public/icon-192.png',
      'public/icon-512.png',
      'public/apple-touch-icon.png',
      'public/favicon-32.png',
      'public/favicon.ico',
      'public/favicon.svg',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });

  it('exports the share image at exactly 1200×630 and does not use the cube icon', () => {
    expect(pngSize('public/og.png')).toEqual({ width: 1200, height: 630 });
    expect(pngSize('public/brand/og.png')).toEqual({ width: 1200, height: 630 });
    expect(pngSize('public/icon-512.png')).toEqual({ width: 512, height: 512 });
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });

    const home = readFileSync(join(root, 'src', 'routes', 'Landing.tsx'), 'utf8');
    const entry = readFileSync(join(root, 'index.html'), 'utf8');
    expect(home).not.toMatch(/Pebble/);
    expect(home).toContain('/brand/mascot.png');
    expect(entry).toContain('https://eshmaki.me/og.png');
    expect(entry).not.toContain('https://eshmaki.me/icon-512.png');
    expect(entry).toContain('summary_large_image');
  });
});
