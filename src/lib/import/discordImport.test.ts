// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { normalizeChannelTarget, parseDiscordExport } from './discordImport';
import { parseVaultExport } from '@/lib/vault/historyVault';

/** A minimal DiscordChatExporter-shaped single-channel export. */
function exportFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guild: { id: '1', name: 'Cool Project' },
    channel: { id: '100', name: 'general', category: 'Text' },
    messages: [
      {
        id: 'm1',
        type: 'Default',
        timestamp: '2025-01-01T10:00:00.000Z',
        content: 'first post',
        author: { id: 'u1', name: 'alice', nickname: 'Alice' },
      },
      {
        id: 'm2',
        type: 'Default',
        timestamp: '2025-01-01T10:05:00.000Z',
        content: 'second',
        author: { id: 'u2', name: 'bob', nickname: '' },
      },
    ],
    ...overrides,
  };
}

describe('normalizeChannelTarget', () => {
  it('prefixes with # and lowercases', () => {
    expect(normalizeChannelTarget('General')).toBe('#general');
  });
  it('strips leading hashes and illegal characters', () => {
    expect(normalizeChannelTarget('##Off Topic! 🎉')).toBe('#off-topic');
  });
  it('collapses whitespace and repeated dashes', () => {
    expect(normalizeChannelTarget('  dev   chat  ')).toBe('#dev-chat');
  });
  it('falls back for an empty name', () => {
    expect(normalizeChannelTarget('   ')).toBe('#imported');
  });
  it('bounds hostile channel names to the vault target ceiling', () => {
    const target = normalizeChannelTarget('x'.repeat(20_000));
    expect(target).toHaveLength(512);
    expect(target.startsWith('#')).toBe(true);
  });
});

describe('parseDiscordExport — happy path', () => {
  it('maps a single channel export into a vault snapshot', () => {
    const result = parseDiscordExport(exportFixture());
    expect(result).not.toBeNull();
    const { snapshot, summary } = result!;
    expect(snapshot.kind).toBe('onyx-vault');
    expect(snapshot.version).toBe(1);
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.targets[0]!.target).toBe('#general');
    expect(snapshot.targets[0]!.messages).toHaveLength(2);
    expect(summary.guild).toBe('Cool Project');
    expect(summary.channels).toBe(1);
    expect(summary.messages).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.oldest).toBe('2025-01-01T10:00:00.000Z');
    expect(summary.newest).toBe('2025-01-01T10:05:00.000Z');
  });

  it('prefers nickname then falls back to name then unknown', () => {
    const result = parseDiscordExport(exportFixture());
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs[0]!.from).toBe('Alice');
    expect(msgs[1]!.from).toBe('bob');
  });

  it('sorts messages chronologically regardless of input order', () => {
    const result = parseDiscordExport(
      exportFixture({
        messages: [
          { id: 'b', type: 'Default', timestamp: '2025-01-02T00:00:00Z', content: 'later', author: { name: 'x' } },
          { id: 'a', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'earlier', author: { name: 'x' } },
        ],
      }),
    );
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs.map((m) => m.text)).toEqual(['earlier', 'later']);
  });

  it('produces ids that are stable and channel-scoped', () => {
    const result = parseDiscordExport(exportFixture());
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs[0]!.id).toBe('discord:100:m1');
    expect(msgs[0]!.type).toBe('msg');
  });
});

describe('parseDiscordExport — input shapes', () => {
  it('accepts an array of channel exports', () => {
    const result = parseDiscordExport([
      exportFixture(),
      exportFixture({ channel: { id: '200', name: 'random' }, messages: [
        { id: 'r1', type: 'Default', timestamp: '2025-01-03T00:00:00Z', content: 'hi', author: { name: 'z' } },
      ] }),
    ]);
    expect(result!.snapshot.targets.map((t) => t.target).sort()).toEqual(['#general', '#random']);
  });

  it('accepts an { exports: [...] } bundle', () => {
    const result = parseDiscordExport({ exports: [exportFixture()] });
    expect(result!.summary.channels).toBe(1);
  });

  it('merges paginated exports of the same channel', () => {
    const page1 = exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'p1', author: { name: 'a' } },
    ] });
    const page2 = exportFixture({ messages: [
      { id: 'm2', type: 'Default', timestamp: '2025-01-01T01:00:00Z', content: 'p2', author: { name: 'a' } },
    ] });
    const result = parseDiscordExport([page1, page2]);
    expect(result!.snapshot.targets).toHaveLength(1);
    expect(result!.snapshot.targets[0]!.messages).toHaveLength(2);
  });

  it('returns null for input with no channel export', () => {
    expect(parseDiscordExport(null)).toBeNull();
    expect(parseDiscordExport({})).toBeNull();
    expect(parseDiscordExport('nope')).toBeNull();
    expect(parseDiscordExport({ guild: { name: 'x' } })).toBeNull();
    expect(parseDiscordExport(42)).toBeNull();
  });
});

