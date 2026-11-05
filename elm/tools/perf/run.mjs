#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, platform, release, arch } from 'node:os';
import { access, constants, lstat, mkdir, open, readFile, readdir, realpath, unlink, link, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceCut, digestRecords } from './source-cut.mjs';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = process.argv.slice(2);
let suite = 'measure';
let receiptValue = null;
let baselineStageArg = null;
let baselineReceiptArg = null;
let planOnly = false;
for (let index = 0; index < args.length; index++) {
  const value = args[index];
  if (value === '--plan-only') planOnly = true;
  else if (value.startsWith('--suite=')) suite = value.slice('--suite='.length);
  else if (value === '--receipt') receiptValue = args[++index] ?? '';
  else if (value.startsWith('--receipt=')) receiptValue = value.slice('--receipt='.length);
  else if (value === '--baseline-stage') baselineStageArg = args[++index] ?? '';
  else if (value.startsWith('--baseline-stage=')) baselineStageArg = value.slice('--baseline-stage='.length);
  else if (value === '--baseline-receipt') baselineReceiptArg = args[++index] ?? '';
  else if (value.startsWith('--baseline-receipt=')) baselineReceiptArg = value.slice('--baseline-receipt='.length);
  else throw new Error(`Unknown argument ${value}`);
}
if (!['measure', 'stress'].includes(suite)) throw new Error(`Unknown suite ${suite}`);
if (!!baselineStageArg !== !!baselineReceiptArg) throw new Error('Paired observations require both --baseline-stage and --baseline-receipt');
if (receiptValue === '') throw new Error('Receipt path cannot be empty');
const receipt = resolve(receiptValue ?? `/tmp/onyx-elm-perf-${process.pid}-${randomUUID()}.json`);
if (!receipt.startsWith('/tmp/')) throw new Error('Receipt must be inside /tmp');
const receiptParent = dirname(receipt);
const receiptStat = await lstat(receiptParent).catch(() => null);
if (!receiptStat?.isDirectory() || receiptStat.isSymbolicLink()) throw new Error('Receipt parent must be an existing real /tmp directory');
const canonicalTmp = await realpath('/tmp');
const canonicalParent = await realpath(receiptParent);
if (canonicalParent !== canonicalTmp && !canonicalParent.startsWith(`${canonicalTmp}/`)) throw new Error('Receipt parent resolves outside /tmp');
const existingReceipt = await lstat(receipt).catch(() => null);
if (existingReceipt?.isSymbolicLink()) throw new Error('Receipt path cannot be a symlink');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function treeHash(dir) {
  const entries = [];
  async function walk(base, prefix = '') {
    for (const item of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      const absolute = resolve(base, item.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Stage contains a symlink with ambiguous served bytes: ${name}`);
      else if (metadata.isDirectory()) await walk(absolute, name);
      else if (metadata.isFile()) {
        const bytes = await readFile(absolute);
        entries.push(`${name}\0${bytes.length}\0${metadata.mode & 0o777}\0${hash(bytes)}\n`);
      }
    }
  }
  await walk(dir);
  return hash(Buffer.from(entries.join(''), 'utf8'));
}

async function executable(name) {
  const candidates = name.includes('/') ? [name] : (process.env.PATH ?? '').split(':').map(dir => resolve(dir, name));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}

async function toolInfo(name, versionArgs = ['--version']) {
  const candidate = await executable(name);
  if (!candidate) return { path: null, binarySha256: null, version: null };
  let path = candidate;
  let binarySha256 = null;
  try {
    path = await realpath(candidate);
    binarySha256 = hash(await readFile(path));
  } catch { /* explicit null */ }
  let version = null;
  try { version = execFileSync(candidate, versionArgs, { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }).trim(); } catch { /* explicit null */ }
  return { path, binarySha256, version };
}

async function saveReceipt(value) {
  const parentNow = await realpath(receiptParent);
  if (parentNow !== canonicalParent || (parentNow !== canonicalTmp && !parentNow.startsWith(`${canonicalTmp}/`))) throw new Error('Receipt parent changed or resolves outside /tmp');
  const temp = resolve(receiptParent, `.onyx-perf-receipt-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    // Hard-link finalization is atomic and fails if a prior receipt exists;
    // it never follows a raced-in symlink at the destination.
    await link(temp, receipt);
  } finally {
    await handle.close();
    await unlink(temp).catch(() => {});
  }
}

const sourcePre = buildSourceCut(root);
const chromiumPath = process.env.ONYX_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium';
const [pnpmInfo, elmInfo, chromiumInfo] = await Promise.all([
  toolInfo('pnpm'), toolInfo(process.env.ELM_BIN ?? 'elm'), toolInfo(chromiumPath),
]);
const runId = `${process.pid}-${randomUUID()}`;
const measurementMethodologyVersion = suite === 'measure' ? 'elm-active-page-post-gc-v3' : null;
const runDir = `/tmp/onyx-elm-perf-${runId}`;
const stage = `${runDir}/stage`;
const resultLines = `${runDir}/results.jsonl`;
const port = 20000 + (process.pid % 30000);
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  suite,
  status: planOnly ? 'plan-only' : 'running',
  sourceCut: sourcePre,
  sourcePreSha256: sourcePre.digest,
  sourcePostSha256: null,
  sourceChangedDuringRun: null,
  stageSha256BeforeServe: null,
  stageSha256AfterRun: null,
  stageChangedDuringRun: null,
  stagePath: stage,
  comparisonMode: baselineStageArg ? 'paired-candidate-and-baseline' : 'candidate-only',
  measurementMethodologyVersion,
  baseline: baselineStageArg ? { stagePath: resolve(baselineStageArg), receiptPath: resolve(baselineReceiptArg), evidenceStatus: 'pending-validation', lanes: [] } : { evidenceStatus: 'unavailable', reason: 'No prior baseline stage and receipt supplied' },
  runId,
  runDirectory: runDir,
  browserServerPort: port,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }).trim(),
  gitDirty: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }).trim() !== '',
  seed: '0x0E90',
  fixedEpoch: '2026-10-09T10:00:00Z',
  host: { platform: platform(), release: release(), arch: arch(), node: process.version, cpuModels: [...new Set(cpus().map(cpu => cpu.model))], logicalCpus: cpus().length },
  provenance: { pnpm: pnpmInfo, elm: elmInfo, chromium: chromiumInfo, elmHome: process.env.ELM_HOME ?? null },
  dataset: { diskTargets: 250, rowsPerTarget: 400, requestedVaultRows: 100000, joinedRooms: 50, activeRosterOffered: 1000, activeLoadedRequested: [500, 1000], initialRenderTarget: 120 },
  workloadSettings: { seed: '0x0E90', desktopViewport: '1280x900', mobileViewport: '390x844', mobileCpuThrottle: 4, inputKeystrokes: 50, ingestCycles: 5, eventsPerCycle: 1000, idbSamples: 100, idbBatchSize: 100, ...(suite === 'measure' ? { laneOperationalTimeoutMs: 600_000, ingestionCohortAssertionTimeoutMs: 10_000, persistenceSettlementGuardMs: 10_000, persistenceEvaluationWatchdogMs: 15_000 } : {}) },
  thresholds: { desktopInputP95Ms: 100, emulatedMobileInputP95Ms: 200, maxIngestLongTaskMs: 200, lastThreeCycleActivePostGcHeapGrowthPercent: 10 },
  ...(suite === 'measure' ? { heapMethodology: { rawDiagnosticField: 'last3EqualWorkloadHeapGrowthPercent', retainedMetricField: 'lastThreeCycleActivePostGcHeapGrowthPercent', perCycleSampleField: 'activePagePostGcHeapUsedBytes', collectionScope: 'same active page after each UI and target-vault persistence settlement', persistenceDrainBarrier: 'latest runtime vaultPut snapshot containing cycle evt-999 settled ready, no pending calls for its exact owner/target, and that owned target row is present before GC', persistenceSettlementGuardMs: 10_000, persistenceEvaluationWatchdogMs: 15_000, unavailablePolicy: 'open threshold failure; never substitute zero' } } : {}),
  limitations: ['Bounded performance observation only; not reconstructible full roadmap source acceptance', 'CPU-throttled viewport emulation is not real mobile or OS evidence', 'No battery or media acceptance evidence'],
};
if (planOnly) {
  await saveReceipt(output);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

let playwrightExitCode = null;
const missingTools = Object.entries({ pnpm: pnpmInfo, elm: elmInfo, chromium: chromiumInfo })
  .filter(([, info]) => !info.path || !info.version || !info.binarySha256)
  .map(([name]) => name);
let failure = missingTools.length ? `Missing required provenance for executable(s): ${missingTools.join(', ')}` : null;
let lanes = [];
let baselineLanes = [];
let baselineFailure = null;
let baselineStage = null;
let baselineEvidence = null;

async function runBrowserLane(stagePath, resultPath, lanePort) {
  await writeFile(resultPath, '', { mode: 0o600 });
  const spec = suite === 'measure' ? 'tests/e2e/elm-performance.measure.spec.ts' : 'tests/e2e/elm-stress.browser.spec.ts';
  const env = { ...process.env, ONYX_PERF_STAGE: stagePath, ONYX_PERF_PORT: String(lanePort), ONYX_PERF_RESULT: resultPath, ONYX_CHROMIUM_EXECUTABLE: chromiumPath };
  const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'elm/tools/perf/playwright.config.ts', spec], {
    cwd: root, env, stdio: 'inherit', timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.signal || result.status === null) throw new Error(`Playwright terminated (${result.signal ?? 'unknown'})`);
  const rawResults = await readFile(resultPath, 'utf8');
  const observations = rawResults.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { status: result.status, observations };
}

