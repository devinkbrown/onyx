// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.account.test.ts
 *
 * Account identity / management actions (Orochi built-in services, no NickServ
 * bot). Each action sends a raw server command through the IRC client; the
 * server's reply (a standard FAIL/WARN/NOTE, a NOTICE, or a numeric) is folded
 * back into state by _handleMessage. We mock the client to capture the exact
 * raw line, and feed parsed replies through _handleMessage to assert state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetAccountReplyStateForTests, store, type Server } from './store';
import { parseIRCMessage } from '@/lib/irc/parser';
import { loadCredentials, saveCredentials } from '@/lib/credentials';

const initialState = store.getInitialState();

/** Minimal IRCClient stand-in — we only assert on sendRaw calls here. The
 *  message handler reads client.isupport.CHANTYPES, so provide a stub. */
function makeClient() {
  return {
    sendRaw: vi.fn(),
    updateResumeTokens: vi.fn(),
    clearResumeTokens: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
  };
}

/** Seed a logged-in server identity so owner-gated actions can run. */
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

/** Feed a raw IRC line through the store's message handler. */
function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function seedAccountBoundState(): void {
  store.setState({
    accountInfo: {
      account: 'alice',
      email: 'alice@example.net',
      fetchedAt: new Date(),
    },
    accountInfoPending: true,
    passkeyBusy: true,
    passkeyError: 'alice error',
    passkeyNotice: 'alice notice',
    passkeyCreds: [{
      id: 'alice-credential',
      label: 'Alice laptop',
      signCount: 1,
      createdAt: null,
    }],
    passkeyListPending: true,
    totp: {
      status: 'pending',
      secret: 'ALICESECRET',
      otpauth: 'otpauth://totp/Onyx:alice?secret=ALICESECRET',
      error: 'alice error',
      busy: true,
    },
    personas: [{ name: 'alice', host: 'alice.example', source: 'grant' }],
    personaOffers: [{ template: '*.example', label: 'Alice offer' }],
  });
}

function expectAccountBoundStateCleared(): void {
  const state = store.getState();
  expect(state.accountInfo).toBeNull();
  expect(state.accountInfoPending).toBe(false);
  expect(state.passkeyBusy).toBe(false);
  expect(state.passkeyError).toBeNull();
  expect(state.passkeyNotice).toBeNull();
  expect(state.passkeyCreds).toEqual([]);
  expect(state.passkeyListPending).toBe(false);
  expect(state.totp).toEqual({
    status: 'unknown',
    secret: null,
    otpauth: null,
    error: null,
    busy: false,
  });
  expect(state.personas).toEqual([]);
  expect(state.personaOffers).toEqual([]);
}

beforeEach(() => {
  localStorage.clear();
  store.setState(initialState, true);
  _resetAccountReplyStateForTests();
});

