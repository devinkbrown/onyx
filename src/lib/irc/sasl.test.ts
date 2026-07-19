// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { IRCClient } from './client';
import type { IRCMessage } from './types';

// ── Test harness ────────────────────────────────────────────────────────────
// Drive the client with a fake OPEN socket that captures every outbound frame
// verbatim, plus separate capture of the redacted onRaw log stream and onError.
interface Priv {
  ws: { readyState: number; bufferedAmount: number; send(l: string): void; close(code?: number, reason?: string): void } | null;
  _saslMech: string | null;
  _saslPending: boolean;
  _loggedIn: boolean;
  _registered: boolean;
  _onMessage(ev: { data: string }): void;
}

function makeSaslClient(password?: string) {
  const sent: string[] = [];
  const raw: Array<{ line: string; dir: 'in' | 'out' }> = [];
  const errors: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];
  const client = new IRCClient({
    url: 'wss://ircx.us:8080/',
    nick: 'kain',
    password,
    onMessage: (_m: IRCMessage) => {},
    onRaw: (line, dir) => raw.push({ line, dir }),
    onError: (e) => errors.push(e),
  });
  const priv = client as unknown as Priv;
  priv.ws = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (l: string) => sent.push(l),
    close: (code?: number, reason?: string) => closed.push({ code, reason }),
  };
  const feed = (data: string) => priv._onMessage({ data });
  return { client, priv, sent, raw, errors, closed, feed };
}

async function waitForSend(sent: string[], prevLen: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (sent.length > prevLen) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for outbound frame');
}

// ── FIX 1 — credential redaction in the raw log ──────────────────────────────
describe('SASL AUTHENTICATE redaction in the raw log', () => {
  it('redacts an outbound base64 payload in onRaw but sends the real bytes', () => {
    const { client, sent, raw } = makeSaslClient('hunter2');
    const payload = btoa('\0kain\0hunter2');
    client.sendRaw('AUTHENTICATE', payload);

    // The raw log must NOT contain the reversible credential.
    const outLog = raw.filter((r) => r.dir === 'out').map((r) => r.line);
    expect(outLog).toContain('AUTHENTICATE <redacted>');
    expect(outLog.join('\n')).not.toContain(payload);

    // The real base64 must still be on the wire, CRLF-terminated.
    expect(sent).toContain(`AUTHENTICATE ${payload}\r\n`);
  });

  it('does NOT redact a bare AUTHENTICATE + continuation', () => {
    const { client, raw } = makeSaslClient();
    client.sendRaw('AUTHENTICATE', '+');
    const outLog = raw.filter((r) => r.dir === 'out').map((r) => r.line);
    expect(outLog).toContain('AUTHENTICATE +');
  });

  it('does NOT redact a bare mechanism-selection line', () => {
    const { client, raw } = makeSaslClient();
    client.sendRaw('AUTHENTICATE', 'PLAIN');
    client.sendRaw('AUTHENTICATE', 'SCRAM-SHA-256');
    client.sendRaw('AUTHENTICATE', 'EXTERNAL');
    const outLog = raw.filter((r) => r.dir === 'out').map((r) => r.line);
    expect(outLog).toContain('AUTHENTICATE PLAIN');
    expect(outLog).toContain('AUTHENTICATE SCRAM-SHA-256');
    expect(outLog).toContain('AUTHENTICATE EXTERNAL');
  });

  it('redacts an uppercase-only base64 payload rather than mistaking it for a mechanism', () => {
    const { client, raw } = makeSaslClient();
    const payload = 'QUJDREVGR0hJSktM';
    client.sendRaw('AUTHENTICATE', payload);
    const outLog = raw.filter((r) => r.dir === 'out').map((r) => r.line);
    expect(outLog).toContain('AUTHENTICATE <redacted>');
    expect(outLog).not.toContain(`AUTHENTICATE ${payload}`);
  });

  it('redacts an inbound base64 AUTHENTICATE challenge but keeps + visible', () => {
    const { raw, feed } = makeSaslClient();
    feed('AUTHENTICATE cj1hYmMscz1kZWYsaT00MDk2'); // base64 server-first challenge
    feed('AUTHENTICATE +');
    const inLog = raw.filter((r) => r.dir === 'in').map((r) => r.line);
    expect(inLog).toContain('AUTHENTICATE <redacted>');
    expect(inLog).toContain('AUTHENTICATE +');
    expect(inLog.join('\n')).not.toContain('cj1hYmMscz1kZWYsaT00MDk2');
  });
});