describe('parseDiscordExport — content mapping', () => {
  it('appends attachment URLs to the message text', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      {
        id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'see this',
        author: { name: 'a' },
        attachments: [{ id: '1', url: 'https://cdn.example/x.png', fileName: 'x.png' }],
      },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('see this\nhttps://cdn.example/x.png');
  });

  it('keeps an attachment-only message using the URL as the body', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      {
        id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: '',
        author: { name: 'a' },
        attachments: [{ url: 'https://cdn.example/y.gif' }],
      },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('https://cdn.example/y.gif');
  });

  it('maps unicode and custom emoji reactions with reactor names', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      {
        id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'nice',
        author: { name: 'a' },
        reactions: [
          { emoji: { name: '🔥' }, count: 2, users: [{ name: 'a' }, { name: 'b' }] },
          { emoji: { name: '', code: 'party' }, count: 1 },
        ],
      },
    ] }));
    const reactions = result!.snapshot.targets[0]!.messages[0]!.reactions!;
    expect(reactions[0]!).toEqual({ emoji: '🔥', users: ['a', 'b'] });
    expect(reactions[1]!.emoji).toBe(':party:');
    expect(reactions[1]!.users).toHaveLength(1); // count preserved via placeholder
  });

  it('resolves replies to earlier messages in the same channel', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'question?', author: { name: 'asker' } },
      { id: 'm2', type: 'Reply', timestamp: '2025-01-01T00:01:00Z', content: 'answer', author: { name: 'helper' }, reference: { messageId: 'm1' } },
    ] }));
    const reply = result!.snapshot.targets[0]!.messages.find((m) => m.text === 'answer')!;
    expect(reply.replyTo).toEqual({ id: 'discord:100:m1', from: 'asker', text: 'question?' });
  });

  it('omits replyTo when the referenced message is absent', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm2', type: 'Reply', timestamp: '2025-01-01T00:01:00Z', content: 'answer', author: { name: 'helper' }, reference: { messageId: 'ghost' } },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.replyTo).toBeUndefined();
  });

  it('marks edited messages', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', timestampEdited: '2025-01-01T00:02:00Z', content: 'fixed', author: { name: 'a' } },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.edited).toBe(true);
  });
});

describe('parseDiscordExport — filtering', () => {
  it('drops system messages by default and counts them as skipped', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'hi', author: { name: 'a' } },
      { id: 'p1', type: 'ChannelPinnedMessage', timestamp: '2025-01-01T00:01:00Z', content: 'pinned a message', author: { name: 'a' } },
    ] }));
    expect(result!.summary.messages).toBe(1);
    expect(result!.summary.skipped).toBe(1);
  });

  it('includes system messages when includeSystem is set', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'p1', type: 'ChannelPinnedMessage', timestamp: '2025-01-01T00:01:00Z', content: 'pinned a message', author: { name: 'a' } },
    ] }), { includeSystem: true });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.type).toBe('system');
  });

  it('skips messages with an invalid timestamp', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: 'not-a-date', content: 'hi', author: { name: 'a' } },
    ] }));
    expect(result!.summary.messages).toBe(0);
    expect(result!.summary.skipped).toBe(1);
    expect(result!.snapshot.targets).toHaveLength(0);
  });

  it('skips empty-body messages with no attachments', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: '   ', author: { name: 'a' } },
    ] }));
    expect(result!.summary.messages).toBe(0);
    expect(result!.summary.skipped).toBe(1);
  });

  it('filters messages older than sinceDays relative to now', () => {
    const recent = new Date().toISOString();
    const old = '2000-01-01T00:00:00Z';
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'old', type: 'Default', timestamp: old, content: 'ancient', author: { name: 'a' } },
      { id: 'new', type: 'Default', timestamp: recent, content: 'fresh', author: { name: 'a' } },
    ] }), { sinceDays: 7 });
    expect(result!.summary.messages).toBe(1);
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('fresh');
  });

  it('caps per-channel messages to keepPerChannel, keeping the newest', () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      type: 'Default',
      timestamp: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
      content: `msg ${i}`,
      author: { name: 'a' },
    }));
    const result = parseDiscordExport(exportFixture({ messages }), { keepPerChannel: 2 });
    const kept = result!.snapshot.targets[0]!.messages;
    expect(kept).toHaveLength(2);
    expect(kept.map((m) => m.text)).toEqual(['msg 3', 'msg 4']);
    expect(result!.summary.droppedOverCap).toBe(3);
  });
});

