#!/usr/bin/env node
// Deterministic, scoped Elm-client lanes. Missing tools or failed suites are
// errors; this runner never converts a skip into success.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceLedger as validateReviewedEvidenceLedger } from './validate-roadmap-evidence.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const elmDir = resolve(root, 'elm');
const seed = '11031904';
const fuzz = '100';
const commandsRun = [];
const laneObservations = [];
const lanes = new Set(['validate-transcripts', 'elm-focused', 'elm-full', 'node-smokes', 'runtime-tests', 'root-gates', 'chromium-mock', 'browser-local', 'stress-media', 'contract-observations', 'playwright-list-audit', 'performance', 'final', 'manifest', 'expected-failure']);
const requested = process.argv[2] ?? 'elm-focused';
if (!lanes.has(requested)) {
  process.stderr.write(`Unknown lane: ${requested}\nValid lanes: ${[...lanes].join(', ')}\n`);
  process.exit(2);
}

const findCommand = name => {
  if (name === 'elm' && process.env.ELM_BIN) return resolve(process.env.ELM_BIN);
  if (name === 'elm-test' && process.env.ELM_TEST_BIN) return resolve(process.env.ELM_TEST_BIN);
  if (name === 'pnpm' && process.env.PNPM_BIN) return resolve(process.env.PNPM_BIN);
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const candidate = resolve(dir, name);
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* next path */ }
  }
  throw new Error(`Required tool missing: ${name}; install the documented pinned tool and set ${name.toUpperCase().replaceAll('-', '_')}_BIN or PATH`);
};
const run = (cmd, args, cwd, env = process.env) => {
  commandsRun.push({ cmd, args, cwd });
  process.stdout.write(`$ ${cmd} ${args.join(' ')}\n`);
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
};
const capture = (cmd, args, cwd, env = process.env) => {
  commandsRun.push({ cmd, args, cwd, capture: true });
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${cmd} ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
};
const loadManifest = () => JSON.parse(capture(process.execPath, [resolve(elmDir, 'tools/source-manifest.mjs')], root));
const manifest = loadManifest();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const receiptRoot = resolve(process.env.ROADMAP_RECEIPT_DIR || '/tmp/onyx-roadmap-receipts');

