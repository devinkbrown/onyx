#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * build-site.mjs — assemble the complete static site (dist/) from the Elm
 * build, public/, and the route table. This is the ONLY thing `pnpm build`
 * produces; deploy.sh stages dist/ and syncs it to the live out/.
 *
 *   node tools/build-site.mjs [--elm elm/dist-elm] [--public public] [--out dist]
 *
 *   1. dist/  <- public/ verbatim (icons, manifest, sw.js, robots/sitemap,
 *      brand art, screenshots, opcodec_wasm.*, source/…)
 *   2. dist/assets/elm/  <- the Elm build's content-hashed scripts and
 *      stylesheets (the deploy's retained, cache-first asset tree)
 *   3. one HTML document per route in tools/site/routes.mjs, plus the root
 *      index.html and the flat, non-indexable 404.html: route <head> metadata
 *      + the Elm head parts + the Elm boot body (tools/site/document.mjs)
 *
 * Non-document files (feeds, downloads, onyxOS, sw.js, icons, …) come from
 * public/ untouched. Fails closed: exits non-zero when anything expected is
 * missing, malformed, or would collide.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allPages, ASSET_PREFIX, elmParts, renderDocument } from './site/document.mjs';

const REQUIRED_ASSETS = [
  [/^app\.[0-9a-f]{12}\.js$/, 'app.*.js (the Elm program)'],
  [/^ports\.[0-9a-f]{12}\.js$/, 'ports.*.js'],
  [/^historyImport\.[0-9a-f]{12}\.js$/, 'historyImport.*.js (history importers)'],
  [/^voice\.[0-9a-f]{12}\.js$/, 'voice.*.js (calls engine)'],
  [/^voice-worker\.[0-9a-f]{12}\.js$/, 'voice-worker.*.js'],
  [/^backdrop\.[0-9a-f]{12}\.js$/, 'backdrop.*.js (background renderer)'],
  [/^app\.[0-9a-f]{12}\.css$/, 'app.*.css'],
];
const HASHED_ROOT = /^(app|ports|voice|voice-worker|backdrop|historyImport)\.[0-9a-f]{12}\.(js|css)$/;
const HASHED_CSS = /^[a-z0-9-]+\.[0-9a-f]{12}\.css$/;

export class SiteBuildError extends Error {}
const fail = (message) => {
  throw new SiteBuildError(message);
};

function guardOutDir(repo, out) {
  if (basename(out) === 'out') fail(`refusing to build into ${out}: only deploy.sh writes the live out/`);
  const repoReal = realpathSync(repo);
  const parent = existsSync(out) ? realpathSync(out) : resolve(realpathSync(dirname(out)), basename(out));
  if (parent === repoReal || repoReal.startsWith(parent + sep)) {
    fail(`refusing to build into ${out}: it contains the repository`);
  }
  if (existsSync(join(out, '.git')) || existsSync(join(out, 'package.json'))) {
    fail(`refusing to clear ${out}: it looks like a source tree, not a build directory`);
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`${path} is a symlink; the site tree must be plain files`);
    if (stat.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Build the site; returns a summary. Throws SiteBuildError on any failed check. */
export function buildSite({ repo, elmDist, publicDir, out }) {
  const log = [];
  if (!existsSync(join(elmDist, 'index.html'))) fail(`${elmDist}/index.html missing (run elm/tools/build.sh)`);
  if (!existsSync(publicDir)) fail(`${publicDir} missing`);
  guardOutDir(repo, out);

  // 1. Elm parts + assets ---------------------------------------------------
  let parts;
  try {
    parts = elmParts(readFileSync(join(elmDist, 'index.html'), 'utf8'));
  } catch (error) {
    fail(error.message);
  }
  const assets = [];
  for (const name of readdirSync(elmDist)) if (HASHED_ROOT.test(name)) assets.push(name);
  for (const [pattern, label] of REQUIRED_ASSETS) {
    if (!assets.some((name) => pattern.test(name))) fail(`hashed ${label} not found in ${elmDist}`);
  }
  const cssAssets = [];
  const cssDir = join(elmDist, 'css');
  if (existsSync(cssDir)) for (const name of readdirSync(cssDir)) if (HASHED_CSS.test(name)) cssAssets.push(name);
  if (!cssAssets.some((name) => /^gap-appearance\.[0-9a-f]{12}\.css$/.test(name))) {
    fail(`hashed css/gap-appearance.*.css (theme bridge) not found in ${elmDist}`);
  }
  const known = new Set([...assets, ...cssAssets.map((name) => `css/${name}`)]);
  for (const ref of [...parts.bootBody.matchAll(/src="([^"]+)"/g), ...parts.styles.flatMap((tag) => [...tag.matchAll(/href="([^"]+)"/g)])]) {
    const path = ref[1];
    if (path.startsWith(ASSET_PREFIX) && !known.has(path.slice(ASSET_PREFIX.length))) {
      fail(`the Elm document references ${path}, which is not in ${elmDist}`);
    }
  }

  // 2. public/ -----------------------------------------------------------------
  const publicFiles = [...walk(publicDir)].map((path) => relative(publicDir, path).split(sep).join('/'));
  const pages = allPages();
  const pageFiles = new Set(pages.map((page) => page.file));
  if (pageFiles.size !== pages.length) fail('two pages map to the same output file');
  for (const file of publicFiles) {
    if (pageFiles.has(file)) fail(`public/${file} would be overwritten by a generated document`);
    if (file.startsWith('assets/elm/')) fail(`public/${file} collides with the Elm asset tree`);
  }
  for (const required of ['sw.js', 'manifest.json', 'robots.txt', 'sitemap.xml', 'opcodec_wasm.js', 'opcodec_wasm.wasm']) {
    if (!publicFiles.includes(required)) fail(`public/${required} missing`);
  }
  const worker = readFileSync(join(publicDir, 'sw.js'), 'utf8');
  if ((worker.match(/onyx-shell-__BUILD_VERSION__/g) ?? []).length !== 1) {
    fail("public/sw.js must contain exactly one 'onyx-shell-__BUILD_VERSION__' placeholder (deploy.sh stamps it)");
  }

  // 3. write ---------------------------------------------------------------------
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(publicDir, out, { recursive: true, dereference: false });
  const assetOut = join(out, 'assets', 'elm');
  mkdirSync(join(assetOut, 'css'), { recursive: true });
  for (const name of assets) copyFileSync(join(elmDist, name), join(assetOut, name));
  for (const name of cssAssets) copyFileSync(join(cssDir, name), join(assetOut, 'css', name));
  log.push(`${assets.length + cssAssets.length} Elm assets -> ${relative(process.cwd(), assetOut) || assetOut}`);

  for (const page of pages) {
    const html = renderDocument(page, parts);
    validateDocument(page, html);
    const file = join(out, page.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html, 'utf8');
  }
  // The flat 404 must stay flat: nginx serves this exact file while keeping the
  // 404 status; a 404/index.html directory would invite a soft-404 200.
  if (existsSync(join(out, '404', 'index.html'))) fail('404/index.html must not exist; the 404 document is flat');
  for (const must of ['index.html', 'app/index.html', '404.html']) {
    if (!readFileSync(join(out, must), 'utf8').includes('Elm.Main.init')) fail(`${must} was not generated`);
  }
  log.push(`${pages.length} documents`);
  return { pages: pages.length, assets: assets.length + cssAssets.length, publicFiles: publicFiles.length, log };
}

