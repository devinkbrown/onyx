// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * parseVaultExport.pure.test.ts — the authoritative import-validation contract
 * for a VAULT EXPORT (a structured, user-controlled JSON blob imported wholesale).
 *
 * Contract (resolved, documents real intent — see historyVault.parseVaultExport):
 *  - FAIL-CLOSED on a malformed/tampered TOP-LEVEL structure: a non-object, a
 *    wrong/absent `kind`, a `version` that is not exactly 1, or a `targets` that
 *    is not an array → return null, import NOTHING.
 *  - REVIVE-AND-DROP within an otherwise-valid export: an individual malformed
 *    TARGET is skipped, and an individual malformed MESSAGE is dropped, while the
 *    rest of the valid export survives. This is deliberate resilience against a
 *    single corrupt row nuking a user's whole imported history — NOT the Discord
 *    importer's per-record best-effort, but the same "don't lose everything to one
 *    bad row" principle applied to a self-produced, structurally-gated blob.
 *  - NEVER throws on hostile/untrusted nested shapes.
 *  - NEVER pollutes Object.prototype (the parser only builds object literals from
 *    validated primitives; there is no untrusted-key write path).
 *  - PRESERVES the E2EE invariant: serializeMessage strips decrypted `plaintext`;
 *    only the ciphertext envelope (`text`) is ever persisted.
 *
 * Pure: parseVaultExport / serializeMessage / deserializeMessage never open the
 * DB, so this file is DOM-free and IndexedDB-free (no fake-indexeddb needed).
 */
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import {
  deserializeMessage,
  MAX_EXPORT_RAW_MESSAGES,
  MAX_EXPORT_TOTAL_RAW_MESSAGES,
  MAX_EXPORT_TARGETS,
  MAX_VAULT_MESSAGE_ID_LENGTH,
  MAX_VAULT_MESSAGE_TEXT_LENGTH,
  MAX_VAULT_MESSAGE_TYPE_LENGTH,
  MAX_VAULT_REACTIONS,
  MAX_VAULT_REACTION_FIELD_LENGTH,
  MAX_VAULT_REACTION_USERS,
  MAX_VAULT_REPLY_TEXT_LENGTH,
  MAX_VAULT_SENDER_LENGTH,
  MAX_VAULT_TARGET_LENGTH,
  MAX_VAULT_TIMESTAMP_LENGTH,
  MAX_VAULT_TOPIC_LENGTH,
  parseVaultExport,
  serializeMessage,
  type VaultExportSnapshot,
} from './historyVault';

function message(id: string, target: string, timeMs: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    target,
    time: new Date(timeMs),
    from: 'kain',
    text: `ciphertext:${id}`,
    type: 'msg',
    ...over,
  };
}

function jsonClone<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function messageDigest(item: ChatMessage): Record<string, unknown> {
  return {
    id: item.id,
    from: item.from,
    target: item.target,
    text: item.text,
    type: item.type,
    time: item.time.toISOString(),
  };
}

