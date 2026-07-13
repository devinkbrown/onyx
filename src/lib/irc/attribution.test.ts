// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * attribution.test.ts — the account-attribution controller (enroll + residence).
 *
 * Drives AccountAttribution with a fake sender and real WebCrypto/fake-IDB,
 * proving: the whole path is a NO-OP unless ISUPPORT ACCOUNTRESIDENCE was
 * advertised AND the account is known (900), the emitted signatures verify
 * against the device pubkey over the byte-exact daemon transcripts, enroll is
 * idempotent, and node-change / refresh / STALE_EPOCH re-sign correctly.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetDeviceSigningForTests,
  buildIdentityTranscript,
  buildResidenceMessage,
  deviceLabel,
  deviceSigningKeys,
} from '../e2ee/deviceSign';
import { AccountAttribution, RESIDENCE_TTL_MS, RESIDENCE_REFRESH_MS } from './attribution';
import type { IRCMessage } from './types';

const NODE = 'a1b2c3d4e5f60718';
const NODE2 = '00112233445566ff';

interface Sent { command: string; params: string[] }

function makeController(timing?: { ttlMs?: number; refreshMs?: number }) {
  const sent: Sent[] = [];
  const ctl = new AccountAttribution(
    { sendRaw: (command: string, ...params: string[]) => sent.push({ command, params }) },
    timing,
  );
  return { ctl, sent };
}

function msg(command: string, ...params: string[]): IRCMessage {
  // Server-originated shape: dotted prefix, nick === null (see parser.ts).
  return { raw: '', tags: {}, prefix: 'srv.example', nick: null, host: 'srv.example', command, params };
}

/** A USER-originated line (nick!user@host prefix) — must always be ignored. */
function userMsg(command: string, ...params: string[]): IRCMessage {
  return { raw: '', tags: {}, prefix: 'mallory!m@evil', nick: 'mallory', host: 'evil', command, params };
}

function loggedIn(ctl: AccountAttribution, account = 'kain') {
  ctl.observe(msg('900', 'kain', 'kain!u@h', account, `You are now logged in as ${account}`));
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifySig(sigHex: string, message: Uint8Array): Promise<boolean> {
  const keys = await deviceSigningKeys();
  const pub = await crypto.subtle.importKey(
    'raw',
    keys!.publicRaw.slice().buffer as ArrayBuffer,
    'Ed25519',
    true,
    ['verify'],
  );
  return crypto.subtle.verify('Ed25519', pub, fromHex(sigHex) as BufferSource, message as BufferSource);
}

/** Let any in-flight (unexpected) async work land before asserting silence. */
const settle = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceSigningForTests();
  localStorage.clear();
});

describe('gating — purely additive, off unless advertised', () => {
  it('does NOTHING when ACCOUNTRESIDENCE was never advertised', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    await settle();
    await vi.waitFor(() => expect(sent).toEqual([]), { timeout: 200 }).catch(() => {});
    expect(sent).toEqual([]);
  });

  it('does NOTHING when the account is unknown (no 900)', async () => {
    const { ctl, sent } = makeController();
    ctl.setNode(NODE);
    await settle();
    expect(sent).toEqual([]);
  });

  it('rejects a malformed ISUPPORT node token fail-closed', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    for (const bad of ['', 'xyz', 'A1B2C3D4E5F6071', '0x1122334455667788', 'a1b2c3d4e5f6071']) {
      ctl.setNode(bad);
    }
    await settle();
    expect(sent).toEqual([]);
  });

  it('does NOTHING when the device key is unavailable (fail-closed, no downgrade)', async () => {
    // @ts-expect-error — simulate no IndexedDB
    delete globalThis.indexedDB;
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toEqual([]);
  });
});

describe('enroll + residence flow', () => {
  it('sends IDENTITY ADD then IDENTITY RESIDENCE with verifiable signatures', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));

    const keys = await deviceSigningKeys();
    const label = deviceLabel(keys!.publicHex);

    // 1) IDENTITY ADD <label> <pub-hex> <sig-hex>, self-signed over the
    //    daemon's exact IDENTITY-v1 transcript.
    const add = sent[0]!;
    expect(add.command).toBe('IDENTITY');
    expect(add.params[0]).toBe('ADD');
    expect(add.params[1]).toBe(label);
    expect(add.params[2]).toBe(keys!.publicHex);
    expect(add.params[3]).toMatch(/^[0-9a-f]{128}$/);
    const transcript = buildIdentityTranscript('kain', label, keys!.publicRaw)!;
    expect(await verifySig(add.params[3]!, transcript)).toBe(true);

    // 2) IDENTITY RESIDENCE <node> <epoch> <expiry-ms> <sig-hex>, signed over
    //    the daemon's exact RESIDENCE-v1 message for those exact params.
    const res = sent[1]!;
    expect(res.command).toBe('IDENTITY');
    expect(res.params[0]).toBe('RESIDENCE');
    expect(res.params[1]).toBe(NODE);
    const epoch = Number(res.params[2]);
    const expiryMs = Number(res.params[3]);
    expect(Number.isSafeInteger(epoch)).toBe(true);
    // Daemon hard-caps the window at 1h; the client must stay inside it.
    expect(expiryMs - Date.now()).toBeGreaterThan(0);
    expect(expiryMs - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(RESIDENCE_TTL_MS).toBeLessThanOrEqual(60 * 60_000);
    expect(RESIDENCE_TTL_MS).toBeGreaterThanOrEqual(2 * RESIDENCE_REFRESH_MS);
    const message = buildResidenceMessage({ account: 'kain', nodeHex: NODE, epoch, expiryMs })!;
    expect(await verifySig(res.params[4]!, message)).toBe(true);
  });

  it('works when 900 arrives AFTER the ISUPPORT token (late passkey login)', async () => {
    const { ctl, sent } = makeController();
    ctl.setNode(NODE);
    await settle();
    expect(sent).toEqual([]);
    loggedIn(ctl);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1]!.params[0]).toBe('RESIDENCE');
  });

  it('ignores the 2-param 900 form (IRCX ERR_BADCOMMAND, not RPL_LOGGEDIN)', async () => {
    const { ctl, sent } = makeController();
    ctl.observe(msg('900', 'kain', 'Bad command'));
    ctl.setNode(NODE);
    await settle();
    expect(sent).toEqual([]);
  });
});

