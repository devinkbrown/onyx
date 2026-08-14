#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Validate the executable Onyx client/server protocol contract v2.
 *
 * The contract is intentionally mirrored in the client and server trees.  A
 * path may be supplied on the command line to require an exact byte-for-byte
 * copy of that mirror after the semantic checks pass.
 */

import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package scripts and Vitest both execute from the repository root.  Use
// that stable root-relative path instead of import.meta.url, which Vitest
// virtualizes with a non-file scheme during transformation.
const localPath = resolve('docs/protocol/onyx-client-contract.v2.json');

const REQUIRED_CAPABILITIES = [
  'message-tags',
  'server-time',
  'batch',
  'labeled-response',
  'echo-message',
  'draft/chathistory',
];

const SESSION_COMMANDS = [
  'SESSION TOKEN',
  'SESSION MTOKEN',
  'SESSION RESUME <token>',
];

const CONTROL_RECORDS = ['key-package', 'welcome', 'commit'];

const CONTROL_FORMS = [
  '<channel> <key-package|commit> <from-device> :<opaque-base64url>',
  '<channel> welcome <from-device> <to-account> <to-device> :<opaque-base64url>',
];

const INBOUND_VERBS = ['E2EE.KEYPACKAGE', 'E2EE.COMMIT', 'E2EE.WELCOME'];
const CLIENT_FIELDS = {
  group_control_observer: {
    status: 'production_wired',
    owner: 'connection_and_account_owned_bridge',
    server_reply_authentication: 'E2EEKEY replies are accepted only from the exact server prefix learned from 001',
    consumes: INBOUND_VERBS,
    does_not_consume: 'inbound E2EEGROUP',
  },
  group_control_runtime: {
    status: 'production_wired',
    trusted_directory_verification: 'production_wired',
    genesis_session_provisioning: 'production_wired',
    genesis_semantics: 'authenticated OGC1-v2 commit and welcome pairs may provision an ephemeral epoch-1 GroupSession only for epoch 0 to 1, priorEpoch 0, a zero prior commit hash, and exact routing, identity, commit, membership, body, context, and epoch-key-commitment binding',
    higher_epoch_semantics: 'requires an existing current session or explicit recovery',
    session_persistence: 'activation_hold',
  },
  group_message_crypto: {
    envelope_helpers: 'implemented',
    store_seal: 'production_wired_required_rooms',
    store_open: 'production_wired_ephemeral_session',
    outbound: 'required rooms seal through the private connection-owned runtime, tag onyx/e2ee=mls, and fail closed without a live session; plaintext is not queued or scheduled at rest',
    inbound: 'ONYXROOM1 remains ciphertext in store text; a matching live session may attach transient plaintext after exact async ownership revalidation, otherwise it renders locked',
  },
};
const REQUIRED_POLICY_FIELDS = {
  status: 'production_active',
  admission: 'tag_and_body',
  tag: '+onyx/e2ee=mls',
  body: 'canonical ONYXROOM1 envelope',
  body_validation: 'exact prefix, canonical unpadded base64url, version 1, decoded length at least 33 bytes, and bounded by the server message limit',
  server_validation: 'structural only; the daemon neither decrypts nor authenticates ciphertext',
  local_privmsg_failure: 'FAIL PRIVMSG E2EE_REQUIRED',
  local_notice_failure: 'silent_drop',
  mesh_relay_failure: 'permanent_reject',
  tagmsg: 'admitted as a tag-only command without a text envelope',
};
const MESSAGE_POLICY_VECTORS = {
  accepted: {
    required_room_ciphertext: {
      line: '@+onyx/e2ee=mls PRIVMSG #secure :ONYXROOM1 AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      outcome: 'accepted',
    },
    required_room_tagmsg: {
      line: '@+typing=active TAGMSG #secure',
      outcome: 'accepted',
    },
  },
  rejected: {
    tagged_plaintext: {
      line: '@+onyx/e2ee=mls PRIVMSG #secure :plaintext',
      fail: 'FAIL PRIVMSG E2EE_REQUIRED',
    },
    untagged_envelope: {
      line: 'PRIVMSG #secure :ONYXROOM1 AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      fail: 'FAIL PRIVMSG E2EE_REQUIRED',
    },
    wrong_tag_value: {
      line: '@+onyx/e2ee=1 PRIVMSG #secure :ONYXROOM1 AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      fail: 'FAIL PRIVMSG E2EE_REQUIRED',
    },
    malformed_envelope: {
      line: '@+onyx/e2ee=mls PRIVMSG #secure :ONYXROOM1 not+base64url',
      fail: 'FAIL PRIVMSG E2EE_REQUIRED',
    },
  },
};
const ACCEPTED_VECTOR_NAMES = [
  'key_package_channel',
  'commit_channel',
  'welcome_targeted',
  'commit_payload_bound',
];
const REJECTED_VECTOR_NAMES = [
  'bad_payload_noncanonical',
  'device_not_owned',
  'welcome_unknown_device',
  'welcome_target_not_in_channel',
  'guest_authoring',
  'missing_cap',
  'missing_ircx',
  'sender_not_on_channel',
  'authenticated_no_reusable_session',
];
const REJECTED_VECTOR_FAILS = {
  bad_payload_noncanonical: 'FAIL E2EEGROUP BAD_PAYLOAD',
  device_not_owned: 'FAIL E2EEGROUP DEVICE_NOT_OWNED',
  welcome_unknown_device: 'FAIL E2EEGROUP TARGET_UNAVAILABLE',
  welcome_target_not_in_channel: 'FAIL E2EEGROUP TARGET_UNAVAILABLE',
  guest_authoring: 'FAIL E2EEGROUP NOT_LOGGED_IN',
  missing_cap: 'FAIL E2EEGROUP CAP_REQUIRED',
  missing_ircx: 'FAIL E2EEGROUP IRCX_REQUIRED',
  sender_not_on_channel: 'FAIL E2EEGROUP NOT_ON_CHANNEL',
  authenticated_no_reusable_session: 'FAIL E2EEGROUP SESSION_UNAVAILABLE',
};

