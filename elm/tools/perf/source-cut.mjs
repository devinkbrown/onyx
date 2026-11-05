// SPDX-License-Identifier: AGPL-3.0-or-later
// Temporary bounded observation for the performance harness. This is not the
// validated full Elm roadmap source closure; the receipt says that explicitly.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export const SELECTION_VERSION = 'elm-performance-observation-v1';
export const INCLUDED = [
  'elm/** (source/build inputs; excluding generated caches and private paths)',
  'tests/e2e/elm.config.ts',
  'tests/e2e/elm-performance*.spec.ts',
  'tests/e2e/elm-stress*.spec.ts',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc',
  'tools/build-elm-site.mjs', 'tools/materialize-elm-routes.mjs',
  'tools/minify-elm-script.mjs', 'tools/serve-dir.mjs',
  'public/brand/mark.png', 'public/brand/mascot-still.png',
  'public/manifest.json', 'public/favicon.ico', 'public/favicon.svg',
  'public/favicon-32.png', 'public/apple-touch-icon.png',
  'public/icon-192.png', 'public/icon-192-maskable.png',
  'public/icon-512.png', 'public/icon-512-maskable.png',
  'public/og.png', 'public/robots.txt', 'public/sitemap.xml',
];
export const EXCLUDED = [
  '.git/**', 'node_modules/**', 'elm/elm-stuff/**', 'elm-stuff/**',
  'elm/out/**', 'elm/dist/**', 'dist/**', 'out/**', 'coverage/**',
  '.cache/**', '.pnpm-store/**', 'private/**', 'secrets/**',
  'elm/private/**', 'elm/secrets/**',
];
const exact = new Set([
  'tests/e2e/elm.config.ts', 'package.json', 'pnpm-lock.yaml',
  'pnpm-workspace.yaml', '.npmrc', 'tools/build-elm-site.mjs',
  'tools/materialize-elm-routes.mjs', 'tools/minify-elm-script.mjs',
  'tools/serve-dir.mjs',
  'public/brand/mark.png', 'public/brand/mascot-still.png',
  'public/manifest.json', 'public/favicon.ico', 'public/favicon.svg',
  'public/favicon-32.png', 'public/apple-touch-icon.png',
  'public/icon-192.png', 'public/icon-192-maskable.png',
  'public/icon-512.png', 'public/icon-512-maskable.png',
  'public/og.png', 'public/robots.txt', 'public/sitemap.xml',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function included(path) {
  if (path.startsWith('elm/')) return true;
  if (exact.has(path)) return true;
  if (path.startsWith('tests/e2e/elm-performance') && path.endsWith('.spec.ts')) return true;
  if (path.startsWith('tests/e2e/elm-stress') && path.endsWith('.spec.ts')) return true;
  return false;
}

export function digestRecords(records) {
  const canonical = [...records].sort((a, b) => a.path.localeCompare(b.path))
    .map(record => `${record.path}\0${record.bytes}\0${record.mode}\0${record.sha256}\n`).join('');
  return hash(Buffer.from(canonical, 'utf8'));
}

export function buildSourceCut(root) {
  const repo = realpathSync(root);
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean).sort();
  const files = [];
  for (const path of listed) {
    if (!included(path) || EXCLUDED.some(pattern => pattern.endsWith('/**') && path.startsWith(pattern.slice(0, -2)))) continue;
    const absolute = resolve(repo, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(absolute);
      const rel = relative(repo, target);
      if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Source symlink escapes repository: ${path}`);
      const bytes = Buffer.from(relative(repo, target), 'utf8');
      files.push({ path, bytes: bytes.length, mode: stat.mode & 0o777, type: 'symlink', target: relative(repo, target), sha256: hash(bytes) });
    } else if (stat.isFile()) {
      const bytes = readFileSync(absolute);
      files.push({ path, bytes: bytes.length, mode: stat.mode & 0o777, type: 'file', sha256: hash(bytes) });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    selectionVersion: SELECTION_VERSION,
    scope: 'bounded-performance-observation',
    reconstructibleSourceCut: false,
    fullRoadmapSourceAcceptance: 'pending validated shared full closure',
    includes: INCLUDED,
    excludes: EXCLUDED,
    fileCount: files.length,
    digestAlgorithm: 'sha256(sorted path NUL byte-count NUL mode NUL file-sha256 LF)',
    digest: digestRecords(files),
    files,
  };
}
