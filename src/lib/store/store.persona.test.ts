// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.persona.test.ts — TOTP + Guise persona notice parsing.
 * Server replies are plain NOTICEs from the server prefix (no nick); the
 * store folds them into structured totp/personas state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from './store';
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

const feed = (line: string) => store.getState()._handleMessage(parseIRCMessage(line));
const notice = (text: string) => feed(`:irc.eshmaki.me NOTICE kain :${text}`);

beforeEach(() => {
  store.setState({ ...initialState, ourNick: 'kain' }, true);
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
    store.setState({ ...mockClient(), totp: { status: 'pending', secret: 'X', otpauth: 'y', error: null, busy: true } });
    notice('TOTP: two-factor authentication is now ACTIVE — future logins require a code');
    const totp = store.getState().totp;
    expect(totp.status).toBe('active');
    expect(totp.secret).toBeNull();
  });

  it('STATUS + DISABLE notices map to states; FAIL surfaces an error', () => {
    store.setState(mockClient());
    notice('TOTP: two-factor authentication is active');
    expect(store.getState().totp.status).toBe('active');
    notice('TOTP: two-factor authentication disabled');
    expect(store.getState().totp.status).toBe('disabled');
    feed(':irc.eshmaki.me FAIL TOTP INVALID_CODE :Incorrect code; try the current one from your authenticator');
    expect(store.getState().totp.error).toMatch(/incorrect code/i);
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
    notice('VHOST: now wearing nightshift (night.works/kain)');
    vi.advanceTimersByTime(400);
    expect(sent.some((l) => l.includes('VHOST LIST'))).toBe(true);
    vi.useRealTimers();
  });
});
