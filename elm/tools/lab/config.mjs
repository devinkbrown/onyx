// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const LOOPBACK = '127.0.0.1';
export const PRIVATE_MODE = 0o700;
export const FILE_MODE = 0o600;

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

const HASH_RE = /^[a-f0-9]{64}$/u;
const COMPILER_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u;
function normalizedBuildCommand(command) {
  if (!Array.isArray(command) || command.length < 2 || command.length > 32 || typeof command[0] !== 'string'
    || !isAbsolute(command[0]) || /[\0\r\n]/u.test(command[0]) || command[1] !== 'build') return null;
  const normalized = ['zig', 'build'];
  for (let index = 2; index < command.length; index += 1) {
    const arg = command[index];
    if (typeof arg !== 'string' || arg.length > 256 || /[\0\r\n]/u.test(arg)) return null;
    if (/^-j(?:[1-9]|[1-5][0-9]|6[0-4])$/u.test(arg) || /^-D(?:target|cpu|optimize)=[A-Za-z0-9_-]{1,64}$/u.test(arg)) {
      normalized.push(arg); continue;
    }
    if (['--prefix', '--cache-dir'].includes(arg)) {
      const path = command[index + 1];
      if (typeof path !== 'string' || !isAbsolute(path) || /[\0\r\n]/u.test(path) || (resolve(path) !== '/tmp' && !resolve(path).startsWith('/tmp/'))) return null;
      normalized.push(arg, '[path-redacted]'); index += 1; continue;
    }
    if (arg === '--summary' && command[index + 1] && ['all', 'short', 'none'].includes(command[index + 1])) {
      normalized.push(arg, command[index + 1]); index += 1; continue;
    }
    return null;
  }
  return Object.freeze(normalized);
}

export async function validateExternalBuildReceipt({ receiptPath, expectedSourceManifestSha256, expectedBinarySha256 }) {
  if (!receiptPath || /[\0\r\n]/u.test(receiptPath) || !HASH_RE.test(expectedSourceManifestSha256) || !HASH_RE.test(expectedBinarySha256)) return null;
  try {
    const path = resolve(receiptPath);
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile() || before.size < 2 || before.size > 64 * 1024) return null;
    const firstBytes = await readFile(path);
    const parsed = JSON.parse(firstBytes.toString('utf8'));
    const after = await lstat(path);
    const secondBytes = await readFile(path);
    if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !firstBytes.equals(secondBytes)) return null;
    const keys = ['schemaVersion', 'kind', 'sourceManifestSha256', 'binarySha256', 'compilerSha256', 'compilerVersion', 'buildCommand', 'exitStatus'];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join('|') !== [...keys].sort().join('|')
      || parsed.schemaVersion !== 1 || parsed.kind !== 'onyx-server-build-receipt' || parsed.exitStatus !== 0
      || !HASH_RE.test(parsed.sourceManifestSha256) || parsed.sourceManifestSha256 !== expectedSourceManifestSha256
      || !HASH_RE.test(parsed.binarySha256) || parsed.binarySha256 !== expectedBinarySha256
      || !HASH_RE.test(parsed.compilerSha256) || typeof parsed.compilerVersion !== 'string' || !COMPILER_VERSION_RE.test(parsed.compilerVersion)
      || !normalizedBuildCommand(parsed.buildCommand)) return null;
    const compilerInfo = await lstat(parsed.buildCommand[0]);
    if (compilerInfo.isSymbolicLink() || !compilerInfo.isFile() || (compilerInfo.mode & 0o111) === 0) return null;
    const compilerBytes = await readFile(parsed.buildCommand[0]);
    const compilerAfter = await lstat(parsed.buildCommand[0]);
    if (compilerAfter.isSymbolicLink() || !compilerAfter.isFile() || compilerInfo.dev !== compilerAfter.dev || compilerInfo.ino !== compilerAfter.ino
      || compilerInfo.size !== compilerAfter.size || compilerInfo.mtimeMs !== compilerAfter.mtimeMs || sha256(compilerBytes) !== parsed.compilerSha256) return null;
    return Object.freeze({
      compilerVersion: parsed.compilerVersion,
      compilerSha256: parsed.compilerSha256,
      command: normalizedBuildCommand(parsed.buildCommand),
      sourceManifestSha256: parsed.sourceManifestSha256,
      binarySha256: parsed.binarySha256,
    });
  } catch { return null; }
}

