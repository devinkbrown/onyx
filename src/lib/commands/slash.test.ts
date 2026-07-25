// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  completeSlashCommand,
  expandSlashTextCommand,
  findSlashCommand,
  getSlashCommandSuggestions,
  slashCommandQuery,
} from './registry';

describe('slash command registry', () => {
  it('extracts a command query only from leading slash input', () => {
    expect(slashCommandQuery('/jo')).toBe('jo');
    expect(slashCommandQuery('/')).toBe('');
    expect(slashCommandQuery('hello /jo')).toBeNull();
    expect(slashCommandQuery('//not-a-command')).toBeNull();
  });

  it('returns typed command suggestions by name or alias', () => {
    expect(getSlashCommandSuggestions('/jo').map((command) => command.name)).toEqual(['join']);
    expect(getSlashCommandSuggestions('/j').some((command) => command.name === 'join')).toBe(true);
    expect(getSlashCommandSuggestions('/web').map((command) => command.name)).toEqual(['webhook']);
    expect(findSlashCommand('leave')?.name).toBe('part');
  });

  it('completes IRC commands with a trailing argument space', () => {
    const command = findSlashCommand('join');
    expect(command).toBeTruthy();
    expect(completeSlashCommand('/jo', command!)).toBe('/join ');
    expect(completeSlashCommand('/jo #root', command!)).toBe('/join #root');
  });

  it('expands local text commands instead of preserving slash syntax', () => {
    const command = findSlashCommand('shrug');
    expect(command).toBeTruthy();
    expect(completeSlashCommand('/shr', command!)).toBe(String.raw`¯\_(ツ)_/¯`);
    expect(expandSlashTextCommand('/tableflip')).toBe('(╯°□°）╯︵ ┻━┻');
  });

  it('registers platform-local mute, export, notify, and help commands', () => {
    expect(findSlashCommand('mute')?.usage).toContain('/mute');
    expect(findSlashCommand('export')?.usage).toContain('/export');
    expect(findSlashCommand('notify')?.usage).toContain('/notify');
    expect(findSlashCommand('help')?.description.toLowerCase()).toContain('slash');
    expect(findSlashCommand('colour')?.name).toBe('color');
    expect(getSlashCommandSuggestions('/sno').map((c) => c.name)).toContain('snooze');
    expect(getSlashCommandSuggestions('/exp').map((c) => c.name)).toEqual(['export']);
  });
});
