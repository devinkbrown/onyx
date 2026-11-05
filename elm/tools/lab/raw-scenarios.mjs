// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { RawIrcClient, parseIrcLine, safeIdentity } from './raw-irc.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (bytes = 8) => randomBytes(bytes).toString('hex');
const has = (lines, needle) => lines.some((line) => line.includes(needle));
const SAFE_FAILURES = new Set([
  'assertion_failed', 'required_capabilities_refused', 'tls_connect_deadline', 'tls_socket_io', 'tls_socket_closed', 'irc_response_deadline',
  'secured_topology_unavailable', 'daemon_exited_before_topology', 'metrics_http_refused',
  'account_registration_refused', 'sasl_login_refused', 'session_credentials_absent', 'session_token_source_fail', 'session_token_source_warn',
  'oper_elevation_not_confirmed', 'mesh_retryable_warning_missing', 'mesh_resume_retry_success_missing', 'lab_oper_credentials_missing',
  'session_redirect_needs_routing', 'session_resume_refused', 'session_event_delivery_cardinality', 'session_event_identity_missing',
  'session_event_identity_mismatch', 'session_roster_replica_mismatch', 'session_resumed_identity_mismatch', 'session_physical_socket_count', 'exact_attachment_busy_oracle_missing',
  'session_message_refused', 'session_reply_path_missing', 'busy_exact_created_sibling_attachment', 'exact_credential_grammar_unexpected', 'exact_unknown_attachment_id_unavailable', 'exact_unknown_attachment_oracle_missing',
  'exact_unknown_token_oracle_missing', 'session_list_snapshot_missing_rows', 'session_list_current_drop_not_denied',
  'session_list_stale_ordinal_reused', 'history_batch_id_missing', 'history_page_limit_exceeded', 'history_message_identity_invalid',
  'history_latest_page_incomplete', 'history_latest_order_invalid', 'history_anchor_missing', 'history_overlap_not_dedupable', 'history_selector_empty',
  'history_targets_channel_missing', 'history_targets_row_invalid', 'history_unknown_selector_not_rejected', 'history_policy_value_mismatch',
  'history_policy_denial_missing', 'history_batch_open_timeout', 'history_batch_close_timeout', 'history_unknown_selector_timeout',
  'history_ircx_timeout', 'history_policy_value_timeout', 'history_policy_end_timeout', 'history_policy_denial_timeout',
  'history_policy_join_timeout',
]);
const safeFailureCode = (error) => SAFE_FAILURES.has(error?.message) ? error.message : 'assertion_failed';
async function stageWait(promise, timeoutCode) {
  try { return await promise; }
  catch (error) { if (error?.message === 'irc_response_deadline') throw new Error(timeoutCode, { cause: error }); throw error; }
}

