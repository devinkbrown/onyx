// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

type WebManifest = {
  description: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  display_override?: string[];
  launch_handler?: { client_mode?: string[] };
  icons?: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  shortcuts?: Array<{ name: string; description: string; url: string }>;
  screenshots?: Array<{ src: string; sizes: string; form_factor: string; label: string }>;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(root, 'public', 'manifest.json');
const serviceWorkerPath = join(root, 'public', 'sw.js');
const deployScriptPath = join(root, 'deploy.sh');

function loadManifest(): WebManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as WebManifest;
}

// The root document the Elm site ships (tools/build-elm-site.mjs copies elm/index.html).
// The per-route <head> metadata is owned by tools/materialize-route-entrypoints.mjs;
// the retired Solid-era generator contracts (tools/build-site.mjs) were removed with it.
let entryDocument = '';

describe('PWA manifest', () => {
  beforeAll(() => {
    entryDocument = readFileSync(join(root, 'elm', 'index.html'), 'utf8');
  });

  it('keeps retired wire branding out of public install and entry metadata', () => {
    const manifest = loadManifest();
    const publicMetadata = [
      manifest.description,
      ...(manifest.shortcuts ?? []).flatMap((shortcut) => [shortcut.name, shortcut.description]),
      entryDocument,
    ].join('\n');

    expect(publicMetadata).not.toMatch(/IRCXNet/i);
    expect(manifest.description).toMatch(/rooms, messages, and calls/i);
    expect(manifest.description).not.toMatch(/\bmesh\b/i);
    expect(entryDocument).toContain('<title>Onyx — good company. Great nights.</title>');
  });

  it('keeps installed launches on the app route with wrapper-safe display metadata', () => {
    const manifest = loadManifest();

    expect(manifest.id).toBe('/app');
    expect(manifest.start_url).toBe('/app/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toContain('window-controls-overlay');
    expect(manifest.launch_handler?.client_mode).toContain('navigate-existing');
  });

  it('declares app shortcuts and install screenshots backed by public assets', () => {
    const manifest = loadManifest();
    const retiredScreenshotDigests = new Set([
      'c1542f755f1547ea55895c4f6fe330c40f6a3b2a8851ba0c3d66fae162b81cde',
      'ea3f78127f21dfb9b19151f249575e83da39b88406e568622d284677bd23e800',
      'a64646f03bc3b5c9dfb269b5299c881aee464248f371ebe4816033aedeba5f3d',
      '4c4b218173b70b15e7f16ba9e52be8b390f77d0f6da45e2f05d4837c849ed640',
    ]);

    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual(['/app/', '/status/', '/guidelines/']);
    expect(manifest.description).not.toMatch(/mesh telemetry/i);
    expect(manifest.screenshots?.every((shot) => !/connect/i.test(shot.label))).toBe(true);
    expect(manifest.screenshots?.map((shot) => shot.form_factor).sort()).toEqual(['narrow', 'wide']);

    for (const screenshot of manifest.screenshots ?? []) {
      expect(screenshot.label).toMatch(/^Onyx /);
      expect(screenshot.sizes).toMatch(/^\d+x\d+$/);
      const screenshotPath = join(root, 'public', screenshot.src);
      expect(existsSync(screenshotPath)).toBe(true);
      const digest = createHash('sha256').update(readFileSync(screenshotPath)).digest('hex');
      expect(retiredScreenshotDigests).not.toContain(digest);
    }
  });

  it('references notification icons that exist in public assets', () => {
    const worker = readFileSync(serviceWorkerPath, 'utf8');
    const notificationAssets = [...worker.matchAll(/(?:icon|badge):\s*'\/([^']+)'/g)]
      .map((match) => match[1])
      .filter((asset): asset is string => asset !== undefined);

    expect(notificationAssets.length).toBeGreaterThan(0);
    for (const asset of notificationAssets) {
      expect(existsSync(join(root, 'public', asset))).toBe(true);
    }
  });

  it('keeps the worker cache version contract aligned with deploy output', () => {
    const placeholder = 'onyx-shell-__BUILD_VERSION__';
    const worker = readFileSync(serviceWorkerPath, 'utf8');
    const deploy = readFileSync(deployScriptPath, 'utf8');
    const occurrences = worker.match(new RegExp(placeholder, 'g')) ?? [];

    expect(occurrences).toHaveLength(1);
    // deploy_main stamps with lowercase shell `version` (compose_version result).
    expect(deploy).toContain('s/onyx-shell-__BUILD_VERSION__/onyx-shell-${version}/');
    expect(deploy).toContain('grep -q "onyx-shell-${version}" dist/sw.js');

    const stamped = worker.replace(placeholder, 'onyx-shell-20260716-test');
    expect(stamped).not.toContain('__BUILD_VERSION__');
    expect(stamped).toContain("const CACHE_NAME = 'onyx-shell-20260716-test';");
  });

  it('fails closed before a missing community site can erase public routes', () => {
    const deploy = readFileSync(deployScriptPath, 'utf8');
    // Pin deploy_main ordering: LANDING must exist before client build and live sync.
    const deployMain = deploy.indexOf('deploy_main() {');
    const landingGuard = deploy.indexOf('test -d "${LANDING}"', deployMain);
    const clientBuild = deploy.indexOf(
      'NODE_OPTIONS="--disable-warning=DEP0205" pnpm build',
      deployMain,
    );
    const liveSync = deploy.indexOf(
      'sync_live_with_rollback "${ROOT}/dist" "${live_out}" "${version}"',
      deployMain,
    );

    expect(deployMain).toBeGreaterThanOrEqual(0);
    expect(landingGuard).toBeGreaterThan(deployMain);
    expect(clientBuild).toBeGreaterThan(landingGuard);
    expect(liveSync).toBeGreaterThan(clientBuild);
    expect(deploy).toContain(
      'FAIL: ${LANDING} missing — cannot stage legacy support resources',
    );
    // Fail-closed only — no optional/bare-SPA landing path.
    expect(deploy).not.toContain('deploying the bare SPA');
    expect(deploy).not.toMatch(/if \[ -d "\$\{LANDING\}" \]/);
  });

  it('keeps landing overlays out of application-owned routes and PWA assets', () => {
    const deploy = readFileSync(deployScriptPath, 'utf8');
    // Deterministic parse of SPA_OWNED_BLOCKLIST=( ... ) — not the removed for-reserved loop.
    const blocklistMatch = deploy.match(
      /SPA_OWNED_BLOCKLIST=\(\n([\s\S]*?)\n\)/,
    );
    expect(blocklistMatch).not.toBeNull();
    const blocklist = (blocklistMatch?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .sort();

    expect(blocklist).toEqual([
      '404.html',
      'about',
      'accessibility',
      'agents',
      'app',
      'appearance',
      'apple-touch-icon.png',
      'assets',
      'brand',
      'codecs',
      'community',
      'contact',
      'download',
      'downloads',
      'favicon-32.png',
      'favicon.ico',
      'favicon.svg',
      'glossary',
      'guidelines',
      'guides',
      'icon-192-maskable.png',
      'icon-192.png',
      'icon-512-maskable.png',
      'icon-512.png',
      'index.html',
      'install',
      'integrations',
      'invite',
      'manifest.json',
      'og.png',
      'opcodec_wasm.js',
      'opcodec_wasm.wasm',
      'privacy',
      'roadmap',
      'robots.txt',
      'screenshots',
      'sitemap.xml',
      'stats',
      'status',
      'sw.js',
    ]);
    // Current collision guard contract (assert_no_spa_owned_in_landing_dist).
    expect(deploy).toContain("conflicts with SPA-owned blocklist");
    expect(deploy).toContain("must not be on the legacy allowlist");
  });

});
