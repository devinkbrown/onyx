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

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('locked public identity assets', () => {
  it('keeps the brand set under public/brand and the share/install derivatives', () => {
    for (const path of [
      'public/brand/mark.png',
      'public/brand/lockup.png',
      'public/brand/wordmark.png',
      'public/brand/mascot.png',
      'public/brand/mascot-transparent.png',
      'public/brand/mascot-wave.png',
      'public/brand/mascot-still.png',
      'public/brand/app-icon.png',
      'public/brand/og.png',
      'public/brand/favicon.png',
      'public/og.png',
      'public/icon-192.png',
      'public/icon-512.png',
      'public/icon-192-maskable.png',
      'public/icon-512-maskable.png',
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
    expect(pngSize('public/icon-192-maskable.png')).toEqual({ width: 192, height: 192 });
    expect(pngSize('public/icon-512-maskable.png')).toEqual({ width: 512, height: 512 });
    const apple = readFileSync(join(root, 'public/apple-touch-icon.png'));
    expect({ width: apple.readUInt32BE(16), height: apple.readUInt32BE(20) }).toEqual({ width: 180, height: 180 });
    expect(apple[25], 'apple-touch must be opaque RGB, not alpha').toBe(2);
    expect(apple.equals(readFileSync(join(root, 'public/favicon-32.png')))).toBe(false);

    const home = read('src/routes/Landing.tsx');
    const entry = read('index.html');
    expect(home).not.toMatch(/Pebble/);
    expect(home).toContain('/brand/mascot-transparent.png');
    const transparentMascot = readFileSync(join(root, 'public/brand/mascot-transparent.png'));
    expect(transparentMascot[25], 'landing mascot must use RGBA pixels').toBe(6);
    expect(entry).toContain('https://eshmaki.me/og.png');
    expect(entry).not.toContain('https://eshmaki.me/icon-512.png');
    expect(entry).toContain('summary_large_image');
  });

  it('derives install icons from the product mark, not the mascot', () => {
    const icon512 = readFileSync(join(root, 'public/icon-512.png'));
    const maskable = readFileSync(join(root, 'public/icon-512-maskable.png'));
    const apple = readFileSync(join(root, 'public/apple-touch-icon.png'));
    const appIcon = readFileSync(join(root, 'public/brand/app-icon.png'));
    const mascotStill = readFileSync(join(root, 'public/brand/mascot-still.png'));
    const wordmark = pngSize('public/brand/wordmark.png');
    const faviconSvg = read('public/favicon.svg');

    expect(wordmark.width).toBeGreaterThan(wordmark.height);
    expect(pngSize('public/brand/app-icon.png')).toEqual({ width: 1024, height: 1024 });
    expect(pngSize('public/brand/mascot-still.png')).toEqual({ width: 1024, height: 1024 });
    expect(apple.equals(icon512)).toBe(false);
    expect(maskable.equals(icon512)).toBe(false);
    expect(icon512.equals(mascotStill)).toBe(false);
    expect(appIcon.equals(mascotStill)).toBe(false);
    expect(faviconSvg).toContain('#05070a');
    expect(faviconSvg).toContain('#5ba3c9');
    expect(faviconSvg).toContain('rx="7.2"');
    expect(faviconSvg).toMatch(/<circle cx="20\.25" cy="12\.44"/);

    const header = read('src/ui/public/PublicHeader.tsx');
    expect(header).toContain('/brand/lockup.png');
    expect(header).toContain('/brand/wordmark.png');
    expect(header).toContain('BrandMark');
    expect(read('src/ui/public/BrandMark.tsx')).toContain('/brand/mark.png');
    expect(read('src/ui/public/PublicFooter.tsx')).toContain('/brand/mark.png');
  });

  it('uses the mascot at most once on each public page and never in chat chrome', () => {
    const home = read('src/routes/Landing.tsx');
    const about = read('src/routes/About.tsx');
    const invite = read('src/routes/Invite.tsx');
    expect(home.match(/\/brand\/mascot[^"]*/g)).toEqual(['/brand/mascot-transparent.png']);
    expect(about.match(/\/brand\/mascot[^"]*/g)).toEqual(['/brand/mascot-still.png']);
    expect(invite.match(/\/brand\/mascot[^"]*/g)).toEqual(['/brand/mascot-wave.png']);
    expect(about).not.toMatch(/Pebble/);
    expect(invite).not.toMatch(/Pebble/);

    const shell = [
      'src/shell/AppShell.tsx',
      'src/shell/Connect.tsx',
      'src/routes/ProductPreview.tsx',
    ];
    for (const path of shell) {
      if (!existsSync(join(root, path))) continue;
      expect(read(path), path).not.toMatch(/\/brand\/mascot/);
    }
  });
});
