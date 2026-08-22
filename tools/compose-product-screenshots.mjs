#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = pathToFileURL(join(root, 'tools', 'compose-product-screenshots.html')).href;
const outDir = join(root, 'public', 'screenshots');

const shots = [
  { file: 'app-wide.png', width: 1280, height: 720, mobile: false },
  { file: 'app-mobile.png', width: 390, height: 844, mobile: true },
];

const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });
for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 1,
  });
  await page.goto(html, { waitUntil: 'networkidle' });
  if (shot.mobile) await page.locator('body').evaluate((el) => el.classList.add('mobile'));
  await page.screenshot({
    path: join(outDir, shot.file),
    type: 'png',
    clip: { x: 0, y: 0, width: shot.width, height: shot.height },
  });
  await page.close();
}
await browser.close();
console.log(`wrote ${shots.map((shot) => shot.file).join(', ')}`);