function saveReceipt(id, command, result, limits) {
  mkdirSync(receiptRoot, { recursive: true });
  const receipt = {
    schemaVersion: 1,
    id,
    command: [...commandsRun, { runner: command }],
    laneObservations: [...laneObservations],
    utcTime: now(),
    exitStatus: result,
    outcome: result === 0 ? 'passed' : result === 2 ? 'blocked' : 'failed',
    acceptanceStatus: 'pending',
    clientSourceManifestDigest: manifest.digest,
    clientGitHead: manifest.gitHead,
    clientWorkingTreeDirty: manifest.gitDirty,
    serverSourceOrArtifactHashesWhenRelevant: process.env.ONYX_SERVER_EVIDENCE || 'not supplied to this lane',
    browser: process.env.ROADMAP_BROWSER || 'not measured',
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    network: process.env.ROADMAP_NETWORK || 'local/mock; not a live-server acceptance receipt',
    limits,
  };
  const name = `${id}-${Date.now()}.json`;
  writeFileSync(join(receiptRoot, name), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Receipt: ${join(receiptRoot, name)}\n`);
}

function validateCatalog() {
  validateEvidenceLedger();
  const path = resolve(elmDir, 'fixtures/roadmap/catalog.json');
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  const source = readFileSync(resolve(elmDir, 'tests/RoadmapTranscriptTest.elm'), 'utf8');
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.scenarios) || !catalog.scenarios.length) throw new Error('Transcript catalog schema is invalid or empty');
  const checkKeys = (value, expected, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const actual = Object.keys(value).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${label} has unknown or missing keys: ${actual.join(', ')}`);
  };
  checkKeys(catalog, ['schemaVersion', 'sourceRevision', 'note', 'scenarios'], 'catalog');
  const ids = new Set();
  for (const scenario of catalog.scenarios) {
    checkKeys(scenario, ['id', 'serverSource', 'initial', 'steps', 'expect'], `scenario ${scenario.id}`);
    checkKeys(scenario.serverSource, ['path', 'symbol', 'revision'], `serverSource ${scenario.id}`);
    checkKeys(scenario.initial, scenario.initial?.reclaim === undefined ? ['nowMs', 'connection'] : ['nowMs', 'connection', 'reclaim'], `initial ${scenario.id}`);
    if (scenario.initial.reclaim !== undefined) {
      checkKeys(scenario.initial.reclaim, ['phase', 'kind'], `initial.reclaim ${scenario.id}`);
      if (scenario.initial.reclaim.phase !== 'restoring' || scenario.initial.reclaim.kind !== 'local') throw new Error(`Unsupported reclaim seed: ${scenario.id}`);
    }
    const expectKeys = ['caps', 'outboundLines', 'reclaimPhase'];
    if (Object.hasOwn(scenario.expect ?? {}, 'notificationTexts')) expectKeys.push('notificationTexts');
    checkKeys(scenario.expect, expectKeys, `expect ${scenario.id}`);
    if (scenario.expect.notificationTexts !== undefined
      && (!Array.isArray(scenario.expect.notificationTexts)
        || scenario.expect.notificationTexts.some(text => typeof text !== 'string'))) {
      throw new Error(`Invalid expected notification texts: ${scenario.id}`);
    }
    if (typeof scenario.id !== 'string' || ids.has(scenario.id)) throw new Error(`Missing or duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.serverSource?.path || !scenario.serverSource?.symbol || scenario.serverSource.revision !== catalog.sourceRevision) throw new Error(`Missing source provenance: ${scenario.id}`);
    if (!Number.isFinite(scenario.initial?.nowMs) || !['live', 'registering', 'offline'].includes(scenario.initial?.connection)) throw new Error(`Invalid deterministic initial clock/connection: ${scenario.id}`);
    if (!Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.some(step => !Number.isFinite(step.atMs) || (typeof step.line !== 'string' && step.event !== 'reclaim-confirm'))) throw new Error(`Invalid transcript steps: ${scenario.id}`);
    if (!Array.isArray(scenario.expect?.caps) || !Array.isArray(scenario.expect?.outboundLines) || !['none', 'restoring', 'reclaimed'].includes(scenario.expect?.reclaimPhase)) throw new Error(`Missing expected result fields: ${scenario.id}`);
    for (const step of scenario.steps) {
      checkKeys(step, typeof step.line === 'string' ? ['atMs', 'line'] : ['atMs', 'event'], `step ${scenario.id}`);
      if (step.line && /\r\n/.test(step.line)) throw new Error(`Server transcript line must omit framing CRLF: ${scenario.id}`);
      if (step.event && step.event !== 'reclaim-confirm') throw new Error(`Unknown transcript event ${step.event}`);
    }
  }
  if (!source.includes('scenarioTest scenario') || !source.includes('RoadmapFixtures.catalogJson')) throw new Error('Generic Elm fixture consumer is missing');
  const generator = resolve(elmDir, 'tools/generate-roadmap-fixtures.mjs');
  const result = spawnSync(process.execPath, [generator, '--check'], { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Generated Elm fixture differs from catalog: ${result.stderr || result.error}`);
  process.stdout.write(`Validated ${catalog.scenarios.length} catalog-bound Elm transcript cases; deterministic seed ${seed}.\n`);
}

function validateEvidenceLedger() {
  const ledger = JSON.parse(readFileSync(resolve(root, 'docs/elm-roadmap/acceptance-ledger.json'), 'utf8'));
  const summary = validateReviewedEvidenceLedger(ledger, root);
  process.stdout.write(`Validated roadmap evidence ledger: ${summary.packages} packages, ${summary.scenarios} scenarios, ${summary.milestones} milestones; ${summary.acceptedPackages} package acceptances have current source-bound reviews. T/M acceptance remains row-scoped.\n`);
}

function version(binary, expected) {
  const actual = capture(binary, ['--version'], root);
  if (actual !== expected) throw new Error(`${binary} version mismatch: expected ${expected}, got ${actual}`);
  return actual;
}

