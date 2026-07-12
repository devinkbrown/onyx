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

  it('accepts mentions surrounded by punctuation boundaries', () => {
    const text = '@alice, (@bob); dot.@carol! slash/@dave?';

    expect(parseMentions(text)).toEqual({
      mentions: ['alice', 'bob', 'carol', 'dave'],
      channels: [],
      ranges: [
        { start: 0, end: 6, kind: 'mention', value: 'alice' },
        { start: 9, end: 13, kind: 'mention', value: 'bob' },
        { start: 20, end: 26, kind: 'mention', value: 'carol' },
        { start: 34, end: 39, kind: 'mention', value: 'dave' },
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

  it('uses code-unit offsets for unicode text before and inside ranges', () => {
    const text = '🌊 @ops #波 @end';

    expect(parseMentions(text)).toEqual({
      mentions: ['ops', 'end'],
      channels: ['#波'],
      ranges: [
        { start: 3, end: 7, kind: 'mention', value: 'ops' },
        { start: 8, end: 10, kind: 'channel', value: '#波' },
        { start: 11, end: 15, kind: 'mention', value: 'end' },
      ],
    });
  });

  it('returns empty collections when only bare markers are present', () => {
    expect(parseMentions('@ # &, trailing @')).toEqual({
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

  it('rejects mentions joined to unicode word boundaries on either side', () => {
    // Arrange
    const text = 'café@bar snowé@cold 9@digit _@under @tailé @ok';

    // Act
    const parsed = parseMentions(text);

    // Assert
    expect(parsed.mentions).toEqual(['ok']);
    expect(parsed.channels).toEqual([]);
    expect(rangeValues(text, parsed.ranges)).toEqual(['@ok']);
  });

  it('rejects ascii nick prefixes followed by unicode word characters', () => {
    const text = '@bobé @alice中 @good-name';

    const parsed = parseMentions(text);

    expect(parsed.mentions).toEqual(['good-name']);
    expect(rangeValues(text, parsed.ranges)).toEqual(['@good-name']);
  });

  it('keeps adjacent mention and channel ranges non-overlapping', () => {
    const text = '@ops#日本-team &ops @alice';

    const parsed = parseMentions(text);

    expect(parsed.mentions).toEqual(['ops', 'alice']);
    expect(parsed.channels).toEqual(['#日本-team', '&ops']);
    expect(parsed.ranges).toEqual([
      { start: 0, end: 4, kind: 'mention', value: 'ops' },
      { start: 4, end: 12, kind: 'channel', value: '#日本-team' },
      { start: 13, end: 17, kind: 'channel', value: '&ops' },
      { start: 18, end: 24, kind: 'mention', value: 'alice' },
    ]);
    expect(rangeValues(text, parsed.ranges)).toEqual(['@ops', '#日本-team', '&ops', '@alice']);
  });

  it('does not parse mention markers inside an already accepted channel range', () => {
    const text = '#room@alice @bob';

    const parsed = parseMentions(text);

    expect(parsed.mentions).toEqual(['bob']);
    expect(parsed.channels).toEqual(['#room@alice']);
    expect(parsed.ranges).toEqual([
      { start: 0, end: 11, kind: 'channel', value: '#room@alice' },
      { start: 12, end: 16, kind: 'mention', value: 'bob' },
    ]);
    expect(rangeValues(text, parsed.ranges)).toEqual(['#room@alice', '@bob']);
  });

  it('keeps boundary markers exact at the start and end of text', () => {
    const text = '@start middle #end';

    const parsed = parseMentions(text);

    expect(parsed.ranges).toEqual([
      { start: 0, end: 6, kind: 'mention', value: 'start' },
      { start: 14, end: 18, kind: 'channel', value: '#end' },
    ]);
    expect(rangeValues(text, parsed.ranges)).toEqual(['@start', '#end']);
  });

  it('accepts mentions after control and punctuation boundaries without absorbing html-looking tails', () => {
    // Arrange
    const text = 'ping\x00@ops, (<@bad>) path/@build\\bot<script>';

    // Act
    const parsed = parseMentions(text);

    // Assert
    expect(parsed.mentions).toEqual(['ops', 'bad', String.raw`build\bot`]);
    expect(rangeValues(text, parsed.ranges)).toEqual(['@ops', '@bad', String.raw`@build\bot`]);
    expect(parsed.ranges.map((range) => range.value)).toEqual(['ops', 'bad', String.raw`build\bot`]);
  });
});
