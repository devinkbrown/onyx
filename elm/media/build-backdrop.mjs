#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * build-backdrop.mjs — bundle the background renderer for the Elm build
 * (v3/gap-appearance).
 *
 *   node elm/media/build-backdrop.mjs <esbuild-binary> <out-dir>
 *
 * Emits <out-dir>/backdrop.js: the window.OnyxBackdrop adapter (IIFE) around
 * the canvas engine + its 17 canvas variants (elm/engine/backgrounds/engine.ts,
 * backgroundPolicy.ts, variants/*). build.sh hashes it with the other
 * index.html assets.
 *
 * Fails closed (non-zero exit) when the bundle would pull in anything outside
 * elm/engine + elm/media, when an expected variant is missing, or when the
 * output does not mount window.OnyxBackdrop.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const [esbuildBin, outDirArg] = process.argv.slice(2);
if (!esbuildBin || !outDirArg) {
  console.error('usage: node elm/media/build-backdrop.mjs <esbuild-binary> <out-dir>');
  process.exit(2);
}
const here = dirname(new URL(import.meta.url).pathname);
const repo = resolve(here, '../..');
const outDir = resolve(outDirArg);
const fail = (msg) => {
  console.error(`FAIL: build-backdrop: ${msg}`);
  process.exit(1);
};

// Point the esbuild JS API at the NATIVE binary next to the package (resolved
// through symlinks, so `node_modules/esbuild/bin/esbuild` and the pnpm store
// path both work). Never point it at the JS launcher script: that launcher
// re-executes ESBUILD_BINARY_PATH, i.e. itself, in an endless process chain.
// When the native binary is not found, leave the variable unset and let the
// API resolve its own.
if (!process.env.ESBUILD_BINARY_PATH) {
  const pkgDir = realpathSync(resolve(dirname(esbuildBin), '..'));
  const native = resolve(pkgDir, '..', '@esbuild', `${process.platform}-${process.arch}`, 'bin', 'esbuild');
  if (existsSync(native)) process.env.ESBUILD_BINARY_PATH = native;
}
const require = createRequire(import.meta.url);
const esbuild = require(resolve(dirname(esbuildBin), '..', 'lib', 'main.js'));

const outfile = join(outDir, 'backdrop.js');
const result = await esbuild.build({
  entryPoints: [join(here, 'backdrop.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  logLevel: 'warning',
  tsconfig: join(repo, 'tsconfig.json'),
  absWorkingDir: repo,
  legalComments: 'none',
  outfile,
  metafile: true,
});

const inputs = Object.keys(result.metafile.inputs);
const forbidden = inputs.filter((p) => !/^elm[\\/](engine|media)[\\/]/.test(p) || /\.tsx$/.test(p));
if (forbidden.length) fail(`backdrop bundle pulled in code outside elm/engine and elm/media: ${forbidden.join(', ')}`);
const variants = inputs.filter((p) => /backgrounds[\\/]variants[\\/][a-z-]+\.ts$/.test(p) && !/utils|layers/.test(p));
if (variants.length !== 17) fail(`expected the 17 canvas variants, bundled ${variants.length}`);
if (!inputs.some((p) => /backgrounds[\\/]engine\.ts$/.test(p))) fail('BackgroundEngine missing from the bundle');
if (!inputs.some((p) => /backgrounds[\\/]backgroundPolicy\.ts$/.test(p))) fail('backgroundPolicy missing from the bundle');
const text = readFileSync(outfile, 'utf8');
if (!text.includes('OnyxBackdrop')) fail('bundle does not mount window.OnyxBackdrop');
const kib = (statSync(outfile).size / 1024).toFixed(1);
console.log(`  backdrop: backdrop.js (${inputs.length} modules, ${variants.length} canvas variants, ${kib} KiB)`);