export function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['--server-bin', '--server-source', '--server-build-receipt', '--scratch-parent', '--topology', '--suite', '--scenario', '--receipt', '--plan-only']);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--') || !allowed.has(key) || values.has(key)) throw new Error('invalid_arguments');
    if (key === '--plan-only') { values.set(key, true); continue; }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error('invalid_arguments');
    values.set(key, value); i += 1;
  }
  const required = ['--server-bin', '--server-source', '--scratch-parent', '--topology', '--suite', '--scenario', '--receipt'];
  if (required.some((key) => !values.has(key))) throw new Error('missing_required_argument');
  const topology = values.get('--topology');
  const suite = values.get('--suite');
  const scenario = values.get('--scenario');
  if (topology && !['two', 'line3'].includes(topology)) throw new Error('invalid_topology');
  if (suite && !['foundation', 'sessions', 'history', 'group'].includes(suite)) throw new Error('invalid_suite');
  if (scenario && !['logical', 'exact'].includes(scenario)) throw new Error('invalid_scenario');
  // The group journey runs both browsers on one node of a two-node mesh.
  if (suite === 'group' && (topology !== 'two' || scenario !== 'logical')) throw new Error('invalid_group_selection');
  if (values.has('--server-build-receipt')) {
    const rawBuildReceipt = values.get('--server-build-receipt');
    if (/[\0\r\n]/u.test(rawBuildReceipt)) throw new Error('invalid_build_receipt_path');
  }
  if (/[\0\r\n]/.test(values.get('--receipt'))) throw new Error('invalid_receipt_path');
  const receipt = resolve(values.get('--receipt'));
  if (receipt !== '/tmp' && !receipt.startsWith('/tmp/')) throw new Error('receipt_must_be_under_tmp');
  return Object.fromEntries(values);
}

