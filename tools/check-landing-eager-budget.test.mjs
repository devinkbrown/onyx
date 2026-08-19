// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNoEagerRuntimeChunk,
  checkLandingEagerBudget,
  extractEagerJsHrefs,
  LANDING_EAGER_JS_BUDGET_GZIP_BYTES,
} from './check-landing-eager-budget.mjs';

const fixtureRoot = resolve('.work');
const temporaryDirectories = [];

async function fixtureDirectory() {
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(resolve(fixtureRoot, 'landing-budget-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeAsset(distDir, path, contents) {
  const target = resolve(distDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('extractEagerJsHrefs', () => {
  it('collects module script srcs and modulepreload hrefs, deduped', () => {
    const html = [
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
      '<script src="/assets/legacy-nomodule.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/solid-def.js">',
      '<link rel="modulepreload" href="/assets/theme-ghi.js">',
      '<link rel="modulepreload" href="/assets/index-abc.js">',
      '<link rel="stylesheet" href="/assets/index-xyz.css">',
    ].join('\n');

    expect(extractEagerJsHrefs(html)).toEqual([
      '/assets/index-abc.js',
      '/assets/solid-def.js',
      '/assets/theme-ghi.js',
    ]);
  });
});

describe('assertNoEagerRuntimeChunk', () => {
  it('passes when no href is the runtime chunk', () => {
    expect(() => assertNoEagerRuntimeChunk(['/assets/solid-abc.js', '/assets/theme-def.js'])).not.toThrow();
  });

  it('throws when a hashed runtime chunk is eagerly preloaded', () => {
    expect(() => assertNoEagerRuntimeChunk(['/assets/runtime-Bz3o7n8T.js']))
      .toThrow(/eagerly loads the runtime chunk/);
  });

  it('does not false-positive on unrelated chunks containing "runtime" as a substring', () => {
    expect(() => assertNoEagerRuntimeChunk(['/assets/my-runtime-helper-abc.js'])).not.toThrow();
  });
});

describe('checkLandingEagerBudget', () => {
  it('passes for a small landing entry under budget with no runtime chunk', async () => {
    const distDir = await fixtureDirectory();
    await writeAsset(distDir, 'index.html', [
      '<script type="module" src="/assets/index-abc.js"></script>',
      '<link rel="modulepreload" href="/assets/solid-def.js">',
      '<link rel="modulepreload" href="/assets/theme-ghi.js">',
    ].join('\n'));
    await writeAsset(distDir, 'assets/index-abc.js', 'console.log(1);\n');
    await writeAsset(distDir, 'assets/solid-def.js', 'console.log(2);\n');
    await writeAsset(distDir, 'assets/theme-ghi.js', 'console.log(3);\n');

    const result = await checkLandingEagerBudget({ distDir });

    expect(result.hrefs).toEqual([
      '/assets/index-abc.js',
      '/assets/solid-def.js',
      '/assets/theme-ghi.js',
    ]);
    expect(result.gzipBytes).toBeLessThan(LANDING_EAGER_JS_BUDGET_GZIP_BYTES);
  });

  it('fails hard when index.html modulepreloads a runtime-*.js chunk, even under budget', async () => {
    const distDir = await fixtureDirectory();
    await writeAsset(distDir, 'index.html', [
      '<script type="module" src="/assets/index-abc.js"></script>',
      '<link rel="modulepreload" href="/assets/runtime-Bz3o7n8T.js">',
    ].join('\n'));
    await writeAsset(distDir, 'assets/index-abc.js', 'console.log(1);\n');
    await writeAsset(distDir, 'assets/runtime-Bz3o7n8T.js', 'console.log(2);\n');

    await expect(checkLandingEagerBudget({ distDir })).rejects.toThrow(/eagerly loads the runtime chunk/);
  });

  it('fails when landing eager JS exceeds the 150 KiB gzip budget', async () => {
    const distDir = await fixtureDirectory();
    await writeAsset(distDir, 'index.html', [
      '<script type="module" src="/assets/index-abc.js"></script>',
    ].join('\n'));
    // High-entropy bytes so gzip cannot compress this below the budget.
    const bytes = Buffer.from(
      Array.from({ length: 200 * 1024 }, () => Math.floor(Math.random() * 256)),
    );
    await writeAsset(distDir, 'assets/index-abc.js', bytes);

    await expect(checkLandingEagerBudget({ distDir })).rejects.toThrow(/over the 150 KiB budget/);
  });
});
