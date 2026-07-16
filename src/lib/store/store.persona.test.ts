// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.persona.test.ts — TOTP + Guise persona notice parsing.
 * Server replies are plain NOTICEs from the server prefix (no nick); the
 * store folds them into structured totp/personas state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PERSONA_ENTRIES,
  MAX_PERSONA_HOST_LENGTH,
  MAX_PERSONA_LABEL_LENGTH,
  MAX_PERSONA_NAME_LENGTH,
  MAX_PERSONA_SOURCE_LENGTH,
  MAX_TOTP_SECRET_LENGTH,
  MAX_TOTP_URI_LENGTH,
  _resetAccountReplyStateForTests,
  store,
  type Server,
} from './store';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

function mockClient() {
  const sent: string[] = [];
  return {
    sent,
    client: {
      negotiatedCaps: new Set<string>(),
      capValues: new Map<string, string>(),
      isupport: {},
      sendRaw: (...parts: string[]) => sent.push(parts.join(' ')),
      send: (line: string) => sent.push(line),
    } as never,
  };
}

function seedServer(account: string | null): Server {
  return {
    id: 'ircxnet',
    name: 'eshmaki.me',
    network: 'IRCXNet',
    url: 'wss://eshmaki.me',
    icon: '#000',
    nick: account ?? 'guest',
    account,
    connected: true,
  };
}

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));
const notice = (text: string) => feed(`:irc.eshmaki.me NOTICE kain :${text}`);

beforeEach(() => {
  store.setState({ ...initialState, ourNick: 'kain' }, true);
  _resetAccountReplyStateForTests();
});