export function validateLoopbackUrl(value) {
  const url = new URL(value);
  if (!['https:', 'wss:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('non_loopback_endpoint');
  }
  if (url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.hash || url.search) throw new Error('invalid_loopback_url');
  return url;
}

export function nodeToml({ index, ports, directory, line3, exact, certPath, keyPath, operAccount = null, manualMeshEdge = false }) {
  for (const path of [directory, certPath, keyPath]) if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error('invalid_config_path');
  for (const group of Object.values(ports)) if (!Array.isArray(group) || group.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('invalid_config_port');
  const seeds = [
    ['9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'],
    ['4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'],
    ['c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025'],
  ];
  const own = seeds[index];
  if (!own) throw new Error('invalid_node_index');
  const roots = line3 ? (index === 1 ? [seeds[0][1], seeds[2][1]] : [seeds[1][1]]) : [seeds[1 - index][1]];
  const peers = roots.map((key) => `"${key}"`).join(', ');
  const target = line3 ? ports.s2s[1] : ports.s2s[index === 0 ? 1 : 0];
  const connect = index === (line3 ? 1 : 0) || (manualMeshEdge && line3 && index === 2) ? '' : `connect = ["${LOOPBACK}:${target}"]\n`;
  if (operAccount !== null && (!/^[A-Za-z][A-Za-z0-9_-]{5,31}$/u.test(operAccount) || index !== 1 || !line3)) throw new Error('invalid_lab_oper_binding');
  const roster = seeds.map((entry) => `"${entry[1]}"`).join(', ');
  const relay = line3 ? `relay_v2_authoring = "active"\nrelay_v2_activation_epoch = 1\nrelay_v2_roster = [${roster}]\n` : '';
  const tlsPath = (path) => resolve(directory, path).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `[node]\nid = ${index + 1}\nsecret_key = "${own[0]}"\npublic_key = "${own[1]}"\n` +
    `[network]\nname = "Onyx local acceptance"\nserver_name = "node-${index + 1}.local.invalid"\n` +
    `[listen]\nhost = "${LOOPBACK}"\nirc = ${ports.irc[index]}\nws = ${ports.ws[index]}\nws_plain = false\ns2s = ${ports.s2s[index]}\nwebtransport = 0\n` +
    `[mesh]\nrealm = "onyx-local-acceptance"\nmesh_pass = "${'x'.repeat(32)}"\nrequire_secured = true\nrequire_signed_frames = true\ntrust_roots = [${peers}]\npresence_store_path = "${tlsPath(join(directory, 'presence-private', 'presence.wal'))}"\n${connect}${relay}` +
    `[cloak]\nsecret = "${'y'.repeat(32)}"\n` +
    `[tls]\nenabled = true\nport = ${ports.tls[index]}\ndns_name = "localhost"\ncert_path = "${tlsPath(certPath)}"\nkey_path = "${tlsPath(keyPath)}"\n` +
    `[sasl]\nenabled = true\naccount_db = "${tlsPath(join(directory, 'accounts-private', 'accounts.wal'))}"\n` +
    `[accounts]\npbkdf2_rounds = 10000\n[sessions]\nresume_composite_issuance = ${exact ? 'true' : 'false'}\n` +
    (operAccount ? `[[oper_groups]]\nname = "netadmin"\nprivileges = ["mesh_admin"]\n\n[[opers]]\naccount = "${operAccount}"\nclass = "netadmin"\n` : '') +
    `[guest_presence]\nissuer_path = "${tlsPath(join(directory, 'issuer-private', 'issuer.wal'))}"\n` +
    `[stats]\ninterval = "1s"\n[metrics]\nbind = "${LOOPBACK}"\nlisten = ${ports.metrics[index]}\n`;
}

export async function createPrivateRun({ scratchParent, serverBin, serverSource, serverBuildReceipt }) {
  const parent = await realpath(resolve(scratchParent));
  if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw new Error('scratch_parent_must_be_tmp');
  for (const raw of [serverBin, serverSource]) if (/[\0\r\n]/.test(raw)) throw new Error('invalid_path_argument');
  const source = await realpath(resolve(serverSource));
  const binary = await realpath(resolve(serverBin));
  const binaryStat = await stat(binary);
  if (!binaryStat.isFile() || (binaryStat.mode & 0o111) === 0) throw new Error('server_binary_invalid');
  const required = ['build.zig', 'build.zig.zon', 'src/main.zig'];
  for (const file of required) await stat(join(source, file));
  const root = await mkdtemp(join(parent, 'onyx-elm-lab-'));
  await chmod(root, PRIVATE_MODE);
  try {
    const pinnedDir = join(root, 'artifact'); await mkdir(pinnedDir, { mode: PRIVATE_MODE });
    const pinned = join(pinnedDir, 'onyx-server'); await copyFile(binary, pinned); await chmod(pinned, 0o700);
    const artifactHash = sha256(await readFile(pinned));
    const listed = spawnSync('git', ['-C', source, 'ls-files', '-co', '--exclude-standard', '--', 'build.zig', 'build.zig.zon', 'src', 'vendor'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error('source_manifest_unavailable');
    const files = [...new Set([...required, ...listed.stdout.split('\n').filter(Boolean)])].sort();
    const sourceManifest = [];
    for (const file of files) {
      if (file.startsWith('/') || file.split('/').includes('..')) throw new Error('source_manifest_path_invalid');
      const path = join(source, file);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('source_manifest_path_invalid');
      const actual = await realpath(path);
      if (actual !== source && !actual.startsWith(`${source}/`)) throw new Error('source_manifest_path_invalid');
      const bytes = await readFile(actual);
      sourceManifest.push([file, sha256(bytes)]);
    }
    const sourceManifestSha256 = sha256(Buffer.from(JSON.stringify(sourceManifest)));
    const buildReceipt = serverBuildReceipt
      ? await validateExternalBuildReceipt({ receiptPath: serverBuildReceipt, expectedSourceManifestSha256: sourceManifestSha256, expectedBinarySha256: artifactHash })
      : null;
    return { root, source, binary: pinned, artifactHash, sourceManifestSha256, buildReceipt };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Group-suite receipt. It mirrors the shared lab receipt envelope but owns
 * its own fixed case IDs, scenario IDs and stage reason codes, so the shared
 * schema in receipt.mjs stays unchanged. Like the shared receipt it carries
 * only hashes, loopback ports, fixed enums and counts — never credentials,
 * message bodies, device keys, room keys or transcripts.
 */
export const GROUP_CASES = Object.freeze({
  'group-signin': ['elm-browser-registration', 'elm-private-identify', 'reusable-session'],
  'group-room-policy': ['ircx-create', 'encryption-policy-required'],
  'group-enroll': ['device-enrollment'],
  'group-genesis': ['founder-genesis', 'group-commit-relay'],
  'group-author-ciphertext': ['ciphertext-on-wire', 'author-render'],
  'group-member-bootstrap': ['member-join', 'member-enrollment', 'device-trust-review', 'key-rotation', 'welcome-delivery', 'bootstrap-preview', 'bootstrap-approve'],
  'group-encrypted-delivery': ['ciphertext-on-wire', 'peer-decrypt-render', 'member-send'],
  'group-device-removal': ['remove-device', 'epoch-advance', 'removed-device-excluded'],
});
export const GROUP_SPEC_TITLES = Object.freeze({
  'group-signin': 'group: two Elm accounts sign in over the isolated local WSS listener',
  'group-room-policy': 'group: founder creates an encryption-required room',
  'group-enroll': 'group: founder enrolls this device for room encryption',
  'group-genesis': 'group: founder authors the room genesis key',
  'group-author-ciphertext': 'group: founder message is ciphertext on the wire and rendered for its author',
  'group-member-bootstrap': 'group: member joins, enrolls and approves the founder key update checkpoint',
  'group-encrypted-delivery': 'group: encrypted message is ciphertext on the wire and decrypted for the peer',
  'group-device-removal': 'group: founder removes the member device and installs a new epoch',
});
export const GROUP_STAGE_CODES = Object.freeze(['lab_endpoints_missing', 'lab_accounts_missing', 'previous_stage_missing',
  'signin_live_timeout', 'signin_lobby_join_missing', 'signin_identify_not_confirmed', 'signin_dialog_not_confirmed', 'session_intent_unavailable', 'session_token_absent',
  'create_not_sent', 'create_oid_reply_missing', 'policy_not_sent', 'policy_not_confirmed',
  'enroll_control_unavailable', 'enroll_result_timeout', 'enroll_founder_not_verified', 'enroll_member_not_verified',
  'genesis_directory_control_unavailable', 'genesis_directory_result_timeout', 'genesis_author_entry_unavailable',
  'genesis_plan_control_unavailable', 'genesis_plan_result_timeout', 'genesis_plan_refused',
  'genesis_commit_control_unavailable', 'genesis_commit_result_timeout', 'genesis_commit_refused', 'genesis_commit_not_relayed', 'genesis_head_not_installed',
  'member_join_missing', 'member_policy_not_observed', 'rotation_head_unavailable',
  'trust_preview_control_unavailable', 'trust_preview_result_timeout', 'trust_preview_refused', 'trust_confirm_control_unavailable', 'trust_confirm_result_timeout', 'trust_confirm_refused',
  'member_ciphertext_not_sent', 'member_send_not_rendered', 'post_removal_not_sent', 'post_removal_not_delivered', 'removed_device_decrypted',
  'rotation_plan_control_unavailable', 'rotation_plan_result_timeout', 'rotation_plan_refused',
  'rotation_commit_control_unavailable', 'rotation_commit_result_timeout', 'rotation_commit_refused', 'rotation_head_not_installed',
  'member_welcome_not_delivered', 'bootstrap_preview_unavailable', 'bootstrap_approve_control_unavailable', 'bootstrap_approve_result_timeout', 'bootstrap_approve_refused', 'member_head_not_installed',
  'ciphertext_not_sent', 'ciphertext_echo_missing', 'plaintext_on_wire', 'ciphertext_not_delivered', 'peer_decryption_not_rendered', 'author_render_missing',
  'remove_head_unavailable', 'remove_entry_unavailable', 'remove_control_unavailable', 'remove_result_timeout', 'remove_refused', 'remove_epoch_not_advanced',
  'directory_control_unavailable', 'directory_result_timeout']);
const GROUP_REASONS = new Set([...GROUP_STAGE_CODES.map((code) => `group_${code}`), 'plan_only', 'binary_source_unverified', 'config_preflight_refused', 'wss_tls_refused',
  'assertion_failed', 'account_registration_refused', 'browser_report_missing', 'browser_runner_timeout', 'browser_assertion_timeout', 'browser_assertion_failed', 'browser_stage_not_run']);
const GROUP_CASE_IDS = new Set([...Object.keys(GROUP_CASES), 'group-wss-preflight', 'current-source-binding', 'setup']);
const GROUP_SCENARIOS = new Set([...Object.values(GROUP_CASES).flat(), 'tls-wss', 'binary-source-provenance']);
const GROUP_LIMITATIONS = new Set(['supplied server binary is not proven to match current server source',
  'both browsers attach to node A; cross-node group delivery is not exercised']);
const exactKeys = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|');
const isHash = (value) => value === 'unavailable' || HASH_RE.test(value);
export function validateGroupReceipt(value) {
  const top = ['schemaVersion', 'kind', 'startedAt', 'finishedAt', 'commandArgsRedacted', 'client', 'server', 'environment', 'topology', 'cases', 'compatibleLabObservation', 'currentSourceAcceptance', 'limitations', 'teardown'];
  if (!exactKeys(value, top) || value.schemaVersion !== 1 || value.kind !== 'local-lab-runtime') throw new Error('group_receipt_schema_invalid');
  const hasBuild = value.commandArgsRedacted?.includes('--server-build-receipt');
  const args = ['--server-bin', '[path-redacted]', '--server-source', '[path-redacted]', ...(hasBuild ? ['--server-build-receipt', '[path-redacted]'] : []),
    '--scratch-parent', '/tmp', '--topology', 'two', '--suite', 'group', '--scenario', 'logical', '--receipt', '[path-redacted]'];
  if (JSON.stringify(value.commandArgsRedacted) !== JSON.stringify(args)) throw new Error('group_receipt_args_invalid');
  const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
  if (!time.test(value.startedAt) || !time.test(value.finishedAt)) throw new Error('group_receipt_time_invalid');
  if (!Array.isArray(value.cases) || new Set(value.cases.map((row) => row?.id)).size !== value.cases.length || !value.cases.every((row) =>
    exactKeys(row, ['id', 'scenarioIds', 'driver', 'status', 'assertions', 'reasonCode', 'evidenceRefs']) && GROUP_CASE_IDS.has(row.id)
    && Array.isArray(row.scenarioIds) && row.scenarioIds.every((id) => GROUP_SCENARIOS.has(id)) && new Set(row.scenarioIds).size === row.scenarioIds.length
    && ['elm-browser', 'raw-tls', 'plan'].includes(row.driver) && ['pass', 'fail', 'blocked'].includes(row.status)
    && exactKeys(row.assertions, ['executed', 'passed', 'failed']) && ['executed', 'passed', 'failed'].every((key) => Number.isSafeInteger(row.assertions[key]) && row.assertions[key] >= 0)
    && row.assertions.passed + row.assertions.failed === row.assertions.executed && (row.status !== 'pass' || (row.assertions.executed > 0 && row.assertions.failed === 0))
    && (row.status === 'pass' ? row.reasonCode === null : GROUP_REASONS.has(row.reasonCode)) && Array.isArray(row.evidenceRefs) && row.evidenceRefs.length === 0)) throw new Error('group_receipt_case_invalid');
  if (!exactKeys(value.client, ['gitHead', 'dirty', 'sourceManifestSha256', 'stageSha256']) || !/^(unknown|[a-f0-9]{40})$/u.test(value.client.gitHead)
    || typeof value.client.dirty !== 'boolean' || !isHash(value.client.sourceManifestSha256) || !isHash(value.client.stageSha256)) throw new Error('group_receipt_client_invalid');
  const server = value.server;
  if (!exactKeys(server, ['binarySha256', 'version', 'sourceGitHead', 'sourceDirty', 'sourceManifestSha256', 'sourceBinding', 'buildReceipt']) || !isHash(server.binarySha256)
    || !/^(unknown|\d+\.\d+\.\d+(?:\+[A-Za-z0-9.-]+)?)$/u.test(server.version) || !(server.sourceGitHead === null || /^[a-f0-9]{40}$/u.test(server.sourceGitHead))
    || typeof server.sourceDirty !== 'boolean' || !isHash(server.sourceManifestSha256) || !['unverified', 'build-proven'].includes(server.sourceBinding)
    || (server.sourceBinding === 'build-proven') !== (server.buildReceipt !== null)
    || (server.buildReceipt !== null && (!exactKeys(server.buildReceipt, ['compilerVersion', 'compilerSha256', 'command', 'sourceManifestSha256', 'binarySha256'])
      || server.buildReceipt.binarySha256 !== server.binarySha256 || server.buildReceipt.sourceManifestSha256 !== server.sourceManifestSha256
      || !Array.isArray(server.buildReceipt.command) || server.buildReceipt.command.some((arg) => typeof arg !== 'string' || arg.startsWith('/'))))) throw new Error('group_receipt_server_invalid');
  if (!exactKeys(value.environment, ['node', 'python', 'openssl', 'browser', 'os']) || !/^v\d+\.\d+\.\d+$/u.test(value.environment.node) || value.environment.python !== 'not-used'
    || !/^OpenSSL \d+\.\d+\.\d+$/u.test(value.environment.openssl) || !/^Chromium \d+\.\d+\.\d+\.\d+$/u.test(value.environment.browser) || !['linux', 'darwin', 'win32'].includes(value.environment.os)) throw new Error('group_receipt_environment_invalid');
  const topology = value.topology;
  if (!exactKeys(topology, ['kind', 'nodes', 'edges']) || topology.kind !== 'two' || !Array.isArray(topology.nodes) || !Array.isArray(topology.edges)
    || !(topology.nodes.length === 0 || topology.nodes.length === 2) || !topology.nodes.every((node) => exactKeys(node, ['id', 'host', 'ircPort', 'tlsPort', 'wsPort', 's2sPort', 'metricsPort', 'configSha256'])
      && ['A', 'B'].includes(node.id) && node.host === LOOPBACK && ['ircPort', 'tlsPort', 'wsPort', 's2sPort', 'metricsPort'].every((field) => Number.isInteger(node[field]) && node[field] > 0 && node[field] < 65536) && HASH_RE.test(node.configSha256))
    || !topology.edges.every((edge) => exactKeys(edge, ['from', 'to']) && edge.from === 'A' && edge.to === 'B')) throw new Error('group_receipt_topology_invalid');
  if (!['pass', 'fail', 'blocked'].includes(value.compatibleLabObservation) || !['pass', 'fail', 'blocked'].includes(value.currentSourceAcceptance)
    || !Array.isArray(value.limitations) || value.limitations.some((entry) => !GROUP_LIMITATIONS.has(entry))) throw new Error('group_receipt_outcome_invalid');
  if (!exactKeys(value.teardown, ['trackedChildrenStopped', 'tempRemoved']) || typeof value.teardown.trackedChildrenStopped !== 'boolean' || typeof value.teardown.tempRemoved !== 'boolean') throw new Error('group_receipt_teardown_invalid');
  if (server.sourceBinding === 'unverified' && value.currentSourceAcceptance === 'pass') throw new Error('unverified_source_cannot_pass');
  if (value.cases.some((row) => row.status === 'fail') !== (value.currentSourceAcceptance === 'fail')) throw new Error('receipt_failure_outcome_mismatch');
  return value;
}
export async function writeGroupReceipt(path, value) {
  validateGroupReceipt(value);
  const target = resolve(path);
  if (target !== '/tmp' && !target.startsWith('/tmp/')) throw new Error('receipt_must_be_under_tmp');
  await mkdir(dirname(target), { recursive: true });
  const parent = await realpath(dirname(target));
  if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw new Error('receipt_must_be_under_tmp');
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: FILE_MODE, flag: 'wx' });
  await chmod(target, FILE_MODE);
}

export async function privateWrite(path, contents) { await writeFile(path, contents, { mode: FILE_MODE, flag: 'wx' }); await chmod(path, FILE_MODE); }
