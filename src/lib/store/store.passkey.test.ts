// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.passkey.test.ts
 *
 * Passkey (WebAuthn) MANAGEMENT wiring — list / remove / rename — on top of the
 * existing register + sign-in ceremonies. Each action dispatches a raw
 * `WEBAUTHN …` line; the server's SUCCESS replies now ride the IRCX EVENT plane
 * (`:server EVENT <me> WEBAUTHN <SUBTYPE> …`, mirroring MEDIA presence) and the
 * EVENT handler re-dispatches them into the passkey fold-in. Errors still arrive
 * as `FAIL WEBAUTHN …` standard replies. Both are folded into state by
 * _handleMessage.
 *
 * The daemon's contract — the `<SUBTYPE> <args>` BODY is unchanged from the old
 * NOTE form; only the ENVELOPE moved from `NOTE WEBAUTHN …` to `EVENT <me>
 * WEBAUTHN …`:
 *   LIST   → `EVENT <me> WEBAUTHN CRED <credId> <sign_count> [<created_unix>] :<label>` (0..n)
 *            then `EVENT <me> WEBAUTHN LIST :end (<n>)`
 *   REMOVE → `EVENT <me> WEBAUTHN REMOVED :<target>`
 *   RENAME → `EVENT <me> WEBAUTHN RENAMED <credId> :<label>`  (daemon gap — see report)
 *   probe failure → `FAIL WEBAUTHN TEMPORARILY_UNAVAILABLE :…`  (still a FAIL)
 *
 * We mock the client to capture the exact raw line and feed parsed replies to
 * assert state — never a smoke "did not throw".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store, _resetPasskeyStateForTests, type Server } from './store';
import { parseIRCMessage } from '@/lib/irc/parser';

// navigator.credentials must look present so isPasskeySupported() is true in the
// jsdom environment (list/remove/rename gate on it before touching the wire).
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PublicKeyCredential', function () {} as unknown);
  vi.stubGlobal('navigator', { credentials: { create: vi.fn(), get: vi.fn() } } as unknown);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const initialState = store.getInitialState();

function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
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

beforeEach(() => {
  store.setState(initialState, true);
  _resetPasskeyStateForTests();
});

describe('listPasskeys()', () => {
  it('sends WEBAUTHN LIST and marks the list pending', () => {
    const client = makeClient();
    store.setState({ client: client as never });

    store.getState().listPasskeys();

    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'LIST');
    expect(store.getState().passkeyListPending).toBe(true);
  });

  it('is a no-op without a client', () => {
    store.getState().listPasskeys();
    expect(store.getState().passkeyListPending).toBe(false);
  });

  it('resolves unsupported when the browser lacks WebAuthn', () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    const client = makeClient();
    store.setState({ client: client as never });

    store.getState().listPasskeys();

    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().passkeySupported).toBe(false);
  });
});

describe('WEBAUTHN LIST reply fold-in (EVENT plane)', () => {
  it('accumulates CRED rows and commits them on LIST end (supported=true)', () => {
    store.setState({ client: makeClient() as never });
    store.getState().listPasskeys();

    feed(':srv EVENT me WEBAUTHN CRED credAAA 7 :My laptop');
    feed(':srv EVENT me WEBAUTHN CRED credBBB 0 :');
    // Not committed until the terminating LIST line arrives.
    expect(store.getState().passkeyCreds).toHaveLength(0);

    feed(':srv EVENT me WEBAUTHN LIST :end (2)');

    const creds = store.getState().passkeyCreds;
    expect(creds).toHaveLength(2);
    expect(creds[0]).toMatchObject({ id: 'credAAA', label: 'My laptop', signCount: 7 });
    expect(creds[1]).toMatchObject({ id: 'credBBB', label: '', signCount: 0 });
    expect(store.getState().passkeyListPending).toBe(false);
    expect(store.getState().passkeySupported).toBe(true);
  });

  it('parses an optional created_unix column when the server sends it', () => {
    store.setState({ client: makeClient() as never });
    store.getState().listPasskeys();
    feed(':srv EVENT me WEBAUTHN CRED credAAA 3 1700000000 :phone');
    feed(':srv EVENT me WEBAUTHN LIST :end (1)');
    expect(store.getState().passkeyCreds[0]).toMatchObject({
      id: 'credAAA',
      signCount: 3,
      createdAt: 1700000000,
    });
  });

  it('commits an empty list (no CRED rows) as supported with zero creds', () => {
    store.setState({ client: makeClient() as never });
    store.getState().listPasskeys();
    feed(':srv EVENT me WEBAUTHN LIST :end (0)');
    expect(store.getState().passkeyCreds).toHaveLength(0);
    expect(store.getState().passkeySupported).toBe(true);
    expect(store.getState().passkeyListPending).toBe(false);
  });

  it('rejects a late Alice list after 900 switches the live account to Bob', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice'), ourNick: 'alice' });
    store.getState().listPasskeys();
    feed(':srv EVENT alice WEBAUTHN CRED alice-cred 7 :Alice laptop');

    feed(':srv 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':srv EVENT alice WEBAUTHN LIST :end (1)');

    expect(store.getState().server?.account).toBe('bob');
    expect(store.getState().passkeyCreds).toEqual([]);
    expect(store.getState().passkeyListPending).toBe(false);

    store.getState().listPasskeys();
    feed(':srv EVENT alice WEBAUTHN CRED bob-cred 2 :Bob phone');
    feed(':srv EVENT alice WEBAUTHN LIST :end (1)');
    expect(store.getState().passkeyCreds).toMatchObject([
      { id: 'bob-cred', label: 'Bob phone' },
    ]);
  });

  it('rejects a late Alice management reply after the live account switches to Bob', () => {
    const client = makeClient();
    store.setState({ client: client as never, server: seedServer('alice'), ourNick: 'alice' });
    store.getState().registerPasskey('Alice laptop');

    feed(':srv 900 alice alice!u@h bob :You are now logged in as bob');
    feed(':srv EVENT alice WEBAUTHN REGISTERED alice-cred :Alice laptop');

    expect(store.getState().server?.account).toBe('bob');
    expect(store.getState().passkeyNotice).toBeNull();
    expect(client.sendRaw).not.toHaveBeenCalledWith('WEBAUTHN', 'LIST');
  });
});

