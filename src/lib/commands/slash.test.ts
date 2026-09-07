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

  it('hides operator commands from members and reveals them to opers', () => {
    expect(getSlashCommandSuggestions('/kil').map((c) => c.name)).toEqual([]);
    expect(getSlashCommandSuggestions('/kil', 8, { isOper: true }).map((c) => c.name)).toEqual(['kill']);
    expect(getSlashCommandSuggestions('/reh', 8, { isOper: false }).map((c) => c.name)).toEqual([]);
    expect(getSlashCommandSuggestions('/reh', 8, { isOper: true }).map((c) => c.name)).toEqual(['rehash']);
    // `/wallops` is an alias for the real EVENT BROADCAST verb (§16: no +w).
    expect(getSlashCommandSuggestions('/wall', 8, { isOper: true }).map((c) => c.name)).toEqual(['broadcast']);
  });

  it('still resolves operator commands by name so /help can describe them', () => {
    expect(findSlashCommand('kill')?.oper).toBe(true);
    expect(findSlashCommand('wallops')?.name).toBe('broadcast');
    expect(findSlashCommand('broadcast')?.description).toMatch(/operators subscribed to ANNOUNCE/i);
    expect(findSlashCommand('broadcast')?.description).not.toMatch(/every member/i);
    expect(findSlashCommand('observe')?.usage).toContain('join part host');
  });

  it('leaves ordinary suggestions untouched when oper status is on', () => {
    expect(getSlashCommandSuggestions('/jo', 8, { isOper: true }).map((c) => c.name)).toEqual(['join']);
  });
});
