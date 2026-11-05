// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GROUP_CASES, GROUP_STAGE_CODES, nodeToml, parseArgs, sha256, validateExternalBuildReceipt, validateGroupReceipt, validateLoopbackUrl } from './config.mjs';
import { validateReceipt } from './receipt.mjs';
import { safeFile } from './serve-https.mjs';
import { DEFAULT_GUEST_CAPABILITIES } from './raw-irc.mjs';

const goodArgs = ['--server-bin', '/tmp/server', '--server-source', '/home/kain/onyx-server', '--scratch-parent', '/tmp', '--topology', 'line3', '--suite', 'history', '--scenario', 'logical', '--receipt', '/tmp/lab.json'];
const baseReceipt = () => ({
  schemaVersion: 1, kind: 'local-lab-plan', startedAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:00:01.000Z',
  commandArgsRedacted: ['--plan-only'],
  client: { gitHead: 'a'.repeat(40), dirty: true, sourceManifestSha256: 'a'.repeat(64), stageSha256: 'unavailable' },
  server: { binarySha256: 'unavailable', version: 'unknown', sourceGitHead: null, sourceDirty: true, sourceManifestSha256: 'unavailable', sourceBinding: 'unverified', buildReceipt: null },
  environment: { node: 'v24.0.0', python: 'not-used', openssl: 'OpenSSL 3.5.9', browser: 'Chromium 155.0.8059.39', os: 'linux' },
  topology: { kind: 'line3', nodes: [], edges: [] },
  cases: [{ id: 'isolation-plan', scenarioIds: ['cli-contract'], driver: 'plan', status: 'blocked', assertions: { executed: 0, passed: 0, failed: 0 }, reasonCode: 'plan_only', evidenceRefs: [] }],
  compatibleLabObservation: 'blocked', currentSourceAcceptance: 'blocked', limitations: ['plan-only isolation result; no server or browser behavior was run'], teardown: { trackedChildrenStopped: true, tempRemoved: true },
});

test('CLI accepts only the explicit contract and rejects non-tmp receipts', () => {
  assert.equal(parseArgs(goodArgs)['--suite'], 'history');
  assert.equal(parseArgs([...goodArgs.slice(0, 4), '--server-build-receipt', '/tmp/build.json', ...goodArgs.slice(4)])['--server-build-receipt'], '/tmp/build.json');
  assert.throws(() => parseArgs([...goodArgs, '--endpoint', 'https://example.com']), /invalid_arguments/);
  assert.throws(() => parseArgs(goodArgs.map((value, index) => index === 13 ? '/home/kain/unsafe.json' : value)), /receipt_must_be_under_tmp/);
  assert.throws(() => parseArgs([...goodArgs, '\n--unsafe']), /invalid_arguments/);
  assert.throws(() => parseArgs(goodArgs.slice(0, -2)), /missing_required_argument/);
});

test('group suite is accepted only for the two-node logical lab and owns a strict redacted receipt', () => {
  const groupArgs = goodArgs.map((value, index) => index === 7 ? 'two' : index === 9 ? 'group' : value);
  assert.equal(parseArgs(groupArgs)['--suite'], 'group');
  assert.throws(() => parseArgs(goodArgs.map((value, index) => index === 9 ? 'group' : value)), /invalid_group_selection/);
  assert.throws(() => parseArgs(groupArgs.map((value, index) => index === 11 ? 'exact' : value)), /invalid_group_selection/);
  const receipt = { ...baseReceipt(), kind: 'local-lab-runtime',
    commandArgsRedacted: ['--server-bin', '[path-redacted]', '--server-source', '[path-redacted]', '--scratch-parent', '/tmp', '--topology', 'two', '--suite', 'group', '--scenario', 'logical', '--receipt', '[path-redacted]'],
    topology: { kind: 'two', nodes: [], edges: [] }, limitations: ['both browsers attach to node A; cross-node group delivery is not exercised'],
    cases: [
      { id: 'group-signin', scenarioIds: GROUP_CASES['group-signin'], driver: 'elm-browser', status: 'pass', assertions: { executed: 1, passed: 1, failed: 0 }, reasonCode: null, evidenceRefs: [] },
      { id: 'group-genesis', scenarioIds: GROUP_CASES['group-genesis'], driver: 'elm-browser', status: 'fail', assertions: { executed: 1, passed: 0, failed: 1 }, reasonCode: 'group_genesis_author_entry_unavailable', evidenceRefs: [] },
      { id: 'group-device-removal', scenarioIds: GROUP_CASES['group-device-removal'], driver: 'elm-browser', status: 'blocked', assertions: { executed: 0, passed: 0, failed: 0 }, reasonCode: 'browser_stage_not_run', evidenceRefs: [] },
    ], compatibleLabObservation: 'fail', currentSourceAcceptance: 'fail' };
  assert.equal(validateGroupReceipt(receipt), receipt);
  // The shared schema still refuses the group suite; it is not widened.
  assert.throws(() => validateReceipt(receipt), /receipt_args_invalid/);
  const freeText = structuredClone(receipt); freeText.cases[1].reasonCode = 'group_stage:genesis plaintext body';
  assert.throws(() => validateGroupReceipt(freeText), /group_receipt_case_invalid/);
  const extra = structuredClone(receipt); extra.cases[0].transcript = 'PRIVMSG #elm-group-lab :hello';
  assert.throws(() => validateGroupReceipt(extra), /group_receipt_case_invalid/);
  const passWithoutFail = structuredClone(receipt); passWithoutFail.currentSourceAcceptance = 'blocked';
  assert.throws(() => validateGroupReceipt(passWithoutFail), /receipt_failure_outcome_mismatch/);
  const unverifiedPass = structuredClone(receipt); unverifiedPass.cases = [receipt.cases[0]]; unverifiedPass.currentSourceAcceptance = 'pass';
  assert.throws(() => validateGroupReceipt(unverifiedPass), /unverified_source_cannot_pass/);
  for (const code of GROUP_STAGE_CODES) assert.match(code, /^[a-z_]+$/u);
});