describe('enroll idempotence', () => {
  it('skips IDENTITY ADD once the server confirmed enrollment of this key', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    const label = sent[0]!.params[1]!;
    // Server confirms: NOTICE :IDENTITY ADDED label=<label>
    ctl.observe(msg('NOTICE', 'kain', `IDENTITY ADDED label=${label}`));

    // Fresh connection: reset + re-learn account/node → RESIDENCE only.
    ctl.reset();
    sent.length = 0;
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]!.params[0]).toBe('RESIDENCE');
  });

  it('re-enrolls when no confirmation was ever observed (server may have lost it)', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));

    ctl.reset();
    sent.length = 0;
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[0]!.params[0]).toBe('ADD'); // idempotent overwrite server-side
  });
});

describe('re-sign triggers', () => {
  it('re-signs and re-sends when the node changes (reconnect to a different node)', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    const firstEpoch = Number(sent[1]!.params[2]);

    ctl.setNode(NODE2);
    await vi.waitFor(() => expect(sent.length).toBe(3));
    const res = sent[2]!;
    expect(res.params[0]).toBe('RESIDENCE');
    expect(res.params[1]).toBe(NODE2);
    const epoch = Number(res.params[2]);
    expect(epoch).toBeGreaterThan(firstEpoch);
    const message = buildResidenceMessage({
      account: 'kain',
      nodeHex: NODE2,
      epoch,
      expiryMs: Number(res.params[3]),
    })!;
    expect(await verifySig(res.params[4]!, message)).toBe(true);
  });

  it('refreshes the proof before expiry with a strictly newer epoch — RESIDENCE only, no duplicate ADD', async () => {
    const { ctl, sent } = makeController({ ttlMs: 30_000, refreshMs: 60 });
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    ctl.stop();
    const firstEpoch = Number(sent[1]!.params[2]);
    const refreshed = sent[2]!;
    expect(refreshed.params[0]).toBe('RESIDENCE');
    expect(refreshed.params[1]).toBe(NODE);
    expect(Number(refreshed.params[2])).toBeGreaterThan(firstEpoch);
    // Exactly one ADD ever — a refresh re-signs the proof, not the enrollment.
    expect(sent.filter((s) => s.params[0] === 'ADD').length).toBe(1);
  });

  it('stop() halts refreshing (no sends after disconnect)', async () => {
    const { ctl, sent } = makeController({ ttlMs: 30_000, refreshMs: 150 });
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
    ctl.stop();
    const count = sent.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(sent.length).toBe(count);
  });

  it('retries ONCE with a bumped epoch on FAIL IDENTITY STALE_EPOCH', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    const firstEpoch = Number(sent[1]!.params[2]);

    ctl.observe(msg('FAIL', 'IDENTITY', 'STALE_EPOCH', 'Residence epoch must exceed the currently-published epoch'));
    await vi.waitFor(() => expect(sent.length).toBe(3));
    expect(Number(sent[2]!.params[2])).toBeGreaterThan(firstEpoch);

    // A second FAIL without an intervening PUBLISHED confirmation is ignored —
    // bounded retry, no ping-pong storm.
    ctl.observe(msg('FAIL', 'IDENTITY', 'STALE_EPOCH', 'still stale'));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(3);
  });
});

describe('hostile-sender rejection (server-origin gate)', () => {
  it('a USER-forged "IDENTITY ADDED" NOTICE never poisons the enrolled marker', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));
    const label = sent[0]!.params[1]!;

    // Attacker (nick!user@host prefix) forges the confirmation mid-enrollment.
    ctl.observe(userMsg('NOTICE', 'kain', `IDENTITY ADDED label=${label}`));
    expect(localStorage.getItem('onyx:attribution-enrolled:kain')).toBeNull();

    // The genuine server confirmation still lands.
    ctl.observe(msg('NOTICE', 'kain', `IDENTITY ADDED label=${label}`));
    expect(localStorage.getItem('onyx:attribution-enrolled:kain')).not.toBeNull();
  });

  it('a USER-forged FAIL STALE_EPOCH never drives an extra publish', async () => {
    const { ctl, sent } = makeController();
    loggedIn(ctl);
    ctl.setNode(NODE);
    await vi.waitFor(() => expect(sent.length).toBe(2));

    ctl.observe(userMsg('FAIL', 'IDENTITY', 'STALE_EPOCH', 'forged'));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBe(2);
  });

  it('a USER-forged 900 never sets the account (no attribution for guests)', async () => {
    const { ctl, sent } = makeController();
    ctl.observe(userMsg('900', 'kain', 'kain!u@h', 'mallory', 'You are now logged in as mallory'));
    ctl.setNode(NODE);
    await settle();
    expect(sent).toEqual([]);
  });
});