try {
  if (failure) throw new Error(failure);
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'elm/tools/perf/tsconfig.json'], { cwd: root, stdio: 'inherit', env: process.env, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  execFileSync(process.execPath, ['--experimental-strip-types', '--test', 'elm/tools/perf/fixtures.test.mjs'], { cwd: root, stdio: 'inherit', env: process.env, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  await mkdir(runDir, { mode: 0o700 });
  await mkdir(stage, { mode: 0o700 });
  if (baselineStageArg) {
    const baselineReceiptPath = resolve(baselineReceiptArg);
    const baselineStat = await lstat(baselineReceiptPath).catch(() => null);
    if (!baselineStat?.isFile() || baselineStat.isSymbolicLink()) throw new Error('Baseline receipt must be a regular non-symlink file');
    baselineEvidence = JSON.parse(await readFile(baselineReceiptPath, 'utf8'));
    const baselineReceiptParent = await realpath(dirname(baselineReceiptPath));
    if (baselineReceiptParent !== canonicalTmp && !baselineReceiptParent.startsWith(`${canonicalTmp}/`)) throw new Error('Baseline receipt resolves outside /tmp');
    baselineStage = resolve(baselineStageArg);
    const stageStat = await lstat(baselineStage).catch(() => null);
    const canonicalBaselineStage = await realpath(baselineStage).catch(() => null);
    if (!stageStat?.isDirectory() || stageStat.isSymbolicLink() || !canonicalBaselineStage || !canonicalBaselineStage.startsWith(`${canonicalTmp}/`)) throw new Error('Baseline stage must be an existing real directory under /tmp');
    const baselineStageHash = await treeHash(baselineStage);
    const compatible = baselineEvidence?.schemaVersion === 1
      && baselineEvidence?.suite === suite
      && typeof baselineEvidence.generatedAt === 'string' && Number.isFinite(Date.parse(baselineEvidence.generatedAt))
      && Date.parse(baselineEvidence.generatedAt) < Date.parse(output.generatedAt)
      && baselineEvidence.stageSha256BeforeServe === baselineStageHash
      && baselineEvidence.stageSha256AfterRun === baselineStageHash
      && baselineEvidence.sourceChangedDuringRun === false
      && baselineEvidence.sourcePreSha256 === baselineEvidence.sourcePostSha256
      && baselineEvidence.sourcePreSha256 !== sourcePre.digest
      && Array.isArray(baselineEvidence.sourceCut?.files)
      && digestRecords(baselineEvidence.sourceCut.files) === baselineEvidence.sourcePreSha256
      && JSON.stringify(baselineEvidence.host) === JSON.stringify(output.host)
      && JSON.stringify(baselineEvidence.provenance?.chromium) === JSON.stringify(chromiumInfo)
      && JSON.stringify(baselineEvidence.provenance?.pnpm) === JSON.stringify(pnpmInfo)
      && JSON.stringify(baselineEvidence.provenance?.elm) === JSON.stringify(elmInfo)
      && baselineEvidence.provenance?.elmHome === output.provenance.elmHome
      && (suite !== 'measure' || baselineEvidence.measurementMethodologyVersion === output.measurementMethodologyVersion)
      && baselineEvidence.seed === output.seed
      && JSON.stringify(baselineEvidence.dataset) === JSON.stringify(output.dataset)
      && JSON.stringify(baselineEvidence.workloadSettings) === JSON.stringify(output.workloadSettings);
    if (!compatible) throw new Error('Baseline receipt does not prove a prior, distinct, unchanged stage/source with matching hardware, browser, measurement methodology, seed, and dataset');
    output.baseline = { stagePath: canonicalBaselineStage, receiptPath: baselineReceiptPath, receiptSourceSha256: baselineEvidence.sourcePreSha256, stageSha256: baselineStageHash, evidenceStatus: 'validated', lanes: [] };
    const baselineRun = await runBrowserLane(canonicalBaselineStage, `${runDir}/baseline-results.jsonl`, port);
    baselineLanes = baselineRun.observations;
    output.baseline.lanes = baselineLanes;
    output.baseline.playwrightExitCode = baselineRun.status;
    output.baseline.stageSha256AfterRun = await treeHash(canonicalBaselineStage);
    if (output.baseline.stageSha256AfterRun !== baselineStageHash) throw new Error('Baseline stage bytes changed during the observation');
    if (baselineRun.status !== 0 || baselineLanes.length === 0) throw new Error('Baseline browser lane failed or produced no observations');
  }
  execFileSync(process.execPath, ['tools/build-elm-site.mjs', stage], { cwd: root, stdio: 'inherit', env: process.env, timeout: 20 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  output.stageSha256BeforeServe = await treeHash(stage);
  const candidateRun = await runBrowserLane(stage, resultLines, port + (baselineStage ? 1 : 0));
  playwrightExitCode = candidateRun.status;
  lanes = candidateRun.observations;
  output.stageSha256AfterRun = await treeHash(stage);
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (baselineStageArg && output.baseline.evidenceStatus !== 'validated') {
    baselineFailure = failure;
    output.baseline = { stagePath: resolve(baselineStageArg), receiptPath: resolve(baselineReceiptArg), evidenceStatus: 'unavailable', reason: failure, lanes: [] };
    output.comparisonMode = 'candidate-only';
    failure = null;
  }
}

const sourcePost = buildSourceCut(root);
output.sourcePostSha256 = sourcePost.digest;
output.sourceChangedDuringRun = sourcePre.digest !== sourcePost.digest;
output.sourcePostFileCount = sourcePost.fileCount;
output.stageChangedDuringRun = output.stageSha256BeforeServe !== output.stageSha256AfterRun;
output.lanes = lanes;
output.baselineLanes = baselineLanes;
if (baselineFailure) output.baselineUnavailableReason = baselineFailure;
if (output.baseline.evidenceStatus === 'validated') {
  output.comparisons = lanes.map(candidate => {
    const baselineLane = baselineLanes.find(row => row.mode === candidate.mode);
    const names = suite === 'measure'
      ? ['inputLatencyP50Ms', 'inputLatencyP95Ms', 'inputLatencyMaxMs', 'maxIngestLongTaskMs', 'last3EqualWorkloadHeapGrowthPercent', 'lastThreeCycleActivePostGcHeapGrowthPercent']
      : ['assertionCount', 'passedAssertionCount'];
    const metrics = Object.fromEntries(names.map(name => {
      const before = baselineLane?.[name];
      const after = candidate?.[name];
      return [name, typeof before === 'number' && typeof after === 'number'
        ? { baseline: before, candidate: after, delta: after - before, comparable: true }
        : { baseline: typeof before === 'number' ? before : null, candidate: typeof after === 'number' ? after : null, delta: null, comparable: false, reason: 'metric-unavailable-in-one-or-both-lanes' }];
    }));
    return { mode: candidate.mode ?? 'unknown', cohort: suite, metrics };
  });
} else {
  output.comparisons = { status: 'unavailable', reason: output.baseline.reason ?? 'No validated baseline supplied' };
}
output.playwrightExitCode = playwrightExitCode;
if (failure) output.failure = failure;
const thresholdFailures = lanes.flatMap(lane => Array.isArray(lane.thresholdFailures) ? lane.thresholdFailures : []);
const openStressFailures = lanes.filter(lane => lane.status === 'failed-open');
const unavailable = lanes.filter(lane => lane.status === 'unavailable');
const emptyLanes = lanes.length === 0;
output.openFailureCount = thresholdFailures.length + openStressFailures.length;
output.unavailableCaseCount = unavailable.length;
if (failure || (playwrightExitCode !== 0 && playwrightExitCode !== null) || emptyLanes) output.status = 'failed';
else if (output.sourceChangedDuringRun || output.stageChangedDuringRun || unavailable.length || (baselineStageArg && output.baseline.evidenceStatus !== 'validated')) output.status = 'blocked';
else if (output.openFailureCount) output.status = 'completed-with-open-failures';
else output.status = 'completed';
await saveReceipt(output);
process.stdout.write(`Receipt: ${receipt}\n`);
// Keep stage bytes and raw result traces beside the receipt; they are the
// artifact evidence needed to reconstruct this bounded observation.
if (output.status === 'failed') process.exitCode = playwrightExitCode !== null && playwrightExitCode !== 0 ? playwrightExitCode : 1;
else if (output.status === 'blocked' || output.openFailureCount) process.exitCode = 2;
