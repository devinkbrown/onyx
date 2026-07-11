// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseDiscordPackage, type DiscordPackageFile } from './discordPackageImport';
import { parseVaultExport } from '@/lib/vault/historyVault';

/** Build a package file list from a path → text map. */
function pkg(entries: Record<string, string>): DiscordPackageFile[] {
  return Object.entries(entries).map(([path, text]) => ({ path, text }));
}

const USER_JSON = JSON.stringify({ username: 'devin', global_name: 'Devin' });

function channelJson(id: string, name: string, guild = 'My Server'): string {
  return JSON.stringify({ id, type: 0, name, guild: { id: '9', name: guild } });
}

function messagesJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows);
}

describe('parseDiscordPackage — official data package (JSON)', () => {
  it('correlates channel.json + messages.json + user.json into a snapshot', () => {
    const result = parseDiscordPackage(
      pkg({
        'account/user.json': USER_JSON,
        'messages/index.json': JSON.stringify({ '100000000000000100': 'general' }),
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: 'hello', Attachments: '' },
          { ID: 'a2', Timestamp: '2025-01-01 10:05:00', Contents: 'world', Attachments: '' },
        ]),
      }),
    );
    expect(result).not.toBeNull();
    const { snapshot, summary } = result!;
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.targets[0]!.target).toBe('#general');
    const msgs = snapshot.targets[0]!.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.text)).toEqual(['hello', 'world']);
    // The package contains only the requesting user's messages → author is them.
    expect(msgs.every((m) => m.from === 'Devin')).toBe(true);
    expect(msgs[0]!.id).toBe('discord:100000000000000100:a1');
    expect(summary.guild).toBe('My Server');
    expect(summary.channels).toBe(1);
    expect(summary.messages).toBe(2);
  });

  it('pins a space-separated timestamp to UTC deterministically', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'a1', Timestamp: '2025-06-15 08:30:00', Contents: 'noon-ish', Attachments: '' },
        ]),
      }),
    );
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.time.toISOString()).toBe('2025-06-15T08:30:00.000Z');
  });

  it('appends space-separated attachment URLs to the message text', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          {
            ID: 'a1',
            Timestamp: '2025-01-01 10:00:00',
            Contents: 'see',
            Attachments: 'https://cdn.example/x.png https://cdn.example/y.png',
          },
        ]),
      }),
    );
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe(
      'see\nhttps://cdn.example/x.png\nhttps://cdn.example/y.png',
    );
  });

  it('falls back to index.json name, then id, for the channel target', () => {
    const viaIndex = parseDiscordPackage(
      pkg({
        'messages/index.json': JSON.stringify({ '100000000000000200': 'random' }),
        'messages/c100000000000000200/messages.json': messagesJson([
          { ID: 'b1', Timestamp: '2025-01-01 10:00:00', Contents: 'hi', Attachments: '' },
        ]),
      }),
    );
    expect(viaIndex!.snapshot.targets[0]!.target).toBe('#random');

    const viaId = parseDiscordPackage(
      pkg({
        'messages/c100000000000000300/messages.json': messagesJson([
          { ID: 'c1', Timestamp: '2025-01-01 10:00:00', Contents: 'hi', Attachments: '' },
        ]),
      }),
    );
    expect(viaId!.snapshot.targets[0]!.target).toBe('#100000000000000300');
  });

  it('handles the newer bare-<id> channel folder (no leading c)', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/100000000000000400/channel.json': channelJson('100000000000000400', 'newer'),
        'messages/100000000000000400/messages.json': messagesJson([
          { ID: 'd1', Timestamp: '2025-01-01 10:00:00', Contents: 'x', Attachments: '' },
        ]),
      }),
    );
    expect(result!.snapshot.targets[0]!.target).toBe('#newer');
  });

  it('defaults the author to "me" when account/user.json is absent', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: 'solo', Attachments: '' },
        ]),
      }),
    );
    expect(result!.snapshot.targets[0]!.messages[0]!.from).toBe('me');
  });
});

