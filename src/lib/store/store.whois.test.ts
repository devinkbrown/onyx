// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.whois.test.ts — the WHOIS numerics that fold into `whoisData`.
 *
 * `store.channel.test.ts` already pins the multi-line 319 merge and the 320
 * accumulation. This file covers the rest of the reply set (276 certfp, 301
 * away, 335 bot, 671 secure) plus the two properties that matter more than any
 * single field: every patch is scoped to the WHOIS the user actually opened,
 * and the repeatable numerics are BOUNDED, since a remote server chooses both
 * how many lines arrive and how long each one is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  store,
  WHOIS_REQUEST_TIMEOUT_MS,
  WHOIS_TIMEOUT_ERROR,
  _resetWhoisRequestTimerForTests,
} from './store';
import { parseIRCMessage } from '@/lib/irc/parser';

const initialState = store.getInitialState();

function seed() {
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
  }, true);
  return client;
}

function feed(line: string) {
  store.getState()._handleMessage(parseIRCMessage(line));
}

beforeEach(() => {
  _resetWhoisRequestTimerForTests();
  store.setState(initialState, true);
});

describe('openWhois request', () => {
  it('doubles the nick so the server returns idle time', () => {
    // RPL_WHOISIDLE (317) is only sent for `WHOIS nick nick`; dropping the
    // second token silently loses the idle/signon row in the sheet.
    const client = seed();
    store.getState().openWhois('alice');
    expect(client.sendRaw).toHaveBeenCalledWith('WHOIS', 'alice', 'alice');
  });

  it('explains itself instead of pretending to load while disconnected', () => {
    seed();
    store.setState({ connectionStatus: 'disconnected' });
    store.getState().openWhois('alice');
    const info = store.getState().whoisData.get('alice');
    expect(info?.loading).toBe(false);
    expect(info?.error).toBeTruthy();
  });

  it('/whois opens the sheet so the reply burst can fold', () => {
    const client = seed();
    store.getState().sendMessage('#root', '/whois alice');
    expect(client.sendRaw).toHaveBeenCalledWith('WHOIS', 'alice', 'alice');
    expect(store.getState().showWhois).toBe(true);
    expect(store.getState().whoisNick).toBe('alice');
  });
});

describe('WHOIS reply fold', () => {
  it('records the certificate fingerprint from 276', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 276 root alice :has client certificate fingerprint SHA256:abc123');
    expect(store.getState().whoisData.get('alice')?.certfp)
      .toBe('has client certificate fingerprint SHA256:abc123');
  });

  it('records the away reason from 301', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 301 root alice :Away at lunch');
    expect(store.getState().whoisData.get('alice')?.awayMessage).toBe('Away at lunch');
  });

  it('records the TLS description from 671', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 671 root alice :is using a secure connection (TLSv1.3)');
    expect(store.getState().whoisData.get('alice')?.secureConnection)
      .toBe('is using a secure connection (TLSv1.3)');
  });

  it('reduces the 313 sentence to a badge label', () => {
    // Both WhoisSheet and PeopleProfileCard render operRole as a label, so a
    // stored "is a …" leaks the server's sentence grammar into a badge.
    seed();
    store.getState().openWhois('alice');
    feed(':server 313 root alice :is an IRC Operator.');
    expect(store.getState().whoisData.get('alice')?.operRole).toBe('IRC Operator');
  });

  it('keeps a role the server did not phrase as a sentence', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 313 root alice :Services Administrator');
    expect(store.getState().whoisData.get('alice')?.operRole).toBe('Services Administrator');
  });

  it('flags a bot from 335', () => {
    seed();
    store.getState().openWhois('helperbot');
    feed(':server 335 root helperbot :is a bot on IRCXNet');
    expect(store.getState().whoisData.get('helperbot')?.bot).toBe(true);
  });

  it('ignores an empty 276/671 rather than storing a blank field', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 276 root alice :');
    feed(':server 671 root alice :');
    const info = store.getState().whoisData.get('alice');
    expect(info?.certfp).toBeUndefined();
    expect(info?.secureConnection).toBeUndefined();
  });
});

