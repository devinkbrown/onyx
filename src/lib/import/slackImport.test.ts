// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseVaultExport } from '@/lib/vault/historyVault';
import { normalizeSlackChannelTarget, parseSlackExport } from './slackImport';

/** A minimal Slack single-channel export bundle. */
function exportFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspace: { name: 'Cool Workspace' },
    channel: { id: 'C100', name: 'general' },
    users: [
      { id: 'U1', name: 'alice', real_name: 'Alice A' },
      { id: 'U2', name: 'bob' },
      { id: 'U3', name: 'carol' },
    ],
    messages: [
      {
        type: 'message',
        user: 'U1',
        text: 'first post',
        ts: '1735725600.100000',
      },
      {
        type: 'message',
        user: 'U2',
        text: 'second',
        ts: '1735725900.200000',
      },
    ],
    ...overrides,
  };
}

describe('normalizeSlackChannelTarget', () => {
  it('prefixes with # and lowercases', () => {
    expect(normalizeSlackChannelTarget('General')).toBe('#general');
  });

  it('strips leading hashes and illegal characters', () => {
    expect(normalizeSlackChannelTarget('##Off Topic!')).toBe('#off-topic');
  });

  it('collapses whitespace and repeated dashes', () => {
    expect(normalizeSlackChannelTarget('  dev   chat  ')).toBe('#dev-chat');
  });

  it('falls back for an empty name', () => {
    expect(normalizeSlackChannelTarget('   ')).toBe('#imported');
  });

  it('bounds hostile channel names to the vault target ceiling', () => {
    const target = normalizeSlackChannelTarget('x'.repeat(20_000));
    expect(target).toHaveLength(512);
    expect(target.startsWith('#')).toBe(true);
  });
});

describe('parseSlackExport — happy path', () => {
  it('maps a single channel export into a vault snapshot', () => {
    const result = parseSlackExport(exportFixture());
    expect(result).not.toBeNull();
    const { snapshot, summary } = result!;
    expect(snapshot.kind).toBe('onyx-vault');
    expect(snapshot.version).toBe(1);
    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.targets[0]!.target).toBe('#general');
    expect(snapshot.targets[0]!.messages).toHaveLength(2);
    expect(summary.workspace).toBe('Cool Workspace');
    expect(summary.channels).toBe(1);
    expect(summary.messages).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.oldest).toBe('2025-01-01T10:00:00.100Z');
    expect(summary.newest).toBe('2025-01-01T10:05:00.200Z');
  });

  it('maps user ids to display names and falls back for bots', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'from user', ts: '1735725600.000100' },
      { type: 'message', username: 'deploybot', bot_id: 'B1', text: 'from bot', ts: '1735725660.000200' },
      { type: 'message', bot_id: 'B2', text: 'from bare bot', ts: '1735725720.000300' },
    ] }));
    const messages = result!.snapshot.targets[0]!.messages;
    expect(messages.map((message) => message.from)).toEqual(['alice', 'deploybot', 'B2']);
  });

  it('sorts messages chronologically regardless of input order', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'later', ts: '1735812000.000000' },
      { type: 'message', user: 'U1', text: 'earlier', ts: '1735725600.000000' },
    ] }));
    expect(result!.snapshot.targets[0]!.messages.map((message) => message.text)).toEqual(['earlier', 'later']);
  });

  it('produces ids that are stable and channel-scoped', () => {
    const result = parseSlackExport(exportFixture());
    const message = result!.snapshot.targets[0]!.messages[0]!;
    expect(message.id).toBe('slack:C100:1735725600.100000');
    expect(message.type).toBe('msg');
  });
});

