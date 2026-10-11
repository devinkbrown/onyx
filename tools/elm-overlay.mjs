#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * elm-overlay.mjs — make the Elm v3 client the served app inside a staged
 * Vite `dist/` (called by deploy.sh when ONYX_CLIENT=elm).
 *
 *   node tools/elm-overlay.mjs <dist> <elm-dist>
 *
 * <elm-dist> is the output of elm/tools/build.sh (hashed app.*.js,
 * voice.*.js, voice-worker.*.js, backdrop.*.js, ports.*.js, app.*.css, css/*.css,
 * index.html, opcodec_wasm.{js,wasm}).
 *
 * 1. Copies the hashed Elm assets to <dist>/assets/elm/ (the deploy's
 *    retained, cache-first asset tree). The voice engine's codec is loaded
 *    from the site root (/opcodec_wasm.js), which the Vite build already
 *    serves from public/; the overlay verifies it is there.
 * 2. Rewrites every SPA document the Solid build/materialiser produced
 *    (any .html that loads the Vite entry `/assets/index-*.js`): the route's
 *    <head> metadata (title, description, OG/Twitter, ld+json, icons,
 *    manifest) is KEPT, the Solid scripts/modulepreloads/stylesheets are
 *    dropped, the Elm stylesheets are added, and the <body> becomes the Elm
 *    boot body with absolute asset URLs.
 *
 * Non-SPA files (feeds, downloads, onyxOS, sw.js, icons…) are untouched.
 * Fails closed: exits non-zero if anything expected is missing.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dist, elmDist] = process.argv.slice(2);
if (!dist || !elmDist) {
  console.error('usage: node tools/elm-overlay.mjs <dist> <elm-dist>');
  process.exit(2);
}
const fail = (msg) => {
  console.error(`FAIL: elm-overlay: ${msg}`);
  process.exit(1);
};
if (!existsSync(join(dist, 'index.html'))) fail(`${dist}/index.html missing`);
if (!existsSync(join(elmDist, 'index.html'))) fail(`${elmDist}/index.html missing (run elm/tools/build.sh)`);

// 1. assets -------------------------------------------------------------
const ASSET_PREFIX = '/assets/elm/';
const assetOut = join(dist, 'assets', 'elm');
mkdirSync(join(assetOut, 'css'), { recursive: true });
const copied = [];
for (const name of readdirSync(elmDist)) {
  if (/^(app|ports|voice|voice-worker|backdrop)\.[0-9a-f]{12}\.(js|css)$/.test(name)) {
    copyFileSync(join(elmDist, name), join(assetOut, name));
    copied.push(name);
  }
}
const cssDir = join(elmDist, 'css');
if (existsSync(cssDir)) {
  for (const name of readdirSync(cssDir)) {
    if (/^[a-z0-9-]+\.[0-9a-f]{12}\.css$/.test(name)) {
      copyFileSync(join(cssDir, name), join(assetOut, 'css', name));
      copied.push(`css/${name}`);
    }
  }
}
if (!copied.some((n) => /^app\..*\.js$/.test(n))) fail('hashed app.*.js not found in elm dist');
if (!copied.some((n) => /^ports\..*\.js$/.test(n))) fail('hashed ports.*.js not found in elm dist');
if (!copied.some((n) => /^voice\.[0-9a-f]{12}\.js$/.test(n))) fail('hashed voice.*.js (calls engine) not found in elm dist');
if (!copied.some((n) => /^voice-worker\.[0-9a-f]{12}\.js$/.test(n))) fail('hashed voice-worker.*.js not found in elm dist');
// v3/gap-appearance: the background renderer (window.OnyxBackdrop).
if (!copied.some((n) => /^backdrop\.[0-9a-f]{12}\.js$/.test(n))) fail('hashed backdrop.*.js (background renderer) not found in elm dist');
if (!copied.some((n) => /^css\/gap-appearance\.[0-9a-f]{12}\.css$/.test(n))) fail('hashed css/gap-appearance.*.css (theme bridge) not found in elm dist');
// The engine loads its codec from the site root; Vite copies public/ there.
for (const codec of ['opcodec_wasm.js', 'opcodec_wasm.wasm']) {
  if (!existsSync(join(dist, codec))) {
    if (!existsSync(join(elmDist, codec))) fail(`${codec} missing from both ${dist} and ${elmDist}`);
    copyFileSync(join(elmDist, codec), join(dist, codec));
  }
}

// 2. Elm document parts -------------------------------------------------
const elmHtml = readFileSync(join(elmDist, 'index.html'), 'utf8');
const absolutize = (html) =>
  html.replace(/(href|src)="(?!https?:|\/|#|data:)([^"]+)"/g, (_, attr, path) => `${attr}="${ASSET_PREFIX}${path}"`);
const elmHead = /<head>([\s\S]*?)<\/head>/i.exec(elmHtml)?.[1] ?? fail('elm index has no <head>');
const elmStyles = (elmHead.match(/<link[^>]+rel="stylesheet"[^>]*>/gi) ?? []).map(absolutize);
if (elmStyles.length === 0) fail('elm index has no stylesheets');
// v3/ios: the device <meta> tags the Elm shell needs (viewport-fit=cover
// for safe areas, standalone/PWA + status bar, theme colour, no phone-number
// links) replace the route head's same-name tags. Fail closed if the Elm
// head stops carrying the viewport the safe-area layout depends on.
const DEVICE_META = ['viewport', 'theme-color', 'color-scheme', 'mobile-web-app-capable',
  'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title',
  'format-detection'];
const metaName = (tag) => /\bname="([^"]+)"/i.exec(tag)?.[1]?.toLowerCase() ?? '';
const elmMeta = (elmHead.match(/<meta\b[^>]*>/gi) ?? []).filter((tag) => DEVICE_META.includes(metaName(tag)));
if (!elmMeta.some((tag) => metaName(tag) === 'viewport' && /viewport-fit=cover/.test(tag))) {
  fail('elm index lacks <meta name="viewport" … viewport-fit=cover>');
}
const carryDeviceMeta = (head) =>
  `${head.replace(/<meta\b[^>]*>\s*/gi, (tag) => (DEVICE_META.includes(metaName(tag)) ? '' : tag)).trimEnd()}\n    ${elmMeta.join('\n    ')}`;
const elmBody = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(elmHtml)?.[1] ?? fail('elm index has no <body>');
const bootBody = absolutize(elmBody);
if (!bootBody.includes('Elm.Main.init')) fail('elm body lacks Elm.Main.init');
for (const ref of bootBody.match(/src="([^"]+)"/g) ?? []) {
  const p = /src="([^"]+)"/.exec(ref)[1];
  if (p.startsWith(ASSET_PREFIX) && !existsSync(join(assetOut, p.slice(ASSET_PREFIX.length)))) {
    fail(`body references missing asset ${p}`);
  }
}

// 3. rewrite SPA documents ---------------------------------------------
const SOLID_ENTRY = /<script[^>]+type="module"[^>]+src="\/assets\/index-[^"]+\.js"[^>]*><\/script>/i;
const SKIP_DIRS = new Set(['assets', 'downloads', 'onyxOS', 'codecs', 'brand', 'screenshots', 'fonts']);

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (dir === dist && SKIP_DIRS.has(name)) continue;
      yield* htmlFiles(p);
    } else if (name.endsWith('.html')) {
      yield p;
    }
  }
}

let rewritten = 0;
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8');
  if (!SOLID_ENTRY.test(html)) continue;
  const headMatch = /<head>([\s\S]*?)<\/head>/i.exec(html);
  if (!headMatch) fail(`${relative(dist, file)} has no <head>`);
  const keptHead = headMatch[1]
    .replace(/<script[^>]+type="module"[^>]*><\/script>/gi, '')
    .replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, '')
    .replace(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/[^"]*"[^>]*>/gi, '');
  const head = `${carryDeviceMeta(keptHead)}\n    ${elmStyles.join('\n    ')}\n  `;
  const out = html
    .replace(headMatch[0], `<head>${head}</head>`)
    .replace(/<body([^>]*)>[\s\S]*<\/body>/i, `<body$1>${bootBody}</body>`);
  if (SOLID_ENTRY.test(out) || !out.includes('Elm.Main.init')) fail(`rewrite failed for ${relative(dist, file)}`);
  writeFileSync(file, out);
  rewritten += 1;
}
if (rewritten === 0) fail('no SPA documents found to rewrite');
for (const must of ['index.html', 'app/index.html', '404.html']) {
  if (!readFileSync(join(dist, must), 'utf8').includes('Elm.Main.init')) fail(`${must} was not converted`);
}
console.log(`==> elm overlay: ${copied.length} assets -> ${relative(process.cwd(), assetOut)}, ${rewritten} SPA documents rewritten`);