// ── FIX 3 — SASL failure surfaces to the user ────────────────────────────────
describe('SASL failure numerics surface via onError', () => {
  it('904 during an in-flight SASL exchange calls onError', () => {
    const { priv, errors, closed, sent, feed } = makeSaslClient('wrong');
    priv._saslPending = true;
    priv._saslMech = 'PLAIN';
    feed(':eshmaki.me 904 kain :SASL authentication failed');
    expect(errors).toContain('SASL authentication failed');
    expect(closed).toContainEqual({ code: 4003, reason: 'SASL authentication failed' });
    expect(sent).not.toContain('CAP END\r\n');
  });

  it('905 during an in-flight SASL exchange calls onError', () => {
    const { priv, errors, closed, feed } = makeSaslClient('wrong');
    priv._saslPending = true;
    priv._saslMech = 'SCRAM-SHA-256';
    feed(':eshmaki.me 905 kain :too many attempts');
    expect(errors).toContain('SASL authentication failed');
    expect(closed).toContainEqual({ code: 4003, reason: 'SASL authentication failed' });
  });

  it('a post-registration 904 (IRCX error, no SASL in flight) does NOT call onError', () => {
    const { priv, errors, feed } = makeSaslClient();
    priv._saslPending = false;
    priv._saslMech = null;
    feed(':eshmaki.me 904 kain #chan :ERR_BADTAG');
    expect(errors).toEqual([]);
  });
});

describe('SASL PLAIN UTF-8 credentials', () => {
  it('encodes a Unicode password as UTF-8 instead of throwing in btoa', () => {
    const password = 'correct horse 🐎 水';
    const { priv, sent, feed } = makeSaslClient(password);
    priv._saslPending = true;
    priv._saslMech = 'PLAIN';

    feed('AUTHENTICATE +');

    const encoded = sent.at(-1)!.replace(/^AUTHENTICATE /, '').replace(/\r\n$/, '');
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(`\0kain\0${password}`);
  });

  it('chunks long payloads into IRCv3-sized AUTHENTICATE frames', () => {
    const password = `water-${'水'.repeat(300)}`;
    const { priv, sent, feed } = makeSaslClient(password);
    priv._saslPending = true;
    priv._saslMech = 'PLAIN';

    feed('AUTHENTICATE +');

    const chunks = sent.map((line) => line.slice('AUTHENTICATE '.length, -2));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 400)).toBe(true);
    const encoded = chunks.filter((chunk) => chunk !== '+').join('');
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(`\0kain\0${password}`);
  });

  it('terminates an exact 400-byte payload with an empty continuation', () => {
    // `\0kain\0` is 6 bytes; +294 ASCII password bytes = 300 raw bytes =
    // exactly 400 base64 bytes.
    const password = 'x'.repeat(294);
    const { priv, sent, feed } = makeSaslClient(password);
    priv._saslPending = true;
    priv._saslMech = 'PLAIN';

    feed('AUTHENTICATE +');

    expect(sent).toHaveLength(2);
    expect(sent[0]).toHaveLength('AUTHENTICATE '.length + 400 + 2);
    expect(sent[1]).toBe('AUTHENTICATE +\r\n');
  });
});

