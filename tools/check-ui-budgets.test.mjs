// SPDX-License-Identifier: AGPL-3.0-or-later
/* global structuredClone */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ceilingFromHeadroom,
  compareUiBudgets,
  measureUiBudgets,
  UI_BUDGET_SCHEMA,
} from './check-ui-budgets.mjs';

const fixtureRoot = resolve('.work');
const temporaryDirectories = [];

async function fixtureDirectory() {
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(resolve(fixtureRoot, 'ui-budget-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeAsset(distDir, path, contents) {
  const target = resolve(distDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function viteManifest(names = {}, { runtimeCss = false } = {}) {
  const files = {
    indexJs: names.indexJs ?? 'index-entry.js',
    indexCss: names.indexCss ?? 'index-style.css',
    runtimeJs: names.runtimeJs ?? 'runtime-shared.js',
    appShellJs: names.appShellJs ?? 'AppShell-route.js',
    appShellCss: names.appShellCss ?? 'AppShell-route.css',
    mediaJs: names.mediaJs ?? 'media-calls.js',
    workerJs: names.workerJs ?? 'videoEncodeWorker-codec.js',
    ...(runtimeCss ? { runtimeCss: names.runtimeCss ?? 'runtime-import.css' } : {}),
  };
  const asset = (name) => `assets/${name}`;
  return {
    files,
    manifest: {
      'src/index.tsx': {
        file: asset(files.indexJs),
        src: 'src/index.tsx',
        isEntry: true,
        imports: ['_runtime'],
        css: [asset(files.indexCss)],
        dynamicImports: ['src/app/AppShell.tsx'],
      },
      _runtime: {
        file: asset(files.runtimeJs),
        name: 'runtime',
        ...(runtimeCss ? { css: [asset(files.runtimeCss)] } : {}),
      },
      'src/app/AppShell.tsx': {
        file: asset(files.appShellJs),
        src: 'src/app/AppShell.tsx',
        isDynamicEntry: true,
        css: [asset(files.appShellCss)],
        dynamicImports: ['src/lib/cadence-media/index.ts'],
      },
      'src/lib/cadence-media/index.ts': {
        file: asset(files.mediaJs),
        src: 'src/lib/cadence-media/index.ts',
        isDynamicEntry: true,
      },
    },
  };
}

async function createManifestFixture({ names, reverseManifest = false, omit = [], runtimeCss = false } = {}) {
  const distDir = await fixtureDirectory();
  const { files, manifest } = viteManifest(names, { runtimeCss });
  const orderedManifest = reverseManifest
    ? Object.fromEntries(Object.entries(manifest).reverse())
    : manifest;
  await writeAsset(distDir, '.vite/manifest.json', JSON.stringify(orderedManifest));
  for (const [role, file] of Object.entries(files)) {
    if (!omit.includes(role)) await writeAsset(distDir, `assets/${file}`, `fixture:${role}\n`);
  }
  return { distDir, files };
}

async function createOutputFixture({ vendor = false } = {}) {
  const distDir = await fixtureDirectory();
  const files = [
    'index-fallback.js',
    'index-fallback.css',
    'runtime-fallback.js',
    'AppShell-fallback.js',
    'AppShell-fallback.css',
    'media-fallback.js',
    'videoEncodeWorker-fallback.js',
  ];
  if (vendor) files.push('vendor-arbitrary.js');
  await writeAsset(distDir, 'manifest.json', JSON.stringify({ name: 'Onyx', start_url: '/' }));
  await writeAsset(distDir, 'index.html', [
    '<script type="module" src="/assets/index-fallback.js"></script>',
    '<link rel="stylesheet" href="/assets/index-fallback.css">',
    '<link rel="modulepreload" href="/assets/runtime-fallback.js">',
    ...(vendor ? ['<link rel="modulepreload" href="/assets/vendor-arbitrary.js">'] : []),
  ].join('\n'));
  for (const file of files) {
    const contents = file === 'vendor-arbitrary.js' ? 'x'.repeat(100_000) : `fixture:${file}\n`;
    await writeAsset(distDir, `assets/${file}`, contents);
  }
  return { distDir };
}

function baselineFor(report, headroomPercent) {
  return {
    schema: UI_BUDGET_SCHEMA,
    policy: { headroomPercent },
    groups: Object.fromEntries(Object.entries(report.groups).map(([role, group]) => [role, {
      count: group.count,
      rawBytes: group.rawBytes,
      gzipBytes: group.gzipBytes,
      rawCeilingBytes: ceilingFromHeadroom(group.rawBytes, headroomPercent),
      gzipCeilingBytes: ceilingFromHeadroom(group.gzipBytes, headroomPercent),
    }])),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('UI performance budget measurement', () => {
  it('hashes bytes and produces a stable digest regardless of manifest key order', async () => {
    const first = await createManifestFixture();
    const second = await createManifestFixture({ reverseManifest: true });

    const firstReport = await measureUiBudgets({ distDir: first.distDir });
    const secondReport = await measureUiBudgets({ distDir: second.distDir });
    const expectedHash = createHash('sha256').update('fixture:appShellJs\n').digest('hex');

    expect(firstReport.groups.appShellJs.artifacts[0].sha256).toBe(expectedHash);
    expect(firstReport.groups.lazyMediaJs.artifacts.map((artifact) => artifact.path)).toEqual([
      'assets/media-calls.js',
      'assets/videoEncodeWorker-codec.js',
    ]);
    expect(firstReport.buildDigest).toBe(secondReport.buildDigest);
  });

  it('classifies roles when Vite content hashes and separators vary', async () => {
    const fixture = await createManifestFixture({
      names: {
        indexJs: 'index.ABC_123.js',
        indexCss: 'index-Z9_y.css',
        runtimeJs: 'runtime.v2_LONG.js',
        appShellJs: 'AppShell.42_mix.js',
        appShellCss: 'AppShell-42_mix.css',
        mediaJs: 'media.2026_alpha.js',
        workerJs: 'videoEncodeWorker-X_y.9.js',
      },
    });

    const report = await measureUiBudgets({ distDir: fixture.distDir });

    expect(report.source).toBe('vite-manifest');
    expect(report.groups.eagerIndexJs.artifacts[0].path).toContain(fixture.files.indexJs);
    expect(report.groups.sharedRuntimeJs.artifacts[0].path).toContain(fixture.files.runtimeJs);
    expect(report.groups.appShellCss.artifacts[0].path).toContain(fixture.files.appShellCss);
    expect(report.groups.lazyMediaJs.count).toBe(2);
  });

  it('fails with the exact missing artifact instead of silently undercounting', async () => {
    const fixture = await createManifestFixture({ omit: ['appShellCss'] });

    await expect(measureUiBudgets({ distDir: fixture.distDir }))
      .rejects.toThrow(`Missing UI budget artifact assets/${fixture.files.appShellCss}`);
  });

  it('uses Math.ceil for fractional thresholds and fails one byte over a ceiling', async () => {
    const fixture = await createManifestFixture();
    const report = await measureUiBudgets({ distDir: fixture.distDir });
    const baseline = baselineFor(report, 0.5);

    expect(ceilingFromHeadroom(100, 0.5)).toBe(101);
    expect(compareUiBudgets(report, baseline)).toEqual({ ok: true, issues: [] });

    const regressed = structuredClone(report);
    regressed.groups.eagerIndexJs.rawBytes = baseline.groups.eagerIndexJs.rawCeilingBytes + 1;
    const comparison = compareUiBudgets(regressed, baseline);
    expect(comparison.ok).toBe(false);
    expect(comparison.issues[0]).toContain('above the');
    expect(comparison.issues[0]).toContain('Keep public-route dependencies');

    const incorrectlyRounded = structuredClone(baseline);
    incorrectlyRounded.groups.eagerIndexJs.rawCeilingBytes -= 1;
    expect(() => compareUiBudgets(report, incorrectlyRounded)).toThrow('ceilings must use Math.ceil');
  });

  it('falls back to index.html and emitted assets when only the PWA manifest exists', async () => {
    const { distDir } = await createOutputFixture();

    const report = await measureUiBudgets({ distDir });

    expect(report.source).toBe('vite-output');
    expect(report.groups.eagerJs.artifacts.map((artifact) => artifact.path)).toEqual([
      'assets/index-fallback.js',
      'assets/runtime-fallback.js',
    ]);
    expect(report.groups.eagerIndexJs.artifacts[0].path).toBe('assets/index-fallback.js');
    expect(report.groups.lazyMediaJs.count).toBe(2);
  });

  it('counts arbitrary eager preload chunks so renamed vendor growth cannot evade the ratchet', async () => {
    const baselineFixture = await createOutputFixture();
    const vendorFixture = await createOutputFixture({ vendor: true });
    const baselineReport = await measureUiBudgets({ distDir: baselineFixture.distDir });
    const vendorReport = await measureUiBudgets({ distDir: vendorFixture.distDir });
    const comparison = compareUiBudgets(vendorReport, baselineFor(baselineReport, 5));

    expect(vendorReport.groups.eagerJs.artifacts.map((artifact) => artifact.path))
      .toContain('assets/vendor-arbitrary.js');
    expect(comparison.ok).toBe(false);
    expect(comparison.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Total eager JS emitted 3 artifacts; baseline expects 2'),
      expect.stringContaining('Total eager JS raw is'),
    ]));
  });

  it('counts CSS attached to static manifest imports so split styles cannot evade the ratchet', async () => {
    const baselineFixture = await createManifestFixture();
    const cssFixture = await createManifestFixture({ runtimeCss: true });
    await writeAsset(cssFixture.distDir, `assets/${cssFixture.files.runtimeCss}`, 'x'.repeat(100_000));
    const baselineReport = await measureUiBudgets({ distDir: baselineFixture.distDir });
    const cssReport = await measureUiBudgets({ distDir: cssFixture.distDir });
    const comparison = compareUiBudgets(cssReport, baselineFor(baselineReport, 5));

    expect(cssReport.groups.eagerCss.artifacts.map((artifact) => artifact.path))
      .toContain(`assets/${cssFixture.files.runtimeCss}`);
    expect(comparison.ok).toBe(false);
    expect(comparison.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Total eager CSS emitted 2 artifacts; baseline expects 1'),
      expect.stringContaining('Total eager CSS raw is'),
    ]));
  });
});
