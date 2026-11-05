// SPDX-License-Identifier: AGPL-3.0-or-later
// Build the Elm client site into a staging directory.
//
// Usage: node tools/build-elm-site.mjs <outDir>
//
// Prerequisites: `elm` 0.19.1 on PATH (and ELM_HOME when the package
// cache lives outside the default location). Fails closed otherwise.
// Minifies with the vendored esbuild when present, else ships the
// --optimize bundle with a warning.
import { copyFile, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build as viteBuild } from 'vite';
import { minifyElmScript } from './minify-elm-script.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const ELM_DIR = resolve(ROOT, 'elm');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function copyDirFiles(srcDir, destDir, names) {
  await mkdir(destDir, { recursive: true });
  for (const name of names) {
    await copyFile(resolve(srcDir, name), resolve(destDir, name));
  }
}

async function buildMediaRuntime(outDir) {
  const stage = await realpath(outDir);
  const output = stage;
  await viteBuild({
    configFile: false, root: ROOT, publicDir: false,
    resolve: { alias: { '@': resolve(ROOT, 'src') } },
    build: {
      target: 'es2022', outDir: output, emptyOutDir: false, manifest: 'runtime-manifest.json', sourcemap: false, minify: true,
      rollupOptions: { input: resolve(ELM_DIR, 'runtime/browser-entry.ts'), output: {
        format: 'iife', name: 'OnyxRuntime', entryFileNames: 'runtime.js', assetFileNames: 'assets/[name]-[hash][extname]',
      } },
    },
  });
  const runtimeBundle = await readFile(resolve(stage, 'runtime.js'), 'utf8');
  if (!runtimeBundle.includes('OnyxRuntime') || !runtimeBundle.includes('createBrowserRuntime')) {
    fail('browser runtime bundle is missing its OnyxRuntime.createBrowserRuntime export bridge');
  }
  for (const name of ['opcodec_wasm.js', 'opcodec_wasm.wasm']) await copyFile(resolve(ROOT, 'public', name), resolve(stage, name));
  const mediaRoot = resolve(stage, 'assets');
  const paths = [];
  const visit = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, item.name);
      if (item.isSymbolicLink()) fail(`media staging contains a symlink: ${absolute}`);
      if (item.isDirectory()) await visit(absolute);
      else if (item.isFile()) paths.push(`/${absolute.slice(stage.length + 1).split('\\').join('/')}`);
    }
  };
  await visit(mediaRoot);
  return paths.sort();
}