describe('SESSION token persistence — server NOTICE compatibility', () => {
  it('persists and activates a local token from NOTICE SESSION TOKEN', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':eshmaki.me NOTICE alice :SESSION TOKEN local-token');

    expect(loadCredentials()?.sessionToken).toBe('local-token');
    expect(client.updateResumeTokens).toHaveBeenCalledWith({ sessionToken: 'local-token' });
  });

  it('persists and activates a mesh token from NOTICE SESSION MTOKEN', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':eshmaki.me NOTICE alice :SESSION MTOKEN mesh-token');

    expect(loadCredentials()?.meshToken).toBe('mesh-token');
    expect(client.updateResumeTokens).toHaveBeenCalledWith({ meshToken: 'mesh-token' });
  });

  it('keeps live token rotation scoped to the connected identity when another identity is active', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'alice-pw' });
    saveCredentials({ nick: 'bob', server: 'wss://other.example', password: 'bob-pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':eshmaki.me NOTICE alice :SESSION TOKEN alice-local');
    feed(':eshmaki.me NOTICE alice :SESSION MTOKEN alice-mesh');

    expect(loadCredentials('wss://eshmaki.me', 'alice')).toMatchObject({
      sessionToken: 'alice-local',
      meshToken: 'alice-mesh',
    });
    const bob = loadCredentials('wss://other.example', 'bob');
    expect(bob).toMatchObject({ password: 'bob-pw' });
    expect(bob?.sessionToken).toBeUndefined();
    expect(bob?.meshToken).toBeUndefined();
  });

  it('keeps NOTE token rotation on the newly identified account without re-keying the previous account', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'alice-pw' });
    saveCredentials({ nick: 'bob', server: 'wss://eshmaki.me', password: 'bob-pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':eshmaki.me NOTE SESSION TOKEN :bob-local');

    expect(loadCredentials('wss://eshmaki.me', 'alice')).toMatchObject({
      nick: 'alice',
      password: 'alice-pw',
    });
    expect(loadCredentials('wss://eshmaki.me', 'bob')).toMatchObject({
      nick: 'bob',
      password: 'bob-pw',
      sessionToken: 'bob-local',
    });
  });

  it('keeps NOTICE token rotation on the newly identified account after logout', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'alice-pw' });
    saveCredentials({ nick: 'bob', server: 'wss://eshmaki.me', password: 'bob-pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':eshmaki.me NOTICE alice :You are now logged out.');
    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':eshmaki.me NOTICE alice :SESSION TOKEN bob-local');

    expect(loadCredentials('wss://eshmaki.me', 'alice')).toMatchObject({
      nick: 'alice',
      password: 'alice-pw',
    });
    expect(loadCredentials('wss://eshmaki.me', 'bob')).toMatchObject({
      nick: 'bob',
      password: 'bob-pw',
      sessionToken: 'bob-local',
    });
  });

  it('does not create a newly identified account from another account credentials', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'alice-pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':eshmaki.me NOTICE alice :SESSION TOKEN bob-local');

    expect(loadCredentials('wss://eshmaki.me', 'alice')).toMatchObject({
      nick: 'alice',
      password: 'alice-pw',
    });
    expect(loadCredentials('wss://eshmaki.me', 'bob')).toBeNull();
    expect(client.updateResumeTokens).toHaveBeenCalledWith({ sessionToken: 'bob-local' });
  });

  it('ignores a peer NOTICE that impersonates a SESSION token reply', () => {
    const client = makeClient();
    saveCredentials({ nick: 'alice', server: 'wss://eshmaki.me', password: 'pw' });
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      ourNick: 'alice',
    });

    feed(':mallory!u@host NOTICE alice :SESSION TOKEN attacker-token');

    expect(loadCredentials()?.sessionToken).toBeUndefined();
    expect(client.updateResumeTokens).not.toHaveBeenCalled();
  });
});

