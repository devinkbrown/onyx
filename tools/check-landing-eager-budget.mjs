#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/* global console, process */
/**
 * Landing-entry eager JS budget guard.
 *
 * Regression guard for a defect that shipped once already: the marketing
 * landing route (`/`, `/about`, `/roadmap`) eagerly downloaded, parsed, and
 * evaluated the entire `runtime` chunk (store + irc/client + E2EE +
 * historyVault) via an index.html `modulepreload` and a static import in the
 * Vite entry chunk — even though none of the landing routes touch it. See
 * `vite.config.ts` `manualChunks` for the fix (preload-helper /
 * lib/prefs/preferences / lib/stats/fetchPublicJson must not fold the
 * `runtime` chunk into the eager entry closure).
 *
 * This never builds into `dist/` or `out/`: it always builds to a private
 * OS temp directory and removes it afterwards, so it is safe to run from any
 * working tree state, including mid-edit by another agent.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Web budget: landing page JS < 150kb gzipped.
export const LANDING_EAGER_JS_BUDGET_GZIP_BYTES = 150 * 1024;

function htmlTags(html, tagName) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'giu')) ?? [];
}

function htmlAttribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu').exec(tag)?.[2] ?? null;
}

/**
 * Pure parse of a built `index.html`: entry `<script type="module">` srcs
 * plus `<link rel="modulepreload">` hrefs, deduped in first-seen order.
 */
export function extractEagerJsHrefs(html) {
  const scripts = htmlTags(html, 'script')
    .filter((tag) => htmlAttribute(tag, 'type') === 'module')
    .map((tag) => htmlAttribute(tag, 'src'))
    .filter((value) => typeof value === 'string' && value.length > 0);
  const preloads = htmlTags(html, 'link')
    .filter((tag) => htmlAttribute(tag, 'rel') === 'modulepreload')
    .map((tag) => htmlAttribute(tag, 'href'))
    .filter((value) => typeof value === 'string' && value.length > 0);
  return [...new Set([...scripts, ...preloads])];
}

/**
 * Hard invariant (not a ratcheted budget): the landing entry must never
 * statically import or modulepreload the shared `runtime` chunk. Fails
 * regardless of how small the chunk happens to be.
 */
export function assertNoEagerRuntimeChunk(hrefs) {
  const offending = hrefs.filter((href) => /\/runtime(?:[-.][^/]*)?\.js(?:[?#].*)?$/u.test(href));
  if (offending.length > 0) {
    throw new Error(
      `Landing entry eagerly loads the runtime chunk: ${offending.join(', ')}. `
        + 'store/irc/e2ee/historyVault must stay lazy to /app — see vite.config.ts manualChunks.',
    );
  }
}

function isJsHref(href) {
  return /\.m?js(?:[?#].*)?$/u.test(href);
}

async function gzipFileSize(distDir, href) {
  const relativePath = href.replace(/^\/+/, '').split(/[?#]/u, 1)[0];
  const bytes = await readFile(resolve(distDir, relativePath));
  return gzipSync(bytes, { level: 9 }).length;
}

export async function measureLandingEagerJsGzipBytes(distDir, jsHrefs) {
  let total = 0;
  for (const href of jsHrefs) total += await gzipFileSize(distDir, href);
  return total;
}

/**
 * Run both assertions against an already-built `distDir`. Exported so tests
 * can exercise it against small fixtures without paying for a real build.
 */
export async function checkLandingEagerBudget({ distDir }) {
  const html = await readFile(resolve(distDir, 'index.html'), 'utf8');
  const hrefs = extractEagerJsHrefs(html);
  assertNoEagerRuntimeChunk(hrefs);
  const jsHrefs = hrefs.filter(isJsHref);
  const gzipBytes = await measureLandingEagerJsGzipBytes(distDir, jsHrefs);
  if (gzipBytes > LANDING_EAGER_JS_BUDGET_GZIP_BYTES) {
    throw new Error(
      `Landing eager JS is ${(gzipBytes / 1024).toFixed(2)} KiB gzip, over the `
        + `${(LANDING_EAGER_JS_BUDGET_GZIP_BYTES / 1024).toFixed(0)} KiB budget. `
        + `Eager files: ${jsHrefs.join(', ')}`,
    );
  }
  return { hrefs: jsHrefs, gzipBytes };
}

async function buildToScratchDir() {
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const scratch = await mkdtemp(join(tmpdir(), 'onyx-landing-budget-'));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', scratch], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  return scratch;
}

async function main() {
  const scratch = await buildToScratchDir();
  try {
    const result = await checkLandingEagerBudget({ distDir: scratch });
    console.log(
      `Landing eager JS: ${(result.gzipBytes / 1024).toFixed(2)} KiB gzip across `
        + `${result.hrefs.length} file(s): ${result.hrefs.join(', ')}`,
    );
    console.log('Landing eager-JS budget guard passed.');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