describe('parseSlackExport — input shapes', () => {
  it('accepts an array of channel bundles', () => {
    const result = parseSlackExport([
      exportFixture(),
      exportFixture({
        channel: { id: 'C200', name: 'random' },
        messages: [{ type: 'message', user: 'U3', text: 'hi', ts: '1735898400.000000' }],
      }),
    ]);
    expect(result!.snapshot.targets.map((target) => target.target).sort()).toEqual(['#general', '#random']);
  });

  it('accepts an { exports: [...] } bundle', () => {
    const result = parseSlackExport({ workspace: { name: 'Bundle Workspace' }, exports: [exportFixture()] });
    expect(result!.summary.workspace).toBe('Bundle Workspace');
    expect(result!.summary.channels).toBe(1);
  });

  it('accepts a workspace bundle with channels and users', () => {
    const result = parseSlackExport({
      team: { name: 'Team Name' },
      users: [{ id: 'U9', name: 'nina' }],
      channels: [
        {
          id: 'C9',
          name: 'support',
          messages: [{ type: 'message', user: 'U9', text: 'ticket', ts: '1735725600.000000' }],
        },
      ],
    });
    expect(result!.summary.workspace).toBe('Team Name');
    expect(result!.snapshot.targets[0]!.target).toBe('#support');
    expect(result!.snapshot.targets[0]!.messages[0]!.from).toBe('nina');
  });

  it('merges paginated exports of the same channel', () => {
    const page1 = exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'p1', ts: '1735725600.000000' },
    ] });
    const page2 = exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'p2', ts: '1735725900.000000' },
    ] });
    const result = parseSlackExport([page1, page2]);
    expect(result!.snapshot.targets).toHaveLength(1);
    expect(result!.snapshot.targets[0]!.messages).toHaveLength(2);
  });

  it('returns null for input with no channel export', () => {
    expect(parseSlackExport(null)).toBeNull();
    expect(parseSlackExport({})).toBeNull();
    expect(parseSlackExport('nope')).toBeNull();
    expect(parseSlackExport({ users: [{ id: 'U1', name: 'a' }] })).toBeNull();
    expect(parseSlackExport(42)).toBeNull();
  });
});

describe('parseSlackExport — content mapping', () => {
  it('rewrites known Slack user mentions to display names', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'hi <@U2> and <@U404>', ts: '1735725600.000000' },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('hi @bob and <@U404>');
  });

  it('appends file permalinks or private URLs to the message text', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      {
        type: 'message',
        user: 'U1',
        text: 'see this',
        ts: '1735725600.000000',
        files: [
          { permalink: 'https://slack.example/files/1', url_private: 'https://private.example/1' },
          { url_private: 'https://private.example/2', name: 'two.png' },
        ],
      },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('see this\nhttps://slack.example/files/1\nhttps://private.example/2');
  });

  it('keeps a file-only message using the URL as the body', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: '', ts: '1735725600.000000', files: [{ permalink: 'https://slack.example/file' }] },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('https://slack.example/file');
  });

  it('maps reactions with user names and preserves count separately', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      {
        type: 'message',
        user: 'U1',
        text: 'nice',
        ts: '1735725600.000000',
        reactions: [{ name: 'thumbsup', users: ['U1'], count: 3 }],
      },
    ] }));
    const reaction = result!.snapshot.targets[0]!.messages[0]!.reactions![0]!;
    expect(reaction.emoji).toBe(':thumbsup:');
    expect(reaction.users).toEqual(['alice']);
    expect(reaction.count).toBe(3);
  });

  it('caps a huge reaction count at MAX_REACTION_USERS', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'x', ts: '1735725600.000000', reactions: [{ name: 'fire', count: 100000 }] },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.reactions![0]!.users).toEqual([]);
    expect(result!.snapshot.targets[0]!.messages[0]!.reactions![0]!.count).toBe(100_000);
  });

  it('resolves thread replies to earlier messages in the same channel', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'question?', ts: '1735725600.000100' },
      { type: 'message', user: 'U2', text: 'answer', ts: '1735725660.000200', thread_ts: '1735725600.000100' },
    ] }));
    const reply = result!.snapshot.targets[0]!.messages.find((message) => message.text === 'answer')!;
    expect(reply.replyTo).toEqual({ id: 'slack:C100:1735725600.000100', from: 'alice', text: 'question?' });
  });

  it('omits replyTo when the thread parent is absent', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U2', text: 'answer', ts: '1735725660.000200', thread_ts: '1735725600.000100' },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.replyTo).toBeUndefined();
  });

  it('marks edited messages', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'fixed', ts: '1735725600.000000', edited: { ts: '1735725660.000000' } },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.edited).toBe(true);
  });
});

