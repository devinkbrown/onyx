/**
 * SESSION-TOKEN SASL mechanism tests.
 *
 * Tests the token detection and AUTHENTICATE payload construction logic
 * from the client, mirroring the logic in lib/irc/client.ts.
 */
import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Token detection logic (mirrors client.ts mechanism selection)
// ─────────────────────────────────────────────────────────────────────────────

describe('SESSION-TOKEN detection', () => {
  function selectMechanism(password: string | undefined, mechs: string[]): string {
    const isToken = (password ?? '').startsWith('sst_');
    if (isToken && mechs.includes('SESSION-TOKEN')) return 'SESSION-TOKEN';
    if (mechs.includes('SCRAM-SHA-256'))            return 'SCRAM-SHA-256';
    if (mechs.includes('PLAIN'))                    return 'PLAIN';
    return 'NONE';
  }

  it('selects SESSION-TOKEN when password starts with sst_', () => {
    expect(selectMechanism('sst_deadbeef01234567890123456789ab', ['SESSION-TOKEN', 'PLAIN']))
      .toBe('SESSION-TOKEN');
  });

  it('falls back to SCRAM-SHA-256 when no token', () => {
    expect(selectMechanism('hunter2', ['SESSION-TOKEN', 'SCRAM-SHA-256', 'PLAIN']))
      .toBe('SCRAM-SHA-256');
  });

  it('falls back to PLAIN when no SCRAM available', () => {
    expect(selectMechanism('hunter2', ['SESSION-TOKEN', 'PLAIN']))
      .toBe('PLAIN');
  });

  it('does not use SESSION-TOKEN when server does not advertise it', () => {
    expect(selectMechanism('sst_deadbeef', ['PLAIN']))
      .toBe('PLAIN');
  });

  it('treats undefined password as non-token', () => {
    expect(selectMechanism(undefined, ['SESSION-TOKEN', 'PLAIN']))
      .toBe('PLAIN');
  });

  it('treats empty string as non-token', () => {
    expect(selectMechanism('', ['SESSION-TOKEN', 'PLAIN']))
      .toBe('PLAIN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSION-TOKEN AUTHENTICATE payload construction
// ─────────────────────────────────────────────────────────────────────────────

describe('SESSION-TOKEN AUTHENTICATE payload', () => {
  /**
   * Payload format: base64(authcid NUL token)
   * This mirrors what client.ts does when _saslMech === 'SESSION-TOKEN'
   */
  function buildTokenPayload(nick: string, token: string): string {
    return btoa(`${nick}\0${token}`);
  }

  it('encodes nick + NUL + token in base64', () => {
    const payload = buildTokenPayload('devin', 'sst_abc123');
    const decoded = atob(payload);
    const [nick, token] = decoded.split('\0');
    expect(nick).toBe('devin');
    expect(token).toBe('sst_abc123');
  });

  it('decoded payload contains exactly one NUL byte', () => {
    const payload = buildTokenPayload('alice', 'sst_xyz789');
    const decoded = atob(payload);
    const nuls = decoded.split('').filter(c => c === '\0').length;
    expect(nuls).toBe(1);
  });

  it('is valid base64', () => {
    const payload = buildTokenPayload('bob', 'sst_deadbeef');
    // base64 regex (URL-safe not needed here)
    expect(payload).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONTOKEN NOTICE parsing (store handler)
// ─────────────────────────────────────────────────────────────────────────────

describe('SESSIONTOKEN NOTICE parsing', () => {
  /**
   * Ophion sends:  NOTICE devin :SESSIONTOKEN sst_<hex> <unix>
   * The store parses params[1] which is "SESSIONTOKEN sst_abc 1700000000"
   */
  function parseSessionTokenNotice(params: string[]): { token: string; expiry: number } | null {
    if (!params[1]?.startsWith('SESSIONTOKEN ')) return null;
    const parts = params[1].split(' ');
    if (parts.length < 3) return null;
    const token = parts[1];
    const expiry = parseInt(parts[2], 10);
    if (!token.startsWith('sst_') || !isFinite(expiry)) return null;
    return { token, expiry };
  }

  it('parses valid SESSIONTOKEN notice', () => {
    const result = parseSessionTokenNotice(['devin', 'SESSIONTOKEN sst_abc123def 1900000000']);
    expect(result).not.toBeNull();
    expect(result!.token).toBe('sst_abc123def');
    expect(result!.expiry).toBe(1900000000);
  });

  it('returns null for non-SESSIONTOKEN notices', () => {
    expect(parseSessionTokenNotice(['devin', 'You are now identified as devin'])).toBeNull();
    expect(parseSessionTokenNotice(['devin', 'Incorrect password'])).toBeNull();
  });

  it('returns null for malformed SESSIONTOKEN line', () => {
    // Missing expiry
    expect(parseSessionTokenNotice(['devin', 'SESSIONTOKEN sst_abc'])).toBeNull();
    // Token doesn't start with sst_
    expect(parseSessionTokenNotice(['devin', 'SESSIONTOKEN bad_token 12345'])).toBeNull();
  });

  it('returns null for empty params', () => {
    expect(parseSessionTokenNotice([])).toBeNull();
    expect(parseSessionTokenNotice(['devin'])).toBeNull();
  });
});