function elmLane(full) {
  const elm = findCommand('elm');
  const test = findCommand('elm-test');
  version(elm, '0.19.1');
  version(test, '0.19.1-revision17');
  validateCatalog();
  const compile = run(elm, ['make', 'src/Main.elm', '--output', os.devNull], elmDir);
  if (compile !== 0) return compile;
  const args = ['--seed', seed, '--fuzz', fuzz];
  if (!full) args.push('tests/RoadmapTranscriptTest.elm');
  return run(test, args, elmDir);
}

async function boundedProcess(cmd, args, cwd, timeoutMs, env = process.env) {
  commandsRun.push({ cmd, args, cwd, timeoutMs });
  process.stdout.write(`$ ${cmd} ${args.join(' ')} (timeout ${timeoutMs}ms)\n`);
  const child = spawn(cmd, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let timedOut = false;
  let termTimer;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch { /* already exited */ }
    termTimer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* already exited */ }
    }, 1000);
  }, timeoutMs);
  return await new Promise((resolveStatus, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (!timedOut) clearTimeout(termTimer);
      if (timedOut) {
        process.stderr.write(`FAILED: timeout after ${timeoutMs}ms; process group terminated (${signal || 'unknown signal'}).\n`);
        resolveStatus(124);
      } else {
        resolveStatus(code ?? 1);
      }
    });
  });
}

async function nodeSmokeLane() {
  const files = (awaitlessList())
    .filter(name => name.endsWith('.smoke.mjs'))
    .sort();
  if (files.length === 0) throw new Error('No Elm JS smoke tests found');
  let result = 0;
  const started = Date.now();
  const laneLimit = 600000;
  for (const file of files) {
    const elapsed = Date.now() - started;
    if (elapsed >= laneLimit) {
      for (const remaining of files.slice(files.indexOf(file))) {
        process.stderr.write(`FAILED: ${remaining}: total JS smoke lane limit reached; elapsed=${elapsed}ms; classified failed, not skipped.\n`);
      }
      if (result === 0) result = 124;
      break;
    }
    const limit = Math.min(60000, laneLimit - elapsed);
    const status = await boundedProcess(process.execPath, [resolve(root, file)], root, limit);
    if (status !== 0 && result === 0) result = status;
  }
  return result;
}

function awaitlessList() {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (entry.isFile()) return [absolute.slice(root.length + 1).split('\\').join('/')];
    throw new Error(`Unsupported entry in smoke discovery: ${absolute}`);
  });
  return walk(elmDir);
}

function rootGates() {
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  for (const args of [['typecheck'], ['lint'], ['test']]) {
    const result = run(pnpm, args, root);
    if (result !== 0) return result;
  }
  return 0;
}

function runtimeTests() {
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  const typecheck = run(pnpm, ['exec', 'tsc', '-p', 'elm/runtime/tsconfig.json', '--noEmit'], root);
  if (typecheck !== 0) return typecheck;
  return run(pnpm, ['test:elm-runtime'], root);
}

function chromiumLane() {
  const chromiumExecutable = process.env.ONYX_CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  if (!existsSync(chromiumExecutable)) throw new Error(`Chromium executable is unavailable: ${chromiumExecutable}`);
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  return run(pnpm, ['test:e2e:elm'], root, { ...process.env, ONYX_CHROMIUM_EXECUTABLE: chromiumExecutable, ROADMAP_BROWSER: process.env.ROADMAP_BROWSER || `Chromium mock (${chromiumExecutable})` });
}

function localBrowserLane() {
  if (!process.env.ONYX_ELM_LAB_BASE || !process.env.ONYX_ELM_LAB_WS) throw new Error('Set ONYX_ELM_LAB_BASE and ONYX_ELM_LAB_WS to explicit loopback local-server endpoints; unavailable is not a passing lane');
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  return run(pnpm, ['exec', 'playwright', 'test', '--config', 'tests/e2e/elm-local.config.ts'], root);
}