describe('parseVaultExport — vault import validation contract', () => {
  it('round-trips a well-formed exported snapshot', () => {
    const alpha = message('a1', '#Alpha', Date.parse('2026-07-10T10:00:00.000Z'), {
      from: 'alice',
      text: 'hello channel',
    });
    const dm = message('d1', 'Trev', Date.parse('2026-07-10T10:01:00.000Z'), {
      from: 'trev',
      text: 'tsumugi.ciphertext',
      encrypted: true,
    });
    const snapshot: VaultExportSnapshot = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-10T10:02:00.000Z',
      targets: [
        { target: '#alpha', messages: [deserializeMessage(serializeMessage('#Alpha', alpha))] },
        { target: 'trev', messages: [deserializeMessage(serializeMessage('Trev', dm))] },
      ],
    };

    const parsed = parseVaultExport(jsonClone(snapshot));

    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('onyx-vault');
    expect(parsed!.version).toBe(1);
    expect(parsed!.exportedAt).toBe('2026-07-10T10:02:00.000Z');
    expect(parsed!.targets.map((t) => t.target)).toEqual(['#alpha', 'trev']);
    expect(parsed!.targets.flatMap((t) => t.messages.map(messageDigest))).toEqual([
      messageDigest(alpha),
      messageDigest(dm),
    ]);
  });

  it('FAILS CLOSED on a malformed top-level export (imports nothing)', () => {
    const malformed: unknown[] = [
      null,
      undefined,
      'not json',
      42,
      true,
      [],
      () => ({ kind: 'onyx-vault', version: 1, targets: [] }),
      {},
      { kind: 'onyx-vault' },
      { kind: 'onyx-vault', version: 1 },
      { kind: 'onyx-vault', version: 1, targets: 'truncated' },
      { kind: 'onyx-vault', version: 1, targets: {} },
      { kind: 'onyx-vault', version: '1', targets: [] }, // version must be strictly numeric 1
      { kind: 'onyx-vault', version: 2, targets: [] },
      { kind: 'not-onyx', version: 1, targets: [] },
      { kind: '', version: 1, targets: [] },
    ];

    for (const raw of malformed) {
      expect(() => parseVaultExport(raw)).not.toThrow();
      expect(parseVaultExport(raw)).toBeNull();
    }
  });

  it('accepts a valid top-level but DROPS an individual malformed message (revive-and-drop, not whole-blob reject)', () => {
    const good = message('a1', '#alpha', Date.parse('2026-07-10T10:00:00.000Z'), { from: 'alice' });
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-10T10:02:00.000Z',
      targets: [
        {
          target: '#Alpha',
          messages: [
            jsonClone(good),
            // missing `from` → dropped, but the export as a whole survives
            { id: 'b1', text: 'no author', type: 'msg', target: '#alpha', time: '2026-07-10T10:01:00.000Z' },
            // disallowed type not in MESSAGE_TYPES → dropped
            { id: 'b2', from: 'mallory', text: 'x', type: 'nuke', target: '#alpha', time: 1 },
            // unparseable time → dropped
            { id: 'b3', from: 'eve', text: 'y', type: 'msg', target: '#alpha', time: 'not-a-date' },
          ],
        },
      ],
    };

    const parsed = parseVaultExport(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.targets).toHaveLength(1);
    expect(parsed!.targets[0]!.target).toBe('#alpha');
    // Only the one valid message survives; the three hostile rows are dropped.
    expect(parsed!.targets[0]!.messages.map((m) => m.id)).toEqual(['a1']);
  });

  it('SKIPS an individual malformed target while keeping the valid ones', () => {
    const good = message('a1', '#alpha', Date.parse('2026-07-10T10:00:00.000Z'));
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      targets: [
        null,
        [],
        'nope',
        { messages: [] }, // no target string
        { target: '   ', messages: [] }, // blank target
        { target: '#beta', messages: 'not-an-array' }, // bad messages shape
        { target: '#Alpha', messages: [jsonClone(good)] }, // the one valid target
      ],
    };

    const parsed = parseVaultExport(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.targets.map((t) => t.target)).toEqual(['#alpha']);
    expect(parsed!.targets[0]!.messages.map((m) => m.id)).toEqual(['a1']);
  });

  it('does not throw on deeply hostile nested shapes and drops every unparseable row', () => {
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: 'not a date',
      targets: [
        {
          target: '#alpha',
          messages: [
            null,
            [],
            42,
            {
              id: ['not', 'a', 'string'],
              from: { nested: true },
              text: 42,
              time: { valueOf: 'nope' },
              type: 'msg',
              reactions: [{ emoji: null, users: [true, 'alice'] }],
            },
          ],
        },
      ],
    };

    let parsed: VaultExportSnapshot | null = null;
    expect(() => {
      parsed = parseVaultExport(raw);
    }).not.toThrow();
    expect(parsed).not.toBeNull();
    // Bad exportedAt is replaced with a valid ISO stamp (never propagated raw).
    expect(Number.isNaN(Date.parse(parsed!.exportedAt))).toBe(false);
    expect(parsed!.targets[0]!.messages).toEqual([]);
  });

  it('does NOT pollute Object.prototype from a hostile __proto__/constructor payload', () => {
    // A realistic tampered JSON blob: `__proto__` is an OWN enumerable key here,
    // not a real prototype link (that is exactly how JSON.parse materializes it).
    const raw = JSON.parse(
      '{"kind":"onyx-vault","version":1,"__proto__":{"polluted":"yes"},' +
        '"targets":[{"target":"__proto__","messages":[' +
        '{"id":"x1","from":"mallory","text":"c","type":"msg","target":"__proto__","time":1,' +
        '"__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"}}]}]}',
    ) as unknown;

    const parsed = parseVaultExport(raw);

    // No global prototype pollution occurred.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    // The literal string "__proto__" target is just a value; it parses safely and
    // is stored as an own key on a fresh object, never touching the prototype.
    expect(parsed).not.toBeNull();
    expect(parsed!.targets[0]!.target).toBe('__proto__');
    expect(Object.getPrototypeOf(parsed!.targets[0]!.messages[0]!)).toBe(Object.prototype);
    expect(parsed!.targets[0]!.messages[0]!.id).toBe('x1');
  });

  it('strips decrypted E2EE plaintext from serialized messages (never at rest)', () => {
    const encryptedDm = message('dm1', 'Trev', Date.parse('2026-07-10T10:03:00.000Z'), {
      encrypted: true,
      text: 'tsumugi.ciphertext.envelope',
      plaintext: 'this decrypted DM must never be persisted',
    });

    const stored = serializeMessage('Trev', encryptedDm);

    expect(stored.text).toBe('tsumugi.ciphertext.envelope');
    expect(stored.encrypted).toBe(true);
    expect(stored.target_key).toBe('trev');
    expect(Object.prototype.hasOwnProperty.call(stored, 'plaintext')).toBe(false);
    expect(JSON.stringify(stored)).not.toContain('this decrypted DM must never be persisted');
  });

  it('does not revive plaintext back onto an imported message', () => {
    // Even if a tampered export smuggles a `plaintext` field, the allowlisted
    // revive path never copies it onto the ChatMessage.
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      targets: [
        {
          target: 'trev',
          messages: [
            {
              id: 'dm2',
              from: 'trev',
              text: 'tsumugi.ciphertext',
              type: 'msg',
              target: 'trev',
              time: 1,
              encrypted: true,
              plaintext: 'smuggled decrypted body',
            },
          ],
        },
      ],
    };

    const parsed = parseVaultExport(raw);

    expect(parsed).not.toBeNull();
    const revived = parsed!.targets[0]!.messages[0]!;
    expect(Object.prototype.hasOwnProperty.call(revived, 'plaintext')).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('smuggled decrypted body');
  });

  it('returns a valid-but-empty snapshot when every target is garbage (imports nothing, still fail-safe)', () => {
    const raw = { kind: 'onyx-vault', version: 1, targets: [null, 1, 'x', {}] };
    const parsed = parseVaultExport(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.targets).toEqual([]);
  });

  it('BOUNDS an oversized per-target message array to the raw ceiling (keeps the newest tail)', () => {
    const overBy = 250;
    const rawCount = MAX_EXPORT_RAW_MESSAGES + overBy;
    const base = Date.parse('2026-07-10T00:00:00.000Z');
    const messages = Array.from({ length: rawCount }, (_, i) =>
      jsonClone(message(`m${i}`, '#flood', base + i * 1000)),
    );
    const raw = { kind: 'onyx-vault', version: 1, targets: [{ target: '#flood', messages }] };

    const parsed = parseVaultExport(raw);

    expect(parsed).not.toBeNull();
    const ids = parsed!.targets[0]!.messages.map((m) => m.id);
    // Capped at the ceiling, and it is the NEWEST tail that survives (chronological
    // export ⇒ tail == most recent), never the oldest leading rows.
    expect(ids).toHaveLength(MAX_EXPORT_RAW_MESSAGES);
    expect(ids[0]).toBe(`m${overBy}`);
    expect(ids[ids.length - 1]).toBe(`m${rawCount - 1}`);
  });

  it('BOUNDS an oversized targets array to the target ceiling', () => {
    const over = 32;
    const targets = Array.from({ length: MAX_EXPORT_TARGETS + over }, (_, i) => ({
      target: `#chan${i}`,
      messages: [jsonClone(message(`m${i}`, `#chan${i}`, Date.parse('2026-07-10T00:00:00.000Z')))],
    }));
    const raw = { kind: 'onyx-vault', version: 1, targets };

    const parsed = parseVaultExport(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.targets).toHaveLength(MAX_EXPORT_TARGETS);
    // The tail targets beyond the ceiling are never materialized.
    expect(parsed!.targets.at(-1)!.target).toBe(`#chan${MAX_EXPORT_TARGETS - 1}`);
  });

  it('BOUNDS aggregate message validation work across many valid targets', () => {
    const perTarget = MAX_EXPORT_RAW_MESSAGES;
    const targetCount = Math.ceil(MAX_EXPORT_TOTAL_RAW_MESSAGES / perTarget) + 2;
    const targets = Array.from({ length: targetCount }, (_, targetIndex) => ({
      target: `#bulk-${targetIndex}`,
      messages: Array.from({ length: perTarget }, (_, messageIndex) => jsonClone(message(
        `m-${targetIndex}-${messageIndex}`,
        `#bulk-${targetIndex}`,
        targetIndex * perTarget + messageIndex,
      ))),
    }));

    const parsed = parseVaultExport({ kind: 'onyx-vault', version: 1, targets });
    const parsedCount = parsed!.targets.reduce((count, target) => count + target.messages.length, 0);

    expect(parsedCount).toBe(MAX_EXPORT_TOTAL_RAW_MESSAGES);
    expect(parsed!.targets.length).toBeLessThan(targetCount);
  });

  it('rejects overlong targets and rows before importing them', () => {
    const valid = jsonClone(message('ok', '#valid', 1));
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      targets: [
        { target: `#${'t'.repeat(MAX_VAULT_TARGET_LENGTH)}`, messages: [valid] },
        {
          target: '#valid',
          messages: [
            { ...message('ok', '#valid', 1), id: 'i'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH + 1) },
            { ...message('ok', '#valid', 1), from: 'f'.repeat(MAX_VAULT_SENDER_LENGTH + 1) },
            { ...message('ok', '#valid', 1), text: 'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH + 1) },
            { ...message('ok', '#valid', 1), target: `#${'m'.repeat(MAX_VAULT_TARGET_LENGTH)}` },
          ],
        },
      ],
    };

    const parsed = parseVaultExport(raw)!;

    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0]!.target).toBe('#valid');
    expect(parsed.targets[0]!.messages).toEqual([]);
  });

  it('preserves exact-limit core fields and rejects control-bearing wire tokens', () => {
    const exactTarget = `#${'t'.repeat(MAX_VAULT_TARGET_LENGTH - 1)}`;
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      targets: [{
        target: exactTarget,
        messages: [
          {
            ...message('i'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH), exactTarget, 1),
            from: 'f'.repeat(MAX_VAULT_SENDER_LENGTH),
            text: 'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH),
          },
          { ...message('bad id', exactTarget, 2) },
          { ...message('bad-from', exactTarget, 3), from: 'bad\nfrom' },
        ],
      }],
    };

    const parsed = parseVaultExport(raw)!;

    expect(parsed.targets[0]!.target).toBe(exactTarget);
    expect(parsed.targets[0]!.messages).toHaveLength(1);
    expect(parsed.targets[0]!.messages[0]).toMatchObject({
      id: 'i'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH),
      from: 'f'.repeat(MAX_VAULT_SENDER_LENGTH),
      text: 'x'.repeat(MAX_VAULT_MESSAGE_TEXT_LENGTH),
    });
  });

  it('bounds timestamp and type validation before parsing untrusted strings', () => {
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2'.repeat(MAX_VAULT_TIMESTAMP_LENGTH + 1),
      targets: [{
        target: '#bounded',
        messages: [
          { ...message('bad-time', '#bounded', 1), time: '2'.repeat(MAX_VAULT_TIMESTAMP_LENGTH + 1) },
          { ...message('bad-type', '#bounded', 2), type: 'm'.repeat(MAX_VAULT_MESSAGE_TYPE_LENGTH + 1) },
          message('good', '#bounded', 3),
        ],
      }],
    };

    const parsed = parseVaultExport(raw)!;

    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(parsed.exportedAt).not.toBe(raw.exportedAt);
    expect(parsed.targets[0]!.messages.map((item) => item.id)).toEqual(['good']);
  });

  it('bounds optional topic, reaction, and reply metadata independently', () => {
    const reactions = Array.from({ length: MAX_VAULT_REACTIONS + 2 }, (_, index) => ({
      emoji: index === 0 ? 'e'.repeat(MAX_VAULT_REACTION_FIELD_LENGTH + 1) : `e${index}`,
      users: [
        ...Array.from({ length: MAX_VAULT_REACTION_USERS }, (_, userIndex) => `u${userIndex}`),
        'u'.repeat(MAX_VAULT_REACTION_FIELD_LENGTH + 1),
        'overflow',
      ],
    }));
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      targets: [{
        target: '#metadata',
        messages: [
          {
            ...message('bounded', '#metadata', 1),
            topic: 't'.repeat(MAX_VAULT_TOPIC_LENGTH + 1),
            reactions,
            replyTo: { id: 'reply', from: 'alice', text: 'r'.repeat(MAX_VAULT_REPLY_TEXT_LENGTH + 1) },
          },
          {
            ...message('exact', '#metadata', 2),
            topic: 't'.repeat(MAX_VAULT_TOPIC_LENGTH),
            replyTo: {
              id: 'i'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH),
              from: 'f'.repeat(MAX_VAULT_SENDER_LENGTH),
              text: 'r'.repeat(MAX_VAULT_REPLY_TEXT_LENGTH),
            },
          },
        ],
      }],
    };

    const parsed = parseVaultExport(raw)!;
    const bounded = parsed.targets[0]!.messages[0]!;
    const exact = parsed.targets[0]!.messages[1]!;

    expect(bounded.topic).toBeUndefined();
    expect(bounded.replyTo).toBeUndefined();
    expect(bounded.reactions).toHaveLength(MAX_VAULT_REACTIONS - 1);
    expect(bounded.reactions![0]!.users).toHaveLength(MAX_VAULT_REACTION_USERS);
    expect(exact.topic).toHaveLength(MAX_VAULT_TOPIC_LENGTH);
    expect(exact.replyTo).toEqual({
      id: 'i'.repeat(MAX_VAULT_MESSAGE_ID_LENGTH),
      from: 'f'.repeat(MAX_VAULT_SENDER_LENGTH),
      text: 'r'.repeat(MAX_VAULT_REPLY_TEXT_LENGTH),
    });
  });

  it('DEDUPES duplicate message ids within a target deterministically (last occurrence wins)', () => {
    const first = jsonClone(
      message('dup', '#alpha', Date.parse('2026-07-10T10:00:00.000Z'), { from: 'alice', text: 'first' }),
    );
    const other = jsonClone(message('solo', '#alpha', Date.parse('2026-07-10T10:01:00.000Z')));
    const last = jsonClone(
      message('dup', '#alpha', Date.parse('2026-07-10T10:02:00.000Z'), { from: 'alice', text: 'last-wins' }),
    );
    const raw = {
      kind: 'onyx-vault',
      version: 1,
      targets: [{ target: '#alpha', messages: [first, other, last] }],
    };

    const parsed = parseVaultExport(raw);

    expect(parsed).not.toBeNull();
    const revived = parsed!.targets[0]!.messages;
    // One 'dup' row, not two; first-appearance order preserved, last value wins.
    expect(revived.map((m) => m.id)).toEqual(['dup', 'solo']);
    expect(revived[0]!.text).toBe('last-wins');
  });

  it('is idempotent across a re-import round-trip (dedup makes re-parsing stable)', () => {
    const snapshot: VaultExportSnapshot = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-10T10:02:00.000Z',
      targets: [
        {
          target: '#alpha',
          messages: [
            deserializeMessage(serializeMessage('#alpha', message('a1', '#alpha', 1_000))),
            deserializeMessage(serializeMessage('#alpha', message('a2', '#alpha', 2_000))),
          ],
        },
      ],
    };

    const once = parseVaultExport(jsonClone(snapshot))!;
    const twice = parseVaultExport(jsonClone(once))!;

    expect(twice.targets[0]!.messages.map(messageDigest)).toEqual(
      once.targets[0]!.messages.map(messageDigest),
    );
  });
});
