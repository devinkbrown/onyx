// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  emptyIdentityProfileMemory,
  IDENTITY_PROFILE_STORAGE_KEY,
  MAX_SELF_BIO_LENGTH,
  saveIdentityProfileMemory,
} from '@/lib/identityProfileMemory';
import { parseIRCMessage } from '@/lib/irc/parser';
import { store, type Server } from './store';

const initialState = store.getInitialState();
const serverUrl = 'wss://profile.example/ws';

function server(account: string | null, nick = account ?? 'guest'): Server {
  return {
    id: 'profile-test',
    name: 'Profile',
    network: 'Profile',
    url: serverUrl,
    icon: '',
    nick,
    account,
    connected: true,
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

describe('identity-visible local profile state', () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState(initialState, true);
  });

  it('fails closed when no server owner is known', () => {
    store.setState({
      server: null,
      ourNick: '',
      customStatus: '',
      customStatusExpiry: null,
      selfDisplayName: '',
      selfBio: '',
      selfPronouns: '',
      selfBannerUrl: '',
    });

    store.getState().setCustomStatus('Alice private status');
    store.getState().setCustomStatusExpiry(new Date('2026-07-17T12:00:00.000Z'));
    store.getState().setSelfDisplayName('Alice Display');
    store.getState().setSelfBio('Alice private draft bio');
    store.getState().setSelfPronouns('she/her');
    store.getState().setSelfBannerUrl('https://alice.example/banner.png');

    expect(store.getState()).toMatchObject({
      customStatus: '',
      customStatusExpiry: null,
      selfDisplayName: '',
      selfBio: '',
      selfPronouns: '',
      selfBannerUrl: '',
    });
    expect(localStorage.length).toBe(0);
  });

  it('persists bounded local drafts for the owner and keeps PROP STATUS on its existing wire contract', () => {
    const owner = { serverUrl, identity: 'alice' } as const;
    const client = { sendRaw: vi.fn(), isupport: { CHANTYPES: '#&' } };
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      client: client as never,
      isIRCX: true,
    });

    store.getState().setCustomStatus('  🎵 Listening to Jazz  ');
    store.getState().setCustomStatusExpiry(new Date('2026-07-17T12:00:00.000Z'));
    store.getState().setSelfDisplayName(' Alice Display ');
    store.getState().setSelfBio(' Alice profile draft ');
    store.getState().setSelfPronouns(' she/her ');
    store.getState().setSelfBannerUrl('https://profile.example/banner.png');

    expect(client.sendRaw).toHaveBeenCalledWith('PROP', '*', 'STATUS', '🎵 Listening to Jazz');
    expect(store.getState()).toMatchObject({
      customStatus: '🎵 Listening to Jazz',
      selfDisplayName: 'Alice Display',
      selfBio: 'Alice profile draft',
      selfPronouns: 'she/her',
      selfBannerUrl: 'https://profile.example/banner.png',
    });
    const key = deviceMemoryStorageKey(IDENTITY_PROFILE_STORAGE_KEY, owner)!;
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({
      customStatus: '🎵 Listening to Jazz',
      customStatusExpiry: '2026-07-17T12:00:00.000Z',
      selfDisplayName: 'Alice Display',
      selfBio: 'Alice profile draft',
      selfPronouns: 'she/her',
      selfBannerUrl: 'https://profile.example/banner.png',
    });

    store.getState().setSelfBio('x'.repeat(MAX_SELF_BIO_LENGTH + 1));
    store.getState().setSelfBannerUrl('javascript:alert(1)');
    expect(store.getState().selfBio).toBe('Alice profile draft');
    expect(store.getState().selfBannerUrl).toBe('https://profile.example/banner.png');
  });

  it('hydrates Bob drafts and clears Alice self wire caches on a live 900 switch', () => {
    const bob = { serverUrl, identity: 'bob' } as const;
    saveIdentityProfileMemory({
      ...emptyIdentityProfileMemory(),
      customStatus: '🎵 Listening to Bob mix',
      selfBio: 'Bob draft bio',
    }, bob);
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      customStatus: 'Alice status',
      selfBio: 'Alice draft bio',
      userActivities: { alice: { emoji: '🔒', typeLabel: 'PRIVATE', text: 'Alice' } },
      userProps: new Map([['alice', { STATUS: 'Alice status' }]]),
      userMetadata: new Map([['alice', { 'ocean.bio': 'Alice published bio' }]]),
      userProfiles: new Map([['alice', { nick: 'alice', bio: 'Alice published bio' }]]),
    });

    feed(':profile.example 900 alice alice!u@h bob :You are now logged in as bob');

    expect(store.getState()).toMatchObject({
      customStatus: '🎵 Listening to Bob mix',
      selfBio: 'Bob draft bio',
    });
    expect(store.getState().userActivities.alice?.text).toBe('Listening to Bob mix');
    expect(store.getState().userProps.has('alice')).toBe(false);
    expect(store.getState().userMetadata.has('alice')).toBe(false);
    expect(store.getState().userProfiles.has('alice')).toBe(false);
  });

  it('hydrates same-owner and guest drafts on 900/901', () => {
    const alice = { serverUrl, identity: 'alice' } as const;
    const guest = { serverUrl, identity: 'guest42' } as const;
    saveIdentityProfileMemory({ ...emptyIdentityProfileMemory(), selfBio: 'Alice draft' }, alice);
    saveIdentityProfileMemory({ ...emptyIdentityProfileMemory(), selfBio: 'Guest draft' }, guest);

    store.setState({ server: server('alice'), ourNick: 'alice', selfBio: '' });
    feed(':profile.example 900 alice alice!u@h alice :You are now logged in as alice');
    expect(store.getState().selfBio).toBe('Alice draft');

    store.setState({ server: server('alice', 'guest42'), ourNick: 'guest42' });
    feed(':profile.example 901 guest42 guest42!u@h :You are now logged out');
    expect(store.getState().selfBio).toBe('Guest draft');
  });

  it('preserves literal ocean.* wire keys while bounding their public profile projection', () => {
    const client = { sendRaw: vi.fn(), isupport: { CHANTYPES: '#&' } };
    store.setState({
      server: server('alice'),
      ourNick: 'alice',
      client: client as never,
      userMetadata: new Map(),
      userProfiles: new Map(),
    });

    store.getState().setOwnMetadata('ocean.display-name', ' Alice Display ');
    store.getState().setOwnMetadata('ocean.banner-url', 'javascript:alert(1)');

    expect(client.sendRaw).toHaveBeenCalledWith('METADATA', '*', 'SET', 'ocean.display-name', 'Alice Display');
    expect(client.sendRaw).not.toHaveBeenCalledWith(
      'METADATA', '*', 'SET', 'ocean.banner-url', expect.anything(),
    );
    expect(store.getState().getUserProfile('alice')?.displayName).toBe('Alice Display');

    store.getState()._applyMetadata('alice', 'ocean.pronouns', ' they/them ');
    store.getState()._applyMetadata('alice', 'ocean.banner', 'javascript:alert(1)');
    expect(store.getState().userMetadata.get('alice')).toMatchObject({
      'ocean.pronouns': ' they/them ',
      'ocean.banner': 'javascript:alert(1)',
    });
    expect(store.getState().getUserProfile('alice')).toMatchObject({ pronouns: 'they/them' });
    expect(store.getState().getUserProfile('alice')?.bannerUrl).toBeUndefined();
  });
});