async function stampServiceWorker(outDir, mediaAssetPaths) {
  const assets = [
    '/index.html', '/app.js', '/runtime.js', '/ports.js', '/app.css', '/rail.css', '/site.css',
    '/brand/mark.png', '/brand/mascot-still.png', '/manifest.json', '/favicon.ico', '/favicon.svg',
    '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-192-maskable.png',
    '/icon-512.png', '/icon-512-maskable.png', '/og.png', '/opcodec_wasm.js', '/opcodec_wasm.wasm', '/runtime-manifest.json', ...mediaAssetPaths,
  ];
  const entries = await readdir(outDir, { withFileTypes: true });
  // `/onyxos/` is served by the standalone legacy onyxOS site that deploy.sh
  // stages beside the app, not by this route document, so its bytes never match
  // a precache hash. One mismatched shell asset fails the whole worker install
  // and strands every returning visitor on their old build, so keep it out.
  const routes = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !['brand', 'assets', 'onyxos'].includes(entry.name))
    .map(entry => `/${entry.name}/`).sort();
  const paths = [
    { path: '/', file: 'index.html' },
    ...assets.map(path => ({ path, file: path.slice(1) })),
    ...routes.map(path => ({ path, file: `${path.slice(1)}index.html` })),
  ];
  const shellAssets = [];
  for (const item of paths) {
    const bytes = await readFile(resolve(outDir, item.file));
    shellAssets.push({ path: item.path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const storageSchemas = { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 };
  const buildInput = { protocolVersion: 1, storageSchemaVersion: 5, storageSchemas, shellAssets, publicNavigationPaths: ['/', ...routes] };
  const shellRef = await readShellRef(outDir);
  if (!shellRef) fail('runtime shell reference was not stamped');
  const buildId = createHash('sha256').update(JSON.stringify({ shellRef, ...buildInput })).digest('hex').slice(0, 32);
  const buildCompatibility = { buildId, protocolVersion: 1, storageSchemas, shellAssets, publicNavigationPaths: ['/', ...routes] };
  const shellEnvelope = { shellRef, buildCompatibility };
  await writeFile(resolve(outDir, 'runtime-build.json'), JSON.stringify(shellEnvelope));
  const swPath = resolve(outDir, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  const token = '__ONYX_SW_BUILD_CONFIG__';
  if (sw.split(token).length !== 2) fail('service worker build config token must appear exactly once');
  await writeFile(swPath, sw.replace(token, JSON.stringify(shellEnvelope)));
}

async function readShellRef(outDir) {
  const indexPath = resolve(outDir, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  const match = /<meta name="onyx-shell-ref" content="([a-f0-9]{64})">/u.exec(index);
  return match?.[1] ?? null;
}

async function stampRuntimeShellRef(outDir) {
  const paths = ['/app.js', '/ports.js', '/runtime.js', '/index.html', '/sw.js'];
  const files = [];
  for (const path of paths) {
    const bytes = await readFile(resolve(outDir, path.slice(1)));
    const text = path.endsWith('.html') || path.endsWith('.js') ? bytes.toString('utf8') : '';
    const token = path === '/runtime.js' ? '__ONYX_PUBLIC_RUNTIME_SHELL_REF__'
      : path === '/index.html' ? '__ONYX_PUBLIC_INDEX_SHELL_REF__' : null;
    if (token && text.split(token).length !== 2) fail(`runtime shell reference token must appear exactly once in ${path}`);
    const unstamped = token ? Buffer.from(text, 'utf8') : bytes;
    files.push({ path, bytes: unstamped });
  }
  const storageSchemas = { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 };
  const shellRef = computeRuntimeShellRef(files, storageSchemas);
  for (const [path, token] of [['runtime.js', '__ONYX_PUBLIC_RUNTIME_SHELL_REF__'], ['index.html', '__ONYX_PUBLIC_INDEX_SHELL_REF__']]) {
    const file = resolve(outDir, path);
    const source = await readFile(file, 'utf8');
    if (source.split(token).length !== 2) fail(`runtime shell reference token must appear exactly once in ${path}`);
    await writeFile(file, source.replace(token, shellRef));
  }
}

export function computeRuntimeShellRef(files, storageSchemas) {
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  if (sorted.length === 0 || new Set(sorted.map(({ path }) => path)).size !== sorted.length) throw new Error('shell descriptor paths must be nonempty and unique');
  const descriptor = JSON.stringify({ schemaVersion: 1, storageSchemas,
    files: sorted.map(({ path, bytes }) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') })) });
  return createHash('sha256').update(descriptor, 'utf8').digest('hex');
}

async function findVendoredEsbuild() {
  try {
    const entries = await readdir(resolve(ROOT, 'node_modules/.pnpm'));
    const hit = entries.filter((e) => e.startsWith('esbuild@')).sort().at(-1);
    return hit ? resolve(ROOT, 'node_modules/.pnpm', hit, 'node_modules/esbuild/bin/esbuild') : null;
  } catch {
    return null;
  }
}

async function main() {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : null;
  if (!outDir) fail('usage: node tools/build-elm-site.mjs <outDir>');
  const forbiddenOutput = resolve(ROOT, 'out');
  if (outDir === forbiddenOutput || outDir.startsWith(`${forbiddenOutput}/`)) {
    fail('build output must use a staging directory such as dist/ or /tmp; only deploy.sh writes out/');
  }

  let elmVersion = null;
  try {
    elmVersion = Buffer.from(
      execFileSync('elm', ['--version'], { encoding: 'utf8', cwd: ELM_DIR }),
    )
      .toString()
      .trim();
  } catch {
    fail('`elm` 0.19.1 is required on PATH to build the Elm client (see elm/README.md toolchain section)');
  }
  if (elmVersion !== '0.19.1') fail(`expected elm 0.19.1, found ${elmVersion}`);

  await mkdir(outDir, { recursive: true });
  console.log('==> compiling Elm --optimize');
  try {
    execFileSync('elm', ['make', '--optimize', 'src/Main.elm', '--output', resolve(outDir, 'app.js')], {
      cwd: ELM_DIR,
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    fail('elm make failed — build broken, NOT staging');
  }

  const esbuild = await findVendoredEsbuild();
  if (esbuild) {
    console.log('==> minifying app.js');
    try {
      minifyElmScript(esbuild, resolve(outDir, 'app.js'), resolve(outDir, 'app.min.js'));
      const { rename } = await import('node:fs/promises');
      await rename(resolve(outDir, 'app.min.js'), resolve(outDir, 'app.js'));
    } catch {
      console.log('WARN: esbuild minify failed — shipping unminified --optimize bundle');
    }
  } else {
    fail('vendored esbuild is required to bundle the private browser runtime');
  }

  await copyDirFiles(ELM_DIR, outDir, ['index.html', 'ports.js', 'app.css', 'rail.css', 'site.css', 'sw.js']);
  await copyDirFiles(resolve(ELM_DIR, '..', 'public', 'brand'), resolve(outDir, 'brand'), ['mark.png', 'mascot-still.png']);
  await copyDirFiles(resolve(ROOT, 'public'), outDir, [
    'manifest.json',
    'favicon.ico',
    'favicon.svg',
    'favicon-32.png',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-192-maskable.png',
    'icon-512.png',
    'icon-512-maskable.png',
    'og.png',
    'robots.txt',
    'sitemap.xml',
  ]);

  console.log('==> bundling browser runtime and Cadence worker assets');
  let stagedMediaAssets;
  try { stagedMediaAssets = await buildMediaRuntime(outDir); }
  catch (error) { fail(`Cadence media runtime staging failed: ${error instanceof Error ? error.message : 'unknown error'}`); }

  await stampRuntimeShellRef(outDir);

  const { spawnSync } = await import('node:child_process');
  const materialized = spawnSync(process.execPath, [resolve(here, 'materialize-elm-routes.mjs'), outDir], { stdio: 'inherit' });
  if (materialized.status !== 0) fail('materialize-elm-routes failed');
  await stampServiceWorker(outDir, stagedMediaAssets);
  console.log(`==> Elm site staged at ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
