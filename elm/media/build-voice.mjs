#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * build-voice.mjs — bundle the Cadence voice engine for the Elm build.
 *
 *   node elm/media/build-voice.mjs <esbuild-binary> <out-dir>
 *
 * Emits into <out-dir> (elm/dist-elm):
 *   voice-worker.<sha12>.js  the video encode worker (module worker, ESM)
 *   voice.js                 the window.OnyxVoiceEngine adapter (IIFE);
 *                            build.sh hashes it with the other index.html
 *                            assets
 *   opcodec_wasm.js / .wasm  the codec, copied from public/ (the engine loads
 *                            it from the site root, where tools/build-site.mjs
 *                            serves public/ too)
 *
 * The engine lives in elm/engine (the `@/` alias, see tsconfig.json). MediaEngine.ts
 * spawns its worker with the bundler idiom
 * `new URL('./videoEncodeWorker.ts', import.meta.url)`, which plain esbuild
 * cannot resolve (IIFE `import.meta` is empty). A load hook rewrites exactly
 * that expression to the hashed worker URL voice-engine.ts publishes; the
 * build FAILS if the expression is ever missing so the rewrite cannot rot.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const [esbuildBin, outDirArg] = process.argv.slice(2);
if (!esbuildBin || !outDirArg) {
  console.error('usage: node elm/media/build-voice.mjs <esbuild-binary> <out-dir>');
  process.exit(2);
}
const here = dirname(new URL(import.meta.url).pathname);
const repo = resolve(here, '../..');
const outDir = resolve(outDirArg);
const fail = (msg) => {
  console.error(`FAIL: build-voice: ${msg}`);
  process.exit(1);
};

// The esbuild JS API lives next to the CLI the build already located.
process.env.ESBUILD_BINARY_PATH ||= (() => {
  const pkgDir = resolve(dirname(esbuildBin), '..');
  const native = resolve(pkgDir, '..', '@esbuild', `${process.platform}-${process.arch}`, 'bin', 'esbuild');
  return existsSync(native) ? native : esbuildBin;
})();
const require = createRequire(import.meta.url);
const esbuild = require(resolve(dirname(esbuildBin), '..', 'lib', 'main.js'));

const sha12 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
const common = {
  bundle: true,
  minify: true,
  target: 'es2020',
  logLevel: 'warning',
  tsconfig: join(repo, 'tsconfig.json'),
  absWorkingDir: repo,
  legalComments: 'none',
};

// 1. video encode worker ---------------------------------------------------
const workerTmp = join(outDir, 'voice-worker.js');
await esbuild.build({
  ...common,
  entryPoints: [join(repo, 'elm/engine/lib/cadence-media/videoEncodeWorker.ts')],
  format: 'esm',
  outfile: workerTmp,
});
const workerName = `voice-worker.${sha12(workerTmp)}.js`;
renameSync(workerTmp, join(outDir, workerName));

// 2. adapter + engine --------------------------------------------------------
const WORKER_EXPR = "new URL('./videoEncodeWorker.ts', import.meta.url)";
const workerUrlPlugin = {
  name: 'onyx-video-worker-url',
  setup(build) {
    build.onLoad({ filter: /cadence-media[\\/]MediaEngine\.ts$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes(WORKER_EXPR)) {
        return { errors: [{ text: `MediaEngine.ts no longer contains ${WORKER_EXPR}; update build-voice.mjs` }] };
      }
      const contents = src.replace(
        WORKER_EXPR,
        "new URL(globalThis.__onyxVideoWorkerUrl || 'voice-worker-missing.js', globalThis.location.href)",
      );
      return { contents, loader: 'ts' };
    });
  },
};
const result = await esbuild.build({
  ...common,
  entryPoints: [join(here, 'voice-engine.ts')],
  format: 'iife',
  outfile: join(outDir, 'voice.js'),
  define: { __ONYX_VIDEO_WORKER__: JSON.stringify(workerName) },
  plugins: [workerUrlPlugin],
  metafile: true,
});
const inputs = Object.keys(result.metafile.inputs);
// The bundle may contain engine and glue code only: nothing from node_modules
// and nothing outside elm/engine + elm/media.
const stray = inputs.filter((p) => !/^elm[\\/](engine|media)[\\/]/.test(p));
if (stray.length) fail(`voice bundle pulled in code outside elm/engine and elm/media: ${stray.join(', ')}`);

// 3. codec -----------------------------------------------------------------
for (const name of ['opcodec_wasm.js', 'opcodec_wasm.wasm']) {
  const src = join(repo, 'public', name);
  if (!existsSync(src)) fail(`public/${name} missing`);
  copyFileSync(src, join(outDir, name));
}
console.log(`  voice engine: voice.js (${inputs.length} modules), ${workerName}, opcodec_wasm.{js,wasm}`);