describe('EVENT-plane envelope routing', () => {
  it('routes a WEBAUTHN EVENT into the fold-in regardless of the <me> target token', () => {
    store.setState({ client: makeClient() as never });
    store.getState().listPasskeys();
    // The re-dispatch drops the target token, so a server-chosen nick still folds.
    feed(':srv EVENT SomeNick WEBAUTHN CRED credAAA 4 :desk');
    feed(':srv EVENT SomeNick WEBAUTHN LIST :end (1)');
    expect(store.getState().passkeyCreds).toMatchObject([{ id: 'credAAA', signCount: 4 }]);
  });

  it('marks the feature supported on a bare STATUS event', () => {
    store.setState({ client: makeClient() as never });
    expect(store.getState().passkeySupported).toBeNull(); // unknown before any reply
    feed(':srv EVENT me WEBAUTHN STATUS');
    expect(store.getState().passkeySupported).toBe(true);
  });

  it('ignores a non-WEBAUTHN, non-MEDIA EVENT plane without touching passkey state', () => {
    store.setState({ client: makeClient() as never });
    feed(':srv EVENT me OTHER SOMETHING :x');
    expect(store.getState().passkeyCreds).toHaveLength(0);
    expect(store.getState().passkeyError).toBeNull();
  });
});

describe('removePasskey()', () => {
  it('sends WEBAUTHN REMOVE <id> and drops the row on REMOVED', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      passkeyCreds: [
        { id: 'credAAA', label: 'laptop', signCount: 1, createdAt: null },
        { id: 'credBBB', label: 'phone', signCount: 2, createdAt: null },
      ],
    });

    store.getState().removePasskey('credAAA');
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'REMOVE', 'credAAA');
    expect(store.getState().passkeyBusy).toBe(true);

    feed(':srv EVENT me WEBAUTHN REMOVED :credAAA');
    const creds = store.getState().passkeyCreds;
    expect(creds.map((c) => c.id)).toEqual(['credBBB']);
    expect(store.getState().passkeyBusy).toBe(false);
    expect(store.getState().passkeyNotice).toBeTruthy();
  });

  it('is a no-op with an empty target', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().removePasskey('   ');
    expect(client.sendRaw).not.toHaveBeenCalled();
  });
});

describe('renamePasskey()', () => {
  it('sends WEBAUTHN RENAME <id> :<label> and updates the row on RENAMED', () => {
    const client = makeClient();
    store.setState({
      client: client as never,
      passkeyCreds: [{ id: 'credAAA', label: 'old', signCount: 1, createdAt: null }],
    });

    store.getState().renamePasskey('credAAA', 'work laptop');
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'RENAME', 'credAAA', 'work laptop');

    feed(':srv EVENT me WEBAUTHN RENAMED credAAA :work laptop');
    expect(store.getState().passkeyCreds[0]).toMatchObject({ id: 'credAAA', label: 'work laptop' });
    expect(store.getState().passkeyBusy).toBe(false);
  });

  it('marks rename unsupported when the server rejects the subcommand', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().renamePasskey('credAAA', 'x');
    feed(':srv FAIL WEBAUTHN INVALID_SUBCOMMAND :Usage: WEBAUTHN <REGISTER|…>');
    expect(store.getState().passkeyRenameUnsupported).toBe(true);
    expect(store.getState().passkeyBusy).toBe(false);
    expect(store.getState().passkeyError).toBeTruthy();
  });
});

describe('support probe fail-closed', () => {
  it('resolves unsupported on FAIL WEBAUTHN TEMPORARILY_UNAVAILABLE', () => {
    store.setState({ client: makeClient() as never });
    store.getState().listPasskeys();
    feed(':srv FAIL WEBAUTHN TEMPORARILY_UNAVAILABLE :Accounts are unavailable');
    expect(store.getState().passkeySupported).toBe(false);
    expect(store.getState().passkeyListPending).toBe(false);
  });

  it('keeps supported=true for an ordinary FAIL (feature present, action failed)', () => {
    store.setState({ client: makeClient() as never, passkeySupported: true });
    store.getState().removePasskey('credAAA');
    feed(':srv FAIL WEBAUTHN NO_CREDENTIAL :No such passkey');
    expect(store.getState().passkeySupported).toBe(true);
    expect(store.getState().passkeyError).toBeTruthy();
  });
});

describe('REGISTERED refreshes the list', () => {
  it('re-lists after a successful registration so the new key appears', () => {
    const client = makeClient();
    store.setState({ client: client as never });
    store.getState().registerPasskey('My key');
    feed(':srv EVENT me WEBAUTHN REGISTERED credNEW :My key');
    expect(client.sendRaw).toHaveBeenCalledWith('WEBAUTHN', 'LIST');
    expect(store.getState().passkeyNotice).toBeTruthy();
  });
});
