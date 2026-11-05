import { describe, expect, it } from 'vitest';
import { parsePrivateWebAuthnReply } from './private-webauthn-reply';

const source = { sourceKind: 'server' as const, serverPrefix: 'server.test', currentNick: 'alice' };

describe('private WebAuthn wire replies', () => {
  it('parses the server REGISTER challenge frame without exposing any body to the public fold', () => {
    expect(parsePrivateWebAuthnReply({ ...source,
      line: ':server.test EVENT alice WEBAUTHN REGISTER-CHALLENGE AAAAAAAAAAAAAAAAAAAAAA chat.example.test :alice' }))
      .toEqual({ kind: 'challenge', action: 'register', challenge: 'AAAAAAAAAAAAAAAAAAAAAA', rpId: 'chat.example.test', account: 'alice' });
  });

  it('parses AUTH challenge and exact allow-credential frames', () => {
    expect(parsePrivateWebAuthnReply({ ...source,
      line: ':server.test EVENT alice WEBAUTHN AUTH-CHALLENGE AAAAAAAAAAAAAAAAAAAAAA chat.example.test :alice' }))
      .toMatchObject({ kind: 'challenge', action: 'authenticate', account: 'alice' });
    expect(parsePrivateWebAuthnReply({ ...source,
      line: ':server.test EVENT alice WEBAUTHN ALLOW-CRED YWJj' }))
      .toEqual({ kind: 'allow-credential', credentialId: 'YWJj' });
  });

  it('rejects an extra colon in the parsed challenge account field', () => {
    expect(parsePrivateWebAuthnReply({ ...source,
      line: ':server.test EVENT alice WEBAUTHN AUTH-CHALLENGE AAAAAAAAAAAAAAAAAAAAAA chat.example.test ::alice' }))
      .toEqual({ kind: 'private-invalid' });
  });

  it('rejects spoofed sources and marks malformed private challenge families for consumption', () => {
    const line = ':server.test EVENT alice WEBAUTHN AUTH-CHALLENGE short chat.example.test :alice';
    expect(parsePrivateWebAuthnReply({ ...source, sourceKind: 'user', line })).toEqual({ kind: 'unrelated' });
    expect(parsePrivateWebAuthnReply({ ...source, line })).toEqual({ kind: 'private-invalid' });
    expect(parsePrivateWebAuthnReply({ ...source, line: ':evil.test EVENT alice :WEBAUTHN REGISTER-CHALLENGE AAAAAAAAAAAAAAAAAAAAAA chat.example.test :alice' }))
      .toEqual({ kind: 'unrelated' });
  });

  it('accepts only prefixless WEBAUTHN FAIL as an operation failure', () => {
    expect(parsePrivateWebAuthnReply({ sourceKind: 'prefixless-protocol', serverPrefix: null, currentNick: null,
      line: 'FAIL WEBAUTHN ASSERTION_FAILED :Passkey assertion rejected' })).toEqual({ kind: 'failure' });
    expect(parsePrivateWebAuthnReply({ sourceKind: 'user', serverPrefix: null, currentNick: null,
      line: 'FAIL WEBAUTHN ASSERTION_FAILED :Passkey assertion rejected' })).toEqual({ kind: 'unrelated' });
  });
});