describe('parseSlackExport — filtering', () => {
  it('drops system subtype messages by default and counts them as skipped', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'hi', ts: '1735725600.000000' },
      { type: 'message', subtype: 'channel_join', user: 'U2', text: '<@U2> joined', ts: '1735725660.000000' },
    ] }));
    expect(result!.summary.messages).toBe(1);
    expect(result!.summary.skipped).toBe(1);
  });

  it('includes system messages when includeSystem is set', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', subtype: 'bot_add', username: 'slackbot', text: 'bot added', ts: '1735725600.000000' },
    ] }), { includeSystem: true });
    const message = result!.snapshot.targets[0]!.messages[0]!;
    expect(message.type).toBe('system');
    expect(message.text).toBe('bot added');
  });

  it('keeps Slack bot_message subtypes as chat messages', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', subtype: 'bot_message', username: 'deploybot', text: 'deployed', ts: '1735725600.000000' },
    ] }));
    expect(result!.snapshot.targets[0]!.messages[0]!.type).toBe('msg');
  });

  it('skips messages with an invalid timestamp', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'hi', ts: 'not-a-ts' },
    ] }));
    expect(result!.summary.messages).toBe(0);
    expect(result!.summary.skipped).toBe(1);
    expect(result!.snapshot.targets).toHaveLength(0);
  });

  it('skips empty-body messages with no files', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: '   ', ts: '1735725600.000000' },
    ] }));
    expect(result!.summary.messages).toBe(0);
    expect(result!.summary.skipped).toBe(1);
  });

  it('filters messages older than sinceDays relative to now', () => {
    const recent = String(Date.now() / 1000);
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'ancient', ts: '946684800.000000' },
      { type: 'message', user: 'U1', text: 'fresh', ts: recent },
    ] }), { sinceDays: 7 });
    expect(result!.summary.messages).toBe(1);
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('fresh');
  });

  it('caps per-channel messages to keepPerChannel, keeping the newest', () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      type: 'message',
      user: 'U1',
      ts: `${1735725600 + i * 60}.000000`,
      text: `msg ${i}`,
    }));
    const result = parseSlackExport(exportFixture({ messages }), { keepPerChannel: 2 });
    const kept = result!.snapshot.targets[0]!.messages;
    expect(kept).toHaveLength(2);
    expect(kept.map((message) => message.text)).toEqual(['msg 3', 'msg 4']);
    expect(result!.summary.droppedOverCap).toBe(3);
  });
});

