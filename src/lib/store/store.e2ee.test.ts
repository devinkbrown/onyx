/**
 * store.e2ee.test.ts — end-to-end-encrypted DM flow through the store.
 *
 * Verifies the wire only carries ciphertext, inbound envelopes decrypt in
 * place into `plaintext` (text stays the envelope for at-rest ciphertext),
 * and an envelope from a peer whose key we lack stays locked.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';
import { parseIRCMessage } from '@/lib/irc/parser';
import type { Channel } from '@/lib/irc/types';
import {
  ENVELOPE_PREFIX,
  _resetDeviceKeysForTests,
  _resetSharedKeysForTests,
  deviceKeys,
  fromB64url,
  isEnvelope,
  toB64url,
} from '@/lib/e2ee/dmCipher';

const initialState = store.getInitialState();

/** A peer device that can seal to us, mirroring dmCipher's derivation. */
async function makePeer(myPublicB64: string) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const publicB64 = toB64url(raw);
  async function seal(plaintext: string): Promise<string> {
    const myRaw = fromB64url(myPublicB64)!;
    const myKey = await crypto.subtle.importKey('raw', myRaw.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: myKey }, kp.privateKey, 256);
    const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const pair = [publicB64, myPublicB64].sort();
    const info = new TextEncoder().encode(`onyx-dm:${pair[0]}:${pair[1]}`);
    const aes = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('onyx-dm-v1'), info },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, new TextEncoder().encode(plaintext));
    const body = new Uint8Array(12 + ct.byteLength);
    body.set(nonce, 0);
    body.set(new Uint8Array(ct), 12);
    return `${ENVELOPE_PREFIX}${toB64url(body)}`;
  }
  return { publicB64, seal };
}

function mockClient(sendRaw = vi.fn()) {
  return {
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
    isupport: { CHANTYPES: '#&' },
    prefixToMode: {},
    sendRaw,
    send: vi.fn(),
  } as never;
}

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));
const dmMsgs = (nick: string) => store.getState().dms.get(nick.toLowerCase())?.messages ?? [];

function seedChannel(name: string): void {
  const channel: Channel = {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
  store.setState({ channels: new Map([[name.toLowerCase(), channel]]) });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDeviceKeysForTests();
  _resetSharedKeysForTests();
  localStorage.clear();
  store.setState({ ...initialState, ourNick: 'me', connectionStatus: 'connected', client: mockClient() }, true);
});

afterEach(() => vi.useRealTimers());

describe('E2EE DMs', () => {
  it('seals an outgoing DM — the wire carries only ciphertext', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient(vi.fn()) });
    store.getState().client!.send = send;
    store.setState({ peerDmKeys: new Map([['trev', peer.publicB64]]) });

    store.getState().sendMessage('trev', 'meet at the quiet dock');

    await until(() => send.mock.calls.length > 0);
    const wire = String(send.mock.calls[0]![0]);
    expect(wire).toContain('PRIVMSG trev :');
    expect(wire).toContain(ENVELOPE_PREFIX);
    expect(wire).not.toContain('quiet dock'); // plaintext never on the wire

    // Local echo: ciphertext as text, plaintext for display.
    await until(() => dmMsgs('trev').length > 0);
    const echo = dmMsgs('trev')[0]!;
    expect(echo.encrypted).toBe(true);
    expect(isEnvelope(echo.text)).toBe(true);
    expect(echo.plaintext).toBe('meet at the quiet dock');
  });

  it('marks sealed outgoing DMs with Orochi E2EE tag when negotiated', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient(vi.fn()) });
    store.getState().client!.send = send;
    store.getState().client!.negotiatedCaps.add('orochi/e2ee');
    store.setState({ peerDmKeys: new Map([['trev', peer.publicB64]]) });

    store.getState().sendMessage('trev', 'sealed with a tag');

    await until(() => send.mock.calls.length > 0);
    expect(String(send.mock.calls[0]![0])).toMatch(/^@\+orochi\/e2ee=mls PRIVMSG trev :/);
    await until(() => dmMsgs('trev').length > 0);
    expect(dmMsgs('trev')[0]?.e2ee).toBe('mls');
  });

  it('stores inbound Orochi E2EE tags without locking plaintext channel messages', () => {
    seedChannel('#room');
    feed('@+orochi/e2ee=sframe;msgid=m1 :alice!u@h PRIVMSG #room :ciphertext frame');
    const msg = store.getState().channels.get('#room')?.messages.at(-1);
    expect(msg).toMatchObject({ id: 'm1', text: 'ciphertext frame', e2ee: 'sframe' });
    expect(msg?.encrypted).toBeUndefined();
  });

  it('decrypts an inbound envelope in place once the peer key is known', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);
    store.setState({ peerDmKeys: new Map([['trev', peer.publicB64]]) });

    const envelope = await peer.seal('the tide is right');
    feed(`:trev!u@h PRIVMSG me :${envelope}`);

    // Inserted immediately as ciphertext, encrypted flagged.
    const msg = () => dmMsgs('trev')[0];
    await until(() => msg() !== undefined);
    expect(msg()!.encrypted).toBe(true);
    expect(isEnvelope(msg()!.text)).toBe(true);

    // Decrypts asynchronously into plaintext; text stays the envelope.
    await until(() => msg()?.plaintext !== undefined);
    expect(msg()!.plaintext).toBe('the tide is right');
    expect(isEnvelope(msg()!.text)).toBe(true);
  });

  it('leaves an envelope locked when we have no key for the sender', async () => {
    const mine = await deviceKeys();
    const peer = await makePeer(mine!.publicB64);
    const sendRaw = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient(sendRaw) }); // no peerDmKeys

    const envelope = await peer.seal('sealed to a stranger');
    feed(`:ghost!u@h PRIVMSG me :${envelope}`);

    await until(() => dmMsgs('ghost').length > 0);
    const msg = dmMsgs('ghost')[0]!;
    expect(msg.encrypted).toBe(true);
    expect(msg.plaintext).toBeUndefined(); // stays locked
    // We asked the server for the sender's device key.
    expect(sendRaw).toHaveBeenCalledWith('METADATA', 'ghost', 'GET', 'ocean.dm-key');
  });

  it('a plaintext DM to a keyless peer is sent unencrypted', async () => {
    const send = vi.fn();
    store.setState({ connectionStatus: 'connected', client: mockClient() });
    store.getState().client!.send = send;
    const sendRaw = store.getState().client!.sendRaw as ReturnType<typeof vi.fn>;

    store.getState().sendMessage('nokey', 'plain and clear');

    // No peer key → the normal (unencrypted) path via sendRaw PRIVMSG.
    expect(sendRaw).toHaveBeenCalledWith('PRIVMSG', 'nokey', 'plain and clear');
    expect(send).not.toHaveBeenCalled();
  });
});
