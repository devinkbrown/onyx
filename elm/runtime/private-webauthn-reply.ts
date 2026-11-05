import { parseIRCMessage } from '../../src/lib/irc/parser';

export type WebAuthnSourceKind = 'server' | 'prefixless-protocol' | 'user';
export type PrivateWebAuthnReply =
  | { readonly kind: 'challenge'; readonly action: 'register' | 'authenticate'; readonly challenge: string; readonly rpId: string; readonly account: string }
  | { readonly kind: 'allow-credential'; readonly credentialId: string }
  | { readonly kind: 'registered' }
  | { readonly kind: 'failure' }
  | { readonly kind: 'private-invalid' }
  | { readonly kind: 'unrelated' };

/** Parse only the server's exact private Event Spine/passkey grammar. */
export function parsePrivateWebAuthnReply(input: {
  readonly line: string;
  readonly sourceKind: WebAuthnSourceKind;
  readonly serverPrefix: string | null;
  readonly currentNick: string | null;
}): PrivateWebAuthnReply {
  let message;
  try { message = parseIRCMessage(input.line); } catch { return { kind: 'unrelated' }; }
  if (message.command === 'FAIL' && message.prefix === null && input.sourceKind === 'prefixless-protocol'
    && message.params[0]?.toUpperCase() === 'WEBAUTHN') return { kind: 'failure' };
  if (input.sourceKind !== 'server' || input.serverPrefix === null || input.currentNick === null
    || message.prefix !== input.serverPrefix || message.command !== 'EVENT' || message.params[0] !== input.currentNick) {
    return { kind: 'unrelated' };
  }
  // EVENT Spine puts the family in its own parameter; it is not part of the
  // trailing body. Keep the parser aligned with the source-shaped
  // `EVENT <nick> WEBAUTHN <family> ...` frame.
  if (message.params[1] !== 'WEBAUTHN') return { kind: 'unrelated' };
  const fields = message.params.slice(2);
  if (fields[0] === 'REGISTER-CHALLENGE' || fields[0] === 'AUTH-CHALLENGE') {
    // parseIRCMessage strips the trailing-parameter colon; the parsed account
    // value itself must be canonical and contain no extra colon.
    const account = fields[3];
    if (fields.length !== 4 || !fields[1] || !fields[2] || !account
      || !/^[A-Za-z0-9_-]{22,2048}$/u.test(fields[1])
      || !/^[A-Za-z0-9.-]{1,253}$/u.test(fields[2])
      || !/^[A-Za-z0-9_.-]{1,64}$/u.test(account)) return { kind: 'private-invalid' };
    return { kind: 'challenge', action: fields[0] === 'REGISTER-CHALLENGE' ? 'register' : 'authenticate',
      challenge: fields[1], rpId: fields[2], account };
  }
  if (fields[0] === 'ALLOW-CRED' && fields.length === 2 && /^[A-Za-z0-9_-]{1,1364}$/u.test(fields[1] ?? '')) {
    return { kind: 'allow-credential', credentialId: fields[1]! };
  }
  if (fields[0] === 'ALLOW-CRED') return { kind: 'private-invalid' };
  if (fields[0] === 'REGISTERED' && fields.length >= 2 && /^[A-Za-z0-9_-]{1,1364}$/u.test(fields[1] ?? '')) return { kind: 'registered' };
  return fields[0]?.startsWith('REGISTER')||fields[0]?.startsWith('AUTH') ? { kind: 'private-invalid' } : { kind: 'unrelated' };
}