function stressMediaLane() {
  const chromiumExecutable = process.env.ONYX_CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  if (!existsSync(chromiumExecutable)) throw new Error(`Chromium executable is unavailable: ${chromiumExecutable}`);
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  const build = run(pnpm, ['build'], root);
  if (build !== 0) return build;
  const browserEnv = { ...process.env, ONYX_CHROMIUM_EXECUTABLE: chromiumExecutable };
  let media = 2;
  if (process.env.ONYX_APP && process.env.ONYX_WS) {
    media = run(pnpm, ['exec', 'playwright', 'test', '--project=chromium', 'tests/e2e/voice.spec.ts'], root, browserEnv);
    laneObservations.push({ id: 'real-media-server-journey', status: media === 0 ? 'passed' : 'failed', exitStatus: media, app: process.env.ONYX_APP, websocket: process.env.ONYX_WS });
  } else {
    laneObservations.push({ id: 'real-media-server-journey', status: 'unavailable', reason: 'ONYX_APP and ONYX_WS must identify an explicitly available Onyx Server media endpoint; no mock acceptance is substituted.' });
  }
  const stress = run(process.execPath, [resolve(elmDir, 'tools/perf/run.mjs'), '--suite=stress'], root, browserEnv);
  laneObservations.push({ id: 'elm-stress-browser', status: stress === 0 ? 'passed' : 'failed', exitStatus: stress });
  return stress !== 0 ? stress : media === 0 ? 0 : 2;
}

function contractObservations() {
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  const client = spawnSync(pnpm, ['check:server-contract-v2'], { cwd: root, env: process.env, encoding: 'utf8', timeout: 60_000 });
  const serverRoot = resolve(process.env.ONYX_SERVER_ROOT || resolve(root, '../onyx-server'));
  const checker = resolve(serverRoot, 'tools/check-client-contract.py');
  let server = null;
  const fileDigest = path => {
    try { return hash(readFileSync(path)); } catch { return null; }
  };
  const gitRevision = cwd => {
    try { return capture('git', ['rev-parse', 'HEAD'], cwd); } catch { return null; }
  };
  if (existsSync(checker)) {
    server = spawnSync('python3', ['-B', checker], { cwd: serverRoot, env: process.env, encoding: 'utf8', timeout: 60_000 });
  }
  const observationOf = (command, result) => ({
    command,
    exitStatus: result.error?.code === 'ETIMEDOUT' ? 124 : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null,
  });
  const observation = {
    clientValidator: observationOf([pnpm, 'check:server-contract-v2'], client),
    serverValidator: server ? observationOf(['python3', '-B', checker], server) : { status: 'unavailable', reason: 'Server checkout or checker is absent' },
    validatorConcordance: client.status === 0 && server?.status === 0 ? 'verified' : 'not-verified',
    e02AcceptanceStatus: 'pending',
    clientSources: {
      checkerSha256: fileDigest(resolve(root, 'tools/check-server-contract-v2.mjs')),
      contractV2Sha256: fileDigest(resolve(root, '../onyx-server/docs/reference/protocol/onyx-client-contract.v2.json')),
      gitHead: gitRevision(root),
    },
    serverSources: server ? {
      checkerSha256: fileDigest(checker),
      contractV1Sha256: fileDigest(resolve(serverRoot, 'docs/reference/protocol/onyx-client-contract.v1.json')),
      contractV2Sha256: fileDigest(resolve(serverRoot, 'docs/reference/protocol/onyx-client-contract.v2.json')),
      gitHead: gitRevision(serverRoot),
    } : null,
    sourceAndJsonEdits: 'none; this lane observes validators and does not mutate either contract',
  };
  laneObservations.push({ id: 'E02-contract-observation', ...observation });
  process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
  if (!server || client.error || server.error || client.status !== server.status || client.status !== 0) {
    process.stderr.write('BLOCKED exit 2: client/server contract validation is missing, disagrees, or is non-green. Preserve the observed outcome; this lane does not remove validation or rewrite JSON.\n');
    return 2;
  }
  process.stdout.write('VERIFIED: client and server contract validators both passed and agree. E02 package/release acceptance remains pending separate source-bound review.\n');
  return 0;
}

