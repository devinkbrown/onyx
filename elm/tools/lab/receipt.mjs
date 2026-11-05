// SPDX-License-Identifier: AGPL-3.0-or-later
import { writeFile, chmod, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const statuses = new Set(['pass', 'fail', 'blocked']);
const scenarioIds = new Set(['cli-contract', 'private-paths', 'loopback-only', 'redacted-receipt', 'tracked-process-policy', 'tls-wss', 'elm-browser-registration', 'elm-private-identify', 'authenticated-send', 'owner-scoped-outbox', 'cap-005', 'ping-pong', 'irc-frame-without-crlf', 'send-and-reconnect', 'binary-negative', 'four-attachments', 'fifth-restore', 'exact-and-logical-cohorts', 'busy-exact', 'detached-restore', 'failure-local-list-drop-stale', 'session-canaries', 'session-roster', 'physical-pings', 'retryable-failures', 'no-cross-node-endpoint-spoofing', 'mesh-link-owner-loss', 'mesh-link-reconnect', 'mesh-resume-retry', 'latest', 'before', 'around', 'overlap-dedupe', 'after', 'between', 'targets', 'unknown-selector', 'history-policy-denial', 'history-rate-limit-denial', 'equal-time-page-boundary', 'binary-source-provenance']);
const reasonCodes = new Set(['plan_only', 'binary_source_unverified', 'config_preflight_refused', 'wss_tls_refused', 'deterministic_server_trigger_unavailable', 'assertion_failed',
  'required_capabilities_refused', 'tls_connect_deadline', 'tls_socket_io', 'tls_socket_closed', 'irc_response_deadline', 'foundation_join_missing', 'foundation_wire_echo_missing',
  'daemon_exited_before_topology', 'secured_topology_unavailable', 'metrics_http_refused', 'session_redirect_needs_routing', 'session_resume_refused',
  'session_message_refused', 'session_reply_path_missing',
  'session_event_delivery_cardinality', 'session_event_identity_missing', 'session_event_identity_mismatch', 'session_roster_replica_mismatch', 'session_resumed_identity_mismatch', 'session_physical_socket_count',
  'exact_attachment_busy_oracle_missing', 'busy_exact_created_sibling_attachment', 'exact_credential_grammar_unexpected', 'exact_unknown_attachment_id_unavailable',
  'exact_unknown_attachment_oracle_missing', 'exact_unknown_token_oracle_missing', 'session_list_snapshot_missing_rows', 'session_list_current_drop_not_denied',
  'session_list_stale_ordinal_reused', 'history_batch_id_missing', 'history_page_limit_exceeded', 'history_message_identity_invalid',
  'history_latest_page_incomplete', 'history_latest_order_invalid', 'history_anchor_missing', 'history_overlap_not_dedupable', 'history_selector_empty',
  'history_targets_channel_missing', 'history_targets_row_invalid', 'history_unknown_selector_not_rejected', 'history_policy_value_mismatch', 'history_policy_denial_missing',
  'history_batch_open_timeout', 'history_batch_close_timeout', 'history_unknown_selector_timeout', 'history_ircx_timeout', 'history_policy_value_timeout',
  'history_policy_end_timeout', 'history_policy_denial_timeout', 'history_policy_join_timeout',
  'browser_report_missing', 'browser_runner_timeout', 'browser_binary_frame_not_terminated', 'browser_elm_live_timeout', 'browser_cap_end_missing', 'browser_registration_assertion_failed', 'browser_authentication_failed', 'browser_outbox_admission_missing', 'browser_assertion_timeout', 'browser_assertion_failed',
  'account_registration_refused', 'sasl_login_refused', 'session_credentials_absent', 'session_token_source_fail', 'session_token_source_warn', 'oper_elevation_not_confirmed', 'mesh_retryable_warning_missing', 'mesh_resume_retry_success_missing', 'lab_oper_credentials_missing', null]);
const caseIds = new Set(['isolation-plan', 'foundation-wss-preflight', 'foundation', 'foundation-auth', 'foundation-wire', 'foundation-binary', 'sessions', 'sessions-fault-injection', 'sessions-mesh-link-recovery', 'history', 'history-rate-limit', 'history-equal-time-boundary', 'sessions-browser-bootstrap', 'history-browser-bootstrap', 'current-source-binding', 'setup']);
const diagnosticPhases = new Set(['account-A-register', 'account-B-register', 'account-C-register', 'origin-login', 'origin-join', 'origin-token-local', 'origin-token-mesh', 'near-login', 'near-local-resume', 'middle-login', 'middle-mesh-resume', 'far-login', 'far-mesh-resume', 'fifth-login', 'fifth-mesh-resume', 'channel-canary', 'dm-peer-login', 'dm-canary', 'origin-names-end', 'physical-pings', 'busy-login', 'busy-exact-resume', 'missing-aid-login', 'missing-aid-resume', 'invalid-token-login', 'invalid-token-resume', 'origin-detach', 'detached-login', 'detached-restore', 'local-list-end', 'drop-current-denied', 'drop-other-accepted', 'stale-drop-denied', 'mesh-link-cut', 'mesh-link-reconnect', 'mesh-owner-resume-offline', 'mesh-owner-resume-restored']);
const diagnosticActors = new Set(['A-origin', 'A-near', 'B-middle', 'C-far', 'C-fifth', 'A-busy', 'A-missing-aid', 'A-invalid-token', 'A-detached', 'registrar-A', 'registrar-B', 'registrar-C', 'dm-peer', 'B-mesh-admin']);
const diagnosticCommands = new Set(['CAP_LS', 'CAP_REQ', 'SASL_START', 'SASL_PAYLOAD', 'REGISTER', 'REGISTRATION', 'JOIN', 'SESSION_TOKEN_LOCAL', 'SESSION_TOKEN_MESH', 'SESSION_RESUME', 'SESSION_LIST', 'SESSION_DROP', 'PRIVMSG_CANARY', 'NAMES', 'PING', 'SQUIT', 'CONNECT']);
const diagnosticOutcomes = new Set(['deadline', 'source-fail', 'source-warn', 'source-redirect', 'source-success', 'socket-closed', 'local-rejection']);
const diagnosticCodes = new Set(['TEMPORARILY_UNAVAILABLE', 'ORIGIN_UNREACHABLE', 'ATTACHMENT_IN_USE', 'NO_ATTACHMENT', 'INVALID_TOKEN', 'NO_SESSION', 'SESSION_REVOKED', 'RESUME_CREDENTIAL_PRESERVED', 'PRIVMSG_TEMPORARILY_UNAVAILABLE', 'PRIVMSG_CTCP_BLOCKED', 'PRIVMSG_E2EE_REQUIRED', 'PRIVMSG_INPUT_TOO_LONG', 'PRIVMSG_OTHER_FAILURE', 'PRIVMSG_OTHER_WARNING', 'IRC_401', 'IRC_404', 'IRC_477', 'IRC_482', 'IRC_716', 'IRC_OTHER_4XX']);
const hash = (value) => value === 'unavailable' || /^[a-f0-9]{64}$/.test(value);
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|');
function validCase(row) {
  const hasDiagnostic = row && Object.hasOwn(row, 'diagnostic');
  return (hasDiagnostic ? keys(row, ['id', 'scenarioIds', 'driver', 'status', 'assertions', 'reasonCode', 'evidenceRefs', 'diagnostic']) : keys(row, ['id', 'scenarioIds', 'driver', 'status', 'assertions', 'reasonCode', 'evidenceRefs'])) &&
    caseIds.has(row.id) && Array.isArray(row.scenarioIds) && row.scenarioIds.every((id) => scenarioIds.has(id)) &&
    ['elm-browser', 'raw-tls', 'plan'].includes(row.driver) && statuses.has(row.status) &&
    keys(row.assertions, ['executed', 'passed', 'failed']) && ['executed', 'passed', 'failed'].every((key) => Number.isSafeInteger(row.assertions[key]) && row.assertions[key] >= 0) &&
    row.assertions.passed + row.assertions.failed === row.assertions.executed &&
    (row.status !== 'pass' || (row.assertions.executed > 0 && row.assertions.failed === 0)) &&
    reasonCodes.has(row.reasonCode) && (row.status === 'pass' ? row.reasonCode === null : row.reasonCode !== null) && Array.isArray(row.evidenceRefs) && row.evidenceRefs.length === 0 && new Set(row.scenarioIds).size === row.scenarioIds.length && (!hasDiagnostic || validDiagnostic(row.diagnostic));
}
function validDiagnostic(row) {
  const families = ['numeric', 'CAP', 'AUTHENTICATE', 'NOTICE_SESSION', 'FAIL_SESSION', 'WARN_SESSION', 'PRIVMSG_CANARY', 'PRIVMSG_FAIL', 'PRIVMSG_WARN', 'PRIVMSG_REFUSAL', 'NAMES_END', 'PONG'];
  const baseKeys = ['schemaVersion', 'phase', 'actorRole', 'node', 'commandClass', 'outcome', 'sourceCode', 'elapsedMs', 'lastCompletedPhase', 'responseFamiliesObserved'];
  const deliveryNodes = { 'A-origin': ['A'], 'A-near': ['A'], 'B-middle': ['B'], 'C-far': ['B', 'C'], 'C-fifth': ['B', 'C'], 'dm-peer': ['A'] };
  const validDelivery = (delivery) => Array.isArray(delivery) && [5, 6].includes(delivery.length)
    && delivery.every((entry) => keys(entry, ['actorRole', 'node', 'matchCount', 'wait'])
      && Object.hasOwn(deliveryNodes, entry.actorRole) && deliveryNodes[entry.actorRole].includes(entry.node)
      && Number.isSafeInteger(entry.matchCount) && entry.matchCount >= 0 && entry.matchCount <= 4194304
      && ['received', 'deadline', 'socket-closed', 'missing'].includes(entry.wait))
    && new Set(delivery.map((entry) => entry.actorRole)).size === delivery.length;
  const hasDelivery = Object.hasOwn(row ?? {}, 'delivery');
  return (hasDelivery ? keys(row, [...baseKeys, 'delivery']) && validDelivery(row.delivery) : keys(row, baseKeys))
    && row.schemaVersion === 1 && (row.phase === null || diagnosticPhases.has(row.phase))
    && (row.actorRole === null || diagnosticActors.has(row.actorRole)) && (row.node === null || ['A', 'B', 'C'].includes(row.node))
    && (row.commandClass === null || diagnosticCommands.has(row.commandClass)) && diagnosticOutcomes.has(row.outcome)
    && (row.sourceCode === null || diagnosticCodes.has(row.sourceCode)) && Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs <= 600000
    && (row.lastCompletedPhase === null || diagnosticPhases.has(row.lastCompletedPhase))
    && keys(row.responseFamiliesObserved, families) && families.every((family) => Number.isSafeInteger(row.responseFamiliesObserved[family]) && row.responseFamiliesObserved[family] >= 0 && row.responseFamiliesObserved[family] <= 1000);
}
function validTopology(topology) {
  return keys(topology, ['kind', 'nodes', 'edges']) && ['two', 'line3'].includes(topology.kind) && Array.isArray(topology.nodes) && Array.isArray(topology.edges) &&
    topology.nodes.every((node) => keys(node, ['id', 'host', 'ircPort', 'tlsPort', 'wsPort', 's2sPort', 'metricsPort', 'configSha256']) &&
      ['A', 'B', 'C'].includes(node.id) && node.host === '127.0.0.1' && ['ircPort', 'tlsPort', 'wsPort', 's2sPort', 'metricsPort'].every((field) => Number.isInteger(node[field]) && node[field] > 0 && node[field] < 65536) && /^[a-f0-9]{64}$/.test(node.configSha256)) &&
    topology.edges.every((edge) => keys(edge, ['from', 'to']) && ['A', 'B', 'C'].includes(edge.from) && ['A', 'B', 'C'].includes(edge.to) && edge.from !== edge.to) &&
    (topology.nodes.length === 0 && topology.edges.length === 0 || topology.kind === 'two' && topology.nodes.length === 2 && topology.nodes.map((node) => node.id).sort().join('') === 'AB' && topology.edges.length === 1 && topology.edges[0].from === 'A' && topology.edges[0].to === 'B' || topology.kind === 'line3' && topology.nodes.length === 3 && topology.nodes.map((node) => node.id).sort().join('') === 'ABC' && topology.edges.length === 2 && topology.edges.some((edge) => edge.from === 'A' && edge.to === 'B') && topology.edges.some((edge) => edge.from === 'B' && edge.to === 'C'));
}
function validBuildCommand(command) {
  if (!Array.isArray(command) || command.length < 2 || command.length > 32 || command[0] !== 'zig' || command[1] !== 'build') return false;
  for (let index = 2; index < command.length; index += 1) {
    const arg = command[index];
    if (typeof arg !== 'string') return false;
    if (/^-j(?:[1-9]|[1-5][0-9]|6[0-4])$/u.test(arg) || /^-D(?:target|cpu|optimize)=[A-Za-z0-9_-]{1,64}$/u.test(arg)) continue;
    if (['--prefix', '--cache-dir'].includes(arg)) {
      if (command[index + 1] !== '[path-redacted]') return false;
      index += 1; continue;
    }
    if (arg === '--summary' && ['all', 'short', 'none'].includes(command[index + 1])) { index += 1; continue; }
    return false;
  }
  return true;
}
export function validateReceipt(value) {
  const topKeys = ['schemaVersion', 'kind', 'startedAt', 'finishedAt', 'commandArgsRedacted', 'client', 'server', 'environment', 'topology', 'cases', 'compatibleLabObservation', 'currentSourceAcceptance', 'limitations', 'teardown'];
  if (!keys(value, topKeys) || !['local-lab-runtime', 'local-lab-plan'].includes(value.kind) || value.schemaVersion !== 1) throw new Error('receipt_schema_invalid');
  const suiteAt = value.commandArgsRedacted?.indexOf('--suite') ?? -1;
  const scenarioAt = value.commandArgsRedacted?.indexOf('--scenario') ?? -1;
  const suite = suiteAt >= 0 ? value.commandArgsRedacted[suiteAt + 1] : '';
  const scenario = scenarioAt >= 0 ? value.commandArgsRedacted[scenarioAt + 1] : '';
  const buildReceiptAt = value.commandArgsRedacted?.indexOf('--server-build-receipt') ?? -1;
  const hasBuildReceiptArg = buildReceiptAt >= 0;
  const runtimeArgs = ['--server-bin', '[path-redacted]', '--server-source', '[path-redacted]',
    ...(hasBuildReceiptArg ? ['--server-build-receipt', '[path-redacted]'] : []),
    '--scratch-parent', '/tmp', '--topology', value.topology?.kind, '--suite', suite, '--scenario', scenario, '--receipt', '[path-redacted]'];
  const planArgs = ['--plan-only'];
  if (!Array.isArray(value.commandArgsRedacted) || (value.kind === 'local-lab-plan' ? JSON.stringify(value.commandArgsRedacted) !== JSON.stringify(planArgs) : JSON.stringify(value.commandArgsRedacted) !== JSON.stringify(runtimeArgs) || !['foundation', 'sessions', 'history'].includes(suite) || !['logical', 'exact'].includes(scenario))) throw new Error('receipt_args_invalid');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.startedAt) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.finishedAt)) throw new Error('receipt_time_invalid');
  if (!Array.isArray(value.cases) || !value.cases.every(validCase) || new Set(value.cases.map((row) => row.id)).size !== value.cases.length) throw new Error('receipt_case_invalid');
  if (!keys(value.client, ['gitHead', 'dirty', 'sourceManifestSha256', 'stageSha256']) || !/^(unknown|[a-f0-9]{40})$/.test(value.client.gitHead) || typeof value.client.dirty !== 'boolean' || !hash(value.client.sourceManifestSha256) || !hash(value.client.stageSha256)) throw new Error('receipt_client_invalid');
  if (!keys(value.server, ['binarySha256', 'version', 'sourceGitHead', 'sourceDirty', 'sourceManifestSha256', 'sourceBinding', 'buildReceipt']) || !hash(value.server.binarySha256) || !/^(unknown|\d+\.\d+\.\d+(?:\+[A-Za-z0-9.-]+)?)$/.test(value.server.version) || !(value.server.sourceGitHead === null || /^[a-f0-9]{40}$/.test(value.server.sourceGitHead)) || typeof value.server.sourceDirty !== 'boolean' || !hash(value.server.sourceManifestSha256) || !['unverified', 'build-proven'].includes(value.server.sourceBinding)) throw new Error('receipt_server_invalid');
  const buildReceipt = value.server.buildReceipt;
  if (buildReceipt !== null && (!keys(buildReceipt, ['compilerVersion', 'compilerSha256', 'command', 'sourceManifestSha256', 'binarySha256'])
    || typeof buildReceipt.compilerVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/u.test(buildReceipt.compilerVersion)
    || !/^[a-f0-9]{64}$/.test(buildReceipt.compilerSha256) || !validBuildCommand(buildReceipt.command)
    || buildReceipt.sourceManifestSha256 !== value.server.sourceManifestSha256 || buildReceipt.binarySha256 !== value.server.binarySha256)) throw new Error('receipt_server_build_invalid');
  if ((value.server.sourceBinding === 'build-proven') !== (buildReceipt !== null)) throw new Error('receipt_server_build_binding_invalid');
  if (!keys(value.environment, ['node', 'python', 'openssl', 'browser', 'os']) || !/^v\d+\.\d+\.\d+$/.test(value.environment.node) || value.environment.python !== 'not-used' || !/^OpenSSL \d+\.\d+\.\d+$/.test(value.environment.openssl) || !/^Chromium \d+\.\d+\.\d+\.\d+$/.test(value.environment.browser) || !['linux', 'darwin', 'win32'].includes(value.environment.os)) throw new Error('receipt_environment_invalid');
  if (!validTopology(value.topology)) throw new Error('receipt_topology_invalid');
  if (!['pass', 'fail', 'blocked'].includes(value.compatibleLabObservation) || !['pass', 'fail', 'blocked'].includes(value.currentSourceAcceptance) || !Array.isArray(value.limitations) || value.limitations.some((entry) => !['plan-only isolation result; no server or browser behavior was run', 'supplied server binary is not proven to match current server source', 'three-node line topology configured; actual link convergence must be asserted by the selected browser scenario'].includes(entry))) throw new Error('receipt_outcome_invalid');
  if (!keys(value.teardown, ['trackedChildrenStopped', 'tempRemoved']) || typeof value.teardown.trackedChildrenStopped !== 'boolean' || typeof value.teardown.tempRemoved !== 'boolean') throw new Error('receipt_teardown_invalid');
  if (value.server.sourceBinding === 'unverified' && value.currentSourceAcceptance === 'pass') throw new Error('unverified_source_cannot_pass');
  if (value.kind === 'local-lab-plan' && (value.compatibleLabObservation === 'pass' || value.currentSourceAcceptance === 'pass')) throw new Error('plan_cannot_claim_runtime_pass');
  if (value.cases.some((row) => row.status === 'fail') !== (value.currentSourceAcceptance === 'fail')) throw new Error('receipt_failure_outcome_mismatch');
  return value;
}
export async function writeReceipt(path, value) {
  validateReceipt(value);
  const target = resolve(path);
  if (target !== '/tmp' && !target.startsWith('/tmp/')) throw new Error('receipt_must_be_under_tmp');
  await mkdir(dirname(target), { recursive: true });
  const parent = await realpath(dirname(target));
  if (parent !== '/tmp' && !parent.startsWith('/tmp/')) throw new Error('receipt_must_be_under_tmp');
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(target, 0o600);
}
