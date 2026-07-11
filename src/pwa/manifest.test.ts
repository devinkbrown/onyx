// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type WebManifest = {
  start_url: string;
  scope: string;
  display: string;
  display_override?: string[];
  launch_handler?: { client_mode?: string[] };
  shortcuts?: Array<{ name: string; url: string }>;
  screenshots?: Array<{ src: string; sizes: string; form_factor: string; label: string }>;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(root, 'public', 'manifest.json');

function loadManifest(): WebManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as WebManifest;
}

describe('PWA manifest', () => {
  it('keeps installed launches on the app route with wrapper-safe display metadata', () => {
    const manifest = loadManifest();

    expect(manifest.start_url).toBe('/app');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toContain('window-controls-overlay');
    expect(manifest.launch_handler?.client_mode).toContain('navigate-existing');
  });

  it('declares app shortcuts and install screenshots backed by public assets', () => {
    const manifest = loadManifest();

    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual(['/app', '/status', '/stats']);
    expect(manifest.screenshots?.map((shot) => shot.form_factor).sort()).toEqual(['narrow', 'wide']);

    for (const screenshot of manifest.screenshots ?? []) {
      expect(screenshot.label).toMatch(/^Onyx /);
      expect(screenshot.sizes).toMatch(/^\d+x\d+$/);
      expect(existsSync(join(root, 'public', screenshot.src))).toBe(true);
    }
  });
});
