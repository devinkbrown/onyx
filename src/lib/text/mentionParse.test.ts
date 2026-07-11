// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { parseMentions } from './mentionParse';

function rangeValues(text: string, ranges: ReturnType<typeof parseMentions>['ranges']): string[] {
  return ranges.map((range) => text.slice(range.start, range.end));
}

describe('parseMentions', () => {
  it('extracts a single mention', () => {
    expect(parseMentions('hello @alice')).toEqual({
      mentions: ['alice'],
      channels: [],
      ranges: [{ start: 6, end: 12, kind: 'mention', value: 'alice' }],
    });
  });

  it('extracts multiple mentions with IRC nick characters', () => {
    const text = String.raw`@Alice ping @dev[ops] and @build\bot`;

    expect(parseMentions(text)).toEqual({
      mentions: ['Alice', 'dev[ops]', String.raw`build\bot`],
      channels: [],
      ranges: [
        { start: 0, end: 6, kind: 'mention', value: 'Alice' },
        { start: 12, end: 21, kind: 'mention', value: 'dev[ops]' },
        { start: 26, end: 36, kind: 'mention', value: String.raw`build\bot` },
      ],
    });
  });

  it('ignores mid-word @ tokens such as email addresses', () => {
    expect(parseMentions('mail alice@example.com or ping @ops')).toEqual({
      mentions: ['ops'],
      channels: [],
      ranges: [{ start: 31, end: 35, kind: 'mention', value: 'ops' }],
    });
  });

  it('extracts IRC channel references', () => {
    expect(parseMentions('join #onyx and &ops, then #dev\x07now')).toEqual({
      mentions: [],
      channels: ['#onyx', '&ops', '#dev'],
      ranges: [
        { start: 5, end: 10, kind: 'channel', value: '#onyx' },
        { start: 15, end: 19, kind: 'channel', value: '&ops' },
        { start: 26, end: 30, kind: 'channel', value: '#dev' },
      ],
    });
  });

  it('extracts mixed mentions and channels in text order', () => {
    expect(parseMentions('(@Alice) meet in #Root with @bob.')).toEqual({
      mentions: ['Alice', 'bob'],
      channels: ['#Root'],
      ranges: [
        { start: 1, end: 7, kind: 'mention', value: 'Alice' },
        { start: 17, end: 22, kind: 'channel', value: '#Root' },
        { start: 28, end: 32, kind: 'mention', value: 'bob' },
      ],
    });
  });

  it('deduplicates mention and channel arrays case-insensitively', () => {
    expect(parseMentions('@Alice @alice #Root #root &Ops &ops')).toEqual({
      mentions: ['Alice'],
      channels: ['#Root', '&Ops'],
      ranges: [
        { start: 0, end: 6, kind: 'mention', value: 'Alice' },
        { start: 7, end: 13, kind: 'mention', value: 'alice' },
        { start: 14, end: 19, kind: 'channel', value: '#Root' },
        { start: 20, end: 25, kind: 'channel', value: '#root' },
        { start: 26, end: 30, kind: 'channel', value: '&Ops' },
        { start: 31, end: 35, kind: 'channel', value: '&ops' },
      ],
    });
  });

  it('rejects unicode nick text instead of partially parsing it', () => {
    expect(parseMentions('hello @álîce and @bob')).toEqual({
      mentions: ['bob'],
      channels: [],
      ranges: [{ start: 17, end: 21, kind: 'mention', value: 'bob' }],
    });
  });

  it('returns empty collections for empty text', () => {
    expect(parseMentions('')).toEqual({
      mentions: [],
      channels: [],
      ranges: [],
    });
  });

  it('ranges reconstruct the highlighted token text', () => {
    const text = 'ping @Alice in #Root, @BOB in &Ops';
    const parsed = parseMentions(text);

    expect(rangeValues(text, parsed.ranges)).toEqual(['@Alice', '#Root', '@BOB', '&Ops']);
    expect(parsed.ranges.map((range) => range.value)).toEqual(['Alice', '#Root', 'BOB', '&Ops']);
  });
});