describe('parseDiscordPackage — official data package (CSV)', () => {
  it('reads messages.csv with the four standard columns', () => {
    const csv = 'ID,Timestamp,Contents,Attachments\n' + 'e1,2025-01-01 10:00:00,plain csv,\n';
    const result = parseDiscordPackage(
      pkg({
        'account/user.json': USER_JSON,
        'messages/c100000000000000500/channel.json': channelJson('100000000000000500', 'csvchan'),
        'messages/c100000000000000500/messages.csv': csv,
      }),
    );
    expect(result!.snapshot.targets[0]!.target).toBe('#csvchan');
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.text).toBe('plain csv');
    expect(msg.from).toBe('Devin');
    expect(msg.id).toBe('discord:100000000000000500:e1');
  });

  it('parses quoted CSV fields with embedded commas, quotes, and newlines', () => {
    const csv =
      'ID,Timestamp,Contents,Attachments\n' +
      'e1,2025-01-01 10:00:00,"hello, ""world"" and\nmore",\n';
    const result = parseDiscordPackage(
      pkg({ 'messages/c100000000000000500/messages.csv': csv }),
    );
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('hello, "world" and\nmore');
  });
});

describe('parseDiscordPackage — robustness', () => {
  it('returns null when no message file is present', () => {
    expect(parseDiscordPackage([])).toBeNull();
    expect(
      parseDiscordPackage(pkg({ 'messages/index.json': JSON.stringify({ '1': 'x' }) })),
    ).toBeNull();
    expect(
      parseDiscordPackage(pkg({ 'account/user.json': USER_JSON })),
    ).toBeNull();
  });

  it('skips an unreadable messages.json without aborting the whole import', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/messages.json': '{ this is not valid json',
        'messages/c100000000000000200/channel.json': channelJson('100000000000000200', 'good'),
        'messages/c100000000000000200/messages.json': messagesJson([
          { ID: 'g1', Timestamp: '2025-01-01 10:00:00', Contents: 'survived', Attachments: '' },
        ]),
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.snapshot.targets).toHaveLength(1);
    expect(result!.snapshot.targets[0]!.target).toBe('#good');
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('survived');
  });

  it('skips rows with an invalid timestamp but keeps the valid ones', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'bad', Timestamp: 'not-a-date', Contents: 'nope', Attachments: '' },
          { ID: 'ok', Timestamp: '2025-01-01 10:00:00', Contents: 'yes', Attachments: '' },
        ]),
      }),
    );
    expect(result!.summary.messages).toBe(1);
    expect(result!.summary.skipped).toBe(1);
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('yes');
  });

  it('is idempotent: two parses of the same package yield identical vault ids', () => {
    const files = pkg({
      'account/user.json': USER_JSON,
      'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
      'messages/c100000000000000100/messages.json': messagesJson([
        { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: 'one', Attachments: '' },
        { ID: 'a2', Timestamp: '2025-01-01 10:05:00', Contents: 'two', Attachments: '' },
      ]),
    });
    const first = parseDiscordPackage(files)!.snapshot.targets[0]!.messages.map((m) => m.id);
    const second = parseDiscordPackage(files)!.snapshot.targets[0]!.messages.map((m) => m.id);
    // Stable, channel-scoped ids → re-import upserts the same rows (no dupes).
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(2);
  });

  it('merges channel.json and messages.json even when listed in any order', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: 'body', Attachments: '' },
        ]),
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'ordered'),
      }),
    );
    expect(result!.snapshot.targets[0]!.target).toBe('#ordered');
  });

  it('produces a snapshot that survives the vault validator round-trip', () => {
    const result = parseDiscordPackage(
      pkg({
        'account/user.json': USER_JSON,
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: 'hello', Attachments: '' },
        ]),
      }),
    );
    const revived = parseVaultExport(result!.snapshot);
    expect(revived).not.toBeNull();
    expect(revived!.targets[0]!.messages[0]!.text).toBe('hello');
  });

  it('never emits HTML — imported markup stays inert text', () => {
    const result = parseDiscordPackage(
      pkg({
        'messages/c100000000000000100/channel.json': channelJson('100000000000000100', 'general'),
        'messages/c100000000000000100/messages.json': messagesJson([
          { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: '<img src=x onerror=alert(1)>', Attachments: '' },
        ]),
      }),
    );
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('<img src=x onerror=alert(1)>');
  });
});
