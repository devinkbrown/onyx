// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '@/lib/irc/types';
import {
  buildHomeMemory,
  buildHomeMemoryFromVault,
  collectHomeMemoryTargets,
  summarizeHomeMemory,
} from './homeMemory';

const base = new Date('2026-07-09T00:00:00.000Z');
let idSeq = 0;

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? `m-${++idSeq}`,
    time: overrides.time ?? base,
    from: overrides.from ?? 'mira',
    text: overrides.text ?? 'hello',
    type: overrides.type ?? 'msg',
    target: overrides.target ?? '#room',
    ...overrides,
  };
}

describe('summarizeHomeMemory', () => {
  test('summarizes readable vaulted messages for a target', () => {
    const summary = summarizeHomeMemory('#room', [
      msg({ from: 'mira', text: 'first', time: new Date(base.getTime() + 1000) }),
      msg({ from: 'kai', text: 'latest line', time: new Date(base.getTime() + 2000) }),
    ]);

    expect(summary).toMatchObject({
      target: '#room',
      count: 2,
      participants: ['mira', 'kai'],
      lastMessageId: expect.any(String),
      lastFrom: 'kai',
      preview: 'latest line',
    });
  });

  test('pins lastMessageId to the newest readable row', () => {
    const summary = summarizeHomeMemory('#room', [
      msg({ id: 'older', text: 'first', time: new Date(base.getTime() + 1000) }),
      msg({ id: 'newest', text: 'last', time: new Date(base.getTime() + 3000) }),
      msg({ id: 'middle', text: 'mid', time: new Date(base.getTime() + 2000) }),
    ]);

    expect(summary?.lastMessageId).toBe('newest');
  });

  test('ignores system, deleted, redacted, and pending rows', () => {
    const summary = summarizeHomeMemory('#room', [
      msg({ type: 'join', text: 'mira joined' }),
      msg({ text: 'deleted', deleted: true }),
      msg({ text: 'redacted', redacted: true }),
      msg({ text: 'pending', pending: true }),
    ]);

    expect(summary).toBeNull();
  });

  test('does not expose ciphertext for encrypted vaulted DMs', () => {
    const summary = summarizeHomeMemory('mira', [
      msg({ encrypted: true, text: 'onyxdm:v1:opaque-ciphertext' }),
    ]);

    expect(summary?.preview).toBe('Encrypted message');
  });

  test('does not expose a vault envelope when a legacy row lacks its flag', () => {
    const summary = summarizeHomeMemory('mira', [
      msg({ text: 'ONYXDM1 opaque-ciphertext' }),
    ]);

    expect(summary?.preview).toBe('Encrypted message');
  });

  test('normalizes long previews', () => {
    const summary = summarizeHomeMemory('#room', [
      msg({ text: `line\n${'x'.repeat(120)}` }),
    ]);

    expect(summary?.preview).toMatch(/^line x+/);
    expect(summary?.preview.length).toBe(96);
    expect(summary?.preview.endsWith('…')).toBe(true);
  });
});

describe('buildHomeMemory', () => {
  test('loads targets, drops empty summaries, sorts newest first, and caps results', async () => {
    const out = await buildHomeMemory(
      ['#old', '#empty', '#new'],
      async (target) => {
        if (target === '#empty') return [];
        return [
          msg({
            target,
            text: target,
            time: target === '#new' ? new Date(base.getTime() + 4000) : new Date(base.getTime() + 1000),
          }),
        ];
      },
      1,
    );

    expect(out.map((item) => item.target)).toEqual(['#new']);
  });

  test('summarizes an owner-scoped vault snapshot without live target state', () => {
    const out = buildHomeMemoryFromVault([
      {
        target: '#older',
        messages: [msg({ id: 'older-1', target: '#older', time: new Date(base.getTime() + 1000) })],
      },
      {
        target: 'mira',
        messages: [msg({ id: 'dm-2', target: 'mira', time: new Date(base.getTime() + 5000) })],
      },
    ]);

    expect(out.map((item) => [item.target, item.lastMessageId])).toEqual([
      ['mira', 'dm-2'],
      ['#older', 'older-1'],
    ]);
  });

  test('caps vault enumeration and never invents unread/membership fields', () => {
    const out = buildHomeMemoryFromVault(
      [
        {
          target: '#a',
          messages: [msg({ id: 'a-1', target: '#a', time: new Date(base.getTime() + 1000) })],
        },
        {
          target: '#b',
          messages: [msg({ id: 'b-1', target: '#b', time: new Date(base.getTime() + 2000) })],
        },
        {
          target: '#c',
          messages: [msg({ id: 'c-1', target: '#c', time: new Date(base.getTime() + 3000) })],
        },
      ],
      2,
    );

    expect(out).toHaveLength(2);
    expect(out.map((item) => item.target)).toEqual(['#c', '#b']);
    for (const item of out) {
      expect(item).not.toHaveProperty('unread');
      expect(item).not.toHaveProperty('highlights');
      expect(item).not.toHaveProperty('followed');
    }
  });
});

describe('collectHomeMemoryTargets', () => {
  test('prefers join history, then auto-join, skips live rooms, and caps fan-out', () => {
    expect(
      collectHomeMemoryTargets(
        ['#left', '#still-joined'],
        ['#still-joined', '#auto', '#auto-dup', '#extra'],
        ['#still-joined'],
        3,
      ),
    ).toEqual(['#left', '#auto', '#auto-dup']);
  });

  test('is case-insensitive against the live map and de-dupes mixed sources', () => {
    expect(
      collectHomeMemoryTargets(
        ['#Archive'],
        ['#archive', '#Ops'],
        new Set(['#OPS']),
        6,
      ),
    ).toEqual(['#Archive']);
  });
});
