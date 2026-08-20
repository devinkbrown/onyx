#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/* global console, process */
/**
 * Measure and enforce the production UI payload ratchet.
 *
 * This command never builds the client. It consumes an existing Vite `dist/`
 * tree so fixture tests and CI can exercise the classifier deterministically.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const UI_BUDGET_SCHEMA = 'onyx-ui-performance-budget/v1';
export const GZIP_OPTIONS = Object.freeze({ level: 9 });

const ROLE_ORDER = Object.freeze([
  'eagerJs',
  'eagerCss',
  'eagerIndexJs',
  'eagerIndexCss',
  'sharedRuntimeJs',
  'appShellJs',
  'appShellCss',
  'lazyMediaJs',
]);

const ROLE_LABELS = Object.freeze({
  eagerJs: 'Total eager JS',
  eagerCss: 'Total eager CSS',
  eagerIndexJs: 'Eager index JS',
  eagerIndexCss: 'Eager index CSS',
  sharedRuntimeJs: 'Shared runtime JS',
  appShellJs: 'AppShell JS',
  appShellCss: 'AppShell CSS',
  lazyMediaJs: 'Optional/lazy media JS',
});

const ROLE_HINTS = Object.freeze({
  eagerJs: 'Inspect the complete entry import closure and keep route-only dependencies out of initial navigation.',
  eagerCss: 'Keep route-only and component-only styles out of the entry static import closure.',
  eagerIndexJs: 'Keep public-route dependencies out of src/index.tsx and preserve lazy route boundaries.',
  eagerIndexCss: 'Move route-only styles out of the eager global/index stylesheet.',
  sharedRuntimeJs: 'Avoid pulling store, IRC, E2EE, or vault-only code into eager public routes.',
  appShellJs: 'Split optional shell panels and heavy conversation tools behind dynamic imports.',
  appShellCss: 'Keep route/panel styles co-located and out of the always-loaded shell stylesheet.',
  lazyMediaJs: 'Keep Cadence optional and split codecs/workers rather than growing the call payload unchecked.',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareStable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareStable);
}

function assetBasename(path) {
  return basename(path.split(/[?#]/u, 1)[0] ?? '');
}

function isRuntimeJs(path) {
  return /^runtime(?:[-.].*)?\.js$/u.test(assetBasename(path));
}

function isJavaScriptAsset(path) {
  return /\.m?js$/u.test(assetBasename(path));
}

function isAppShellJs(path) {
  return /^AppShell(?:[-.].*)?\.js$/u.test(assetBasename(path));
}

function isAppShellCss(path) {
  return /^AppShell(?:[-.].*)?\.css$/u.test(assetBasename(path));
}

function isMediaJs(path) {
  const name = assetBasename(path);
  return /^media(?:[-.].*)?\.js$/u.test(name)
    || /^videoEncodeWorker(?:[-.].*)?\.js$/u.test(name);
}

function normalizeAssetPath(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const withoutSuffix = value.split(/[?#]/u, 1)[0] ?? '';
  if (/^[a-z][a-z\d+.-]*:/iu.test(withoutSuffix) || withoutSuffix.startsWith('//')) return null;
  const normalized = withoutSuffix.replace(/^\/+/, '').replaceAll('\\', '/');
  if (normalized.length === 0 || isAbsolute(normalized)) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function looksLikeViteManifest(value) {
  if (!isRecord(value)) return false;
  const chunks = Object.values(value);
  return chunks.length > 0
    && chunks.every((chunk) => isRecord(chunk))
    && chunks.some((chunk) => typeof chunk.file === 'string' && (chunk.isEntry === true || chunk.isDynamicEntry === true));
}

async function loadViteManifest(distDir) {
  const candidates = [resolve(distDir, '.vite/manifest.json'), resolve(distDir, 'manifest.json')];
  for (const path of candidates) {
    if (!(await regularFile(path))) continue;
    let value;
    try {
      value = await readJson(path);
    } catch (error) {
      throw new Error(
        `Cannot parse Vite manifest ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    // `dist/manifest.json` is normally Onyx's PWA manifest. Ignore it unless it
    // actually has Vite's chunk-record shape.
    if (looksLikeViteManifest(value)) return { path, value };
  }
  return null;
}

function manifestEntry(manifest) {
  const entries = Object.entries(manifest);
  const explicit = entries.find(([, chunk]) => chunk.isEntry === true && /(?:^|\/)index\.[cm]?[jt]sx?$/u.test(chunk.src ?? ''));
  if (explicit) return explicit;
  const anyEntry = entries.filter(([, chunk]) => chunk.isEntry === true);
  if (anyEntry.length !== 1) {
    throw new Error(`Expected one unambiguous Vite entry chunk, found ${anyEntry.length}.`);
  }
  return anyEntry[0];
}

function staticManifestClosure(manifest, entryKey) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const chunk = manifest[key];
    if (!isRecord(chunk)) throw new Error(`Vite manifest import ${key} has no chunk record.`);
    seen.add(key);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  visit(entryKey);
  return seen;
}

function classifyManifest(manifest) {
  const [entryKey, entry] = manifestEntry(manifest);
  const closure = staticManifestClosure(manifest, entryKey);
  const eagerFiles = new Set();
  const eagerJs = [];
  const eagerCss = [];
  for (const key of closure) {
    const chunk = manifest[key];
    if (typeof chunk.file === 'string') {
      eagerFiles.add(chunk.file);
      if (isJavaScriptAsset(chunk.file)) eagerJs.push(chunk.file);
    }
    for (const css of chunk.css ?? []) {
      eagerFiles.add(css);
      eagerCss.push(css);
    }
  }

  const chunks = Object.values(manifest);
  const files = chunks.flatMap((chunk) => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])])
    .filter((value) => typeof value === 'string');
  const appShellChunks = chunks.filter((chunk) => isAppShellJs(chunk.file ?? '') || /(?:^|\/)AppShell\.[cm]?[jt]sx?$/u.test(chunk.src ?? ''));
  const appShellCss = appShellChunks.flatMap((chunk) => chunk.css ?? []);

  return {
    source: 'vite-manifest',
    eagerFiles,
    roles: {
      eagerJs,
      eagerCss,
      eagerIndexJs: [entry.file],
      eagerIndexCss: entry.css ?? [],
      sharedRuntimeJs: files.filter(isRuntimeJs),
      appShellJs: files.filter(isAppShellJs),
      appShellCss: [...files.filter(isAppShellCss), ...appShellCss],
      lazyMediaJs: files.filter(isMediaJs),
    },
  };
}

function htmlAttributeTags(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'giu');
  return html.match(pattern) ?? [];
}

function htmlAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu');
  return pattern.exec(tag)?.[2] ?? null;
}

async function listAssetFiles(distDir) {
  const assetsDir = resolve(distDir, 'assets');
  const walk = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...await walk(resolve(directory, entry.name), relativePath));
      else if (entry.isFile()) files.push(`assets/${relativePath}`);
    }
    return files;
  };
  try {
    return await walk(assetsDir);
  } catch (error) {
    throw new Error(
      `Cannot read Vite assets directory ${assetsDir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function classifyOutput(distDir) {
  const indexPath = resolve(distDir, 'index.html');
  let html;
  try {
    html = await readFile(indexPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read Vite output entry ${indexPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const scripts = htmlAttributeTags(html, 'script');
  const links = htmlAttributeTags(html, 'link');
  const entryJs = scripts
    .filter((tag) => htmlAttribute(tag, 'type') === 'module')
    .map((tag) => htmlAttribute(tag, 'src'))
    .filter(Boolean);
  const indexCss = links
    .filter((tag) => htmlAttribute(tag, 'rel') === 'stylesheet')
    .map((tag) => htmlAttribute(tag, 'href'))
    .filter(Boolean);
  const preloads = links
    .filter((tag) => htmlAttribute(tag, 'rel') === 'modulepreload')
    .map((tag) => htmlAttribute(tag, 'href'))
    .filter(Boolean);
  const files = await listAssetFiles(distDir);

  return {
    source: 'vite-output',
    eagerFiles: new Set([...entryJs, ...indexCss, ...preloads]),
    roles: {
      eagerJs: [...entryJs, ...preloads].filter(isJavaScriptAsset),
      eagerCss: indexCss,
      eagerIndexJs: entryJs,
      eagerIndexCss: indexCss,
      sharedRuntimeJs: preloads.filter(isRuntimeJs),
      appShellJs: files.filter(isAppShellJs),
      appShellCss: files.filter(isAppShellCss),
      lazyMediaJs: files.filter(isMediaJs),
    },
  };
}

async function discoverRoles(distDir) {
  const manifest = await loadViteManifest(distDir);
  const discovered = manifest ? classifyManifest(manifest.value) : await classifyOutput(distDir);
  // Vite's manifest does not necessarily list assets spawned by worker URLs.
  // Merge named output chunks so the same roles are enforced with or without
  // `build.manifest`, including Cadence's emitted encoding worker.
  const outputFiles = await listAssetFiles(distDir);
  discovered.roles.sharedRuntimeJs.push(...outputFiles.filter(isRuntimeJs));
  discovered.roles.appShellJs.push(...outputFiles.filter(isAppShellJs));
  discovered.roles.appShellCss.push(...outputFiles.filter(isAppShellCss));
  discovered.roles.lazyMediaJs.push(...outputFiles.filter(isMediaJs));
  const normalizedRoles = {};
  for (const role of ROLE_ORDER) {
    normalizedRoles[role] = uniqueSorted((discovered.roles[role] ?? [])
      .map(normalizeAssetPath)
      .filter(Boolean));
  }
  const eagerFiles = new Set([...discovered.eagerFiles].map(normalizeAssetPath).filter(Boolean));
  const eagerMedia = normalizedRoles.lazyMediaJs.filter((path) => eagerFiles.has(path));
  if (eagerMedia.length > 0) {
    throw new Error(`Optional media became eager: ${eagerMedia.join(', ')}. Restore the lazy Cadence boundary.`);
  }
  return { source: discovered.source, roles: normalizedRoles };
}

async function measureArtifact(distDir, assetPath) {
  const root = resolve(distDir);
  const absolute = resolve(root, assetPath);
  const rel = relative(root, absolute);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new Error(`Budget artifact escapes dist/: ${assetPath}`);
  }
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw new Error(
      `Missing UI budget artifact ${assetPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return {
    path: assetPath,
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, GZIP_OPTIONS).length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function stableReportDigest(groups) {
  const hash = createHash('sha256');
  for (const role of ROLE_ORDER) {
    const artifacts = [...(groups[role]?.artifacts ?? [])]
      .sort((left, right) => compareStable(left.path, right.path));
    for (const artifact of artifacts) {
      hash.update(`${role}\0${artifact.path}\0${artifact.rawBytes}\0${artifact.gzipBytes}\0${artifact.sha256}\n`);
    }
  }
  return hash.digest('hex');
}

export async function measureUiBudgets({ distDir = resolve('dist') } = {}) {
  const root = resolve(distDir);
  const discovered = await discoverRoles(root);
  const groups = {};
  const measuredArtifacts = new Map();
  for (const role of ROLE_ORDER) {
    const paths = discovered.roles[role];
    if (paths.length === 0) {
      throw new Error(`Missing required UI budget role ${role} (${ROLE_LABELS[role]}). Build with Vite before running the ratchet.`);
    }
    const artifacts = [];
    for (const path of paths) {
      if (!measuredArtifacts.has(path)) measuredArtifacts.set(path, await measureArtifact(root, path));
      artifacts.push(measuredArtifacts.get(path));
    }
    artifacts.sort((left, right) => compareStable(left.path, right.path));
    groups[role] = {
      label: ROLE_LABELS[role],
      count: artifacts.length,
      rawBytes: artifacts.reduce((sum, item) => sum + item.rawBytes, 0),
      gzipBytes: artifacts.reduce((sum, item) => sum + item.gzipBytes, 0),
      artifacts,
    };
  }
  return {
    schema: UI_BUDGET_SCHEMA,
    source: discovered.source,
    gzip: { algorithm: 'gzip', level: GZIP_OPTIONS.level },
    groups,
    buildDigest: stableReportDigest(groups),
  };
}

export function ceilingFromHeadroom(bytes, percent) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Invalid byte baseline: ${bytes}`);
  if (!Number.isFinite(percent) || percent < 0) throw new Error(`Invalid headroom percent: ${percent}`);
  return Math.ceil(bytes * (1 + percent / 100));
}

function validateBaseline(baseline) {
  if (!isRecord(baseline) || baseline.schema !== UI_BUDGET_SCHEMA) {
    throw new Error(`Baseline schema must be ${UI_BUDGET_SCHEMA}.`);
  }
  const percent = baseline.policy?.headroomPercent;
  if (!Number.isFinite(percent) || percent < 0) throw new Error('Baseline policy.headroomPercent must be a non-negative number.');
  if (!isRecord(baseline.groups)) throw new Error('Baseline groups are missing.');
  for (const role of ROLE_ORDER) {
    const group = baseline.groups[role];
    if (!isRecord(group)) throw new Error(`Baseline group ${role} is missing.`);
    for (const field of ['count', 'rawBytes', 'gzipBytes', 'rawCeilingBytes', 'gzipCeilingBytes']) {
      if (!Number.isSafeInteger(group[field]) || group[field] < 0) {
        throw new Error(`Baseline ${role}.${field} must be a non-negative safe integer.`);
      }
    }
    const expectedRaw = ceilingFromHeadroom(group.rawBytes, percent);
    const expectedGzip = ceilingFromHeadroom(group.gzipBytes, percent);
    if (group.rawCeilingBytes !== expectedRaw || group.gzipCeilingBytes !== expectedGzip) {
      throw new Error(
        `Baseline ${role} ceilings must use Math.ceil at ${percent}% headroom `
        + `(expected raw=${expectedRaw}, gzip=${expectedGzip}).`,
      );
    }
  }
  return baseline;
}

function percentDelta(current, baseline) {
  if (baseline === 0) return current === 0 ? 0 : Infinity;
  return ((current - baseline) / baseline) * 100;
}

function formatDelta(current, baseline) {
  const delta = percentDelta(current, baseline);
  if (!Number.isFinite(delta)) return '+infinity';
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`;
}

export function compareUiBudgets(report, baselineInput) {
  const baseline = validateBaseline(baselineInput);
  const issues = [];
  for (const role of ROLE_ORDER) {
    const current = report.groups[role];
    const expected = baseline.groups[role];
    if (!current) {
      issues.push(`${ROLE_LABELS[role]} is missing from the measured report.`);
      continue;
    }
    if (current.count !== expected.count) {
      issues.push(
        `${ROLE_LABELS[role]} emitted ${current.count} artifacts; baseline expects ${expected.count}. `
        + `Inspect chunk splitting and update the reviewed baseline only if intentional.`,
      );
    }
    for (const metric of ['raw', 'gzip']) {
      const currentBytes = current[`${metric}Bytes`];
      const baselineBytes = expected[`${metric}Bytes`];
      const ceilingBytes = expected[`${metric}CeilingBytes`];
      if (currentBytes > ceilingBytes) {
        issues.push(
          `${ROLE_LABELS[role]} ${metric} is ${formatBytes(currentBytes)}, above the `
          + `${formatBytes(ceilingBytes)} ceiling by ${formatBytes(currentBytes - ceilingBytes)} `
          + `(baseline ${formatBytes(baselineBytes)}, ${formatDelta(currentBytes, baselineBytes)}). `
          + ROLE_HINTS[role],
        );
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB (${bytes} B)`;
}

export function renderReport(report, baseline = null) {
  const lines = [
    `Onyx UI budget report (${report.source}, gzip level ${report.gzip.level})`,
    'Role                         Files        Raw                    Gzip',
  ];
  for (const role of ROLE_ORDER) {
    const group = report.groups[role];
    const base = baseline?.groups?.[role];
    const suffix = base
      ? ` | baseline ${formatDelta(group.gzipBytes, base.gzipBytes)} gzip`
      : '';
    lines.push(
      `${ROLE_LABELS[role].padEnd(28)} ${String(group.count).padStart(5)}  `
      + `${formatBytes(group.rawBytes).padStart(22)}  ${formatBytes(group.gzipBytes).padStart(22)}${suffix}`,
    );
    for (const artifact of group.artifacts) lines.push(`  - ${artifact.path}`);
  }
  lines.push(`Build digest: ${report.buildDigest}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = {
    distDir: resolve('dist'),
    baselinePath: resolve('docs/ui-performance-baseline.json'),
    json: false,
    measureOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist' || arg === '--baseline') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path.`);
      if (arg === '--dist') options.distDir = resolve(value);
      else options.baselinePath = resolve(value);
      index += 1;
    } else if (arg === '--json') options.json = true;
    else if (arg === '--measure-only') options.measureOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node tools/check-ui-budgets.mjs [options]',
    '',
    'Options:',
    '  --dist <path>       Existing Vite output (default: dist)',
    '  --baseline <path>   Checked-in baseline (default: docs/ui-performance-baseline.json)',
    '  --measure-only      Measure without loading or enforcing the baseline',
    '  --json              Emit the measurement report as JSON',
  ].join('\n');
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const report = await measureUiBudgets({ distDir: options.distDir });
  if (options.measureOnly) {
    console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(report));
    return 0;
  }
  let baseline;
  try {
    baseline = await readJson(options.baselinePath);
  } catch (error) {
    throw new Error(
      `Cannot read UI performance baseline ${options.baselinePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const comparison = compareUiBudgets(report, baseline);
  console.log(options.json
    ? JSON.stringify({ ...report, comparison }, null, 2)
    : renderReport(report, baseline));
  if (!comparison.ok) {
    throw new Error(`UI performance budget failed:\n- ${comparison.issues.join('\n- ')}`);
  }
  console.log('UI performance budget passed.');
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
