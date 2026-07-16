// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/commands/registry.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PALETTE_RECENTS_STORAGE_KEY,
  clearCommands,
  clearRecents,
  getCommands,
  getCommandsBySection,
  loadRecents,
  registerCommand,
  saveRecent,
  unregisterCommand,
  type PaletteCommand,
} from './registry';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';

const ALICE = { serverUrl: 'wss://irc.example/ws', identity: 'alice' } as const;
const BOB = { serverUrl: 'wss://irc.example/ws', identity: 'bob' } as const;

function makeCmd(overrides: Partial<PaletteCommand> = {}): PaletteCommand {
  return {
    id: 'test:foo',
    section: 'Actions',
    label: 'Foo command',
    run: () => { /* noop */ },
    ...overrides,
  };
}

describe('registerCommand / getCommands', () => {
  beforeEach(() => clearCommands());

  it('registers a command and returns it from getCommands', () => {
    registerCommand(makeCmd({ id: 'test:foo', label: 'Foo' }));
    const cmds = getCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.id).toBe('test:foo');
  });

  it('overwrites a duplicate id', () => {
    registerCommand(makeCmd({ id: 'test:foo', label: 'First' }));
    registerCommand(makeCmd({ id: 'test:foo', label: 'Second' }));
    const cmds = getCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.label).toBe('Second');
  });

  it('stores multiple distinct commands', () => {
    registerCommand(makeCmd({ id: 'test:a' }));
    registerCommand(makeCmd({ id: 'test:b' }));
    registerCommand(makeCmd({ id: 'test:c' }));
    expect(getCommands()).toHaveLength(3);
  });
});

describe('unregisterCommand', () => {
  beforeEach(() => clearCommands());

  it('removes the specified command', () => {
    registerCommand(makeCmd({ id: 'test:foo' }));
    unregisterCommand('test:foo');
    expect(getCommands()).toHaveLength(0);
  });

  it('is a no-op for unknown ids', () => {
    expect(() => unregisterCommand('nope')).not.toThrow();
  });
});

describe('getCommandsBySection', () => {
  beforeEach(() => clearCommands());

  it('returns only commands in the specified section', () => {
    registerCommand(makeCmd({ id: 'a', section: 'Actions' }));
    registerCommand(makeCmd({ id: 'b', section: 'Channels' }));
    registerCommand(makeCmd({ id: 'c', section: 'Actions' }));

    expect(getCommandsBySection('Actions')).toHaveLength(2);
    expect(getCommandsBySection('Channels')).toHaveLength(1);
    expect(getCommandsBySection('DMs')).toHaveLength(0);
  });
});

describe('recents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fails closed without an owner and purges ownerless legacy rows', () => {
    localStorage.setItem(PALETTE_RECENTS_STORAGE_KEY, JSON.stringify([
      { id: 'dm:private', label: 'Open DM with private', section: 'DMs', at: new Date().toISOString() },
    ]));
    localStorage.setItem('ruri:palette-recents', 'legacy-private');

    expect(loadRecents()).toEqual([]);
    saveRecent({ id: 'channel:#secret', label: '#secret', section: 'Channels' });

    expect(localStorage.getItem(PALETTE_RECENTS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('ruri:palette-recents')).toBeNull();
  });

  it('saves and loads a recent target for one owner', () => {
    saveRecent({ id: 'channel:#lapis', label: 'Go to #lapis', section: 'Channels' }, ALICE);
    const recents = loadRecents(ALICE);
    expect(recents).toHaveLength(1);
    expect(recents[0]!.id).toBe('channel:#lapis');
    expect(recents[0]!.label).toBe('Go to #lapis');
  });

  it('isolates owners and moves an existing entry to the front on re-access', () => {
    saveRecent({ id: 'channel:#a', label: '#a', section: 'Channels' }, ALICE);
    saveRecent({ id: 'channel:#b', label: '#b', section: 'Channels' }, ALICE);
    saveRecent({ id: 'channel:#bob', label: '#bob', section: 'Channels' }, BOB);
    saveRecent({ id: 'channel:#a', label: '#a', section: 'Channels' }, ALICE); // re-access #a
    const recents = loadRecents(ALICE);
    expect(recents[0]!.id).toBe('channel:#a');
    expect(recents.map((entry) => entry.id)).not.toContain('channel:#bob');
    expect(loadRecents(BOB).map((entry) => entry.id)).toEqual(['channel:#bob']);
  });

  it('caps at MAX_RECENTS (6)', () => {
    for (let i = 0; i < 10; i++) {
      saveRecent({ id: `test:${i}`, label: `Item ${i}`, section: 'Actions' }, ALICE);
    }
    expect(loadRecents(ALICE)).toHaveLength(6);
  });

  it('rejects malformed rows and overlong or control-character writes', () => {
    const key = deviceMemoryStorageKey(PALETTE_RECENTS_STORAGE_KEY, ALICE)!;
    localStorage.setItem(key, JSON.stringify([
      { id: 'valid', label: 'Valid', section: 'Actions', at: new Date().toISOString() },
      { id: 'bad', label: 'Bad', section: 'Unknown', at: new Date().toISOString() },
      { id: 'dm:evil', label: 'Evil\nJOIN #private', section: 'DMs', at: new Date().toISOString() },
    ]));

    expect(loadRecents(ALICE).map((entry) => entry.id)).toEqual(['valid']);
    saveRecent({ id: 'x'.repeat(257), label: 'too long', section: 'Actions' }, ALICE);
    expect(loadRecents(ALICE).map((entry) => entry.id)).toEqual(['valid']);
  });

  it('clearRecents removes only the selected owner', () => {
    saveRecent({ id: 'alice', label: 'Alice', section: 'Actions' }, ALICE);
    saveRecent({ id: 'bob', label: 'Bob', section: 'Actions' }, BOB);
    clearRecents(ALICE);
    expect(loadRecents(ALICE)).toEqual([]);
    expect(loadRecents(BOB).map((entry) => entry.id)).toEqual(['bob']);
  });
});
