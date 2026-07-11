// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/commands/registry.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
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
    clearRecents();
    localStorage.clear();
  });

  it('returns empty array when no recents exist', () => {
    expect(loadRecents()).toEqual([]);
  });

  it('saves and loads a recent target', () => {
    saveRecent({ id: 'channel:#lapis', label: 'Go to #lapis', section: 'Channels' });
    const recents = loadRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0]!.id).toBe('channel:#lapis');
    expect(recents[0]!.label).toBe('Go to #lapis');
  });

  it('moves an existing entry to the front on re-access', () => {
    saveRecent({ id: 'channel:#a', label: '#a', section: 'Channels' });
    saveRecent({ id: 'channel:#b', label: '#b', section: 'Channels' });
    saveRecent({ id: 'channel:#a', label: '#a', section: 'Channels' }); // re-access #a
    const recents = loadRecents();
    expect(recents[0]!.id).toBe('channel:#a');
  });

  it('caps at MAX_RECENTS (6)', () => {
    for (let i = 0; i < 10; i++) {
      saveRecent({ id: `test:${i}`, label: `Item ${i}`, section: 'Actions' });
    }
    expect(loadRecents()).toHaveLength(6);
  });

  it('clearRecents removes all entries', () => {
    saveRecent({ id: 'x', label: 'x', section: 'Actions' });
    clearRecents();
    expect(loadRecents()).toHaveLength(0);
  });
});