describe('parseSlackExport — robustness', () => {
  it('resolves a thread reply whose parent is in an earlier paginated file', () => {
    const page1 = exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'parent', ts: '1735725600.000100' },
    ] });
    const page2 = exportFixture({ messages: [
      { type: 'message', user: 'U2', text: 'child', ts: '1735725900.000200', thread_ts: '1735725600.000100' },
    ] });
    const result = parseSlackExport([page1, page2]);
    const child = result!.snapshot.targets[0]!.messages.find((message) => message.text === 'child')!;
    expect(child.replyTo).toEqual({ id: 'slack:C100:1735725600.000100', from: 'alice', text: 'parent' });
  });

  it('keeps both messages when Slack timestamps collide within a channel', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: 'one', ts: '1735725600.000000' },
      { type: 'message', user: 'U1', text: 'two', ts: '1735725600.000000' },
    ] }));
    const messages = result!.snapshot.targets[0]!.messages;
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
  });

  it('falls back to the default cap for a non-finite keepPerChannel', () => {
    const result = parseSlackExport(exportFixture(), { keepPerChannel: Number.NaN });
    expect(result!.snapshot.targets[0]!.messages).toHaveLength(2);
    expect(result!.summary.droppedOverCap).toBe(0);
  });

  it('ignores a non-finite sinceDays instead of filtering everything', () => {
    const result = parseSlackExport(exportFixture(), { sinceDays: Infinity });
    expect(result!.summary.messages).toBe(2);
  });

  it('bounds memory: mid-scan compaction keeps only newest keepPerChannel', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      type: 'message',
      user: 'U1',
      ts: `${1735725600 + i * 60}.000000`,
      text: `m${i}`,
    }));
    const result = parseSlackExport(exportFixture({ messages }), { keepPerChannel: 3 });
    const kept = result!.snapshot.targets[0]!.messages;
    expect(kept.map((message) => message.text)).toEqual(['m17', 'm18', 'm19']);
    expect(result!.summary.droppedOverCap).toBe(17);
  });

  it('bounds hostile fields, files, reactions, and reactor lists', () => {
    const files = [
      { permalink: 'javascript:alert(1)' },
      { permalink: 'https://user:secret@example.com/private.png' },
      { permalink: 'http://127.0.0.1/internal.png' },
      ...Array.from({ length: 40 }, (_, index) => ({
        permalink: `https://files.example/${index}.png`,
      })),
    ];
    const reactions = Array.from({ length: 70 }, (_, reactionIndex) => ({
      name: `reaction-${reactionIndex}`,
      count: 150,
      users: Array.from({ length: 120 }, (_, userIndex) => `user ${userIndex}`),
    }));
    const result = parseSlackExport(exportFixture({
      workspace: { name: `Workspace\u0000${'w'.repeat(400)}` },
      channel: { id: 'c'.repeat(500), name: 'general' },
      messages: [{
        type: 'message',
        username: `Alice Smith\u0000${'a'.repeat(400)}`,
        text: 'x'.repeat(70 * 1_024),
        ts: '1735725600.100000',
        files,
        reactions,
      }],
    }));
    const message = result!.snapshot.targets[0]!.messages[0]!;

    expect(result!.summary.workspace).toHaveLength(256);
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

  it('caps per-export and aggregate message work while retaining scanned tails', () => {
    const rows = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
      type: 'message',
      username: 'a',
      ts: `${1735725600 + index}.000000`,
      text: `${prefix} ${index}`,
    }));
    const exports = Array.from({ length: 12 }, (_, index) => exportFixture({
      channel: { id: `C${index + 100}`, name: `channel-${index}` },
      messages: rows(`c${index}-`, 1_700),
    }));
    const result = parseSlackExport(exports);

    expect(result!.summary.messages).toBe(10 * 400 + 384);
    expect(result!.summary.droppedOverCap).toBe(12 * 1_700 - (10 * 400 + 384));
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('c0- 1300');
    expect(result!.snapshot.targets.at(-1)!.target).toBe('#channel-10');
  });

  it('allocates duplicate timestamps without quadratic suffix rescans', () => {
    const messages = Array.from({ length: 1_000 }, (_, index) => ({
      type: 'message',
      username: 'a',
      ts: '1735725600.000000',
      text: `message ${index}`,
    }));
    const result = parseSlackExport(exportFixture({ messages }));
    const ids = result!.snapshot.targets[0]!.messages.map((message) => message.id);

    expect(ids).toHaveLength(400);
    expect(new Set(ids).size).toBe(400);
    expect(ids.at(-1)).toBe('slack:C100:1735725600.000000#1000');
  });

  it('never seats private or credential-bearing file URLs in imported text', () => {
    const result = parseSlackExport(exportFixture({ messages: [{
      type: 'message',
      username: 'a',
      ts: '1735725600.000000',
      text: 'files',
      files: [
        { permalink: 'http://192.168.1.1/router.png' },
        { permalink: 'https://user:secret@example.com/private.png' },
        { permalink: 'https://files.example/public.png' },
      ],
    }] }));

    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe(
      'files\nhttps://files.example/public.png',
    );
  });
});

describe('parseSlackExport — vault interop', () => {
  it('produces a snapshot that survives the vault validator round-trip', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      {
        type: 'message',
        user: 'U1',
        text: 'hello',
        ts: '1735725600.000100',
        reactions: [{ name: 'wave', users: ['U2'], count: 1 }],
      },
      {
        type: 'message',
        user: 'U2',
        text: 'hi back',
        ts: '1735725660.000200',
        thread_ts: '1735725600.000100',
      },
    ] }));
    // parseVaultExport is what guards importVault against untrusted JSON; the
    // Slack-mapped snapshot must pass it losslessly.
    const revived = parseVaultExport(result!.snapshot);
    expect(revived).not.toBeNull();
    expect(revived!.targets).toHaveLength(1);
    expect(revived!.targets[0]!.messages).toHaveLength(2);
    const reply = revived!.targets[0]!.messages.find((message) => message.text === 'hi back')!;
    expect(reply.replyTo?.from).toBe('alice');
    const reacted = revived!.targets[0]!.messages.find((message) => message.text === 'hello')!;
    expect(reacted.reactions?.[0]).toEqual({ emoji: ':wave:', users: ['bob'], count: 1 });
  });

  it('never emits HTML — imported markup stays inert text', () => {
    const result = parseSlackExport(exportFixture({ messages: [
      { type: 'message', user: 'U1', text: '<img src=x onerror=alert(1)>', ts: '1735725600.000000' },
    ] }));
    const message = result!.snapshot.targets[0]!.messages[0]!;
    expect(message.text).toBe('<img src=x onerror=alert(1)>');
    // No HTML parsing/execution happens here — the renderer escapes at display.
  });
});
