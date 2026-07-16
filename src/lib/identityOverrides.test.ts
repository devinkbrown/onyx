// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';
import {
  DISPLAY_NAMES_STORAGE_KEY,
  loadDisplayNameOverrides,
  loadNickColorOverrides,
  loadSoftIgnoreList,
  MAX_IDENTITY_OVERRIDES,
  NICK_COLORS_STORAGE_KEY,
  parseDisplayNameOverrides,
  parseNickColorOverrides,
  parseSoftIgnoreList,
  saveDisplayNameOverrides,
  saveNickColorOverrides,
  saveSoftIgnoreList,
  SOFT_IGNORE_STORAGE_KEY,
} from './identityOverrides';

const alice = { serverUrl: 'wss://identity.example/ws', identity: 'alice' } as const;
const bob = { serverUrl: 'wss://identity.example/ws', identity: 'bob' } as const;

describe('account-scoped identity overrides', () => {
  beforeEach(() => localStorage.clear());

  it('isolates owners and purges every ambiguous ownerless journal', () => {
    localStorage.setItem(SOFT_IGNORE_STORAGE_KEY, JSON.stringify(['legacy-ignore']));
    localStorage.setItem(NICK_COLORS_STORAGE_KEY, JSON.stringify({ legacy: '#123456' }));
    localStorage.setItem(DISPLAY_NAMES_STORAGE_KEY, JSON.stringify({ legacy: 'Legacy alias' }));

    expect(saveSoftIgnoreList(new Set(['AliceIgnored']), alice)).toEqual(new Set(['aliceignored']));
    expect(saveNickColorOverrides(new Map([['AliceColor', '#ABCDEF']]), alice))
      .toEqual(new Map([['alicecolor', '#abcdef']]));
    expect(saveDisplayNameOverrides({ AliceAlias: ' Alice teammate ' }, alice))
      .toEqual({ alicealias: 'Alice teammate' });

    expect(saveSoftIgnoreList(new Set(['BobIgnored']), bob)).toEqual(new Set(['bobignored']));
    expect(saveNickColorOverrides(new Map([['BobColor', '#1234']]), bob))
      .toEqual(new Map([['bobcolor', '#1234']]));
    expect(saveDisplayNameOverrides({ BobAlias: 'Bob teammate' }, bob))
      .toEqual({ bobalias: 'Bob teammate' });

    expect(loadSoftIgnoreList(alice)).toEqual(new Set(['aliceignored']));
    expect(loadNickColorOverrides(alice)).toEqual(new Map([['alicecolor', '#abcdef']]));
    expect(loadDisplayNameOverrides(alice)).toEqual({ alicealias: 'Alice teammate' });
    expect(loadSoftIgnoreList(bob)).toEqual(new Set(['bobignored']));
    expect(loadNickColorOverrides(bob)).toEqual(new Map([['bobcolor', '#1234']]));
    expect(loadDisplayNameOverrides(bob)).toEqual({ bobalias: 'Bob teammate' });

    expect(localStorage.getItem(SOFT_IGNORE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(NICK_COLORS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(DISPLAY_NAMES_STORAGE_KEY)).toBeNull();
  });

  it('normalizes, bounds, and sanitizes every persisted nick-indexed record', () => {
    const oversized = Object.fromEntries(
      Array.from({ length: MAX_IDENTITY_OVERRIDES + 20 }, (_, index) => [`nick${index}`, '#123456']),
    );

    const softIgnores = parseSoftIgnoreList([
      ' Alice ',
      'alice',
      'bad nick',
      'bad\u0000nick',
      ...Object.keys(oversized),
    ]);
    const colors = parseNickColorOverrides({
      Alice: '#AABBCC',
      unsafe: 'red; background: url(https://example.test)',
      'bad nick': '#123456',
      ...oversized,
    });
    const displayNames = parseDisplayNameOverrides({
      Alice: '  Trusted alias  ',
      control: 'spoof\nnext row',
      'bad nick': 'Bad nick key',
      ...Object.fromEntries(Object.keys(oversized).map((nick) => [nick, `Alias ${nick}`])),
    });

    expect(softIgnores.size).toBe(MAX_IDENTITY_OVERRIDES);
    expect(softIgnores).toContain('alice');
    expect(colors.size).toBe(MAX_IDENTITY_OVERRIDES);
    expect(colors.get('alice')).toBe('#aabbcc');
    expect(colors.has('unsafe')).toBe(false);
    expect(Object.keys(displayNames)).toHaveLength(MAX_IDENTITY_OVERRIDES);
    expect(displayNames.alice).toBe('Trusted alias');
    expect(displayNames.control).toBeUndefined();
  });

  it('fails closed for missing owners, malformed JSON, and oversized storage', () => {
    localStorage.setItem(SOFT_IGNORE_STORAGE_KEY, JSON.stringify(['must-purge']));
    expect(saveSoftIgnoreList(new Set(['ownerless']))).toBeNull();
    expect(saveNickColorOverrides(new Map([['ownerless', '#123456']]))).toBeNull();
    expect(saveDisplayNameOverrides({ ownerless: 'Private alias' })).toBeNull();
    expect(loadSoftIgnoreList()).toEqual(new Set());
    expect(loadNickColorOverrides()).toEqual(new Map());
    expect(loadDisplayNameOverrides()).toEqual({});

    const softKey = deviceMemoryStorageKey(SOFT_IGNORE_STORAGE_KEY, alice)!;
    const colorKey = deviceMemoryStorageKey(NICK_COLORS_STORAGE_KEY, alice)!;
    const namesKey = deviceMemoryStorageKey(DISPLAY_NAMES_STORAGE_KEY, alice)!;
    localStorage.setItem(softKey, '{bad-json');
    localStorage.setItem(colorKey, 'x'.repeat(256 * 1024 + 1));
    localStorage.setItem(namesKey, JSON.stringify({ alice: 42 }));

    expect(loadSoftIgnoreList(alice)).toEqual(new Set());
    expect(loadNickColorOverrides(alice)).toEqual(new Map());
    expect(loadDisplayNameOverrides(alice)).toEqual({});
  });
});