const count = (html, pattern) => (html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)) ?? []).length;

/** Exactly-one / absent invariants on an emitted document (the old materialiser's checks). */
export function validateDocument(page, html) {
  const once = (pattern, label) => {
    const n = count(html, pattern);
    if (n !== 1) fail(`${page.file}: expected exactly one ${label}; found ${n}`);
  };
  const absent = (pattern, label) => {
    if (count(html, pattern) !== 0) fail(`${page.file}: must not contain ${label}`);
  };
  once(/<title>[^<]*<\/title>/, '<title>');
  once(/<meta\s+name="description"/, 'description');
  once(/<meta\s+property="og:title"/, 'og:title');
  once(/<meta\s+property="og:description"/, 'og:description');
  once(/<meta\s+name="twitter:title"/, 'twitter:title');
  once(/<meta\s+name="twitter:description"/, 'twitter:description');
  once(/<meta name="viewport"/, 'viewport');
  once(/Elm\.Main\.init/, 'Elm.Main.init');
  absent(/\/assets\/index-/, 'a legacy bundle entry (/assets/index-*)');
  absent(/type="module"/, 'a module script');
  if (page.kind === 'not-found') {
    absent(/rel="canonical"/, 'a canonical link');
    absent(/property="og:url"/, 'og:url');
    absent(/application\/ld\+json/, 'structured data');
    once(/<meta name="robots" content="noindex, nofollow" data-onyx-route-robots="true" \/>/, 'noindex robots meta');
  } else {
    once(/<link rel="canonical"/, 'canonical link');
    once(/<meta property="og:url"/, 'og:url');
    once(/<script type="application\/ld\+json">/, 'structured data');
    absent(/name="robots"/, 'a robots meta');
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--elm', '--public', '--out'].includes(flag) || argv[i + 1] === undefined) {
      console.error('usage: node tools/build-site.mjs [--elm elm/dist-elm] [--public public] [--out dist]');
      process.exit(2);
    }
    options[flag.slice(2)] = argv[(i += 1)];
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = buildSite({
      repo,
      elmDist: resolve(options.elm ?? join(repo, 'elm', 'dist-elm')),
      publicDir: resolve(options.public ?? join(repo, 'public')),
      out: resolve(options.out ?? join(repo, 'dist')),
    });
    console.log(`==> site: ${result.log.join(', ')}, ${result.publicFiles} public files`);
  } catch (error) {
    if (!(error instanceof SiteBuildError)) throw error;
    console.error(`FAIL: build-site: ${error.message}`);
    process.exit(1);
  }
}