describe('account actions — raw command dispatch', () => {
  it('identify() sends IDENTIFY <account> <password> and clears prior error', () => {
    const client = makeClient();
    store.setState({ client: client as never, accountActionError: { command: 'DROP', code: 'X', description: 'x' } });

    store.getState().identify('alice', 'hunter2');

    expect(client.sendRaw).toHaveBeenCalledWith('IDENTIFY', 'alice', 'hunter2');
    expect(store.getState().accountActionError).toBeNull();
  });

  it('identify() is a no-op without a client, account, or password', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().identify('', 'pw');
    store.getState().identify('alice', '');
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('logout() sends LOGOUT', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().logout();
    expect(client.sendRaw).toHaveBeenCalledWith('LOGOUT');
  });

  it('accountInfo_fetch() sends ACCOUNTINFO with no arg for own account', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().accountInfo_fetch();
    expect(client.sendRaw).toHaveBeenCalledWith('ACCOUNTINFO');
    expect(store.getState().accountInfoPending).toBe(true);
  });

  it('accountInfo_fetch(account) sends ACCOUNTINFO <account>', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().accountInfo_fetch('bob');
    expect(client.sendRaw).toHaveBeenCalledWith('ACCOUNTINFO', 'bob');
  });

  it('accountSet() sends ACCOUNTSET <account> <password> <field> <value>', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    store.getState().accountSet('email', 'alice@example.net', 'hunter2');
    expect(client.sendRaw).toHaveBeenCalledWith(
      'ACCOUNTSET', 'alice', 'hunter2', 'email', 'alice@example.net',
    );
  });

  it('accountSet() is a no-op when not logged in', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer(null) });
    store.getState().accountSet('secure', 'on', 'pw');
    expect(client.sendRaw).not.toHaveBeenCalled();
  });

  it('recover() sends RECOVER <nick> with and without a password', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().recover('alice');
    expect(client.sendRaw).toHaveBeenCalledWith('RECOVER', 'alice');
    store.getState().recover('alice', 'pw');
    expect(client.sendRaw).toHaveBeenCalledWith('RECOVER', 'alice', 'pw');
  });

  it('dropAccount() sends DROP <account> <password>', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().dropAccount('alice', 'hunter2');
    expect(client.sendRaw).toHaveBeenCalledWith('DROP', 'alice', 'hunter2');
  });

  it('E2EEKEY actions dispatch account device-key commands', () => {
    const client = makeClient();
    store.setState({ client: client as never });

    store.getState().e2eeKeyStatus();
    store.getState().e2eeKeyList();
    store.getState().e2eeKeyList('alice');
    store.getState().e2eeKeyAdd('laptop', 'mls-x25519', 'abcd+/=');
    store.getState().e2eeKeyDelete('laptop');
    store.getState().e2eeKeyAdd('bad device', 'mls-x25519', 'abcd+/=');

    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'E2EEKEY', 'STATUS');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'E2EEKEY', 'LIST');
    expect(client.sendRaw).toHaveBeenNthCalledWith(3, 'E2EEKEY', 'LIST', 'alice');
    expect(client.sendRaw).toHaveBeenNthCalledWith(4, 'E2EEKEY', 'ADD', 'laptop', 'mls-x25519', 'abcd+/=');
    expect(client.sendRaw).toHaveBeenNthCalledWith(5, 'E2EEKEY', 'DEL', 'laptop');
    expect(client.sendRaw).toHaveBeenCalledTimes(5);
  });

  it('KEYTRANS actions dispatch transparency commands', () => {
    const client = makeClient();
    store.setState({ client: client as never });

    store.getState().keyTransparencyStatus();
    store.getState().keyTransparencyProof(42);
    store.getState().keyTransparencyProof(-1);

    expect(client.sendRaw).toHaveBeenNthCalledWith(1, 'KEYTRANS', 'STATUS');
    expect(client.sendRaw).toHaveBeenNthCalledWith(2, 'KEYTRANS', 'PROOF', '42');
    expect(client.sendRaw).toHaveBeenCalledTimes(2);
  });
});