function listPlaywrightFiles(config, env = process.env, extraArgs = []) {
  const pnpm = findCommand('pnpm');
  version(pnpm, '10.33.0');
  const output = capture(pnpm, ['exec', 'playwright', 'test', '--config', config, '--list', '--reporter=json', ...extraArgs], root, env);
  let report;
  try { report = JSON.parse(output); }
  catch { throw new Error(`Playwright --list returned invalid JSON for ${config}`); }
  const rootDir = report?.config?.rootDir;
  if (typeof rootDir !== 'string' || !Array.isArray(report?.suites)) {
    throw new Error(`Playwright --list JSON omitted config root or suite inventory for ${config}`);
  }
  const files = new Set();
  const visit = suite => {
    if (!suite || typeof suite !== 'object') return;
    if (typeof suite.file === 'string' && suite.file.length > 0) {
      const absolute = resolve(rootDir, suite.file);
      const sourcePath = relative(root, absolute).split(sep).join('/');
      if (sourcePath.endsWith('.spec.ts')) files.add(sourcePath);
    }
    if (Array.isArray(suite.suites)) suite.suites.forEach(visit);
  };
  report.suites.forEach(visit);
  const sortedFiles = [...files].sort();
  if (!sortedFiles.length) throw new Error(`Playwright --list produced no source files for ${config}`);
  return { output, files: sortedFiles };
}

function playwrightListAudit() {
  const staticSuite = listPlaywrightFiles('tests/e2e/elm.config.ts');
  const localEnv = { ...process.env, ONYX_ELM_LAB_BASE: 'https://127.0.0.1:1', ONYX_ELM_LAB_WS: 'wss://127.0.0.1:1/ws' };
  const localSuite = listPlaywrightFiles('tests/e2e/elm-local.config.ts', localEnv);
  const mediaSuite = listPlaywrightFiles('playwright.config.ts', process.env, ['--project=chromium', 'tests/e2e/voice.spec.ts']);
  const browserEnv = { ...process.env, ONYX_CHROMIUM_EXECUTABLE: process.env.ONYX_CHROMIUM_EXECUTABLE || '/usr/bin/chromium' };
  const stressSuite = listPlaywrightFiles('elm/tools/perf/playwright.config.ts', browserEnv, ['--grep', 'stress mock wire']);
  const perfSuite = listPlaywrightFiles('elm/tools/perf/playwright.config.ts', browserEnv, ['--grep', 'measure deterministic']);
  const suites = [staticSuite.files, localSuite.files, mediaSuite.files, stressSuite.files, perfSuite.files];
  for (let left = 0; left < suites.length; left += 1) for (let right = left + 1; right < suites.length; right += 1) {
    const overlap = suites[left].filter(file => suites[right].includes(file));
    if (overlap.length) throw new Error(`Playwright suites overlap: ${overlap.join(', ')}`);
  }
  const observation = { id: 'playwright-suite-separation', command: 'pnpm exec playwright test --config <declared-config> --list', staticElm: staticSuite.files, localServer: localSuite.files, rootMedia: mediaSuite.files, elmStress: stressSuite.files, performance: perfSuite.files };
  laneObservations.push(observation);
  process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
  return 0;
}

function performanceLane() {
  const baselineStage = process.env.ONYX_PERF_BASELINE_STAGE;
  const baselineReceipt = process.env.ONYX_PERF_BASELINE_RECEIPT;
  if (!baselineStage || !baselineReceipt) {
    const observation = { id: 'performance-last', status: 'unavailable', reason: 'No distinct validated source-bound baseline stage and receipt were supplied; no candidate measurement was run.' };
    laneObservations.push(observation);
    process.stdout.write(`${JSON.stringify(observation)}\n`);
    return 2;
  }
  const result = run(process.execPath, [resolve(elmDir, 'tools/perf/run.mjs'), '--suite=measure', '--baseline-stage', baselineStage, '--baseline-receipt', baselineReceipt], root);
  laneObservations.push({ id: 'performance-last', status: result === 0 ? 'paired-observation-complete' : 'blocked', baselineStage, baselineReceipt, exitStatus: result });
  return result;
}

