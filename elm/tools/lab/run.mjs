#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { mkdtemp, mkdir, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateRun, FILE_MODE, GROUP_CASES, GROUP_SPEC_TITLES, GROUP_STAGE_CODES, LOOPBACK, nodeToml, parseArgs, privateWrite, sha256, writeGroupReceipt } from './config.mjs';
import { writeReceipt } from './receipt.mjs';
import { serve } from './serve-https.mjs';
import { provisionFoundationAccount, runFoundationWire, runHistoryScenarios, runSessionScenarios, waitForTopology } from './raw-scenarios.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BUILD = join(ROOT, 'tools/build-elm-site.mjs');
const ELM_TOOL_PATH = '/tmp/onyx-elm-tools:/usr/local/bin:/usr/bin:/bin';
const MAX_LOG = 1024 * 1024;
const reason = { blocked: 'deterministic_server_trigger_unavailable', config: 'config_preflight_refused', provenance: 'binary_source_unverified', tls: 'wss_tls_refused', failed: 'assertion_failed' };

function fixedVersion(text) { return text.match(/[0-9]+\.[0-9]+\.[0-9]+(?:\+[A-Za-z0-9._-]+)?/)?.[0] || 'unknown'; }
function toolVersion(command, args, label, pattern) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
  const match = `${result.stdout || ''}${result.stderr || ''}`.match(pattern);
  return result.status === 0 && match ? `${label} ${match[1]}` : `${label} 0.0.0`;
}
async function reserve(count) {
  const ports = [];
  for (let i = 0; i < count; i += 1) {
    const server = createServer();
    await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, LOOPBACK, resolvePromise); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('port_reservation_failed');
    ports.push(address.port); await new Promise((resolvePromise) => server.close(resolvePromise));
  }
  return ports;
}
function cleanEnv(root) {
  return { PATH: ELM_TOOL_PATH, HOME: join(root, 'home'), TMPDIR: root, ELM_HOME: '/tmp/onyx-elm-home', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CI: '1' };
}
function spawnTracked(command, args, options) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.outputBytes = 0; child.outputOverflow = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { child.outputBytes += chunk.length; if (child.outputBytes > MAX_LOG) child.outputOverflow = true; });
  return child;
}
async function runTrackedCommand(command, args, options) {
  const child = spawnTracked(command, args, options);
  let output = ''; let overflow = false;
  const collect = (chunk) => {
    if (output.length < 8192) output += chunk.toString('utf8').slice(0, 8192 - output.length);
    else overflow = true;
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  let timedOut = false;
  const timeout = options.timeout || 180_000;
  let killTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ } }
    killTimer = setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } } }, 1000);
    killTimer.unref();
  }, timeout);
  let watchdog;
  const code = await Promise.race([new Promise((resolvePromise) => {
    child.once('close', (exitCode) => resolvePromise(exitCode ?? 1));
    child.once('error', () => resolvePromise(127));
  }), new Promise((resolvePromise) => { watchdog = setTimeout(() => resolvePromise(124), timeout + 2500); watchdog.unref(); })]);
  clearTimeout(timer);
  clearTimeout(killTimer);
  clearTimeout(watchdog);
  // A tracked leader may leave descendants behind. Clean only its own process group.
  if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group exited */ } }
  return { child, code: timedOut ? 124 : code, output, overflow, timedOut };
}
async function stopChildren(children) {
  for (const child of [...children].reverse()) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group already exited */ } }
  }
  await Promise.all(children.map(async (child) => {
    await Promise.race([new Promise((resolvePromise) => child.once('exit', resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))]);
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group gone */ } }
    await Promise.race([new Promise((resolvePromise) => child.once('exit', resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))]);
  }));
}
async function stageClient(root, env) {
  const stage = join(root, 'site');
  const result = spawnSync(process.execPath, [BUILD, stage], { cwd: ROOT, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 128 * 1024 });
  if (result.status !== 0) throw new Error('elm_stage_failed');
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push([path.slice(stage.length + 1), sha256(await readFile(path))]);
    }
  }
  await walk(stage); files.sort((a, b) => a[0].localeCompare(b[0]));
  return { path: stage, hash: sha256(Buffer.from(JSON.stringify(files))) };
}
async function gitInfo() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() || 'unknown';
  const dirty = Boolean(spawnSync('git', ['status', '--porcelain', '--', 'elm/', 'tools/build-elm-site.mjs'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim());
  const manifest = spawnSync(process.execPath, [join(ROOT, 'elm/tools/source-manifest.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
  let manifestHash = 'unavailable';
  if (manifest.status === 0) {
    try { manifestHash = JSON.parse(manifest.stdout).digest; } catch { /* unavailable is explicit */ }
  }
  return { head, dirty, manifestHash };
}
async function makeTls(root, env) {
  const key = join(root, 'local.key'); const cert = join(root, 'local.crt');
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { cwd: root, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 4096 });
  if (result.status !== 0) throw new Error('local_certificate_generation_failed');
  await chmod(key, FILE_MODE); await chmod(cert, FILE_MODE);
  return { key: await readFile(key), cert: await readFile(cert), keyPath: key, certPath: cert };
}
async function startDaemon(binary, config, cwd, env, children) {
  const check = await runTrackedCommand(binary, ['--check-config', config], { cwd, env, timeout: 20_000 }); children.push(check.child);
  if (check.code !== 0 || check.overflow) throw new Error('config_preflight_refused');
  const init = await runTrackedCommand(binary, ['--initialize-guest-issuer', config], { cwd, env, timeout: 20_000 }); children.push(init.child);
  if (init.code !== 0 || init.overflow) throw new Error('issuer_initialize_refused');
  const daemon = spawnTracked(binary, [config], { cwd, env }); daemon.isDaemon = true; children.push(daemon);
  return daemon;
}
async function probeWss(url) {
  const endpoint = new URL(url);
  return await new Promise((resolvePromise) => {
    const socket = tlsConnect({ host: endpoint.hostname, port: Number(endpoint.port), servername: 'localhost', rejectUnauthorized: false });
    const timer = setTimeout(() => { socket.destroy(); resolvePromise(false); }, 3500);
    socket.once('secureConnect', () => { clearTimeout(timer); socket.end(); resolvePromise(true); });
    socket.once('error', () => { clearTimeout(timer); resolvePromise(false); });
  });
}
function caseRecord(id, scenarioIds, status, reasonCode = null, counts = { executed: 0, passed: 0, failed: 0 }) {
  return { id, scenarioIds, driver: id === 'foundation' || id === 'foundation-auth' || id === 'foundation-binary' || id.endsWith('-browser-bootstrap') ? 'elm-browser' : status === 'blocked' ? 'plan' : 'raw-tls', status, assertions: counts, reasonCode, evidenceRefs: [] };
}
function browserSpecs(report) {
  const found = [];
  const visit = (suite) => {
    for (const spec of suite?.specs || []) for (const browserTest of spec.tests || []) {
      const result = browserTest.results?.at(-1);
      const text = (result?.errors || []).map((error) => typeof error?.message === 'string' ? error.message : '').join('\n');
      found.push({ title: spec.title || '', status: result?.status || 'missing', text });
    }
    for (const child of suite?.suites || []) visit(child);
  };
  for (const suite of report?.suites || []) visit(suite);
  return found;
}
function safeBrowserFailure(spec, runnerCode) {
  if (!spec || spec.status === 'missing') return 'browser_report_missing';
  if (runnerCode === 124) return 'browser_runner_timeout';
  if (/binary_frame_not_terminated/iu.test(spec.text)) return 'browser_binary_frame_not_terminated';
  if (/owner_scoped_outbox_admission_missing/iu.test(spec.text)) return 'browser_outbox_admission_missing';
  if (spec.title === 'Elm browser identifies a private account and sends an authenticated canary') return 'browser_authentication_failed';
  if (/onyx-conn-live/iu.test(spec.text)) return 'browser_elm_live_timeout';
  if (/CAP END/iu.test(spec.text)) return 'browser_cap_end_missing';
  if (/CAP LS|CAP END| 005 /u.test(spec.text)) return 'browser_registration_assertion_failed';
  if (/timed?\s*out|timeout/iu.test(spec.text) || spec.status === 'timedOut') return 'browser_assertion_timeout';
  return 'browser_assertion_failed';
}
/** Group stages run serially; a skipped later stage is blocked, never passed. */
function groupBrowserCases(report, runnerCode) {
  const specs = browserSpecs(report);
  return Object.entries(GROUP_SPEC_TITLES).map(([id, title]) => {
    const spec = specs.find((entry) => entry.title === title);
    if (spec?.status === 'passed') return { ...caseRecord(id, GROUP_CASES[id], 'pass', null, { executed: 1, passed: 1, failed: 0 }), driver: 'elm-browser' };
    if (spec?.status === 'skipped') return { ...caseRecord(id, GROUP_CASES[id], 'blocked', 'browser_stage_not_run'), driver: 'elm-browser' };
    const code = /group_stage:([a-z_]+)/u.exec(spec?.text || '')?.[1];
    const reasonCode = code && GROUP_STAGE_CODES.includes(code) ? `group_${code}` : safeBrowserFailure(spec, runnerCode);
    const known = ['browser_report_missing', 'browser_runner_timeout', 'browser_assertion_timeout'].includes(reasonCode) || reasonCode.startsWith('group_') ? reasonCode : 'browser_assertion_failed';
    return { ...caseRecord(id, GROUP_CASES[id], 'fail', known, { executed: 1, passed: 0, failed: 1 }), driver: 'elm-browser' };
  });
}
function browserCase(report, runnerCode, title, id, scenarios) {
  const spec = browserSpecs(report).find((entry) => entry.title === title);
  if (spec?.status === 'passed') return caseRecord(id, scenarios, 'pass', null, { executed: 1, passed: 1, failed: 0 });
  return caseRecord(id, scenarios, 'fail', safeBrowserFailure(spec, runnerCode), { executed: 1, passed: 0, failed: 1 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const plan = args['--plan-only'] === true;
  const scratchParent = args['--scratch-parent'] || '/tmp';
  const receiptPath = args['--receipt'] || `/tmp/onyx-elm-lab-plan-${process.pid}.json`;
  let privateRun; let server; let https; const children = [];
  const results = [];
  const envRoot = await mkdtemp(join(tmpdir(), 'onyx-lab-env-')); await chmod(envRoot, 0o700); await mkdir(join(envRoot, 'home'), { mode: 0o700 });
  const env = cleanEnv(envRoot);
  let source = { head: 'unknown', dirty: true, manifestHash: 'unavailable' };
  let stage = { path: '', hash: 'unavailable' };
  let serverInfo = { binarySha256: 'unavailable', version: 'unknown', sourceGitHead: null, sourceDirty: true, sourceManifestSha256: 'unavailable', sourceBinding: 'unverified', buildReceipt: null };
  let topology = { kind: args['--topology'] || 'two', nodes: [], edges: [] };
  let rawResults = [];
  try {
    source = await gitInfo();
    if (plan) {
      results.push(caseRecord('isolation-plan', ['cli-contract', 'private-paths', 'loopback-only', 'redacted-receipt', 'tracked-process-policy'], 'blocked', 'plan_only'));
    } else {
      const run = await createPrivateRun({ scratchParent, serverBin: args['--server-bin'], serverSource: args['--server-source'], serverBuildReceipt: args['--server-build-receipt'] }); privateRun = run;
      serverInfo.binarySha256 = run.artifactHash;
      const version = spawnSync(run.binary, ['--version'], { cwd: run.root, env, encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
      serverInfo.version = fixedVersion(`${version.stdout || ''}${version.stderr || ''}`);
      const currentSource = spawnSync('git', ['-C', run.source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null;
      serverInfo.sourceGitHead = currentSource;
      serverInfo.sourceDirty = Boolean(spawnSync('git', ['-C', run.source, 'status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim());
      serverInfo.sourceBinding = run.buildReceipt ? 'build-proven' : 'unverified';
      serverInfo.sourceManifestSha256 = run.sourceManifestSha256;
      serverInfo.buildReceipt = run.buildReceipt;
      stage = await stageClient(run.root, env);
      {
        const nodeCount = args['--topology'] === 'line3' ? 3 : 2;
        const ports = (await reserve(nodeCount * 5));
        const portSet = { irc: [], ws: [], s2s: [], tls: [], metrics: [] };
        for (let i = 0; i < nodeCount; i += 1) Object.values(portSet).forEach((group, j) => group.push(ports[i * 5 + j]));
        const certs = await makeTls(run.root, env);
        const manualMeshEdge = args['--suite'] === 'sessions' && args['--topology'] === 'line3'
          && args['--scenario'] === 'logical';
        const operAccount = manualMeshEdge ? `labop${randomBytes(9).toString('hex')}` : null;
        const operPassword = manualMeshEdge ? randomBytes(32).toString('base64url') : null;
        const dirs = [];
        const startOrder = args['--topology'] === 'line3' ? [1, 0, 2] : [0, 1];
        for (const i of startOrder) {
          const directory = join(run.root, `node-${i + 1}`); dirs.push(directory);
          for (const name of ['accounts-private', 'issuer-private', 'presence-private']) await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
          const configPath = join(directory, 'node.toml');
          const config = nodeToml({ index: i, ports: portSet, directory, line3: args['--topology'] === 'line3', exact: args['--scenario'] === 'exact', certPath: certs.certPath, keyPath: certs.keyPath, operAccount: i === 1 ? operAccount : null, manualMeshEdge });
          await privateWrite(configPath, config);
          await startDaemon(run.binary, configPath, directory, env, children);
          topology.nodes.push({ id: String.fromCharCode(65 + i), host: LOOPBACK, ircPort: portSet.irc[i], tlsPort: portSet.tls[i], wsPort: portSet.ws[i], s2sPort: portSet.s2s[i], metricsPort: portSet.metrics[i], configSha256: sha256(Buffer.from(config)) });
        }
        topology.nodes.sort((a, b) => a.id.localeCompare(b.id));
        topology.edges = args['--topology'] === 'line3' ? [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] : [{ from: 'A', to: 'B' }];
        if (manualMeshEdge) await waitForTopology(topology.nodes, children, 'line3-manual');
        else await waitForTopology(topology.nodes, children, args['--topology']);
        let foundationAccount = null;
        let memberAccount = null;
        if (args['--suite'] === 'group') {
          foundationAccount = await provisionFoundationAccount(portSet.tls[0]);
          memberAccount = await provisionFoundationAccount(portSet.tls[0]);
        }
        if (args['--suite'] === 'foundation') {
          rawResults = await runFoundationWire(portSet.tls[0]);
          foundationAccount = await provisionFoundationAccount(portSet.tls[0]);
        }
        if (args['--suite'] === 'sessions') rawResults = await runSessionScenarios(topology.nodes, children, args['--topology'], args['--scenario'], { operAccount, operPassword });
        if (args['--suite'] === 'history') rawResults = await runHistoryScenarios(topology.nodes, children, args['--topology']);
        const firstWss = await probeWss(`wss://${LOOPBACK}:${portSet.ws[0]}/`);
        if (!firstWss) results.push(caseRecord(args['--suite'] === 'group' ? 'group-wss-preflight' : 'foundation-wss-preflight', ['tls-wss'], 'blocked', reason.tls));
        else {
          https = await serve({ root: stage.path, key: certs.key, cert: certs.cert });
          const reportPath = join(run.root, 'browser-report.json');
          const suiteName = { foundation: 'foundation', sessions: 'session', history: 'history', group: 'group' }[args['--suite']];
          const suiteSpec = `tests/e2e/elm-local-${suiteName}.spec.ts`;
          const playwright = await runTrackedCommand('pnpm', ['exec', 'playwright', 'test', '--config=tests/e2e/elm-local.config.ts', suiteSpec, '--reporter=json'], { cwd: ROOT, env: {
            ...env, ONYX_ELM_LAB_BASE: https.url, ONYX_ELM_LAB_WS: `wss://${LOOPBACK}:${portSet.ws[0]}/`, ONYX_ELM_LAB_NICK: 'ElmLabGuest', ONYX_ELM_LAB_CERT_BYPASS: '1', ONYX_ELM_LAB_OUTPUT_DIR: join(run.root, 'playwright-results'),
            ...(foundationAccount ? { ONYX_ELM_LAB_ACCOUNT: foundationAccount.account, ONYX_ELM_LAB_PASSWORD: foundationAccount.password } : {}),
            ...(memberAccount ? { ONYX_ELM_LAB_ACCOUNT_B: memberAccount.account, ONYX_ELM_LAB_PASSWORD_B: memberAccount.password } : {}),
            // Opt-in, redacted group diagnostics (verbs and counts only), confined to /tmp.
            ...(args['--suite'] === 'group' && process.env.ONYX_ELM_LAB_GROUP_DEBUG_DIR?.startsWith('/tmp/') ? { ONYX_ELM_LAB_GROUP_DEBUG_DIR: process.env.ONYX_ELM_LAB_GROUP_DEBUG_DIR, ONYX_ELM_LAB_GROUP_SCREENSHOTS: process.env.ONYX_ELM_LAB_GROUP_SCREENSHOTS === '1' ? '1' : '0' } : {}),
            ONYX_CHROMIUM_EXECUTABLE: '/usr/bin/chromium', PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
          }, timeout: args['--suite'] === 'group' ? 900_000 : 180_000 });
          children.push(playwright.child);
          try { await new Promise((resolvePromise) => https.server.close(resolvePromise)); } catch { /* already closed */ } finally { https = null; }
          const report = await readFile(reportPath, 'utf8').catch(() => '');
          let parsed = null; try { parsed = JSON.parse(report); } catch { /* blocked result below */ }
          if (args['--suite'] === 'group') {
            results.push(...groupBrowserCases(parsed, playwright.code));
          } else if (args['--suite'] === 'foundation') {
            results.push(browserCase(parsed, playwright.code, 'Elm browser registers over the isolated local WSS listener', 'foundation', ['elm-browser-registration', 'cap-005', 'irc-frame-without-crlf']));
            results.push(browserCase(parsed, playwright.code, 'Elm browser identifies a private account and sends an authenticated canary', 'foundation-auth', ['elm-private-identify', 'authenticated-send', 'owner-scoped-outbox']));
            results.push(...rawResults);
            results.push(browserCase(parsed, playwright.code, 'the local server terminates a client binary WebSocket frame', 'foundation-binary', ['binary-negative']));
          } else {
            const bootstrapCase = `${args['--suite']}-browser-bootstrap`;
            const title = args['--suite'] === 'sessions'
              ? 'Elm browser establishes a real WSS connection for the selected session cohort'
              : 'Elm browser establishes a real WSS connection for the selected history cohort';
            results.push(browserCase(parsed, playwright.code, title, bootstrapCase, ['elm-browser-registration']));
          }
        }
      }
      if (args['--suite'] !== 'foundation') results.push(...rawResults);
    }
  } catch (error) {
    if (args['--suite'] === 'group' && error.message === 'account_registration_refused') {
      results.push({ ...caseRecord('setup', [], 'fail', 'account_registration_refused', { executed: 1, passed: 0, failed: 1 }), driver: 'raw-tls' });
    }
    const isConfigBlocked = ['config_preflight_refused', 'issuer_initialize_refused', 'invalid_config_path', 'invalid_config_port'].includes(error.message);
    const isSourceBlocked = ['source_manifest_unavailable', 'source_manifest_path_invalid'].includes(error.message);
    const isTlsBlocked = error.message === 'local_certificate_generation_failed';
    const isBlocked = isConfigBlocked || isSourceBlocked || isTlsBlocked;
    const errorCode = isConfigBlocked ? reason.config : isSourceBlocked ? reason.provenance : isTlsBlocked ? reason.tls : reason.failed;
    if (!results.length || results.at(-1).status !== 'fail') results.push(caseRecord('setup', [], isBlocked ? 'blocked' : 'fail', errorCode, isBlocked ? { executed: 0, passed: 0, failed: 0 } : { executed: 1, passed: 0, failed: 1 }));
  } finally {
    if (https) await new Promise((resolvePromise) => https.server.close(resolvePromise));
    await stopChildren(children);
    if (privateRun) await rm(privateRun.root, { recursive: true, force: true });
    await rm(envRoot, { recursive: true, force: true });
  }
  const blockedByProvenance = !plan && serverInfo.sourceBinding !== 'build-proven';
  if (blockedByProvenance && results.length) {
    const passCases = results.filter((entry) => entry.status === 'pass');
    if (passCases.length) results.push(caseRecord('current-source-binding', ['binary-source-provenance'], 'blocked', reason.provenance));
  }
  const failed = results.some((entry) => entry.status === 'fail');
  const blocked = results.some((entry) => entry.status === 'blocked') || plan;
  const receipt = {
    schemaVersion: 1,
    kind: plan ? 'local-lab-plan' : 'local-lab-runtime',
    startedAt,
    finishedAt: new Date().toISOString(),
    commandArgsRedacted: plan ? ['--plan-only'] : ['--server-bin', '[path-redacted]', '--server-source', '[path-redacted]',
      ...(args['--server-build-receipt'] ? ['--server-build-receipt', '[path-redacted]'] : []),
      '--scratch-parent', '/tmp', '--topology', args['--topology'], '--suite', args['--suite'], '--scenario', args['--scenario'], '--receipt', '[path-redacted]'],
    client: { gitHead: source.head, dirty: source.dirty, sourceManifestSha256: source.manifestHash, stageSha256: stage.hash },
    server: serverInfo,
    environment: { node: process.version, python: 'not-used', openssl: toolVersion('openssl', ['version'], 'OpenSSL', /OpenSSL (\d+\.\d+\.\d+)/), browser: toolVersion('/usr/bin/chromium', ['--version'], 'Chromium', /Chromium (\d+\.\d+\.\d+\.\d+)/), os: process.platform },
    topology,
    cases: results,
    compatibleLabObservation: plan ? 'blocked' : failed ? 'fail' : results.some((entry) => entry.status === 'pass') ? 'pass' : 'blocked',
    currentSourceAcceptance: failed ? 'fail' : plan || blockedByProvenance || blocked ? 'blocked' : 'pass',
    limitations: [plan ? 'plan-only isolation result; no server or browser behavior was run' : null, blockedByProvenance ? 'supplied server binary is not proven to match current server source' : null, args['--topology'] === 'line3' && args['--suite'] !== 'sessions' ? 'three-node line topology configured; actual link convergence must be asserted by the selected browser scenario' : null,
      args['--suite'] === 'group' && !plan ? 'both browsers attach to node A; cross-node group delivery is not exercised' : null].filter(Boolean),
    teardown: { trackedChildrenStopped: children.every((child) => child.exitCode !== null || child.signalCode !== null), tempRemoved: true },
  };
  if (args['--suite'] === 'group' && !plan) await writeGroupReceipt(receiptPath, receipt);
  else await writeReceipt(receiptPath, receipt);
  process.stdout.write(`receipt=${resolve(receiptPath)}\ncompatibleLabObservation=${receipt.compatibleLabObservation}\ncurrentSourceAcceptance=${receipt.currentSourceAcceptance}\n`);
  process.exitCode = failed ? 1 : blocked ? 2 : 0;
}

main().catch((error) => {
  const safeCodes = new Set(['invalid_arguments', 'missing_required_argument', 'invalid_topology', 'invalid_suite', 'invalid_scenario', 'invalid_build_receipt_path', 'receipt_must_be_under_tmp', 'receipt_schema_invalid', 'receipt_args_invalid', 'receipt_case_invalid', 'receipt_client_invalid', 'receipt_server_invalid', 'receipt_server_build_invalid', 'receipt_server_build_binding_invalid', 'receipt_environment_invalid', 'receipt_topology_invalid', 'receipt_outcome_invalid', 'receipt_teardown_invalid', 'receipt_failure_outcome_mismatch', 'unverified_source_cannot_pass', 'plan_cannot_claim_runtime_pass', 'elm_stage_failed',
    'invalid_group_selection', 'group_receipt_schema_invalid', 'group_receipt_args_invalid', 'group_receipt_time_invalid', 'group_receipt_case_invalid', 'group_receipt_client_invalid',
    'group_receipt_server_invalid', 'group_receipt_environment_invalid', 'group_receipt_topology_invalid', 'group_receipt_outcome_invalid', 'group_receipt_teardown_invalid', 'receipt_failure_outcome_mismatch']);
  const code = safeCodes.has(error?.message) ? error.message : 'internal_error';
  process.stderr.write(`FAIL: local lab setup failed (${code}); private details omitted\n`);
  process.exitCode = 1;
});
