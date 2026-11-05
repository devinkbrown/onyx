/* Session-resume boundary smoke. The old global OnyxPorts bearer store was
   retired; runtime behavior is exercised in credential-owner.test.ts. This
   no-dependency smoke guards the architectural migration so the removed
   secret API cannot silently return. Run with `node --test
   elm/sessionResume.smoke.mjs` from the repository root. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portsSource = await readFile(new URL('./ports.js', import.meta.url), 'utf8');
const ownerSource = await readFile(new URL('./runtime/credential-owner.ts', import.meta.url), 'utf8');

test('legacy public bearer store is absent from browser ports', () => {
  assert.doesNotMatch(portsSource, /resumeCredentials|sessionToken\s*:\s*token|meshToken\s*:\s*token/u);
});

test('credential operations remain behind the private owner and opaque refs', () => {
  assert.match(ownerSource, /export function createCredentialOwner/u);
  assert.match(ownerSource, /resume\(owner: OwnerSnapshot, credentialRef: CredentialRef/u);
  assert.match(ownerSource, /forget\(owner: OwnerSnapshot, credentialRef: CredentialRef/u);
  assert.match(ownerSource, /consumePrivateLine\(line: string/u);
  assert.doesNotMatch(ownerSource, /export\s+function\s+(?:load|store|clear)Credentials/u);
});