describe('WHOIS patches are scoped to the open request', () => {
  it('drops a reply for a nick the user did not ask about', () => {
    // 301 in particular also arrives unsolicited when you message an away
    // nick, and a late reply from a previous WHOIS can still be in flight —
    // neither may rewrite the entry the sheet is currently showing.
    seed();
    store.getState().openWhois('alice');
    feed(':server 276 root mallory :has client certificate fingerprint SHA256:evil');
    feed(':server 301 root mallory :gone fishing');

    expect(store.getState().whoisData.get('mallory')).toBeUndefined();
    expect(store.getState().whoisData.get('alice')?.certfp).toBeUndefined();
  });
});

describe('repeatable numerics stay bounded', () => {
  it('does not stack a duplicate 320 note repeated within one reply burst', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 320 root alice :Geo: US');
    feed(':server 320 root alice :Geo: US');
    expect(store.getState().whoisData.get('alice')?.specialNotes).toEqual(['Geo: US']);
  });

  it('caps 320 notes so a chatty server cannot grow the entry without limit', () => {
    seed();
    store.getState().openWhois('alice');
    for (let i = 0; i < 40; i += 1) feed(`:server 320 root alice :note ${i}`);

    const notes = store.getState().whoisData.get('alice')?.specialNotes ?? [];
    expect(notes.length).toBeLessThanOrEqual(12);
    // The cap keeps the most recent lines, so the newest note survives.
    expect(notes.at(-1)).toBe('note 39');
  });
});

describe('WHOIS request timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetWhoisRequestTimerForTests();
    vi.useRealTimers();
  });

  it('replaces a hung request with an explicit error instead of spinning forever', () => {
    seed();
    store.getState().openWhois('alice');
    expect(store.getState().whoisData.get('alice')?.loading).toBe(true);

    vi.advanceTimersByTime(WHOIS_REQUEST_TIMEOUT_MS);

    const info = store.getState().whoisData.get('alice');
    expect(info?.loading).toBe(false);
    expect(info?.error).toBe(WHOIS_TIMEOUT_ERROR);
  });

  it('does not timeout after 318 ends the burst', () => {
    seed();
    store.getState().openWhois('alice');
    feed(':server 311 root alice alice-user cloak.example * :Alice');
    feed(':server 318 root alice :End of /WHOIS list');

    vi.advanceTimersByTime(WHOIS_REQUEST_TIMEOUT_MS);

    const info = store.getState().whoisData.get('alice');
    expect(info?.loading).toBe(false);
    expect(info?.error).toBeUndefined();
    expect(info?.realname).toBe('Alice');
  });

  it('does not let a previous nick\'s timer poison the open request', () => {
    seed();
    store.getState().openWhois('alice');
    vi.advanceTimersByTime(WHOIS_REQUEST_TIMEOUT_MS / 2);
    store.getState().openWhois('bob');

    vi.advanceTimersByTime(WHOIS_REQUEST_TIMEOUT_MS / 2);
    expect(store.getState().whoisData.get('bob')?.loading).toBe(true);
    expect(store.getState().whoisData.get('bob')?.error).toBeUndefined();

    vi.advanceTimersByTime(WHOIS_REQUEST_TIMEOUT_MS / 2);
    expect(store.getState().whoisData.get('bob')?.error).toBe(WHOIS_TIMEOUT_ERROR);
    expect(store.getState().whoisData.get('alice')?.error).toBeUndefined();
  });

  it('keeps the 401 unknown-nick copy when the timer would have fired later', () => {
    seed();
    store.getState().openWhois('ghost');
    feed(':server 401 root ghost :No such nick');

    vi.advanceTimersByTime(WHOIS_REQUEST_TIMEOUT_MS);

    expect(store.getState().whoisData.get('ghost')?.error)
      .toBe('No profile was found for ghost. They may have left the network.');
  });
});