async function finalLane() {
  const stages = [];
  const capture = async (id, operation) => {
    let exitStatus;
    try { exitStatus = await operation(); }
    catch (error) { process.stderr.write(`${id}: ${error.stack ?? error}\n`); exitStatus = 2; }
    stages.push({ id, exitStatus });
  };
  await capture('transcript-validation-and-generator-check', async () => { validateCatalog(); return 0; });
  await capture('elm-full', async () => elmLane(true));
  await capture('node-smokes', async () => nodeSmokeLane());
  await capture('elm-runtime-vitest-projects', async () => runtimeTests());
  await capture('root-typecheck-lint-test', async () => rootGates());
  await capture('E02-contract-observations', async () => contractObservations());
  await capture('playwright-list-audit', async () => playwrightListAudit());
  await capture('mock-chromium-browser', async () => chromiumLane());
  await capture('local-server-browser', async () => localBrowserLane());
  await capture('stress-media-browser', async () => stressMediaLane());
  // Keep this isolated paired run last; no baseline means unavailable/blocked.
  await capture('performance-last', async () => performanceLane());
  laneObservations.push({ id: 'final-consolidated-phase', stages });
  return stages.some(stage => stage.exitStatus === 1) ? 1 : stages.some(stage => stage.exitStatus !== 0) ? 2 : 0;
}

function jsonReport(result, label) {
  if (result.error) throw result.error;
  const records = (result.stdout ?? '').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { throw new Error(`${label}: elm-test emitted a non-JSON report line`); }
  });
  const start = records.find(row => row.event === 'runStart');
  const complete = records.find(row => row.event === 'runComplete');
  const tests = records.filter(row => row.event === 'testCompleted');
  if (!start || !complete || tests.length !== Number(start.testCount)) throw new Error(`${label}: incomplete elm-test JSON event stream`);
  return { start, complete, tests };
}

