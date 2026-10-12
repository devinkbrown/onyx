// SPDX-License-Identifier: AGPL-3.0-or-later
// Test helper: build the whole site (tools/build-site.mjs) into a temp dir from
// a fixture Elm build plus the REAL public/ tree and the REAL elm/index.html
// head/body markup, so contract tests assert on the documents that ship.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../build-site.mjs';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCRIPTS = ['app', 'voice', 'backdrop', 'historyImport', 'ports'];
const hash = (name, i) => `${name}.${(i + 1).toString(16).padStart(12, '0')}`;

/** An Elm build dir shaped like elm/tools/build.sh's output (hashed names, rewritten index.html). */
export function writeFixtureElmDist(dir, { mutate } = {}) {
  mkdirSync(join(dir, 'css'), { recursive: true });
  const names = {};
  SCRIPTS.forEach((name, i) => { names[name] = `${hash(name, i)}.js`; });
  names.worker = `${hash('voice-worker', 9)}.js`;
  names.appCss = `${hash('app', 10)}.css`;
  names.appearanceCss = `${hash('gap-appearance', 11)}.css`;
  names.statsCss = `${hash('pol-stats', 12)}.css`;
  for (const file of [names.app, names.voice, names.backdrop, names.historyImport, names.ports, names.worker, names.appCss]) {
    writeFileSync(join(dir, file), `/* ${file} */\n`);
  }
  for (const file of [names.appearanceCss, names.statsCss]) writeFileSync(join(dir, 'css', file), `/* ${file} */\n`);
  let html = readFileSync(join(repo, 'elm', 'index.html'), 'utf8');
  html = html
    .replace(/<link rel="stylesheet" href="[^"]+">\n?/g, '')
    .replace('</head>', `<link rel="stylesheet" href="${names.appCss}">\n<link rel="stylesheet" href="css/${names.appearanceCss}">\n<link rel="stylesheet" href="css/${names.statsCss}">\n</head>`)
    .replace('src="app.js"', `src="${names.app}"`)
    .replace('src="voice.js"', `src="${names.voice}"`)
    .replace('src="backdrop.js"', `src="${names.backdrop}"`)
    .replace('src="historyImport.js"', `src="${names.historyImport}"`)
    .replace('src="ports.js"', `src="${names.ports}"`);
  writeFileSync(join(dir, 'index.html'), mutate ? mutate(html) : html);
  return names;
}

/** Build the site into a fresh temp dir; returns helpers for the tests. */
export function buildTestSite({ mutateElmHtml, publicDir, out } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'onyx-site-'));
  const elmDist = join(base, 'elm-dist');
  mkdirSync(elmDist);
  const names = writeFixtureElmDist(elmDist, { mutate: mutateElmHtml });
  const dist = out ?? join(base, 'dist');
  const summary = buildSite({ repo, elmDist, publicDir: publicDir ?? join(repo, 'public'), out: dist });
  return { base, elmDist, dist, names, summary, read: (file) => readFileSync(join(dist, file), 'utf8') };
}
