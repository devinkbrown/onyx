// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validContract } from './check-server-contract.mjs';

const source = JSON.parse(
  await readFile(resolve('docs/protocol/onyx-client-contract.v1.json'), 'utf8'),
);

function changed(mutator) {
  const copy = structuredClone(source);
  mutator(copy);
  return copy;
}

describe('Onyx client/server contract schema', () => {
  it('accepts the checked-in contract', () => {
    expect(validContract(source)).toBe(true);
  });

  it.each([
    ['command name', (value) => { value.group_e2ee.control_command.name = 'DATA'; }],
    ['IRCX gate', (value) => { value.group_e2ee.control_command.ircx_required = false; }],
    ['payload bound', (value) => { value.group_e2ee.control_command.limits.payload_bytes = 8192; }],
    ['persistence', (value) => { value.group_e2ee.control_command.persistence = 'history'; }],
    ['control kinds', (value) => { value.group_e2ee.v1_control_records.pop(); }],
    ['MLS semantics', (value) => { delete value.group_e2ee.message_tag_semantics; }],
  ])('rejects drift in %s', (_label, mutate) => {
    expect(validContract(changed(mutate))).toBe(false);
  });
});
