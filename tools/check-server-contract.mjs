#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localPath = resolve('docs/protocol/onyx-client-contract.v1.json');
const serverPath = process.argv[2] ? resolve(process.argv[2]) : null;
const requiredCaps = ['message-tags', 'server-time', 'batch', 'labeled-response', 'echo-message', 'draft/chathistory'];
const controlKinds = ['key-package', 'welcome', 'commit'];
const controlForms = [
  '<channel> <key-package|commit> <from-device> :<opaque-base64url>',
  '<channel> welcome <from-device> <to-account> <to-device> :<opaque-base64url>',
];

function exactArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function validContract(value) {
  return value
    && value.schema === 'onyx-client-server-contract/v1'
    && value.revision === 1
    && requiredCaps.every((cap) => value.capabilities?.required_for_first_party_client?.includes(cap))
    && value.capabilities?.vendor?.['onyx/e2ee']
    && value.group_e2ee?.content_envelope === 'ONYXROOM1'
    && value.group_e2ee?.message_tag === '+onyx/e2ee=mls'
    && value.group_e2ee?.message_tag_semantics === 'internal MLS-family marker only; does not claim RFC 9420 wire interoperability'
    && value.group_e2ee?.invariants?.some((invariant) => invariant.includes('never decrypt'))
    && exactArray(value.group_e2ee?.v1_control_records, controlKinds)
    && value.group_e2ee?.control_command?.name === 'E2EEGROUP'
    && value.group_e2ee?.control_command?.ircx_required === true
    && exactArray(value.group_e2ee?.control_command?.forms, controlForms)
    && value.group_e2ee?.control_command?.payload_encoding === 'canonical base64url without padding'
    && value.group_e2ee?.control_command?.persistence === 'none'
    && value.group_e2ee?.control_command?.limits?.channel_bytes === 128
    && value.group_e2ee?.control_command?.limits?.device_id_bytes === 32
    && value.group_e2ee?.control_command?.limits?.account_bytes === 64
    && value.group_e2ee?.control_command?.limits?.payload_bytes === 4096;
}

async function main() {
  const localText = await readFile(localPath, 'utf8');
  const local = JSON.parse(localText);
  if (!validContract(local)) throw new Error(`Invalid Onyx protocol contract: ${localPath}`);

  if (serverPath) {
    const serverText = await readFile(serverPath, 'utf8');
    if (serverText !== localText) throw new Error(`Protocol contract drift: ${serverPath}`);
  }

  console.log(`Protocol contract valid: ${localPath}${serverPath ? ` = ${serverPath}` : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
