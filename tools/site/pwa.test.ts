// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTestSite } from './testSite.mjs';

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

// The root document exactly as tools/build-site.mjs emits it.
let entryDocument = '';

describe('PWA manifest', () => {
  beforeAll(() => {
    entryDocument = buildTestSite().read('index.html');
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

  it('states public-service entry truth and rejects premature desktop ship wording', () => {
    const document = new DOMParser().parseFromString(entryDocument, 'text/html');
    const title = document.querySelector('title')?.textContent ?? '';
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';
    const twitterDescription = document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? '';
    const entryMetadata = [title, description, ogDescription, twitterDescription].join('\n');

    expect(title).toBe('Onyx — good company. Great nights.');
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThanOrEqual(110);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).toMatch(/Rooms, calls, and private DMs/i);
    expect(description).toMatch(/this device/i);
    expect(description).toMatch(/400/);
    expect(description).toMatch(/No ads/i);
    expect(description).not.toMatch(/mesh telemetry|fully encrypted|cloud history/i);
    expect(ogDescription).toBe(description);
    expect(twitterDescription).toBe(description);
    expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    expect(entryDocument).not.toMatch(/googletagmanager|gtag\(|facebook\.net|adsbygoogle|plausible\.io|analytics\.js/i);
    expect(entryDocument).not.toMatch(/aggregateRating/i);

    // Premature native-ship promises must stay out of entry/share metadata.
    // Keep patterns specific so form-factor labels like "desktop room"
    // in the install manifest are not false positives.
    for (const surface of [entryDocument, entryMetadata]) {
      expect(surface).not.toMatch(/desktop apps are part of the launch/i);
      expect(surface).not.toMatch(/desktop apps with the launch/i);
      expect(surface).not.toMatch(/Desktop apps ship with the launch/i);
      expect(surface).not.toMatch(/Desktop with the launch/i);
      expect(surface).not.toMatch(/downloadable desktop apps are part of/i);
      expect(surface).not.toMatch(/signed installer available/i);
      expect(surface).not.toMatch(/get the desktop app/i);
      expect(surface).not.toMatch(/download now/i);
    }
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

  it('keeps install chrome aligned and does not overclaim full-bleed icons as maskable', () => {
    const manifest = loadManifest();
    const document = new DOMParser().parseFromString(entryDocument, 'text/html');

    expect(manifest.icons).toEqual([
      expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ src: '/icon-192-maskable.png', sizes: '192x192', purpose: 'maskable' }),
      expect.objectContaining({ src: '/icon-512-maskable.png', sizes: '512x512', purpose: 'maskable' }),
    ]);
    expect(manifest.icons?.some((icon) => icon.purpose.split(/\s+/).includes('maskable'))).toBe(true);
    expect(existsSync(join(root, 'public', 'icon-192-maskable.png'))).toBe(true);
    expect(existsSync(join(root, 'public', 'icon-512-maskable.png'))).toBe(true);
    // The document carries the Elm shell's boot colour; ports.js restyles
    // theme-color at runtime from the active palette. The manifest keeps the
    // brand ground used for the splash and the installed window chrome.
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
      .toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toBe('#05070a');
    expect(manifest.theme_color).not.toBe('#000306');
    expect(manifest.background_color).toBe(manifest.theme_color);
    expect(manifest.start_url).toBe('/app/');
    expect(manifest.display).toBe('standalone');
    const apple = document.querySelector('link[rel="apple-touch-icon"]');
    expect(apple?.getAttribute('href')).toBe('/apple-touch-icon.png');
    expect(apple?.getAttribute('sizes')).toBe('180x180');
    expect(entryDocument).not.toMatch(/beforeinstallprompt/i);
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

  it('backs entrypoint share and platform icon metadata with public assets', () => {
    const document = new DOMParser().parseFromString(entryDocument, 'text/html');
    const publicPaths = [
      document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
      document.querySelector('link[rel="icon"]')?.getAttribute('href'),
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
    ].map((value) => value ? new URL(value, 'https://eshmaki.me').pathname : '');

    expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe('Onyx');
    expect(document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content')).toMatch(/Onyx/i);
    expect(document.querySelector('meta[name="twitter:image:alt"]')?.getAttribute('content')).toMatch(/Onyx/i);
    expect(publicPaths).not.toContain('');
    for (const path of publicPaths) {
      expect(existsSync(join(root, 'public', path))).toBe(true);
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

  it('pins the flat, non-indexable branded 404 document contract', () => {
    const document = readFileSync(join(root, 'tools', 'site', 'document.mjs'), 'utf8');
    const deploy = readFileSync(deployScriptPath, 'utf8');

    expect(document).toContain("robots: 'noindex, nofollow'");
    expect(document).toContain('data-onyx-route-robots="true"');
    expect(document).toContain('canonical: null');
    expect(document).toContain('ogUrl: null');
    expect(document).toContain('ldJson: false');
    expect(deploy).toContain('test -f dist/404.html');
    expect(deploy).toContain('test ! -e dist/404/index.html');
    expect(deploy).toContain('live 404.html metadata contract is unsafe');
  });
});
