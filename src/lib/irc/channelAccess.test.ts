// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  accessEntryKey,
  accessLevelLabel,
  formatAccessDuration,
  MAX_ACCESS_LIST_ENTRIES,
  MAX_ACCESS_MASK_LENGTH,
  normalizeAccessEntry,
  normalizeAccessList,
  normalizeAccessMask,
  parseAccessLevel,
  removeAccessEntry,
  sortAccessEntries,
  upsertAccessEntry,
  type ChannelAccessEntry,
} from './channelAccess';

describe('parseAccessLevel', () => {
  it('accepts the six IRCX channel levels case-insensitively', () => {
    expect(parseAccessLevel('host')).toBe('HOST');
    expect(parseAccessLevel('OWNER')).toBe('OWNER');
    expect(parseAccessLevel('  deny ')).toBe('DENY');
    expect(parseAccessLevel('FOUNDER')).toBe('FOUNDER');
    expect(parseAccessLevel('voice')).toBe('VOICE');
    expect(parseAccessLevel('grant')).toBe('GRANT');
  });

  it('rejects unknown or empty tokens', () => {
    expect(parseAccessLevel('')).toBeNull();
    expect(parseAccessLevel('OP')).toBeNull();
    expect(parseAccessLevel(null)).toBeNull();
  });
});

describe('normalizeAccessMask', () => {
  it('expands a bare nick to nick!*@*', () => {
    expect(normalizeAccessMask('Alice')).toBe('Alice!*@*');
  });

  it('keeps a full hostmask', () => {
    expect(normalizeAccessMask('bad!*@spam.example')).toBe('bad!*@spam.example');
  });

  it('rejects empty, control, overlong, or malformed masks', () => {
    expect(normalizeAccessMask('')).toBeNull();
    expect(normalizeAccessMask('a\nb!*@*')).toBeNull();
    expect(normalizeAccessMask(`${'x'.repeat(MAX_ACCESS_MASK_LENGTH)}!*@*`)).toBeNull();
    expect(normalizeAccessMask('!*@*')).toBeNull();
    expect(normalizeAccessMask('nick!@host')).toBeNull();
    expect(normalizeAccessMask('nick!user@')).toBeNull();
  });
});

describe('normalizeAccessEntry / list ops', () => {
  it('normalizes a complete entry and drops unsafe setters', () => {
    expect(
      normalizeAccessEntry({
        level: 'host',
        mask: 'bob',
        setBy: 'oper',
        duration: 25,
      }),
    ).toEqual({
      level: 'HOST',
      mask: 'bob!*@*',
      setBy: 'oper',
      duration: 25,
    });
    expect(
      normalizeAccessEntry({ level: 'DENY', mask: '*!*@bad.test', setBy: 'x\ny' }),
    ).toEqual({ level: 'DENY', mask: '*!*@bad.test' });
  });

  it('upserts by level+mask and removes by identity', () => {
    const a: ChannelAccessEntry = { level: 'HOST', mask: 'a!*@*' };
    const b: ChannelAccessEntry = { level: 'VOICE', mask: 'b!*@*' };
    const updated = upsertAccessEntry([a, b], {
      level: 'HOST',
      mask: 'a!*@*',
      setBy: 'me',
      duration: 60,
    });
    expect(updated).toHaveLength(2);
    expect(updated.find((e) => e.level === 'HOST')).toMatchObject({
      setBy: 'me',
      duration: 60,
    });
    expect(removeAccessEntry(updated, 'HOST', 'a')).toEqual([b]);
  });

  it('bounds normalizeAccessList and de-dupes', () => {
    const values = Array.from({ length: MAX_ACCESS_LIST_ENTRIES + 20 }, (_, i) => ({
      level: 'VOICE' as const,
      mask: `u${i}!*@*`,
    }));
    values.push({ level: 'VOICE', mask: 'u0!*@*' });
    const list = normalizeAccessList(values);
    expect(list).toHaveLength(MAX_ACCESS_LIST_ENTRIES);
    expect(list[0]?.mask).toBe('u0!*@*');
  });

  it('sorts DENY ahead of ranks and uses stable mask order', () => {
    const sorted = sortAccessEntries([
      { level: 'VOICE', mask: 'z!*@*' },
      { level: 'DENY', mask: 'b!*@*' },
      { level: 'HOST', mask: 'a!*@*' },
      { level: 'DENY', mask: 'a!*@*' },
    ]);
    expect(sorted.map((e) => `${e.level}:${e.mask}`)).toEqual([
      'DENY:a!*@*',
      'DENY:b!*@*',
      'HOST:a!*@*',
      'VOICE:z!*@*',
    ]);
  });

  it('formats durations for the settings list', () => {
    expect(formatAccessDuration(undefined)).toBe('Permanent');
    expect(formatAccessDuration(3600)).toBe('1 hour');
    expect(formatAccessDuration(86_400)).toBe('1 day');
    expect(accessLevelLabel('HOST')).toBe('Operator (host)');
    expect(accessEntryKey({ level: 'HOST', mask: 'A!*@*' })).toBe('HOST\0a!*@*');
  });
});