async function metrics(port) {
  const response = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error('metrics_http_refused');
  const body = await response.text();
  const values = {};
  for (const line of body.split('\n')) {
    const match = line.match(/^(onyx_(?:s2s_links_active|s2s_tcp_active|mesh_peers_up|mesh_partitioned)) ([0-9.]+)$/);
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
}

export async function waitForTopology(nodes, children, topology, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  const degrees = topology === 'line3' ? [1, 2, 1] : topology === 'line3-manual' ? [1, 1, 0] : [1, 1];
  while (Date.now() < deadline) {
    if (children.some((child) => child.isDaemon && (child.exitCode !== null || child.signalCode !== null))) throw new Error('daemon_exited_before_topology');
    try {
      const rows = await Promise.all(nodes.map((node) => metrics(node.metricsPort)));
      if (rows.every((row, index) => row.onyx_s2s_links_active === degrees[index] && row.onyx_s2s_tcp_active === degrees[index]
        && row.onyx_mesh_peers_up === degrees[index] && (topology === 'line3-manual' || row.onyx_mesh_partitioned === 0))) return rows.length;
    } catch { /* local metrics listener may still be starting */ }
    await delay(200);
  }
  throw new Error('secured_topology_unavailable');
}

export async function runFoundationWire(port) {
  const nick = `Wire${random(4)}`;
  const client = new RawIrcClient(port, 'foundation-wire');
  try {
    await client.guest(nick);
    await client.ping(`lab-ping-${random(3)}`);
    client.send(`JOIN #elm-lab-wire-${random(3)}`);
    const joinLine = await client.waitFor((line) => line.includes(' JOIN #elm-lab-wire-'), 12_000);
    const room = joinLine.match(/ JOIN (#[^ ]+)/)?.[1];
    if (!room) throw new Error('foundation_join_missing');
    const marker = `lab-wire-${random(4)}`;
    const start = client.seen.length;
    client.send(`PRIVMSG ${room} :${marker}`);
    const echo = await client.waitFor((line) => line.includes(`PRIVMSG ${room} :${marker}`), 12_000, start);
    if (!echo) throw new Error('foundation_wire_echo_missing');
    client.close();
    await delay(200);
    const reconnect = new RawIrcClient(port, 'foundation-reconnect');
    try {
      await reconnect.guest(nick);
      await reconnect.ping(`lab-reconnect-${random(3)}`);
      return [ok('foundation-wire', ['ping-pong', 'send-and-reconnect'], 2)];
    } finally { reconnect.close(); }
  } catch (error) {
    const code = new Set(['required_capabilities_refused', 'tls_connect_deadline', 'tls_socket_io', 'tls_socket_closed',
      'irc_response_deadline', 'foundation_join_missing', 'foundation_wire_echo_missing']).has(error?.message)
      ? error.message : 'assertion_failed';
    return [fail('foundation-wire', ['ping-pong', 'send-and-reconnect'], code)];
  } finally { client.close(); }
}

export async function provisionFoundationAccount(port) {
  const account = `elmlab${random(8)}`;
  const password = randomBytes(24).toString('base64url');
  await registerAt(port, account, password, 'foundation');
  return { account, password };
}

function result(id, scenarioIds, status, reasonCode, assertions, diagnostic = null) {
  return { id, scenarioIds, driver: 'raw-tls', status, assertions, reasonCode, evidenceRefs: [], ...(diagnostic ? { diagnostic } : {}) };
}
function ok(id, scenarios, count, diagnostic = null) { return result(id, scenarios, 'pass', null, { executed: count, passed: count, failed: 0 }, diagnostic); }
function fail(id, scenarios, reasonCode = 'assertion_failed', diagnostic = null, assertions = null) { return result(id, scenarios, 'fail', reasonCode, assertions || { executed: 1, passed: 0, failed: 1 }, diagnostic); }
function blocked(id, scenarios, diagnostic = null) { return result(id, scenarios, 'blocked', 'deterministic_server_trigger_unavailable', { executed: 0, passed: 0, failed: 0 }, diagnostic); }

async function registerAt(port, account, password, suffix) {
  const client = new RawIrcClient(port, `registrar-${suffix}`);
  const node = suffix === 'mesh-admin' ? 'B' : ['A', 'B', 'C'].find((candidate) => suffix.endsWith(candidate)) || null;
  if (node) client.setDiagnosticContext({ phase: `account-${node}-register`, actorRole: `registrar-${node}`, node });
  try {
    await client.guest(`Reg${suffix}${random(3)}`);
    await client.registerAccount(account, password);
  } finally { client.close(); }
}

async function connected(port, account, password, suffix, capabilities = '', nodeOverride = null) {
  const client = new RawIrcClient(port, `attachment-${suffix}`);
  try {
    const diagnostic = ({ A0: ['origin-login', 'A-origin', 'A'], A1: ['near-login', 'A-near', 'A'], B0: ['middle-login', 'B-middle', 'B'], B1: ['far-login', 'C-far', 'C'], B2: ['fifth-login', 'C-fifth', 'C'], A2: ['invalid-token-login', 'A-invalid-token', 'A'], A3: ['detached-login', 'A-detached', 'A'], A4: ['missing-aid-login', 'A-missing-aid', 'A'] })[suffix];
    if (diagnostic) client.setDiagnosticContext({ phase: diagnostic[0], actorRole: diagnostic[1], node: nodeOverride || diagnostic[2] });
    await client.login(account, password, `Elm${suffix}${random(3)}`, capabilities || undefined);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

async function meshOwnerLossRecovery(nodes, children, credentials) {
  if (!credentials?.operAccount || !credentials?.operPassword) throw new Error('lab_oper_credentials_missing');
  await registerAt(nodes[1].tlsPort, credentials.operAccount, credentials.operPassword, 'mesh-admin');
  const admin = new RawIrcClient(nodes[1].tlsPort, 'B-mesh-admin');
  const clients = [];
  let linkCut = false;
  let linkRestored = false;
  let manualBaselineEstablished = false;
  let completedChecks = 0;
  try {
    admin.setDiagnosticContext({ phase: 'mesh-link-reconnect', actorRole: 'B-mesh-admin', node: 'B' });
    await admin.login(credentials.operAccount, credentials.operPassword, `MeshAdmin${random(3)}`, undefined, { requireOper: true });
    completedChecks += 1;
    const serverName = `node-3.local.invalid`;
    let start = admin.seen.length;
    admin.send(`CONNECT 127.0.0.1 ${nodes[2].s2sPort}`);
    await admin.waitFor((line) => {
      const message = parseIrcLine(line);
      return message.command === 'NOTICE' && message.prefix === 'node-2.local.invalid'
        && message.params[0]?.toLowerCase() === admin.nick?.toLowerCase()
        && message.params.at(-1) === 'CONNECT initiated (secured)';
    }, 12_000, start);
    completedChecks += 1;
    await waitForTopology(nodes, children, 'line3');
    manualBaselineEstablished = true;
    completedChecks += 1;
    linkRestored = true;
    admin.markDiagnosticPhaseComplete();
    admin.setDiagnosticContext({ phase: 'mesh-link-cut', actorRole: 'B-mesh-admin', node: 'B', lastCompletedPhase: 'mesh-link-reconnect' });
    start = admin.seen.length;
    admin.send(`SQUIT ${serverName} :lab-link-cut`);
    await admin.waitFor((line) => {
      const message = parseIrcLine(line);
      return message.command === 'NOTICE' && message.prefix === 'node-2.local.invalid'
        && message.params[0]?.toLowerCase() === admin.nick?.toLowerCase()
        && message.params.at(-1) === 'SQUIT complete';
    }, 12_000, start);
    linkCut = true;
    linkRestored = false;
    completedChecks += 1;
    admin.markDiagnosticPhaseComplete();
    await waitForTopology(nodes, children, 'line3-manual');
    completedChecks += 1;

    const account = `elmlab${random(4)}`;
    const password = randomBytes(24).toString('base64url');
    await Promise.all(nodes.map((node, index) => registerAt(node.tlsPort, account, password, `mesh-recovery-${String.fromCharCode(65 + index)}`)));
    completedChecks += nodes.length;
    const origin = await connected(nodes[0].tlsPort, account, password, 'mesh-origin'); clients.push(origin);
    completedChecks += 1;
    origin.setDiagnosticContext({ phase: 'origin-token-local', actorRole: 'A-origin', node: 'A' });
    const issued = await origin.tokens();
    completedChecks += 1;
    const far = await connected(nodes[2].tlsPort, account, password, 'mesh-far'); clients.push(far);
    completedChecks += 1;
    far.setDiagnosticContext({ phase: 'mesh-owner-resume-offline', actorRole: 'C-far', node: 'C' });
    start = far.seen.length;
    far.send(`SESSION RESUME ${issued.meshToken}`);
    const warning = await far.waitFor((line) => {
      const message = parseIrcLine(line);
      const body = message.params.at(-1) || '';
      const issue = far.sessionIssueFailureForLab(line);
      return issue !== null || message.command === 'NOTICE' && message.prefix === 'node-3.local.invalid'
        && message.params[0]?.toLowerCase() === far.nick?.toLowerCase()
        && body.startsWith('SESSION RESUME:');
    }, 12_000, start);
    const issue = far.sessionIssueFailureForLab(warning);
    if (!issue || issue.outcome !== 'source-warn' || issue.sourceCode !== 'ORIGIN_UNREACHABLE') {
      const error = new Error('session_resume_refused');
      error.diagnostic = far.diagnostic(issue?.outcome || 'local-rejection', issue?.sourceCode || null);
      throw error;
    }
    completedChecks += 1;
    far.markDiagnosticPhaseComplete();

    admin.setDiagnosticContext({ phase: 'mesh-link-reconnect', actorRole: 'B-mesh-admin', node: 'B', lastCompletedPhase: 'mesh-link-cut' });
    start = admin.seen.length;
    admin.send(`CONNECT 127.0.0.1 ${nodes[2].s2sPort}`);
    await admin.waitFor((line) => {
      const message = parseIrcLine(line);
      return message.command === 'NOTICE' && message.prefix === 'node-2.local.invalid'
        && message.params[0]?.toLowerCase() === admin.nick?.toLowerCase()
        && message.params.at(-1) === 'CONNECT initiated (secured)';
    }, 12_000, start);
    completedChecks += 1;
    await waitForTopology(nodes, children, 'line3');
    completedChecks += 1;
    linkRestored = true;
    far.setDiagnosticContext({ phase: 'mesh-owner-resume-restored', actorRole: 'C-far', node: 'C', lastCompletedPhase: 'mesh-owner-resume-offline' });
    const restored = await far.resume(issued.meshToken);
    if (!restored.includes('attached to replicated mesh session') && !restored.includes('attached to live mesh session')) {
      throw new Error('mesh_resume_retry_success_missing');
    }
    completedChecks += 1;
    return { scenarios: ['mesh-link-owner-loss', 'retryable-failures', 'mesh-link-reconnect', 'mesh-resume-retry'], count: completedChecks };
  } catch (error) {
    if (!error?.diagnostic) error.diagnostic = admin.diagnostic(
      ['secured_topology_unavailable', 'daemon_exited_before_topology', 'metrics_http_refused'].includes(error?.message) ? 'deadline' : 'local-rejection',
    );
    error.manualBaselineEstablished = manualBaselineEstablished;
    error.assertions = { executed: completedChecks + 1, passed: completedChecks, failed: 1 };
    throw error;
  } finally {
    if (linkCut && !linkRestored) {
      try {
        admin.send(`CONNECT 127.0.0.1 ${nodes[2].s2sPort}`);
        await waitForTopology(nodes, children, 'line3', 20_000);
      } catch { /* preserve the scenario's original result; daemon teardown owns final cleanup */ }
    }
    for (const client of clients) client.close();
    admin.close();
  }
}

function setSessionDiagnosticPhase(clients, phase, farNode = 'C') {
  const roles = [
    ['A-origin', 'A'], ['A-near', 'A'], ['B-middle', 'B'], ['C-far', farNode], ['C-fifth', farNode],
  ];
  clients.forEach((client, index) => {
    const role = roles[index];
    if (role) client.setDiagnosticContext({ phase, actorRole: role[0], node: role[1] });
  });
}

async function waitForCollapsedSessionRoster(clients, channel, expectedNick, farNode) {
  const deadline = Date.now() + 15_000;
  setSessionDiagnosticPhase(clients, 'origin-names-end', farNode);
  while (Date.now() < deadline) {
    const starts = clients.map((client) => client.seen.length);
    clients.forEach((client) => client.send(`NAMES ${channel}`));
    const responses = await Promise.all(clients.map((client, index) => client.waitFor(
      (line) => {
        const message = parseIrcLine(line);
        return message.command === '366'
          && message.params[0]?.toLowerCase() === client.nick?.toLowerCase()
          && message.params[1] === channel;
      },
      Math.min(2_000, Math.max(1, deadline - Date.now())),
      starts[index],
    ).catch((error) => {
      if (error?.message === 'irc_response_deadline') return null;
      throw error;
    })));
    if (responses.every(Boolean)) {
      const allCollapsed = clients.every((client, index) => {
        const roster = client.seen.slice(starts[index]).flatMap((line) => {
          const message = parseIrcLine(line);
          if (message.command !== '353' || message.params[2] !== channel) return [];
          return (message.params.at(-1) || '').split(/\s+/u).filter(Boolean)
            .map((entry) => entry.replace(/^[~&@%+!.]+/u, '').toLowerCase());
        });
        return roster.filter((nick) => nick === expectedNick.toLowerCase()).length === 1;
      });
      if (allCollapsed) return;
    }
    await delay(100);
  }
  throw new Error('session_roster_replica_mismatch');
}

async function resumeExactWithRetryableWarn(client, token, onRetryableWarn) {
  const deadline = Date.now() + 20_000;
  try {
    // Both attempts share the client's usual 20 second resume budget.
    return { notice: await client.resume(token, 10_000), diagnostic: null };
  } catch (error) {
    const diagnostic = error?.diagnostic;
    if (diagnostic?.outcome !== 'source-warn' || diagnostic.sourceCode !== 'TEMPORARILY_UNAVAILABLE') throw error;
    onRetryableWarn();
    // Exact restore is explicitly retryable with the same credential. Do not
    // substitute another token or treat the warning as successful restoration.
    const beforeDelay = deadline - Date.now();
    if (beforeDelay <= 0) throw error;
    await delay(Math.min(100, beforeDelay));
    const retryTimeout = Math.min(10_000, Math.floor(deadline - Date.now()));
    if (retryTimeout <= 0 || Date.now() >= deadline) throw error;
    const notice = await client.resume(token, retryTimeout);
    return { notice, diagnostic: client.diagnostic('source-success', 'TEMPORARILY_UNAVAILABLE') };
  }
}

const SESSION_DELIVERY_ACTORS = [
  { actorRole: 'A-origin', node: 'A' }, { actorRole: 'A-near', node: 'A' },
  { actorRole: 'B-middle', node: 'B' }, { actorRole: 'C-far', node: 'C' },
  { actorRole: 'C-fifth', node: 'C' }, { actorRole: 'dm-peer', node: 'A' },
];
function eventMatches(line, target, marker) {
  const message = parseIrcLine(line);
  return message.command === 'PRIVMSG' && message.params[0] === target && message.params.at(-1) === marker;
}
function attachDelivery(diagnostic, eligible, counts, waits, actors) {
  diagnostic.delivery = eligible.map((_client, index) => {
    const actor = actors[index];
    return actor ? { ...actor, matchCount: counts[index] || 0, wait: waits[index] || 'missing' } : null;
  }).filter(Boolean);
  return diagnostic;
}

async function publishAndProve(eligible, sender, target, marker, { replyTo = null, replyTagRecipients = [], deliveryActors = SESSION_DELIVERY_ACTORS } = {}) {
  const starts = new Map(eligible.map((client) => [client, client.seen.length]));
  const senderStart = sender.seen.length;
  const waitStatus = eligible.map(() => 'missing');
  const tagRecipients = new Set(replyTagRecipients);
  if (replyTo !== null && !/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(replyTo)) throw new Error('session_reply_path_missing');
  for (const client of new Set([...eligible, sender])) client.setPrivmsgTargetForLab?.(target);
  sender.send(`${replyTo === null ? '' : `@+draft/reply=${replyTo} `}PRIVMSG ${target} :${marker}`);

  const deliveryWaits = eligible.map((client, index) => client.waitFor(
    (line) => eventMatches(line, target, marker), 15_000, starts.get(client),
  ).then(() => { waitStatus[index] = 'received'; }).catch((error) => {
    waitStatus[index] = error?.message === 'tls_socket_closed' ? 'socket-closed' : 'deadline';
  }));
  const senderResponse = sender.waitFor((line) => eventMatches(line, target, marker)
    || (sender.privmsgFailureForLab?.(line, target) ?? null) !== null, 15_000, senderStart)
    .then((line) => ({ line, issue: sender.privmsgFailureForLab?.(line, target) || null }))
    .catch((error) => ({ error }));
  const [response] = await Promise.all([senderResponse, ...deliveryWaits]);
  await delay(100);
  const matchingLines = eligible.map((client) => client.seen.slice(starts.get(client))
    .filter((line) => eventMatches(line, target, marker)));
  const counts = matchingLines.map((rows) => rows.length);
  const diagnostic = (outcome, sourceCode = null) => attachDelivery(sender.diagnostic(outcome, sourceCode), eligible, counts, waitStatus, deliveryActors);

  if (response?.issue) {
    const error = new Error('session_message_refused');
    error.diagnostic = diagnostic(response.issue.outcome, response.issue.sourceCode);
    throw error;
  }
  if (response?.error) {
    const error = new Error(response.error.message === 'tls_socket_closed' ? 'tls_socket_closed' : 'irc_response_deadline');
    error.diagnostic = diagnostic(response.error.message === 'tls_socket_closed' ? 'socket-closed' : 'deadline');
    throw error;
  }
  if (counts.some((count) => count !== 1)) {
    const error = new Error('session_event_delivery_cardinality');
    error.diagnostic = diagnostic('source-success');
    throw error;
  }
  const identities = matchingLines.map((rows) => safeIdentity(rows[0]));
  if (identities.some((identity) => !identity.msgid || !identity.time)) {
    const error = new Error('session_event_identity_missing');
    error.diagnostic = diagnostic('source-success');
    throw error;
  }
  if (new Set(identities.map((identity) => `${identity.msgid}|${identity.time}`)).size !== 1) {
    const error = new Error('session_event_identity_mismatch');
    error.diagnostic = diagnostic('source-success');
    throw error;
  }
  if (replyTo !== null && eligible.some((client, index) => {
    const value = parseIrcLine(matchingLines[index][0]).tags['+draft/reply'];
    return tagRecipients.has(client) ? value !== replyTo : value !== undefined && value !== replyTo;
  })) {
    const error = new Error('session_reply_path_missing');
    error.diagnostic = diagnostic('source-success');
    throw error;
  }
  return { recipients: matchingLines.length, identity: identities[0] };
}

function markSessionCheck(progress) { progress.passed += 1; }

async function fourAttachmentJourney(nodes, scenario, progress = { passed: 0 }) {
  const account = `elmlab${random(4)}`;
  const password = randomBytes(24).toString('base64url');
  const clients = [];
  try {
    await Promise.all(nodes.map((node, index) => registerAt(node.tlsPort, account, password, String.fromCharCode(65 + index))));
    markSessionCheck(progress);
    const origin = await connected(nodes[0].tlsPort, account, password, 'A0', scenario === 'logical' ? 'draft/reply' : ''); clients.push(origin);
    origin.setDiagnosticContext({ phase: 'origin-join', actorRole: 'A-origin', node: 'A' });
    await origin.join('#elm-lab-session');
    markSessionCheck(progress);
    const originTokens = await origin.tokens();
    markSessionCheck(progress);
    if (scenario === 'logical') {
      const deliveryActors = [
        { actorRole: 'A-origin', node: nodes[0].id }, { actorRole: 'A-near', node: nodes[0].id },
        { actorRole: 'B-middle', node: nodes[1]?.id || 'B' },
        { actorRole: 'C-far', node: nodes.at(-1)?.id || 'C' },
        { actorRole: 'C-fifth', node: nodes.at(-1)?.id || 'C' },
        { actorRole: 'dm-peer', node: nodes[0].id },
      ];
      const near = await connected(nodes[0].tlsPort, account, password, 'A1'); clients.push(near); near.setDiagnosticContext({ phase: 'near-local-resume', actorRole: 'A-near', node: 'A' }); await near.resume(originTokens.localToken);
      markSessionCheck(progress);
      const middle = await connected(nodes[1].tlsPort, account, password, 'B0'); clients.push(middle); middle.setDiagnosticContext({ phase: 'middle-mesh-resume', actorRole: 'B-middle', node: 'B' }); await middle.resume(originTokens.meshToken);
      markSessionCheck(progress);
      const farNode = nodes.at(-1)?.id || 'C';
      const far = await connected(nodes[nodes.length - 1].tlsPort, account, password, 'B1', '', farNode); clients.push(far); far.setDiagnosticContext({ phase: 'far-mesh-resume', actorRole: 'C-far', node: farNode }); await far.resume(originTokens.meshToken);
      markSessionCheck(progress);
      const fifth = await connected(nodes[nodes.length - 1].tlsPort, account, password, 'B2', '', farNode); clients.push(fifth); fifth.setDiagnosticContext({ phase: 'fifth-mesh-resume', actorRole: 'C-fifth', node: farNode }); await fifth.resume(originTokens.meshToken);
      markSessionCheck(progress);
      await waitForCollapsedSessionRoster(clients, '#elm-lab-session', origin.nick, farNode);
      markSessionCheck(progress);
      for (const [index, client] of clients.entries()) {
        const marker = `lab-session-${random(5)}-from-${index}`;
        setSessionDiagnosticPhase(clients, 'channel-canary', farNode);
        await publishAndProve(clients, client, '#elm-lab-session', marker, { deliveryActors });
        markSessionCheck(progress);
      }
      const peerAccount = `elmlabpeer${random(4)}`;
      const peerPassword = randomBytes(24).toString('base64url');
      await registerAt(nodes[0].tlsPort, peerAccount, peerPassword, 'dm-peer');
      markSessionCheck(progress);
      const peer = new RawIrcClient(nodes[0].tlsPort, 'session-dm-peer');
      try {
        peer.setDiagnosticContext({ phase: 'dm-peer-login', actorRole: 'dm-peer', node: 'A' });
        await peer.login(peerAccount, peerPassword, `Peer${random(3)}`, 'draft/reply');
        markSessionCheck(progress);
        await peer.tokens();
        markSessionCheck(progress);
        const dmMarker = `lab-dm-${random(5)}`;
        setSessionDiagnosticPhase(clients, 'dm-canary', farNode);
        peer.setDiagnosticContext({ phase: 'dm-canary', actorRole: 'dm-peer', node: 'A' });
        const seed = await publishAndProve(clients, peer, origin.nick, dmMarker, { deliveryActors: deliveryActors.slice(0, 5) });
        markSessionCheck(progress);
        const replyMarker = `lab-reply-${random(5)}`;
        setSessionDiagnosticPhase(clients, 'dm-canary', farNode);
        origin.setDiagnosticContext({ phase: 'dm-canary', actorRole: 'A-origin', node: 'A' });
        await publishAndProve([...clients, peer], origin, peer.nick, replyMarker, {
          replyTo: seed.identity.msgid, replyTagRecipients: [peer], deliveryActors,
        });
        markSessionCheck(progress);
      } finally { peer.close(); }
      const namesStart = origin.seen.length;
      origin.setDiagnosticContext({ phase: 'origin-names-end', actorRole: 'A-origin', node: 'A' });
      origin.send('NAMES #elm-lab-session');
      await origin.waitFor((line) => line.includes(' 366 ') && line.includes('#elm-lab-session'), 12_000, namesStart);
      const names = origin.seen.slice(namesStart).filter((line) => line.includes(' 353 ') && line.includes('#elm-lab-session'));
      if (!clients.every((client) => client.nick?.toLowerCase() === origin.nick?.toLowerCase())) throw new Error('session_resumed_identity_mismatch');
      const rosterNicks = names.flatMap((line) => parseIrcLine(line).params.at(-1)?.split(/\s+/u) || [])
        .map((entry) => entry.replace(/^[~&@%+!.]+/u, '').toLowerCase())
        .filter((entry) => entry === origin.nick.toLowerCase());
      if (!names.length || rosterNicks.length !== 1) throw new Error('session_roster_replica_mismatch');
      markSessionCheck(progress);
      setSessionDiagnosticPhase(clients, 'physical-pings', nodes.at(-1)?.id || 'C');
      const pings = await Promise.all(clients.map((client, index) => client.ping(`lab-session-ping-${index}-${random(3)}`)));
      if (pings.length !== 5) throw new Error('session_physical_socket_count');
      markSessionCheck(progress);
      return { count: progress.passed, scenarios: ['four-attachments', 'fifth-restore', 'exact-and-logical-cohorts', 'session-canaries', 'session-roster', 'physical-pings'] };
    }

    const busy = await connected(nodes[0].tlsPort, account, password, 'A1'); clients.push(busy);
    busy.setDiagnosticContext({ phase: 'busy-exact-resume', actorRole: 'A-busy', node: 'A' });
    const start = busy.seen.length; busy.send(`SESSION RESUME ${originTokens.localToken}`);
    const response = await busy.waitFor((line) => line.includes('FAIL SESSION ') || line.includes('SESSION RESUME:'), 12_000, start);
    if (!response.includes('ATTACHMENT_IN_USE')) throw new Error('exact_attachment_busy_oracle_missing');
    markSessionCheck(progress);
    await origin.ping(`lab-exact-origin-remains-active-${random(3)}`);
    if (busy.seen.slice(start).some((line) => line.includes('SESSION RESUME:'))) throw new Error('busy_exact_created_sibling_attachment');
    markSessionCheck(progress);
    const [prefix, group, aid] = originTokens.localToken.split('.');
    if (prefix !== 'srm2l' || !group || !/^[a-f0-9]{32}$/iu.test(aid || '')) throw new Error('exact_credential_grammar_unexpected');
    markSessionCheck(progress);
    const unknownAid = await connected(nodes[0].tlsPort, account, password, 'A4'); clients.push(unknownAid);
    const absentAid = ['1', '2', '3'].map((tail) => `${'0'.repeat(aid.length - 1)}${tail}`).find((candidate) => candidate !== aid);
    if (!absentAid) throw new Error('exact_unknown_attachment_id_unavailable');
    unknownAid.setDiagnosticContext({ phase: 'missing-aid-resume', actorRole: 'A-missing-aid', node: 'A' });
    const aidStart = unknownAid.seen.length; unknownAid.send(`SESSION RESUME ${prefix}.${group}.${absentAid}`);
    const aidResponse = await unknownAid.waitFor((line) => line.includes('FAIL SESSION '), 12_000, aidStart);
    if (!aidResponse.includes('NO_ATTACHMENT')) throw new Error('exact_unknown_attachment_oracle_missing');
    markSessionCheck(progress);
    const unknown = await connected(nodes[0].tlsPort, account, password, 'A2'); clients.push(unknown);
    unknown.setDiagnosticContext({ phase: 'invalid-token-resume', actorRole: 'A-invalid-token', node: 'A' });
    const failStart = unknown.seen.length; unknown.send(`SESSION RESUME ${random(16)}`);
    const badToken = await unknown.waitFor((line) => line.includes('FAIL SESSION '), 12_000, failStart);
    if (!/(?:NO_SESSION|INVALID_TOKEN)/.test(badToken)) throw new Error('exact_unknown_token_oracle_missing');
    markSessionCheck(progress);
    origin.close();
    clients.splice(clients.indexOf(origin), 1);
    await delay(300);
    const detached = await connected(nodes[0].tlsPort, account, password, 'A3'); clients.push(detached);
    detached.setDiagnosticContext({ phase: 'detached-restore', actorRole: 'A-detached', node: 'A' });
    let retryableRestoreWarnings = 0;
    const detachedRestore = await resumeExactWithRetryableWarn(detached, originTokens.localToken, () => {
      retryableRestoreWarnings += 1;
      markSessionCheck(progress);
    });
    markSessionCheck(progress);
    detached.setDiagnosticContext({ phase: 'local-list-end', actorRole: 'A-detached', node: 'A' });
    const listStart = detached.seen.length; detached.send('SESSION LIST');
    await detached.waitFor((line) => line.includes('SESSION: end of session list'), 12_000, listStart);
    const listed = detached.seen.slice(listStart).filter((line) => line.includes('SESSION LIST ') && / #\d+ /.test(line));
    const self = listed.find((line) => line.includes('SESSION LIST * #'));
    const other = listed.find((line) => line.includes('SESSION LIST - #'));
    if (!self || !other) throw new Error('session_list_snapshot_missing_rows');
    markSessionCheck(progress);
    const selfOrdinal = Number(self.match(/#(\d+)/)?.[1]);
    detached.setDiagnosticContext({ phase: 'drop-current-denied', actorRole: 'A-detached', node: 'A' });
    const deniedStart = detached.seen.length; detached.send(`SESSION DROP #${selfOrdinal}`);
    const denied = await detached.waitFor((line) => line.includes('FAIL SESSION '), 12_000, deniedStart);
    if (!denied.includes('CANNOT_DROP_CURRENT')) throw new Error('session_list_current_drop_not_denied');
    markSessionCheck(progress);
    const otherOrdinal = Number(other.match(/#(\d+)/)?.[1]);
    detached.setDiagnosticContext({ phase: 'drop-other-accepted', actorRole: 'A-detached', node: 'A' });
    const dropStart = detached.seen.length; detached.send(`SESSION DROP #${otherOrdinal}`);
    await detached.waitFor((line) => line.includes(`SESSION DROP #${otherOrdinal} ok`), 12_000, dropStart);
    markSessionCheck(progress);
    detached.setDiagnosticContext({ phase: 'stale-drop-denied', actorRole: 'A-detached', node: 'A' });
    const staleStart = detached.seen.length; detached.send(`SESSION DROP #${otherOrdinal}`);
    const stale = await detached.waitFor((line) => line.includes('FAIL SESSION '), 12_000, staleStart);
    if (!stale.includes('STALE_LIST')) throw new Error('session_list_stale_ordinal_reused');
    markSessionCheck(progress);
    return {
      count: progress.passed,
      scenarios: ['busy-exact', 'detached-restore', 'failure-local-list-drop-stale', 'exact-and-logical-cohorts'],
      diagnostic: retryableRestoreWarnings === 0 ? null : detachedRestore.diagnostic,
    };
  } catch (error) {
    const actor = clients.at(-1);
    if (!error?.diagnostic && actor) error.diagnostic = actor.diagnostic('local-rejection');
    throw error;
  } finally { for (const client of clients) client.close(); }
}

async function historyBatch(client, command, target, type = 'chathistory') {
  const start = client.seen.length;
  client.send(command);
  const open = await stageWait(client.waitFor((line) => {
    const message = parseIrcLine(line);
    return message.command === 'BATCH' && message.params[0]?.startsWith('+') && message.params[1] === type;
  }, 12_000, start), 'history_batch_open_timeout');
  const ref = parseIrcLine(open).params[0]?.slice(1);
  if (!ref) throw new Error('history_batch_id_missing');
  await stageWait(client.waitFor((line) => {
    const message = parseIrcLine(line);
    return message.command === 'BATCH' && message.params[0] === `-${ref}`;
  }, 12_000, start), 'history_batch_close_timeout');
  const rows = client.seen.slice(start).filter((line) => {
    const message = parseIrcLine(line);
    if (message.tags.batch !== ref) return false;
    if (type === 'draft/chathistory-targets') return message.command === 'CHATHISTORY' && message.params[0] === 'TARGETS';
    return message.command === 'PRIVMSG' && message.params[0] === target;
  });
  if (rows.length > 50) throw new Error('history_page_limit_exceeded');
  if (type === 'draft/chathistory-targets') {
    const validRows = rows.every((line) => {
      const message = parseIrcLine(line);
      return Boolean(message.params[1]) && /^timestamp=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(message.params[2] || '');
    });
    if (!validRows) throw new Error('history_targets_row_invalid');
    return rows;
  }
  const ids = rows.map((line) => safeIdentity(line).msgid).filter(Boolean);
  if (ids.length !== rows.length || new Set(ids).size !== ids.length) throw new Error('history_message_identity_invalid');
  return rows;
}

export async function runSessionScenarios(nodes, children, topology, scenario, operCredentials = null) {
  const results = [];
  let manualBaselineUnavailable = false;
  if (topology === 'line3' && scenario === 'logical' && operCredentials) {
    try {
      const observed = await meshOwnerLossRecovery(nodes, children, operCredentials);
      results.push(ok('sessions-mesh-link-recovery', observed.scenarios, observed.count));
    } catch (error) {
      results.push(fail('sessions-mesh-link-recovery', ['mesh-link-owner-loss', 'retryable-failures', 'mesh-link-reconnect', 'mesh-resume-retry'], safeFailureCode(error), error?.diagnostic || null, error?.assertions || null));
      manualBaselineUnavailable = error?.manualBaselineEstablished !== true;
    }
  }
  const ordinaryScenarios = ['four-attachments', 'fifth-restore', 'exact-and-logical-cohorts', 'busy-exact', 'detached-restore', 'session-canaries', 'session-roster', 'physical-pings'];
  if (manualBaselineUnavailable) {
    const topologyDiagnostic = results.at(-1)?.diagnostic || null;
    results.push(blocked('sessions', ordinaryScenarios, topologyDiagnostic));
  } else {
    const progress = { passed: 0 };
    try {
      await waitForTopology(nodes, children, topology);
      const observed = await fourAttachmentJourney(nodes, scenario, progress);
      results.push(ok('sessions', observed.scenarios, observed.count, observed.diagnostic));
    } catch (error) {
      const assertions = { executed: progress.passed + 1, passed: progress.passed, failed: 1 };
      results.push(fail('sessions', ordinaryScenarios, safeFailureCode(error), error?.diagnostic || null, assertions));
    }
  }
  results.push(blocked('sessions-fault-injection', scenario === 'exact'
    ? ['retryable-failures', 'no-cross-node-endpoint-spoofing']
    : ['no-cross-node-endpoint-spoofing']));
  return results;
}

export async function runHistoryScenarios(nodes, children, topology) {
  const client = new RawIrcClient(nodes[0].tlsPort, 'history-writer');
  try {
    await waitForTopology(nodes, children, topology);
    const historyCapabilities = 'message-tags server-time echo-message batch draft/chathistory';
    await client.guest(`History${random(4)}`, historyCapabilities);
    const channel = `#elm-lab-history-${random(3)}`;
    await client.join(channel);
    const prefix = `lab-h-${random(4)}-`;
    for (let index = 0; index < 80; index += 1) {
      const start = client.seen.length;
      client.send(`PRIVMSG ${channel} :${prefix}${index}`);
      await client.waitFor((line) => line.includes(`PRIVMSG ${channel} :${prefix}${index}`), 10_000, start);
      await delay(120);
    }
    const latest = await historyBatch(client, `CHATHISTORY LATEST ${channel} * 20`, channel);
    if (latest.length !== 20) throw new Error('history_latest_page_incomplete');
    const latestIdentity = latest.map((line) => safeIdentity(line));
    const newest = latestIdentity[0]?.msgid;
    const middle = latestIdentity[Math.floor(latestIdentity.length / 2)]?.msgid;
    const oldest = latestIdentity.at(-1)?.msgid;
    if (!oldest || !middle || !newest) throw new Error('history_anchor_missing');
    const latestTimes = latestIdentity.map((identity) => Date.parse(identity.time || ''));
    if (latestTimes.some((time, index) => !Number.isFinite(time) || (index > 0 && time > latestTimes[index - 1]))) {
      throw new Error('history_latest_order_invalid');
    }
    const before = await historyBatch(client, `CHATHISTORY BEFORE ${channel} msgid=${oldest} 20`, channel);
    const around = await historyBatch(client, `CHATHISTORY AROUND ${channel} msgid=${middle} 20`, channel);
    const latestIds = latest.map((line) => safeIdentity(line).msgid);
    const beforeIds = before.map((line) => safeIdentity(line).msgid);
    const aroundIds = around.map((line) => safeIdentity(line).msgid);
    const allIds = [...latestIds, ...beforeIds, ...aroundIds];
    const latestSet = new Set(latestIds);
    if (new Set(allIds).size >= allIds.length || !aroundIds.some((id) => latestSet.has(id)) || beforeIds.some((id) => latestSet.has(id))) {
      throw new Error('history_overlap_not_dedupable');
    }
    const after = await historyBatch(client, `CHATHISTORY AFTER ${channel} msgid=${oldest} 20`, channel);
    const between = await historyBatch(client, `CHATHISTORY BETWEEN ${channel} msgid=${oldest} msgid=${newest} 20`, channel);
    if (!after.length || !between.length) throw new Error('history_selector_empty');
    const targetBatch = await historyBatch(client, 'CHATHISTORY TARGETS * * 20', channel, 'draft/chathistory-targets');
    if (!targetBatch.some((line) => parseIrcLine(line).params[1] === channel)) throw new Error('history_targets_channel_missing');
    const unknownStart = client.seen.length;
    client.send(`CHATHISTORY UNKNOWN ${channel} * 10`);
    const invalid = await stageWait(client.waitFor((line) => line.includes('FAIL CHATHISTORY '), 12_000, unknownStart), 'history_unknown_selector_timeout');
    if (!invalid.includes('INVALID_PARAMS') && !invalid.includes('INVALID_SUBCOMMAND')) throw new Error('history_unknown_selector_not_rejected');
    client.send('IRCX');
    await stageWait(client.waitFor((line) => line.includes(' 800 '), 8_000), 'history_ircx_timeout');
    const policyStart = client.seen.length;
    client.send(`PROP ${channel} history-policy :members`);
    const property = await stageWait(client.waitFor((line) => line.includes(' 818 ')
      && line.includes(` ${client.nick} ${channel} history-policy `), 8_000, policyStart), 'history_policy_value_timeout');
    if (!property.includes(` history-policy :members`)) throw new Error('history_policy_value_mismatch');
    await stageWait(client.waitFor((line) => line.includes(` 819 ${client.nick} ${channel} :End of properties`), 8_000, policyStart), 'history_policy_end_timeout');
    const outsider = new RawIrcClient(nodes[0].tlsPort, 'history-outsider');
    try {
      await outsider.guest(`Outsider${random(3)}`, historyCapabilities);
      const deniedStart = outsider.seen.length; outsider.send(`CHATHISTORY LATEST ${channel} * 10`);
      const denied = await stageWait(outsider.waitFor((line) => line.includes('FAIL CHATHISTORY '), 12_000, deniedStart), 'history_policy_denial_timeout');
      if (!denied.includes('ACCESS_DENIED')) throw new Error('history_policy_denial_missing');
      outsider.send(`JOIN ${channel}`);
      await stageWait(outsider.waitFor((line) => line.includes(' 366 ') && line.includes(channel), 12_000), 'history_policy_join_timeout');
      await historyBatch(outsider, `CHATHISTORY LATEST ${channel} * 10`, channel);
    } finally { outsider.close(); }
    return [
      ok('history', ['latest', 'before', 'around', 'overlap-dedupe', 'after', 'between', 'targets', 'unknown-selector', 'history-policy-denial'], latest.length + before.length + around.length + after.length + between.length + targetBatch.length + 3),
      blocked('history-rate-limit', ['history-rate-limit-denial']),
      blocked('history-equal-time-boundary', ['equal-time-page-boundary']),
    ];
  } catch (error) {
    return [
      fail('history', ['latest', 'before', 'around', 'overlap-dedupe', 'after', 'between', 'targets', 'unknown-selector', 'history-policy-denial'], safeFailureCode(error)),
      blocked('history-rate-limit', ['history-rate-limit-denial']),
      blocked('history-equal-time-boundary', ['equal-time-page-boundary']),
    ];
  } finally { client.close(); }
}