describe('parseDiscordExport — robustness (independent review fixes)', () => {
  it('resolves a reply whose parent is in an earlier paginated file', () => {
    const page1 = exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'parent', author: { name: 'asker' } },
    ] });
    const page2 = exportFixture({ messages: [
      { id: 'm2', type: 'Reply', timestamp: '2025-01-01T00:05:00Z', content: 'child', author: { name: 'helper' }, reference: { messageId: 'm1' } },
    ] });
    const result = parseDiscordExport([page1, page2]);
    const child = result!.snapshot.targets[0]!.messages.find((m) => m.text === 'child')!;
    expect(child.replyTo).toEqual({ id: 'discord:100:m1', from: 'asker', text: 'parent' });
  });

  it('preserves reaction count when the export lists only some reactors', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      {
        id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'x',
        author: { name: 'a' },
        reactions: [{ emoji: { name: '👍' }, count: 50, users: [{ name: 'alice' }] }],
      },
    ] }));
    const reaction = result!.snapshot.targets[0]!.messages[0]!.reactions![0]!;
    expect(reaction.users).toHaveLength(50);
    expect(reaction.users[0]).toBe('alice');
  });

  it('caps a huge reaction count at MAX_REACTION_USERS', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'x', author: { name: 'a' }, reactions: [{ emoji: { name: '🔥' }, count: 100000 }] },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.reactions![0]!.users).toHaveLength(99);
  });

  it('keeps both messages when Discord ids collide within a channel', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'dup', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'one', author: { name: 'a' } },
      { id: 'dup', type: 'Default', timestamp: '2025-01-01T00:01:00Z', content: 'two', author: { name: 'a' } },
    ] }));
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs).toHaveLength(2);
    expect(new Set(msgs.map((m) => m.id)).size).toBe(2); // distinct vault ids
  });

  it('assigns distinct ids to id-less messages', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'a', author: { name: 'a' } },
      { type: 'Default', timestamp: '2025-01-01T00:01:00Z', content: 'b', author: { name: 'a' } },
    ] }));
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(new Set(msgs.map((m) => m.id)).size).toBe(2);
  });

  it('falls back to the default cap for a non-finite keepPerChannel', () => {
    const result = parseDiscordExport(exportFixture(), { keepPerChannel: Number.NaN });
    expect(result!.snapshot.targets[0]!.messages).toHaveLength(2); // both kept, no NaN cap bypass
    expect(result!.summary.droppedOverCap).toBe(0);
  });

  it('ignores a non-finite sinceDays instead of filtering everything', () => {
    const result = parseDiscordExport(exportFixture(), { sinceDays: Infinity });
    expect(result!.summary.messages).toBe(2);
  });

  it('bounds memory: mid-scan compaction keeps only the newest keepPerChannel', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      type: 'Default',
      timestamp: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
      content: `m${i}`,
      author: { name: 'a' },
    }));
    const result = parseDiscordExport(exportFixture({ messages }), { keepPerChannel: 3 });
    const kept = result!.snapshot.targets[0]!.messages;
    expect(kept.map((m) => m.text)).toEqual(['m17', 'm18', 'm19']);
    expect(result!.summary.droppedOverCap).toBe(17);
  });

  it('bounds oversized fields, attachments, reactions, and reactor lists', () => {
    const attachments = [
      { url: 'javascript:alert(1)' },
      { url: 'https://user:secret@example.com/private.png' },
      { url: 'http://127.0.0.1/internal.png' },
      ...Array.from({ length: 40 }, (_, index) => ({ url: `https://cdn.example/${index}.png` })),
    ];
    const reactions = Array.from({ length: 70 }, (_, reactionIndex) => ({
      emoji: { name: `emoji-${reactionIndex}` },
      count: 150,
      users: Array.from({ length: 120 }, (_, userIndex) => `user ${userIndex}`),
    }));
    const result = parseDiscordExport(exportFixture({
      guild: { name: `Guild\u0000${'g'.repeat(400)}` },
      channel: { id: 'c'.repeat(500), name: 'general' },
      messages: [{
        id: 'm'.repeat(500),
        type: 'Default',
        timestamp: '2025-01-01T00:00:00Z',
        content: 'x'.repeat(70 * 1_024),
        attachments,
        author: { name: `Alice Smith\u0000${'a'.repeat(400)}` },
        reactions,
      }],
    }));
    const message = result!.snapshot.targets[0]!.messages[0]!;

    expect(result!.summary.guild).toHaveLength(256);
    expect(message.id.length).toBeLessThanOrEqual(512);
    expect(message.from).toBe(`Alice-Smith-${'a'.repeat(244)}`);
    expect(message.text).toHaveLength(64 * 1_024);
    expect(message.text).not.toContain('javascript:');
    expect(message.text).not.toContain('secret');
    expect(message.text).not.toContain('127.0.0.1');
    expect(message.reactions).toHaveLength(64);
    expect(message.reactions![0]!.users).toHaveLength(99);
    expect(message.reactions![0]!.users[0]).toBe('user-0');
    expect(parseVaultExport(result!.snapshot)).not.toBeNull();
  });

  it('caps per-export and aggregate scan work while retaining each scanned tail', () => {
    const rows = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `${prefix}${index}`,
      type: 'Default',
      timestamp: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
      content: `${prefix} ${index}`,
      author: { name: 'a' },
    }));
    const exports = Array.from({ length: 12 }, (_, index) => exportFixture({
      channel: { id: `${index + 100}`, name: `channel-${index}` },
      messages: rows(`c${index}-`, 1_700),
    }));
    const result = parseDiscordExport(exports);

    expect(result!.summary.messages).toBe(10 * 400 + 384);
    expect(result!.summary.droppedOverCap).toBe(12 * 1_700 - (10 * 400 + 384));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('c0- 1300');
    expect(result!.snapshot.targets.at(-1)!.target).toBe('#channel-10');
  });

  it('allocates duplicate ids without quadratic suffix rescans', () => {
    const messages = Array.from({ length: 1_000 }, (_, index) => ({
      id: 'same',
      type: 'Default',
      timestamp: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
      content: `message ${index}`,
      author: { name: 'a' },
    }));
    const result = parseDiscordExport(exportFixture({ messages }));
    const ids = result!.snapshot.targets[0]!.messages.map((message) => message.id);

    expect(ids).toHaveLength(400);
    expect(new Set(ids).size).toBe(400);
    expect(ids.at(-1)).toBe('discord:100:same#1000');
  });
});