// ── FIX 2 — SCRAM server-signature (mutual auth) verification ─────────────────
// Simulate the Onyx Server SCRAM emit path: after the client-final, the server
// sends the server-final `v=<ServerSignature>` as a DISCRETE AUTHENTICATE line,
// then 903. The client must recompute ServerSignature and fail closed on a
// mismatch, and must NOT emit a stray `AUTHENTICATE +`.
describe('SCRAM-SHA-256 server-signature verification', () => {
  const enc = new TextEncoder();

  async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
    const k = await crypto.subtle.importKey(
      'raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
  }

  async function serverSignatureB64(
    password: string, salt: Uint8Array, iterations: number, authMessage: string,
  ): Promise<string> {
    const rawKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const saltedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations }, rawKey, 256,
    );
    const salted = new Uint8Array(saltedBits);
    const serverKey = await hmac(salted, 'Server Key');
    const sig = await hmac(serverKey, authMessage);
    return btoa(String.fromCharCode(...sig));
  }

  // Drive client through client-first + client-final, returning the pieces a
  // server needs to build a correct (or tampered) server-final.
  async function runToClientFinal(password: string) {
    const h = makeSaslClient(password);
    h.priv._saslMech = 'SCRAM-SHA-256';
    h.priv._saslPending = true;

    // Server: AUTHENTICATE + → client sends client-first.
    let prev = h.sent.length;
    h.feed('AUTHENTICATE +');
    await waitForSend(h.sent, prev);
    const clientFirstB64 = h.sent[h.sent.length - 1]!.replace(/^AUTHENTICATE /, '').replace(/\r\n$/, '');
    const clientFirst = atob(clientFirstB64); // "n,,n=kain,r=<nonce>"
    const clientFirstBare = clientFirst.replace(/^n,,/, '');
    const clientNonce = /r=([^,]*)/.exec(clientFirstBare)![1]!;

    // Server: build server-first with an appended server nonce.
    const serverNonce = clientNonce + 'SRVNONCE';
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const iterations = 4096;
    const serverFirst = `r=${serverNonce},s=${btoa(String.fromCharCode(...salt))},i=${iterations}`;

    // Client processes server-first → sends client-final.
    prev = h.sent.length;
    h.feed(`AUTHENTICATE ${btoa(serverFirst)}`);
    await waitForSend(h.sent, prev);
    const clientFinalB64 = h.sent[h.sent.length - 1]!.replace(/^AUTHENTICATE /, '').replace(/\r\n$/, '');
    const clientFinal = atob(clientFinalB64); // "c=biws,r=<sn>,p=<proof>"
    const clientFinalWithoutProof = clientFinal.replace(/,p=[^,]*$/, '');
    const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;

    return { h, password, salt, iterations, authMessage };
  }

  it('accepts a correct server-final, sets logged-in on 903, and sends NO stray +', async () => {
    const { h, password, salt, iterations, authMessage } = await runToClientFinal('s3cret');
    const goodSig = await serverSignatureB64(password, salt, iterations, authMessage);

    const before = h.sent.length;
    h.feed(`AUTHENTICATE ${btoa(`v=${goodSig}`)}`);
    // No error, and the client must not answer the server-final with anything.
    expect(h.errors).toEqual([]);
    expect(h.sent.length).toBe(before);

    // The trailing 903 completes the login.
    h.feed(':eshmaki.me 903 kain :SASL authentication successful');
    expect(h.priv._loggedIn).toBe(true);
  });

  it('fails closed on a tampered server-final and never marks logged-in', async () => {
    const { h, password, salt, iterations, authMessage } = await runToClientFinal('s3cret');
    const goodSig = await serverSignatureB64(password, salt, iterations, authMessage);
    // Flip one base64 char to corrupt the signature.
    const badSig = goodSig[0] === 'A' ? 'B' + goodSig.slice(1) : 'A' + goodSig.slice(1);

    h.feed(`AUTHENTICATE ${btoa(`v=${badSig}`)}`);
    expect(h.errors.some((e) => /SASL authentication failed/i.test(e))).toBe(true);
    expect(h.closed).toContainEqual({ code: 4003, reason: 'SASL authentication failed' });

    // Even a following (spoofed) 903 must not flip logged-in — the exchange was
    // torn down when verification failed closed.
    h.feed(':eshmaki.me 903 kain :SASL authentication successful');
    expect(h.priv._loggedIn).toBe(false);
  });
});