describe('account replies — state from the message handler', () => {
  it('ACCOUNTINFO NOTICE populates structured accountInfo', () => {
    store.setState({ client: makeClient() as never, server: seedServer('alice') });
    store.getState().accountInfo_fetch();
    feed(':eshmaki.me NOTICE alice :account=alice flags=8 email=alice@example.net secure=on enforce=off');

    const info = store.getState().accountInfo;
    expect(info).toMatchObject({
      account: 'alice',
      flags: 8,
      email: 'alice@example.net',
      secure: true,
      enforce: false,
    });
    expect(store.getState().accountInfoPending).toBe(false);
  });

  it('a NOTE ACCOUNTINFO standard reply also populates accountInfo', () => {
    store.setState({ client: makeClient() as never, server: seedServer('bob') });
    store.getState().accountInfo_fetch();
    feed(':eshmaki.me NOTE ACCOUNTINFO :account=bob flags=2');
    expect(store.getState().accountInfo).toMatchObject({ account: 'bob', flags: 2 });
    expect(store.getState().accountInfoPending).toBe(false);
  });

  it('FAIL ACCOUNTSET surfaces accountActionError and a notification', () => {
    store.setState({ server: seedServer('alice') });
    feed(':eshmaki.me FAIL ACCOUNTSET INVALID_VALUE :Bad value for secure');

    expect(store.getState().accountActionError).toMatchObject({
      command: 'ACCOUNTSET',
      code: 'INVALID_VALUE',
    });
    const notes = store.getState().notifications;
    expect(notes[notes.length - 1]).toMatchObject({ type: 'error' });
  });

  it('FAIL IDENTIFY surfaces accountActionError', () => {
    feed(':eshmaki.me FAIL IDENTIFY TEMPORARILY_UNAVAILABLE :try later');
    expect(store.getState().accountActionError).toMatchObject({
      command: 'IDENTIFY',
      code: 'TEMPORARILY_UNAVAILABLE',
    });
  });

  it('FAIL E2EEKEY surfaces accountActionError', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    store.getState().e2eeKeyAdd('laptop', 'tsumugi-p256', 'public-key');
    feed(':eshmaki.me FAIL E2EEKEY BAD_DEVICE :Device id must use safe characters');
    expect(store.getState().accountActionError).toMatchObject({
      command: 'E2EEKEY',
      code: 'BAD_DEVICE',
    });
  });

  it('rejects late Alice E2EEKEY notices and failures after switching to Bob', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    store.getState().e2eeKeyStatus();

    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':eshmaki.me NOTICE alice :E2EEKEY STATUS account=alice devices=1');
    feed(':eshmaki.me FAIL E2EEKEY BAD_DEVICE :Alice device failed');

    expect(store.getState().server?.account).toBe('bob');
    expect(store.getState().accountActionError).toBeNull();
    expect(store.getState().serviceNotices).not.toContainEqual(expect.objectContaining({
      text: expect.stringContaining('account=alice'),
    }));

    store.getState().e2eeKeyStatus();
    feed(':eshmaki.me NOTICE alice :E2EEKEY STATUS account=bob devices=2');
    expect(store.getState().serviceNotices.at(-1)).toMatchObject({
      source: 'Account',
      text: 'E2EEKEY STATUS account=bob devices=2',
    });
  });

  it('rejects late Alice KEYTRANS and CERT notices after switching to Bob', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    store.getState().keyTransparencyStatus();
    store.getState().certList();

    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':eshmaki.me NOTICE alice :KEYTRANS STATUS account=alice entries=1 root=alice-root');
    feed(':eshmaki.me NOTICE alice :CERTLIST SHA256:alice-fingerprint');
    feed(':eshmaki.me FAIL CERTLIST UNAVAILABLE :Alice certificate lookup failed');

    expect(store.getState().serviceNotices).not.toContainEqual(expect.objectContaining({
      text: expect.stringMatching(/alice-root|alice-fingerprint|Alice certificate lookup failed/),
    }));

    store.getState().keyTransparencyStatus();
    feed(':eshmaki.me NOTICE alice :KEYTRANS STATUS account=bob entries=2 root=bob-root');
    store.getState().certList();
    feed(':eshmaki.me NOTICE alice :CERTLIST SHA256:bob-fingerprint');

    expect(store.getState().serviceNotices.map((notice) => notice.text)).toEqual([
      'KEYTRANS STATUS account=bob entries=2 root=bob-root',
      'CERTLIST SHA256:bob-fingerprint',
    ]);
  });

  it('rejects peer notices impersonating account security replies', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    store.getState().e2eeKeyStatus();

    feed(':mallory!m@evil NOTICE alice :E2EEKEY STATUS account=alice devices=99');
    feed(':mallory!m@evil NOTICE alice :KEYTRANS STATUS account=alice entries=99 root=evil');
    feed(':mallory!m@evil NOTICE alice :CERTLIST SHA256:evil-fingerprint');

    expect(store.getState().serviceNotices).toEqual([]);
  });

  it('a logout confirmation NOTICE clears account + accountInfo', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      server: seedServer('alice'),
    });
    seedAccountBoundState();
    feed(':eshmaki.me NOTICE alice :You are now logged out.');

    expect(store.getState().server?.account).toBeNull();
    expectAccountBoundStateCleared();
    expect(client.clearResumeTokens).toHaveBeenCalledOnce();
  });

  it('901 RPL_LOGGEDOUT clears the server account', () => {
    store.setState({ server: seedServer('alice') });
    seedAccountBoundState();
    feed(':eshmaki.me 901 alice alice!u@h :You are now logged out');
    expect(store.getState().server?.account).toBeNull();
    expectAccountBoundStateCleared();
  });

  it('does NOT clear the account from a peer PM mentioning "logged out"', () => {
    store.setState({ server: seedServer('alice') });
    feed(':mallory!m@evil NOTICE alice :hey you got logged out lol');
    expect(store.getState().server?.account).toBe('alice');
  });

  it('does NOT clear the account from an unrelated server notice containing "drop"', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      accountInfo: { account: 'alice', fetchedAt: new Date() },
    });

    feed(':eshmaki.me NOTICE alice :Drop by #support if you need help.');

    expect(store.getState().server?.account).toBe('alice');
    expect(store.getState().accountInfo?.account).toBe('alice');
    expect(client.clearResumeTokens).not.toHaveBeenCalled();
  });

  it('does NOT clear the account from an unrelated server notice containing "logout"', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      server: seedServer('alice'),
      accountInfo: { account: 'alice', fetchedAt: new Date() },
    });

    feed(':eshmaki.me NOTICE alice :Logout maintenance begins at 02:00 UTC.');

    expect(store.getState().server?.account).toBe('alice');
    expect(store.getState().accountInfo?.account).toBe('alice');
    expect(client.clearResumeTokens).not.toHaveBeenCalled();
  });

  it('900 RPL_LOGGEDIN sets the server account (IDENTIFY success path)', () => {
    store.setState({ server: seedServer(null) });
    feed(':eshmaki.me 900 alice alice!u@h alice :You are now logged in as alice');
    expect(store.getState().server?.account).toBe('alice');
  });

  it('clears account-bound presentation when 900 switches Alice to Bob', () => {
    store.setState({ server: seedServer('alice'), ourNick: 'alice' });
    seedAccountBoundState();

    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');

    expect(store.getState().server?.account).toBe('bob');
    expectAccountBoundStateCleared();
  });

  it('ignores an Alice ACCOUNTINFO reply after the live account switches to Bob', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice'), ourNick: 'alice' });
    store.getState().accountInfo_fetch();

    feed(':eshmaki.me 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':eshmaki.me NOTICE alice :account=alice flags=8 email=alice@example.net secure=on enforce=off');

    expect(store.getState().server?.account).toBe('bob');
    expect(store.getState().accountInfo).toBeNull();

    store.getState().accountInfo_fetch();
    feed(':eshmaki.me NOTICE alice :account=bob flags=2 email=bob@example.net secure=off enforce=on');
    expect(store.getState().accountInfo).toMatchObject({
      account: 'bob',
      email: 'bob@example.net',
    });
  });

  it('accepts ACCOUNTINFO only for the exact requested account', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('bob'), ourNick: 'alice' });
    store.getState().accountInfo_fetch();

    feed(':eshmaki.me NOTICE alice :account=alice flags=8 email=alice@example.net');
    expect(store.getState().accountInfo).toBeNull();
    expect(store.getState().accountInfoPending).toBe(true);

    feed(':eshmaki.me NOTICE alice :account=bob flags=2 email=bob@example.net');
    expect(store.getState().accountInfo).toMatchObject({
      account: 'bob',
      email: 'bob@example.net',
    });
  });

  it('does not replace our identity when another user sends account-notify', () => {
    store.setState({ server: seedServer('alice'), ourNick: 'alice' });

    feed(':mallory!m@evil ACCOUNT *');

    expect(store.getState().server?.account).toBe('alice');
  });

  it('updates our identity from our own account-notify event', () => {
    store.setState({ server: seedServer(null), ourNick: 'alice' });

    feed(':alice!a@host ACCOUNT alice');

    expect(store.getState().server?.account).toBe('alice');
  });

  it('an ACCOUNTSET confirmation NOTICE re-fetches ACCOUNTINFO', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    feed(':eshmaki.me NOTICE alice :Secure mode enabled.');
    // The confirmation has no structured payload, so the store asks the server
    // for fresh details to reflect the new value in the panel.
    expect(client.sendRaw).toHaveBeenCalledWith('ACCOUNTINFO');
    expect(store.getState().accountActionError).toBeNull();
  });

  it('a NOTE ACCOUNTSET confirmation (no payload) re-fetches ACCOUNTINFO', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice') });
    feed(':eshmaki.me NOTE ACCOUNTSET :email updated');
    expect(client.sendRaw).toHaveBeenCalledWith('ACCOUNTINFO');
  });

  it('a DROP confirmation NOTICE clears the account', () => {
    store.setState({ server: seedServer('alice'), accountInfo: { account: 'alice', fetchedAt: new Date() } });
    feed(':eshmaki.me NOTICE alice :Account dropped.');
    expect(store.getState().server?.account).toBeNull();
    expect(store.getState().accountInfo).toBeNull();
  });
});
