// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * operAction is the single choke point every operator surface shares — the
 * desk, the composer's /kill and /broadcast, and any future oper control. It
 * must fail closed, because oper status here is granted by the SASL account
 * and can be revoked mid-session by a MODE -o.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from './store';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

function seed(overrides: Partial<ReturnType<typeof store.getState>> = {}) {
  const client = {
    sendRaw: vi.fn((..._args: string[]) => true),
    isupport: { CHANTYPES: '#&' },
    negotiatedCaps: new Set<string>(),
    capValues: new Map<string, string>(),
  };
  store.setState({
    ...initialState,
    client: client as never,
    connectionStatus: 'connected',
    ourNick: 'root',
    isOper: true,
    ...overrides,
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initialState, true);
});

describe('operAction — fail-closed dispatch', () => {
  it('sends the command when the session holds oper status', () => {
    const client = seed();
    store.getState().operAction('EVENT', 'BROADCAST', 'maintenance at 03:00');
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'BROADCAST', 'maintenance at 03:00');
    expect(store.getState().toasts).toHaveLength(0);
  });

  it('refuses and explains when the session is not an oper', () => {
    const client = seed({ isOper: false });
    store.getState().operAction('KILL', 'someone', 'bye');
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().toasts[0]).toMatchObject({
      variant: 'error',
      title: 'Operator access required',
    });
  });

  it('refuses while the socket is down rather than dropping the command silently', () => {
    const client = seed({ connectionStatus: 'reconnecting' });
    store.getState().operAction('REHASH');
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().toasts[0]).toMatchObject({ variant: 'error', title: 'Not connected' });
  });

  it('refuses with no client attached', () => {
    seed({ client: null });
    expect(() => store.getState().operAction('PRIVS')).not.toThrow();
    expect(store.getState().toasts[0]).toMatchObject({ variant: 'error', title: 'Not connected' });
  });

  it('stops sending the moment a MODE -o revokes the grant mid-session', () => {
    const client = seed();
    store.getState().operAction('PRIVS');
    expect(client.sendRaw).toHaveBeenCalledTimes(1);

    store.getState()._handleMessage(parseIRCMessage(':server MODE root :-o'));
    expect(store.getState().isOper).toBe(false);
    expect(store.getState().isNetworkAdmin).toBe(false);

    store.getState().operAction('PRIVS');
    expect(client.sendRaw).toHaveBeenCalledTimes(1);
  });
});

describe('oper status from the server', () => {
  it('381 grants oper status, and the admin flag only when the server says so', () => {
    seed({ isOper: false });
    store.getState()._handleMessage(
      parseIRCMessage(':server 381 root :You are now an IRC operator'),
    );
    expect(store.getState().isOper).toBe(true);
    expect(store.getState().isNetworkAdmin).toBe(false);
  });

  it('491 clears oper status — this network has no OPER command', () => {
    seed({ isOper: true, isNetworkAdmin: true });
    store.getState()._handleMessage(
      parseIRCMessage(':server 491 root :No O-lines for your host'),
    );
    expect(store.getState().isOper).toBe(false);
    expect(store.getState().isNetworkAdmin).toBe(false);
  });

  it('381 raises the admin badge when the network words the role that way', () => {
    seed({ isOper: false });
    store.getState()._handleMessage(
      parseIRCMessage(':server 381 root :You are now a Network Administrator'),
    );
    expect(store.getState().isNetworkAdmin).toBe(true);
  });
});

describe('network-admin badge is learned only from our own role', () => {
  it('promotes on our own 313 admin line', () => {
    seed({ isOper: true });
    store.getState().openWhois('root');
    store.getState()._handleMessage(
      parseIRCMessage(':server 313 root root :is a Network Administrator'),
    );
    expect(store.getState().isNetworkAdmin).toBe(true);
  });

  it('never promotes from ANOTHER oper 313 admin line', () => {
    // The badge gates admin-labelled UI, so reading someone else's role must
    // not raise it — otherwise merely opening an admin's profile would present
    // the local session as an administrator.
    seed({ isOper: true });
    store.getState().openWhois('alice');
    store.getState()._handleMessage(
      parseIRCMessage(':server 313 root alice :is a Network Administrator'),
    );
    // The copula is stripped so the badge reads as a label, not a sentence.
    expect(store.getState().whoisData.get('alice')?.operRole).toBe('Network Administrator');
    expect(store.getState().isNetworkAdmin).toBe(false);
  });

  it('leaves the badge down for a plain oper role on our own nick', () => {
    seed({ isOper: true });
    store.getState().openWhois('root');
    store.getState()._handleMessage(
      parseIRCMessage(':server 313 root root :is an IRC Operator'),
    );
    expect(store.getState().isNetworkAdmin).toBe(false);
  });
});

describe('composer oper slashes share the desk validation path', () => {
  it('maps /broadcast and /wallops onto EVENT BROADCAST', () => {
    const client = seed();
    store.getState().sendMessage('#root', '/broadcast maintenance at 03:00');
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'BROADCAST', 'maintenance at 03:00');

    store.getState().sendMessage('#root', '/wallops node restart soon');
    expect(client.sendRaw).toHaveBeenCalledWith('EVENT', 'BROADCAST', 'node restart soon');
  });

  it('refuses /kill without a reason instead of sending a bare disconnect', () => {
    const client = seed();
    store.getState().sendMessage('#root', '/kill flooder');
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().toasts[0]).toMatchObject({
      variant: 'warning',
      title: 'Operator command',
    });
  });

  it('stops a composer /kill when oper status is already gone', () => {
    const client = seed({ isOper: false });
    store.getState().sendMessage('#root', '/kill flooder Repeat flooding');
    expect(client.sendRaw).not.toHaveBeenCalled();
    expect(store.getState().toasts[0]).toMatchObject({
      variant: 'error',
      title: 'Operator access required',
    });
  });
});
