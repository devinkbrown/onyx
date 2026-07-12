// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * store.vaultResult.test.ts — CHANTYPES-aware channel/DM classification.
 *
 * `openVaultResult` and `raidChannel` must classify a target against the
 * server-advertised ISupport.CHANTYPES, not a hardcoded '#'. On a server whose
 * CHANTYPES includes '&', a '&foo' target is a CHANNEL: it must NOT be inserted
 * into `dms` as a phantom conversation, and BREAKOUT must not carry its sigil.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from './store';
import { setPreference } from '@/lib/prefs/preferences';

const initialState = store.getInitialState();

function mockClient() {
  const sent: string[] = [];
  const joined: string[] = [];
  return {
    sent,
    joined,
    client: {
      isupport: { CHANTYPES: '#&' },
      negotiatedCaps: new Set<string>(),
      sendRaw: (...parts: string[]) => sent.push(parts.join(' ')),
      join: (channel: string) => joined.push(channel),
    } as never,
  };
}

beforeEach(() => {
  // Keep openVaultResult off the vault path so the test stays synchronous.
  setPreference('localHistory', false);
  store.setState({ ...initialState, ourNick: 'kain' }, true);
});

afterEach(() => {
  setPreference('localHistory', true);
});

describe('openVaultResult', () => {
  it('classifies a &-channel as a channel, not a DM (CHANTYPES=#&)', () => {
    const { client, joined } = mockClient();
    store.setState({ client });

    store.getState().openVaultResult('&foo', 'msg-1');

    const s = store.getState();
    expect(s.channels.has('&foo')).toBe(true);
    expect(s.dms.has('&foo')).toBe(false);
    expect(joined).toContain('&foo');
    expect(s.activeView).toEqual({ kind: 'channel', channel: '&foo' });
  });

  it('still routes a plain nick to a DM', () => {
    const { client, joined } = mockClient();
    store.setState({ client });

    store.getState().openVaultResult('trev', 'msg-2');

    const s = store.getState();
    expect(s.dms.has('trev')).toBe(true);
    expect(s.channels.has('trev')).toBe(false);
    expect(joined).toEqual([]);
  });
});

describe('raidChannel', () => {
  it('strips the &-sigil so BREAKOUT carries the bare room name', () => {
    const { client, sent } = mockClient();
    store.setState({ client });

    store.getState().raidChannel('#stage', '&breakout');

    expect(sent).toContain('MEDIA BREAKOUT #stage breakout');
  });

  it('strips the #-sigil too', () => {
    const { client, sent } = mockClient();
    store.setState({ client });

    store.getState().raidChannel('#stage', '#breakout');

    expect(sent).toContain('MEDIA BREAKOUT #stage breakout');
  });
});
