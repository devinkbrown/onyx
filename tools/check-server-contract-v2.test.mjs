// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validContract, validateContract } from './check-server-contract-v2.mjs';

const localText = await readFile(resolve('docs/protocol/onyx-client-contract.v2.json'), 'utf8');
const source = JSON.parse(localText);

function changed(mutator) {
  const copy = structuredClone(source);
  mutator(copy);
  return copy;
}

describe('Onyx client/server contract v2 schema', () => {
  it('accepts the checked-in client contract', () => {
    expect(validContract(source)).toBe(true);
  });

  it.each([
    ['server status', (value) => { value.server.group_control = 'staged'; }],
    ['client observer status', (value) => { value.client.group_control_observer.status = 'staged_unwired'; }],
    ['client observer owner', (value) => { value.client.group_control_observer.owner = 'store_global'; }],
    ['client server authentication', (value) => { value.client.group_control_observer.server_reply_authentication = 'accept any prefix'; }],
    ['client runtime status', (value) => { value.client.group_control_runtime.status = 'staged_unwired'; }],
    ['client genesis provisioning', (value) => { value.client.group_control_runtime.genesis_session_provisioning = 'not_wired'; }],
    ['client genesis semantics', (value) => { value.client.group_control_runtime.genesis_semantics = 'accept any epoch'; }],
    ['client session persistence', (value) => { value.client.group_control_runtime.session_persistence = 'production_active'; }],
    ['client store seal', (value) => { value.client.group_message_crypto.store_seal = 'production_active'; }],
    ['client store open', (value) => { value.client.group_message_crypto.store_open = 'production_active'; }],
    ['transport missing', (value) => { delete value.transport; }],
    ['transport nonobject', (value) => { value.transport = ['websocket']; }],
    ['transport websocket drift', (value) => { value.transport.websocket = 'multiple IRC messages per frame'; }],
    ['guest negotiation', (value) => { value.eligibility.guest.onyx_e2ee_negotiation = 'forbidden'; }],
    ['guest authoring prose', (value) => { value.eligibility.guest.authoring = 'NOT_LOGGED_IN is not required'; }],
    ['guest recipient prose', (value) => { value.eligibility.guest.recipient = 'not ineligible; no reusable session row'; }],
    ['authenticated session failure', (value) => { value.eligibility.authenticated_no_reusable_session.negotiation = 'allowed'; }],
    ['authoring defense deleted', (value) => { delete value.eligibility.authenticated_no_reusable_session.authoring_defense; }],
    ['authoring defense replayed as success', (value) => {
      value.eligibility.authenticated_no_reusable_session.authoring_defense = 'accepted without a reusable session';
    }],
    ['required capabilities', (value) => {
      value.capabilities.required_for_first_party_client = value.capabilities.required_for_first_party_client
        .filter((cap) => cap !== 'draft/chathistory');
    }],
    ['channel limit', (value) => { value.e2ee_group.control_command.limits.channel_bytes = 64; }],
    ['device limit', (value) => { value.e2ee_group.control_command.limits.device_id_bytes = 16; }],
    ['account limit', (value) => { value.e2ee_group.control_command.limits.account_bytes = 32; }],
    ['control command name', (value) => { value.e2ee_group.control_command.name = 'DATA'; }],
    ['IRCX requirement', (value) => { value.e2ee_group.control_command.ircx_required = false; }],
    ['capability requirement', (value) => { value.e2ee_group.control_command.cap_required = 'message-tags'; }],
    ['payload bound', (value) => { value.e2ee_group.control_command.limits.payload_b64url_chars = 4097; }],
    ['payload field name', (value) => {
      value.e2ee_group.control_command.limits.payload_bytes = value.e2ee_group.control_command.limits.payload_b64url_chars;
      delete value.e2ee_group.control_command.limits.payload_b64url_chars;
    }],
    ['recipient gate', (value) => { value.e2ee_group.control_command.delivery.recipient_gate = 'onyx/e2ee negotiated'; }],
    ['welcome absence', (value) => { value.e2ee_group.control_command.delivery.welcome_absence = 'queue for later delivery'; }],
    ['offline persistence', (value) => { value.e2ee_group.persistence.offline_recipient = 'allowed'; }],
    ['trusted signer', (value) => { value.e2ee_group.trusted_signer.requirement = 'wire_only'; }],
    ['trusted signer semantics', (value) => {
      value.e2ee_group.trusted_signer.semantics = 'verification requires an externally supplied trusted key, but the wire signer_pub is not required';
    }],
    ['content envelope', (value) => { value.e2ee_group.content_envelope = 'TSUMUGI1'; }],
    ['message tag', (value) => { value.e2ee_group.message_tag = '+onyx/e2ee=sframe'; }],
    ['Helix checkpoint', (value) => { value.e2ee_group.persistence.helix_checkpoint = 'include_payloads'; }],
    ['required policy admission', (value) => { value.e2ee_group.required_policy.admission = 'tag_only'; }],
    ['required policy tag', (value) => { value.e2ee_group.required_policy.tag = '+onyx/e2ee=1'; }],
    ['required policy body', (value) => { value.e2ee_group.required_policy.body = 'any text'; }],
    ['required policy TAGMSG', (value) => { value.e2ee_group.required_policy.tagmsg = 'rejected'; }],
    ['message policy accepted ciphertext', (value) => { value.message_policy_vectors.accepted.required_room_ciphertext.outcome = 'rejected'; }],
    ['message policy accepted TAGMSG', (value) => { value.message_policy_vectors.accepted.required_room_tagmsg.line = 'TAGMSG #other'; }],
    ['message policy tagged plaintext', (value) => { value.message_policy_vectors.rejected.tagged_plaintext.fail = 'accepted'; }],
    ['message policy malformed envelope', (value) => { value.message_policy_vectors.rejected.malformed_envelope.line = 'PRIVMSG #secure :plain'; }],
    ['MLS semantics', (value) => { delete value.e2ee_group.message_tag_semantics; }],
    ['mesh QUIT scope', (value) => { value.presence.quit.scope = 'channel_local'; }],
    ['mesh QUIT marker', (value) => { value.presence.quit.mesh_marker = 'ONYX-PART'; }],
    ['QUIT delivery', (value) => { value.presence.quit.delivery = 'best_effort'; }],
    ['QUIT client visible', (value) => { value.presence.quit.client_visible = 'one PART per channel'; }],
    ['QUIT sibling attachment', (value) => { value.presence.quit.sibling_attachment = 'emit identity-wide QUIT for every sibling'; }],
    ['QUIT scope deleted', (value) => { delete value.presence.quit.scope; }],
    ['QUIT delivery deleted', (value) => { delete value.presence.quit.delivery; }],
    ['QUIT marker deleted', (value) => { delete value.presence.quit.mesh_marker; }],
    ['QUIT client visible deleted', (value) => { delete value.presence.quit.client_visible; }],
    ['QUIT sibling attachment deleted', (value) => { delete value.presence.quit.sibling_attachment; }],
    ['QUIT object malformed', (value) => { value.presence.quit = ['identity_wide']; }],
    ['QUIT object extra key', (value) => { value.presence.quit.extra = 'drift'; }],
    ['PART channels', (value) => { value.presence.part.channels = 'single channel only'; }],
    ['PART intent', (value) => { value.presence.part.intent = 'identity-wide withdrawal of every channel'; }],
    ['PART scope deleted', (value) => { delete value.presence.part.scope; }],
    ['PART channels deleted', (value) => { delete value.presence.part.channels; }],
    ['PART intent deleted', (value) => { delete value.presence.part.intent; }],
    ['PART object malformed', (value) => { value.presence.part = null; }],
    ['PART object extra key', (value) => { value.presence.part.extra = 'drift'; }],
    ['replay/live separation', (value) => { value.session.replay_live_separation.history_replay = 're-author live commands'; }],
    ['resume invariant', (value) => { value.session.resume.invariant = 'replay JOIN on resume'; }],
    ['resume live sibling', (value) => { value.session.resume.live_sibling = 'disconnect the source'; }],
    ['resume detached ghost', (value) => { value.session.resume.detached_ghost = 'discard the ghost before restore'; }],
    ['resume mesh token', (value) => { value.session.resume.mesh_token = 'mesh tokens are one-shot replay nonces'; }],
    ['resume invariant deleted', (value) => { delete value.session.resume.invariant; }],
    ['resume live sibling deleted', (value) => { delete value.session.resume.live_sibling; }],
    ['resume detached ghost deleted', (value) => { delete value.session.resume.detached_ghost; }],
    ['resume mesh token deleted', (value) => { delete value.session.resume.mesh_token; }],
    ['resume object malformed', (value) => { value.session.resume = 'not-an-object'; }],
    ['resume object extra key', (value) => { value.session.resume.extra = 'drift'; }],
    ['session resume replays membership', (value) => {
      value.session.replay_live_separation.session_resume = 'replay original JOIN/PART/QUIT live commands';
    }],
    ['negated authenticated negotiation', (value) => {
      value.eligibility.authenticated_no_reusable_session.negotiation = 'does not emit FAIL E2EEGROUP SESSION_UNAVAILABLE; connection never closes';
    }],
    ['negated authoring defense', (value) => {
      value.eligibility.authenticated_no_reusable_session.authoring_defense = 'not TEMPORARILY_UNAVAILABLE; a reusable session is not required';
    }],
    ['negated session resume', (value) => {
      value.session.replay_live_separation.session_resume = 'it is false that original JOIN/PART/QUIT live commands are not replayed';
    }],
    ['negated live command path', (value) => {
      value.session.replay_live_separation.live_commands = 'processLiveLine is not the only client-command admission path';
    }],
    ['negated history replay', (value) => {
      value.session.replay_live_separation.history_replay = 'CHATHISTORY and bouncer rewind do not replay stored events; they re-author live commands';
    }],
    ['negated Helix replay', (value) => {
      value.session.replay_live_separation.helix_e2ee_group = 'EGRG Helix checkpoints are not replay metadata only; opaque payloads enter Helix';
    }],
    ['session commands', (value) => { value.session.commands[0] = 'SESSION LIST'; }],
    ['control forms', (value) => {
      value.e2ee_group.control_command.forms[0] = '<channel> commit <from-device> :<opaque-base64url>';
    }],
    ['channel delivery record', (value) => {
      value.e2ee_group.control_command.delivery.channel_record = ':<source-prefix> E2EEGROUP <channel> <from-account> <from-device> :<opaque-base64url>';
    }],
    ['welcome delivery record', (value) => {
      value.e2ee_group.control_command.delivery.welcome_record = ':<source-prefix> E2EEGROUP WELCOME <channel> <from-account> <from-device> <to-account> <to-device> :<opaque-base64url>';
    }],
    ['control records', (value) => { value.e2ee_group.control_records.push('proposal'); }],
    ['vendor extra key', (value) => { value.capabilities.vendor['onyx/media'] = 'calls'; }],
    ['vendor e2ee description', (value) => {
      value.capabilities.vendor['onyx/e2ee'] = 'permits the +onyx/e2ee message tag';
    }],
    ['accepted vector', (value) => { value.command_vectors.accepted.commit_channel.delivery = 'forged'; }],
    ['accepted vector line', (value) => {
      value.command_vectors.accepted.commit_channel.line = 'E2EEGROUP #secure commit phone :AAAAAA';
    }],
    ['accepted vector delivery', (value) => {
      value.command_vectors.accepted.key_package_channel.delivery = ':Alice!alice@localhost E2EEGROUP #secure phone :AQIDBA';
    }],
    ['accepted account-less delivery', (value) => {
      value.command_vectors.accepted.key_package_channel.delivery = ':Alice!alice@localhost E2EE.KEYPACKAGE #secure phone :AQIDBA';
    }],
    ['accepted welcome delivery verb swap', (value) => {
      value.command_vectors.accepted.welcome_targeted.delivery = ':Alice!alice@localhost E2EE.COMMIT #secure phone Bob tablet :d2VsY29tZQ';
    }],
    ['rejected vector', (value) => { delete value.command_vectors.rejected.missing_cap; }],
    ['rejected vector empty line', (value) => { value.command_vectors.rejected.missing_cap.line = ''; }],
  ])('rejects drift in %s', (_label, mutate) => {
    expect(validContract(changed(mutate))).toBe(false);
  });

  it.each([
    ['non-object contract', () => []],
    ['missing transport', (value) => { delete value.transport; }],
    ['malformed transport', (value) => { value.transport = null; }],
    ['null command vectors', (value) => { value.command_vectors = null; }],
    ['null accepted vectors', (value) => { value.command_vectors.accepted = null; }],
    ['missing accepted bound vector', (value) => { value.command_vectors.accepted.commit_payload_bound = undefined; }],
    ['null rejected vectors', (value) => { value.command_vectors.rejected = null; }],
    ['missing group control observer', (value) => { delete value.client.group_control_observer; }],
    ['malformed group control observer', (value) => { value.client.group_control_observer = null; }],
    ['missing group control runtime', (value) => { delete value.client.group_control_runtime; }],
    ['malformed message crypto', (value) => { value.client.group_message_crypto = null; }],
    ['missing message policy vectors', (value) => { delete value.message_policy_vectors; }],
    ['missing persistence', (value) => { delete value.e2ee_group.persistence; }],
    ['malformed persistence', (value) => { value.e2ee_group.persistence = 'none'; }],
    ['malformed e2ee group', (value) => { value.e2ee_group = []; }],
  ])('fails closed on malformed objects: %s', (_label, mutate) => {
    const candidate = typeof mutate === 'function' && mutate.length === 0
      ? mutate()
      : changed(mutate);
    expect(() => validContract(candidate)).not.toThrow();
    expect(validContract(candidate)).toBe(false);
  });

  it('requires exact bytes when an explicit mirror is supplied', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'onyx-contract-v2-'));
    const mirror = resolve(dir, 'mirror.json');
    try {
      await writeFile(mirror, localText, 'utf8');
      await expect(validateContract(mirror)).resolves.toMatchObject({ serverPath: mirror });
      await writeFile(mirror, `${localText}\n`, 'utf8');
      await expect(validateContract(mirror)).rejects.toThrow('Protocol contract v2 drift');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a controlled failure for a missing repo-local peer copy', async () => {
    const missing = resolve('tools/.missing-onyx-client-contract-v2.json');
    await expect(validateContract(missing)).rejects.toThrow(`Cannot read peer contract v2: ${missing}`);
  });

  it('keeps the client status and security claims grounded in source evidence', async () => {
    const [routingSource, payloadSource, envelopeSource, keyringSource] = await Promise.all([
      readFile(resolve('src/lib/e2ee/groupControl.ts'), 'utf8'),
      readFile(resolve('src/lib/e2ee/groupControlPayload.ts'), 'utf8'),
      readFile(resolve('src/lib/e2ee/groupEnvelope.ts'), 'utf8'),
      readFile(resolve('src/lib/e2ee/groupKeyring.ts'), 'utf8'),
    ]);

    expect(routingSource).toContain("export const GROUP_CONTROL_COMMAND = 'E2EEGROUP';");
    expect(routingSource).toContain('export const MAX_GROUP_CONTROL_PAYLOAD = 4096;');
    expect(payloadSource).toContain('verification requires an **explicit trusted signer**');
    expect(payloadSource).toContain('wire `signer_pub` must **exactly equal** that trusted key');
    expect(payloadSource).toContain('Non-goals: MLS/RFC 9420 wire interop');
    expect(envelopeSource).toContain('No RFC-9420 compliance claim');
    expect(keyringSource).toContain('never writes a room secret to IndexedDB');
  });
});