describe('parseDiscordExport — vault interop', () => {
  it('produces a snapshot that survives the vault validator round-trip', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      {
        id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: 'hello',
        author: { name: 'a' },
        reactions: [{ emoji: { name: '👍' }, count: 1, users: [{ name: 'b' }] }],
      },
      {
        id: 'm2', type: 'Reply', timestamp: '2025-01-01T00:01:00Z', content: 'hi back',
        author: { name: 'b' }, reference: { messageId: 'm1' },
      },
    ] }));
    // parseVaultExport is what guards importVault against untrusted JSON; the
    // Discord-mapped snapshot must pass it losslessly.
    const revived = parseVaultExport(result!.snapshot);
    expect(revived).not.toBeNull();
    expect(revived!.targets).toHaveLength(1);
    expect(revived!.targets[0]!.messages).toHaveLength(2);
    const reply = revived!.targets[0]!.messages.find((m) => m.text === 'hi back')!;
    expect(reply.replyTo?.from).toBe('a');
    const reacted = revived!.targets[0]!.messages.find((m) => m.text === 'hello')!;
    expect(reacted.reactions?.[0]).toEqual({ emoji: '👍', users: ['b'] });
  });

  it('never emits HTML — imported markup stays inert text', () => {
    const result = parseDiscordExport(exportFixture({ messages: [
      { id: 'm1', type: 'Default', timestamp: '2025-01-01T00:00:00Z', content: '<img src=x onerror=alert(1)>', author: { name: '<b>x</b>' } },
    ] }));
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.text).toBe('<img src=x onerror=alert(1)>');
    expect(msg.from).toBe('<b>x</b>');
    // No HTML parsing/execution happens here — the renderer escapes at display.
  });
});