const EXPECTED_VECTORS = {
  accepted: {
    key_package_channel: {
      line: 'E2EEGROUP #secure key-package phone :AQIDBA',
      delivery: ':Alice!alice@localhost E2EE.KEYPACKAGE #secure alice phone :AQIDBA',
    },
    commit_channel: {
      line: 'E2EEGROUP #secure commit phone :b3BhcXVl',
      delivery: ':Alice!alice@localhost E2EE.COMMIT #secure alice phone :b3BhcXVl',
    },
    welcome_targeted: {
      line: 'E2EEGROUP #secure welcome phone Bob tablet :d2VsY29tZQ',
      delivery: ':Alice!alice@localhost E2EE.WELCOME #secure alice phone Bob tablet :d2VsY29tZQ',
    },
    commit_payload_bound: {
      line: 'E2EEGROUP #secure commit phone :<payload>',
      payload_repeat: { char: 'A', count: 4096 },
      delivery_verb: 'E2EE.COMMIT',
    },
  },
  rejected: {
    bad_payload_noncanonical: {
      line: 'E2EEGROUP #secure commit phone :not+base64url',
      fail: 'FAIL E2EEGROUP BAD_PAYLOAD',
    },
    device_not_owned: {
      line: 'E2EEGROUP #secure commit missing :AQIDBA',
      fail: 'FAIL E2EEGROUP DEVICE_NOT_OWNED',
    },
    welcome_unknown_device: {
      line: 'E2EEGROUP #secure welcome phone bob missing :AQIDBA',
      fail: 'FAIL E2EEGROUP TARGET_UNAVAILABLE',
    },
    welcome_target_not_in_channel: {
      line: 'E2EEGROUP #secure welcome phone carol laptop :AQIDBA',
      fail: 'FAIL E2EEGROUP TARGET_UNAVAILABLE',
    },
    guest_authoring: {
      line: 'E2EEGROUP #secure commit phone :AQIDBA',
      fail: 'FAIL E2EEGROUP NOT_LOGGED_IN',
    },
    missing_cap: {
      line: 'E2EEGROUP #secure commit phone :AQIDBA',
      fail: 'FAIL E2EEGROUP CAP_REQUIRED',
    },
    missing_ircx: {
      line: 'E2EEGROUP #secure commit phone :AQIDBA',
      fail: 'FAIL E2EEGROUP IRCX_REQUIRED',
    },
    sender_not_on_channel: {
      line: 'E2EEGROUP #secure commit phone :AQIDBA',
      fail: 'FAIL E2EEGROUP NOT_ON_CHANNEL',
    },
    authenticated_no_reusable_session: {
      line: 'CAP REQ :onyx/e2ee',
      fail: 'FAIL E2EEGROUP SESSION_UNAVAILABLE',
      closes_connection: true,
    },
  },
};