test('external build receipt must bind source, artifact, and the available compiler bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onyx-lab-build-receipt-'));
  try {
    const compiler = join(root, 'zig');
    const compilerBytes = Buffer.from('#!/bin/sh\nexit 0\n');
    await writeFile(compiler, compilerBytes, { mode: 0o700 });
    await chmod(compiler, 0o700);
    const receiptPath = join(root, 'receipt.json');
    const sourceManifestSha256 = 'a'.repeat(64); const binarySha256 = 'b'.repeat(64);
    const value = { schemaVersion: 1, kind: 'onyx-server-build-receipt', sourceManifestSha256, binarySha256,
      compilerSha256: sha256(compilerBytes), compilerVersion: '0.17.0',
      buildCommand: [compiler, 'build', '-j2', '--prefix', join(root, 'prefix'), '--cache-dir', join(root, 'cache'), '--summary', 'all'], exitStatus: 0 };
    await writeFile(receiptPath, JSON.stringify(value));
    const accepted = await validateExternalBuildReceipt({ receiptPath, expectedSourceManifestSha256: sourceManifestSha256, expectedBinarySha256: binarySha256 });
    assert.deepEqual(accepted, { compilerVersion: '0.17.0', compilerSha256: value.compilerSha256,
      command: ['zig', 'build', '-j2', '--prefix', '[path-redacted]', '--cache-dir', '[path-redacted]', '--summary', 'all'],
      sourceManifestSha256, binarySha256 });
    assert.equal(await validateExternalBuildReceipt({ receiptPath, expectedSourceManifestSha256: 'c'.repeat(64), expectedBinarySha256: binarySha256 }), null);
    assert.equal(await validateExternalBuildReceipt({ receiptPath, expectedSourceManifestSha256: sourceManifestSha256, expectedBinarySha256: 'd'.repeat(64) }), null);
    const tampered = { ...value, compilerSha256: 'c'.repeat(64) };
    await writeFile(receiptPath, JSON.stringify(tampered));
    assert.equal(await validateExternalBuildReceipt({ receiptPath, expectedSourceManifestSha256: sourceManifestSha256, expectedBinarySha256: binarySha256 }), null);
    await writeFile(receiptPath, JSON.stringify({ ...value, unexpected: 'secret' }));
    assert.equal(await validateExternalBuildReceipt({ receiptPath, expectedSourceManifestSha256: sourceManifestSha256, expectedBinarySha256: binarySha256 }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('endpoint validation accepts literal loopback with a port only', () => {
  assert.equal(validateLoopbackUrl('wss://127.0.0.1:9400/').hostname, '127.0.0.1');
  for (const endpoint of ['wss://example.com:9400/', 'wss://localhost:9400/', 'wss://127.0.0.1/', 'wss://user@127.0.0.1:9400/']) {
    assert.throws(() => validateLoopbackUrl(endpoint));
  }
});

test('foundation guest negotiates only capabilities needed by its wire assertions', () => {
  expectCapabilities(DEFAULT_GUEST_CAPABILITIES);
});

function expectCapabilities(capabilities) {
  const requested = capabilities.split(' ');
  assert.ok(requested.includes('echo-message'));
  assert.ok(requested.includes('message-tags'));
  assert.equal(requested.includes('chathistory'), false);
  assert.equal(requested.includes('draft/chathistory'), false);
  assert.equal(requested.includes('batch'), false);
}

test('node topology config binds only loopback and preserves secure direct trust', () => {
  const ports = { irc: [1, 2, 3], ws: [4, 5, 6], s2s: [7, 8, 9], tls: [10, 11, 12], metrics: [13, 14, 15] };
  const dir = '/tmp/lab/A';
  const text = nodeToml({ index: 0, ports, directory: dir, line3: true, exact: false, certPath: '/tmp/cert.pem', keyPath: '/tmp/key.pem' });
  assert.match(text, /host = "127\.0\.0\.1"/);
  assert.match(text, /require_secured = true/);
  assert.match(text, /require_signed_frames = true/);
  assert.match(text, /presence_store_path = "/);
  assert.match(text, /trust_roots = \["3d4017/);
  assert.match(text, /resume_composite_issuance = false/);
  assert.doesNotMatch(text, /ws_plain = true/);
  const b = nodeToml({ index: 1, ports, directory: '/tmp/lab/B', line3: true, exact: true, certPath: '/tmp/cert.pem', keyPath: '/tmp/key.pem' });
  assert.match(b, /trust_roots = \["d75a980.*"fc51cd/);
  assert.match(b, /resume_composite_issuance = true/);
  assert.doesNotMatch(text, /connect = \["127\.0\.0\.1:7"/);
});

test('receipt schema rejects unverified acceptance, arbitrary fields and inconsistent counts', () => {
  const receipt = baseReceipt();
  assert.equal(validateReceipt(receipt), receipt);
  const unverified = structuredClone(receipt); unverified.currentSourceAcceptance = 'pass';
  assert.throws(() => validateReceipt(unverified), /unverified_source_cannot_pass/);
  const extra = structuredClone(receipt); extra.note = 'bearer-shaped-secret';
  assert.throws(() => validateReceipt(extra), /receipt_schema_invalid/);
  const badCounts = structuredClone(receipt); badCounts.cases[0].assertions.executed = 2;
  assert.throws(() => validateReceipt(badCounts), /receipt_case_invalid/);
  const planPass = structuredClone(receipt); planPass.compatibleLabObservation = 'pass';
  assert.throws(() => validateReceipt(planPass), /plan_cannot_claim_runtime_pass/);
  const buildProven = structuredClone(receipt);
  buildProven.kind = 'local-lab-runtime';
  buildProven.commandArgsRedacted = ['--server-bin', '[path-redacted]', '--server-source', '[path-redacted]', '--server-build-receipt', '[path-redacted]',
    '--scratch-parent', '/tmp', '--topology', 'line3', '--suite', 'history', '--scenario', 'logical', '--receipt', '[path-redacted]'];
  buildProven.server = { binarySha256: 'b'.repeat(64), version: '0.0.0', sourceGitHead: null, sourceDirty: false,
    sourceManifestSha256: 'a'.repeat(64), sourceBinding: 'build-proven', buildReceipt: { compilerVersion: '0.17.0', compilerSha256: 'c'.repeat(64),
      command: ['zig', 'build', '-j2', '--prefix', '[path-redacted]', '--cache-dir', '[path-redacted]', '--summary', 'all'],
      sourceManifestSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64) } };
  buildProven.cases = [{ id: 'setup', scenarioIds: [], driver: 'raw-tls', status: 'blocked',
    assertions: { executed: 0, passed: 0, failed: 0 }, reasonCode: 'config_preflight_refused', evidenceRefs: [] }];
  assert.equal(validateReceipt(buildProven), buildProven);
  const wrongBuildHash = structuredClone(buildProven); wrongBuildHash.server.buildReceipt.binarySha256 = 'd'.repeat(64);
  assert.throws(() => validateReceipt(wrongBuildHash), /receipt_server_build_invalid/);
  const unsafeBuildCommand = structuredClone(buildProven); unsafeBuildCommand.server.buildReceipt.command = ['zig', 'run', '[path-redacted]'];
  assert.throws(() => validateReceipt(unsafeBuildCommand), /receipt_server_build_invalid/);
});

test('source manifest requires required build inputs and hashes content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onyx-lab-src-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'build.zig'), 'build');
    await writeFile(join(root, 'build.zig.zon'), '.{}');
    await assert.rejects(import('./config.mjs').then(({ createPrivateRun }) => createPrivateRun({ scratchParent: '/tmp', serverBin: '/bin/true', serverSource: root })), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('static staging server blocks paths outside its root', () => {
  assert.equal(safeFile('/tmp/site', '/app.js'), '/tmp/site/app.js');
  assert.equal(safeFile('/tmp/site', '/%2e%2e/secret'), null);
});
