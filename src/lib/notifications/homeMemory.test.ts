// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '@/lib/irc/types';
import { buildHomeMemory, summarizeHomeMemory } from './homeMemory';

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
      lastFrom: 'kai',
      preview: 'latest line',
    });
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
      msg({ encrypted: true, text: 'tsumugi:v1:opaque-ciphertext' }),
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
});