const VENDOR_CAPABILITIES = {
  'onyx/session-sync': 'same-account attachment synchronization',
  'onyx/bouncer': 'automatic history rewind',
  'onyx/topics': 'named conversation tags and history',
  'onyx/e2ee': 'permits the +onyx/e2ee message tag and E2EEGROUP eligibility',
};
const GUEST_AUTHORING = 'FAIL E2EEGROUP NOT_LOGGED_IN';
const GUEST_RECIPIENT = 'ineligible; no reusable session row';
const AUTH_NEGOTIATION = 'FAIL E2EEGROUP SESSION_UNAVAILABLE; connection closes before autojoin or further participation';
const AUTH_AUTHORING_DEFENSE = 'WARN E2EEGROUP TEMPORARILY_UNAVAILABLE; a reusable session is required for group E2EE';
const RESUME_INVARIANT = 'A successful same-account resume preserves the logical attachment without duplicate JOIN or MODE events.';
const SESSION_RESUME_FIELDS = {
  invariant: RESUME_INVARIANT,
  live_sibling: 'attach without disconnecting the source',
  detached_ghost: 'restore snapshot then replace the ghost; the token remains reusable',
  mesh_token: 'non-local-length hex is a mesh-sealed reclaim credential, not a one-shot replay nonce',
};
const LIVE_COMMANDS = 'processLiveLine is the only client-command admission path';
const HISTORY_REPLAY = 'CHATHISTORY and bouncer rewind replay stored events; they do not re-author live commands';
const HELIX_E2EE_GROUP = 'EGRG Helix checkpoints are replay metadata only; opaque payloads and hop-custody wires never enter Helix';
const SESSION_RESUME_SPLIT = 'snapshot or live-sibling attach; original JOIN/PART/QUIT live commands are not replayed';
const TRUSTED_SIGNER_SEMANTICS = 'verification requires an externally supplied trusted Ed25519 public key; the wire signer_pub must equal that key and is never account authentication by itself';
const CHANNEL_RECORD = ':<source-prefix> E2EE.KEYPACKAGE|E2EE.COMMIT <channel> <from-account> <from-device> :<opaque-base64url>';
const WELCOME_RECORD = ':<source-prefix> E2EE.WELCOME <channel> <from-account> <from-device> <to-account> <to-device> :<opaque-base64url>';
const RECIPIENT_GATE = 'onyx/e2ee negotiated, locally joined to the channel, and attached to a reusable session';
const WELCOME_ABSENCE = 'explicit TARGET_UNAVAILABLE failure; no offline-recipient persistence';
const PRESENCE_QUIT_FIELDS = {
  scope: 'identity_wide',
  delivery: 'exactly_once',
  mesh_marker: 'ONYX-QUIT',
  client_visible: 'one identity-wide QUIT; per-channel membership withdrawals converge separately',
  sibling_attachment: 'handoff without identity-wide QUIT',
};
const PRESENCE_PART_FIELDS = {
  scope: 'channel_local',
  channels: 'comma-separated list with a shared reason',
  intent: 'one-way exact-token withdrawal of the named channels only',
};

function exactArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function hasText(value, expected) {
  return typeof value === 'string' && value === expected;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactNamedKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every((name) => Object.prototype.hasOwnProperty.call(value, name));
}