function expectedFailureProof() {
  const elm = findCommand('elm');
  const test = findCommand('elm-test');
  version(elm, '0.19.1');
  version(test, '0.19.1-revision17');
  validateCatalog();
  const catalogPath = resolve(elmDir, 'fixtures/roadmap/catalog.json');
  const originalCatalogBytes = readFileSync(catalogPath);
  const originalCatalog = originalCatalogBytes.toString('utf8');
  const marker = '"CAP REQ message-tags\\r\\n"';
  const replacement = '"CAP REQ mutated-message-tags\\r\\n"';
  if (originalCatalog.indexOf(marker) < 0 || originalCatalog.indexOf(marker) !== originalCatalog.lastIndexOf(marker)) throw new Error('Expected-outbound mutation marker must occur exactly once');
  const expectedCatalog = JSON.parse(originalCatalog);
  const targetId = 'E04.cap-ping-known-good';
  const target = expectedCatalog.scenarios.find(scenario => scenario.id === targetId);
  if (!target || !target.expect.outboundLines.includes('CAP REQ message-tags\r\n')) throw new Error('Known-good catalog case/expected output is missing');
  const temp = mkdtempSync(join(os.tmpdir(), 'onyx-elm-expected-failure-'));
  const copy = resolve(temp, 'elm');
  try {
    cpSync(elmDir, copy, { recursive: true, filter: path => !path.includes('/elm-stuff/') && !path.includes('/node_modules/') });
    const copiedCatalog = resolve(copy, 'fixtures/roadmap/catalog.json');
    const copiedGenerated = resolve(copy, 'tests/RoadmapFixtures.elm');
    const runnerArgs = ['--seed', seed, '--fuzz', fuzz, '--report', 'json', 'tests/RoadmapTranscriptTest.elm'];
    const base = spawnSync(test, runnerArgs, { cwd: copy, env: process.env, encoding: 'utf8', timeout: 60000 });
    const baseReport = jsonReport(base, 'baseline');
    if (base.status !== 0 || baseReport.complete.failed !== '0') throw new Error(`Known-good fixture baseline must pass before mutation (status=${base.status})`);
    const originalGeneratedDigest = hash(readFileSync(copiedGenerated));
    commandsRun.push({ cmd: test, args: runnerArgs, cwd: copy, phase: 'known-good baseline' });

    const mutantCatalog = originalCatalog.replace(marker, replacement);
    if (mutantCatalog === originalCatalog) throw new Error('Expected-output mutation did not alter the catalog');
    writeFileSync(copiedCatalog, mutantCatalog);
    const generated = spawnSync(process.execPath, [resolve(copy, 'tools/generate-roadmap-fixtures.mjs')], { cwd: temp, env: process.env, encoding: 'utf8', timeout: 10000 });
    if (generated.status !== 0) throw new Error(`Could not regenerate isolated fixture module: ${generated.stderr}`);
    const mutatedGeneratedDigest = hash(readFileSync(copiedGenerated));
    const mutantRun = spawnSync(test, runnerArgs, { cwd: copy, env: process.env, encoding: 'utf8', timeout: 60000 });
    const mutantReport = jsonReport(mutantRun, 'mutated expected-failure run');
    commandsRun.push({ cmd: process.execPath, args: [resolve(copy, 'tools/generate-roadmap-fixtures.mjs')], cwd: temp, phase: 'mutated catalog fixture generation' });
    commandsRun.push({ cmd: test, args: runnerArgs, cwd: copy, phase: 'mutated assertion' });
    const targetEvent = mutantReport.tests.find(event => event.labels?.includes(targetId));
    const failureJson = JSON.stringify(targetEvent?.failures ?? []);
    const passedOthers = mutantReport.tests.filter(event => !event.labels?.includes(targetId)).every(event => event.status === 'pass');
    if (mutantRun.status === 0 || mutantReport.complete.failed !== '1' || targetEvent?.status !== 'fail'
      || !failureJson.includes('CAP REQ mutated-message-tags') || !passedOthers
      || /Compilation failed|failed to compile/i.test(mutantRun.stderr ?? '')) {
      throw new Error(`Mutation was not the single structured assertion failure for ${targetId}; status=${mutantRun.status}`);
    }
    laneObservations.push({
      id: 'expected-failure-proof',
      targetId,
      seed,
      fuzz,
      originalCatalogSha256: hash(originalCatalogBytes),
      originalGeneratedModuleSha256: originalGeneratedDigest,
      mutatedGeneratedModuleSha256: mutatedGeneratedDigest,
      baseline: {
        exitStatus: base.status,
        testCount: Number(baseReport.start.testCount),
        passed: Number(baseReport.complete.passed),
        failed: Number(baseReport.complete.failed),
      },
      mutant: {
        exitStatus: mutantRun.status,
        testCount: Number(mutantReport.start.testCount),
        passed: Number(mutantReport.complete.passed),
        failed: Number(mutantReport.complete.failed),
        targetFailures: targetEvent.failures ?? [],
        passedOthers,
      },
    });
    process.stdout.write(`Expected-failure proof passed: ${targetId} passed from the original catalog, then failed one exact expected outbound assertion in an isolated catalog/generated-module copy; other cases passed.\n`);
    return 0;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

let result = 0;
try {
  if (requested === 'validate-transcripts') validateCatalog();
  else if (requested === 'manifest') process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  else if (requested === 'elm-focused' || requested === 'elm-full') result = elmLane(requested === 'elm-full');
  else if (requested === 'node-smokes') result = await nodeSmokeLane();
  else if (requested === 'runtime-tests') result = runtimeTests();
  else if (requested === 'root-gates') result = rootGates();
  else if (requested === 'chromium-mock') result = chromiumLane();
  else if (requested === 'browser-local') result = localBrowserLane();
  else if (requested === 'stress-media') result = stressMediaLane();
  else if (requested === 'contract-observations') result = contractObservations();
  else if (requested === 'playwright-list-audit') result = playwrightListAudit();
  else if (requested === 'performance') result = performanceLane();
  else if (requested === 'final') result = await finalLane();
  else if (requested === 'expected-failure') result = expectedFailureProof();
  saveReceipt(requested, process.argv.slice(0, 3), result, `seed=${seed}; fuzz=${fuzz}; bounded processes; no hidden skips; gates and acceptance remain distinct`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
if (result !== 0) process.exitCode = result;