describe('TOTP notices', () => {
  it('captures secret + otpauth during enrollment and flips to pending', () => {
    const { client, sent } = mockClient();
    store.setState({ client });
    store.getState().totpEnroll();
    expect(sent.some((l) => l.includes('TOTP ENROLL'))).toBe(true);
    expect(store.getState().totp.busy).toBe(true);

    notice('TOTP: add this to your authenticator, then run TOTP CONFIRM <code>');
    notice('TOTP: secret JBSWY3DPEHPK3PXP');
    notice('TOTP: otpauth://totp/irc.eshmaki.me:kain?secret=JBSWY3DPEHPK3PXP&issuer=irc.eshmaki.me&algorithm=SHA1&digits=6&period=30');

    const totp = store.getState().totp;
    expect(totp.busy).toBe(false);
    expect(totp.status).toBe('pending');
    expect(totp.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(totp.otpauth).toContain('otpauth://totp/');
  });

  it('activation clears the secret and marks active', () => {
    const { client } = mockClient();
    store.setState({ client, totp: { status: 'pending', secret: 'X', otpauth: 'y', error: null, busy: true } });
    store.getState().totpConfirm('123456');
    notice('TOTP: two-factor authentication is now ACTIVE — future logins require a code');
    const totp = store.getState().totp;
    expect(totp.status).toBe('active');
    expect(totp.secret).toBeNull();
  });

  it('STATUS + DISABLE notices map to states; FAIL surfaces an error', () => {
    const { client } = mockClient();
    store.setState({ client });
    store.getState().totpStatus();
    notice('TOTP: two-factor authentication is active');
    expect(store.getState().totp.status).toBe('active');
    store.getState().totpDisable();
    notice('TOTP: two-factor authentication disabled');
    expect(store.getState().totp.status).toBe('disabled');
    store.getState().totpConfirm('000000');
    feed(':irc.eshmaki.me FAIL TOTP INVALID_CODE :Incorrect code; try the current one from your authenticator');
    expect(store.getState().totp.error).toMatch(/incorrect code/i);
  });

  it('rejects late Alice notices after 900 switches the live account to Bob', () => {
    const { client } = mockClient();
    store.setState({ client, server: seedServer('alice') });
    store.getState().totpStatus();

    feed(':irc.eshmaki.me 900 kain kain!u@h bob :You are now logged in as bob');
    notice('TOTP: secret ALICESECRET');
    notice('TOTP: enrollment pending for alice');

    expect(store.getState().server?.account).toBe('bob');
    expect(store.getState().totp).toEqual({
      status: 'unknown',
      secret: null,
      otpauth: null,
      error: null,
      busy: false,
    });

    store.getState().totpStatus();
    notice('TOTP: two-factor authentication is active');
    expect(store.getState().totp.status).toBe('active');
  });

  it('rejects a reply owned by a superseded client for the same account', () => {
    const oldClient = mockClient().client;
    const newClient = mockClient().client;
    store.setState({ client: oldClient, server: seedServer('alice') });
    store.getState().totpStatus();

    store.setState({ client: newClient });
    notice('TOTP: two-factor authentication is active');
    expect(store.getState().totp.status).toBe('unknown');

    store.getState().totpStatus();
    notice('TOTP: two-factor authentication is active');
    expect(store.getState().totp.status).toBe('active');
  });

  it('rejects malformed confirmation codes and oversized enrollment secrets', () => {
    const { client, sent } = mockClient();
    store.setState({ client });

    for (const code of ['', '12345', '1234567', '12345x', '１２３４５６']) {
      store.getState().totpConfirm(code);
    }
    expect(sent).toEqual([]);

    store.getState().totpEnroll();
    notice(`TOTP: secret ${'A'.repeat(MAX_TOTP_SECRET_LENGTH + 1)}`);
    notice(`TOTP: otpauth://${'a'.repeat(MAX_TOTP_URI_LENGTH)}`);
    expect(store.getState().totp.secret).toBeNull();
    expect(store.getState().totp.otpauth).toBeNull();
  });
});

describe('VHOST wardrobe notices', () => {
  it('vhostList clears then accumulates personas and offers', () => {
    const { client, sent } = mockClient();
    store.setState({
      client,
      personas: [{ name: 'stale', host: 'x', source: 'granted' }],
    });
    store.getState().vhostList();
    expect(sent.some((l) => l.includes('VHOST LIST'))).toBe(true);
    expect(store.getState().personas).toEqual([]);

    notice('VHOST persona nightshift = night.works/kain (granted)');
    notice('VHOST persona poet = poets.society/kain (claimed)');
    notice('VHOST offer poets.society/* :for the verse-inclined');
    notice('VHOST: USE <name> to wear a persona, CLAIM <host> for an offer, REQUEST <host> to ask');

    const s = store.getState();
    expect(s.personas.map((p) => p.name)).toEqual(['nightshift', 'poet']);
    expect(s.personas[0]).toEqual({ name: 'nightshift', host: 'night.works/kain', source: 'granted' });
    expect(s.personaOffers).toEqual([{ template: 'poets.society/*', label: 'for the verse-inclined' }]);
  });

  it('a wear confirmation triggers a wardrobe refresh', () => {
    vi.useFakeTimers();
    const { client, sent } = mockClient();
    store.setState({ client });
    store.getState().vhostUse('nightshift');
    notice('VHOST: now wearing nightshift (night.works/kain)');
    vi.advanceTimersByTime(400);
    expect(sent.some((l) => l.includes('VHOST LIST'))).toBe(true);
    vi.useRealTimers();
  });

  it('rejects late Alice wardrobe rows after 900 switches the live account to Bob', () => {
    const { client } = mockClient();
    store.setState({ client, server: seedServer('alice') });
    store.getState().vhostList();

    feed(':irc.eshmaki.me 900 kain kain!u@h bob :You are now logged in as bob');
    notice('VHOST persona alice-night = alice.example (granted)');
    notice('VHOST offer alice.example/* :Alice offer');

    expect(store.getState().server?.account).toBe('bob');
    expect(store.getState().personas).toEqual([]);
    expect(store.getState().personaOffers).toEqual([]);

    store.getState().vhostList();
    notice('VHOST persona bob-night = bob.example (granted)');
    expect(store.getState().personas).toEqual([
      { name: 'bob-night', host: 'bob.example', source: 'granted' },
    ]);
  });

  it('bounds and deduplicates persona and offer reply streams', () => {
    const { client } = mockClient();
    store.setState({ client });
    store.getState().vhostList();

    for (let index = 0; index < MAX_PERSONA_ENTRIES + 8; index += 1) {
      const key = index.toString().padStart(4, '0');
      notice(`VHOST persona p${key} = host${key}.example (source ${key})`);
      notice(`VHOST offer offer${key}.example/* :label ${key}`);
    }
    notice('VHOST persona P0000 = replacement.example (updated)');
    notice('VHOST offer OFFER0000.example/* :replacement');

    const state = store.getState();
    expect(state.personas).toHaveLength(MAX_PERSONA_ENTRIES);
    expect(state.personaOffers).toHaveLength(MAX_PERSONA_ENTRIES);
    expect(state.personas.at(-1)).toEqual({
      name: 'P0000',
      host: 'replacement.example',
      source: 'updated',
    });
    expect(state.personaOffers.at(-1)).toEqual({
      template: 'OFFER0000.example/*',
      label: 'replacement',
    });
  });

  it('rejects oversized persona tokens and bounds display-only labels', () => {
    const { client } = mockClient();
    store.setState({ client });
    store.getState().vhostList();

    notice(`VHOST persona ${'n'.repeat(MAX_PERSONA_NAME_LENGTH + 1)} = safe.example (grant)`);
    notice(`VHOST persona safe = ${'h'.repeat(MAX_PERSONA_HOST_LENGTH + 1)} (grant)`);
    notice(`VHOST persona bounded = bounded.example (${'s'.repeat(MAX_PERSONA_SOURCE_LENGTH + 20)})`);
    notice(`VHOST offer bounded.example/* :${'l'.repeat(MAX_PERSONA_LABEL_LENGTH + 20)}`);

    expect(store.getState().personas).toEqual([{
      name: 'bounded',
      host: 'bounded.example',
      source: 's'.repeat(MAX_PERSONA_SOURCE_LENGTH),
    }]);
    expect(store.getState().personaOffers).toEqual([{
      template: 'bounded.example/*',
      label: 'l'.repeat(MAX_PERSONA_LABEL_LENGTH),
    }]);
  });

  it('validates persona action targets before writing to the wire', () => {
    const { client, sent } = mockClient();
    store.setState({ client });

    store.getState().vhostUse('bad name');
    store.getState().vhostUse('n'.repeat(MAX_PERSONA_NAME_LENGTH + 1));
    store.getState().vhostClaim('bad host');
    store.getState().vhostClaim('h'.repeat(MAX_PERSONA_HOST_LENGTH + 1));
    expect(sent).toEqual([]);

    store.getState().vhostUse('nightshift');
    store.getState().vhostClaim('night.example/alice');
    expect(sent).toEqual(['VHOST USE nightshift', 'VHOST CLAIM night.example/alice']);
  });
});