function validCommandVectors(vectors) {
  if (!isRecord(vectors)) return false;
  if (!exactNamedKeys(vectors.accepted, ACCEPTED_VECTOR_NAMES)) return false;
  if (!exactNamedKeys(vectors.rejected, REJECTED_VECTOR_NAMES)) return false;

  for (const name of ACCEPTED_VECTOR_NAMES) {
    const item = vectors.accepted[name];
    if (!isRecord(item) || typeof item.line !== 'string' || item.line.length === 0) return false;
  }

  for (const name of REJECTED_VECTOR_NAMES) {
    const item = vectors.rejected[name];
    if (
      !isRecord(item)
      || typeof item.line !== 'string'
      || item.line.length === 0
      || item.fail !== REJECTED_VECTOR_FAILS[name]
    ) {
      return false;
    }
  }

  const bound = vectors.accepted.commit_payload_bound;
  if (
    bound?.payload_repeat?.char !== 'A'
    || bound?.payload_repeat?.count !== 4096
    || bound?.delivery_verb !== 'E2EE.COMMIT'
  ) return false;

  const deliveryVerbs = {
    key_package_channel: 'E2EE.KEYPACKAGE',
    commit_channel: 'E2EE.COMMIT',
    welcome_targeted: 'E2EE.WELCOME',
  };
  for (const [name, verb] of Object.entries(deliveryVerbs)) {
    if (
      vectors.accepted[name].delivery !== EXPECTED_VECTORS.accepted[name].delivery
      || !vectors.accepted[name].delivery.includes(verb)
    ) return false;
  }

  const noSession = vectors.rejected.authenticated_no_reusable_session;
  return noSession.line === 'CAP REQ :onyx/e2ee' && noSession.closes_connection === true;
}

/**
 * Return true only for the frozen v2 contract shape and named vectors.
 * Keeping these checks explicit makes a semantically weakened mirror fail
 * before it can be accepted by the optional byte-equivalence gate.
 */
export function validContract(value) {
  if (!isRecord(value)) return false;

  const contract = value;
  const caps = contract.capabilities;
  const server = contract.server;
  const client = contract.client;
  const eligibility = contract.eligibility;
  const session = contract.session;
  const e2ee = contract.e2ee_group;
  const command = e2ee?.control_command;
  const limits = command?.limits;
  const delivery = command?.delivery;
  const persistence = e2ee?.persistence;
  const presence = contract.presence;

  return contract.schema === 'onyx-client-server-contract/v2'
    && contract.revision === 3
    && contract.transport?.websocket === 'one IRC message per frame; no trailing frame bytes'
    && exactArray(caps?.required_for_first_party_client, REQUIRED_CAPABILITIES)
    && isDeepStrictEqual(caps?.vendor, VENDOR_CAPABILITIES)
    && server?.group_control === 'production_active'
    && hasText(server?.group_control_semantics, 'authenticated membership policy and opaque E2EEGROUP control-record delivery are live, including mesh hop custody and exact-once replay metadata')
    && server?.local_authoring_default === true
    && server?.local_authoring_quiesce === 'operator-only E2EEGROUP ON|OFF|STATUS; inbound relay, ACK, and retry stay live while quiesced'
    && exactNamedKeys(client, Object.keys(CLIENT_FIELDS))
    && isDeepStrictEqual(client, CLIENT_FIELDS)
    && eligibility?.guest?.onyx_e2ee_negotiation === 'allowed'
    && eligibility?.guest?.reusable_session_required === false
    && eligibility?.guest?.authoring === GUEST_AUTHORING
    && eligibility?.guest?.recipient === GUEST_RECIPIENT
    && eligibility?.authenticated_no_reusable_session?.fail_closed === true
    && eligibility?.authenticated_no_reusable_session?.negotiation === AUTH_NEGOTIATION
    && eligibility?.authenticated_no_reusable_session?.authoring_defense === AUTH_AUTHORING_DEFENSE
    && exactArray(session?.commands, SESSION_COMMANDS)
    && isDeepStrictEqual(session?.resume, SESSION_RESUME_FIELDS)
    && session?.replay_live_separation?.live_commands === LIVE_COMMANDS
    && session?.replay_live_separation?.history_replay === HISTORY_REPLAY
    && session?.replay_live_separation?.helix_e2ee_group === HELIX_E2EE_GROUP
    && session?.replay_live_separation?.session_resume === SESSION_RESUME_SPLIT
    && e2ee?.content_envelope === 'ONYXROOM1'
    && e2ee?.message_tag === '+onyx/e2ee=mls'
    && e2ee?.message_tag_semantics === 'internal MLS-family marker only; does not claim RFC 9420 wire interoperability'
    && e2ee?.trusted_signer?.requirement === 'mandatory_external'
    && e2ee?.trusted_signer?.semantics === TRUSTED_SIGNER_SEMANTICS
    && e2ee?.server_secrets === 'none'
    && persistence?.group_secrets === 'none'
    && persistence?.offline_recipient === 'none'
    && persistence?.opaque_control_payload === 'none_durable'
    && exactArray(persistence?.allowed_transient, ['bounded_ads1_attachment_spool', 'ram_mesh_hop_custody_until_ack'])
    && persistence?.helix_checkpoint === 'replay_metadata_only'
    && isDeepStrictEqual(e2ee?.required_policy, REQUIRED_POLICY_FIELDS)
    && exactArray(e2ee?.control_records, CONTROL_RECORDS)
    && command?.name === 'E2EEGROUP'
    && command?.ircx_required === true
    && command?.cap_required === 'onyx/e2ee'
    && exactArray(command?.forms, CONTROL_FORMS)
    && limits?.channel_bytes === 128
    && limits?.device_id_bytes === 32
    && limits?.account_bytes === 64
    && limits?.payload_b64url_chars === 4096
    && command?.payload_encoding === 'canonical base64url without padding'
    && delivery?.channel_record === CHANNEL_RECORD
    && delivery?.welcome_record === WELCOME_RECORD
    && delivery?.recipient_gate === RECIPIENT_GATE
    && delivery?.welcome_absence === WELCOME_ABSENCE
    && isDeepStrictEqual(presence?.quit, PRESENCE_QUIT_FIELDS)
    && isDeepStrictEqual(presence?.part, PRESENCE_PART_FIELDS)
    && isDeepStrictEqual(contract.message_policy_vectors, MESSAGE_POLICY_VECTORS)
    && validCommandVectors(contract.command_vectors)
    && isDeepStrictEqual(contract.command_vectors?.accepted, EXPECTED_VECTORS.accepted)
    && isDeepStrictEqual(contract.command_vectors?.rejected, EXPECTED_VECTORS.rejected);
}

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return { text, value: JSON.parse(text) };
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function validateContract(serverPath = null) {
  let local;
  try {
    local = await readJson(localPath);
  } catch (error) {
    throw new Error(`Cannot read local contract v2: ${localPath}: ${errorText(error)}`);
  }
  if (!validContract(local.value)) {
    throw new Error(`Invalid Onyx protocol contract v2: ${localPath}`);
  }

  if (serverPath) {
    const explicitPath = resolve(serverPath);
    let server;
    try {
      server = await readJson(explicitPath);
    } catch (error) {
      throw new Error(`Cannot read peer contract v2: ${explicitPath}: ${errorText(error)}`);
    }
    if (!validContract(server.value)) {
      throw new Error(`Invalid Onyx protocol contract v2: ${explicitPath}`);
    }
    if (server.text !== local.text) {
      throw new Error(`Protocol contract v2 drift: ${explicitPath}`);
    }
  }

  return { localPath, serverPath: serverPath ? resolve(serverPath) : null };
}

async function main() {
  try {
    const result = await validateContract(process.argv[2] ?? null);
    console.log(`Protocol contract v2 valid: ${result.localPath}${result.serverPath ? ` = ${result.serverPath}` : ''}`);
  } catch (error) {
    console.error(`Protocol contract v2 check failed: ${errorText(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
