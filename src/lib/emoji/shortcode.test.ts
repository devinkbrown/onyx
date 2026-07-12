// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { lookupShortcode, parseEmojiShortcodes, type EmojiSegment } from './shortcode';

function kinds(segments: readonly EmojiSegment[]): string[] {
  return segments.map((segment) => segment.kind);
}

describe('lookupShortcode', () => {
  it('resolves an exact picker shortcode to its glyph entry', () => {
    const entry = lookupShortcode('grinning');

    expect(entry).toEqual({
      emoji: '😀',
      shortcode: 'grinning',
      keywords: ['smile', 'happy'],
    });
  });

  it('resolves a known lowercase shortcode to its entry', () => {
    expect(lookupShortcode('rocket')).toEqual({
      emoji: '🚀',
      shortcode: 'rocket',
      keywords: ['ship', 'launch'],
    });
  });

  it('is case-sensitive and returns null for an unknown name', () => {
    expect(lookupShortcode('ROCKET')).toBeNull();
    expect(lookupShortcode('definitely_not_real')).toBeNull();
  });

  it('does not resolve skin-tone modifier names as emoji entries', () => {
    const modifier = 'skin-tone-2';

    const entry = lookupShortcode(modifier);

    expect(entry).toBeNull();
  });
});

describe('parseEmojiShortcodes', () => {
  it('returns an empty array for empty input', () => {
    expect(parseEmojiShortcodes('')).toEqual([]);
  });

  it('emits plain text with no shortcodes as a single text segment', () => {
    expect(parseEmojiShortcodes('hello world')).toEqual([
      { kind: 'text', value: 'hello world' },
    ]);
  });

  it('splits text around a known shortcode with correct boundaries', () => {
    expect(parseEmojiShortcodes('go :rocket: now')).toEqual([
      { kind: 'text', value: 'go ' },
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'text', value: ' now' },
    ]);
  });

  it('resolves a shortcode at the very start and end', () => {
    expect(parseEmojiShortcodes(':fire:')).toEqual([
      { kind: 'emoji', emoji: '🔥', shortcode: 'fire' },
    ]);
  });

  it('handles adjacent shortcodes with no separator', () => {
    const segments = parseEmojiShortcodes(':rocket::fire:');

    expect(segments).toEqual([
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'emoji', emoji: '🔥', shortcode: 'fire' },
    ]);
  });

  it('keeps unknown shortcodes literal while still parsing later known shortcodes', () => {
    const input = ':missing::rocket: tail';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'text', value: ':missing:' },
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'text', value: ' tail' },
    ]);
  });

  it('renders an unknown shortcode as literal text (passthrough)', () => {
    expect(parseEmojiShortcodes('a :not_a_real_code: b')).toEqual([
      { kind: 'text', value: 'a :not_a_real_code: b' },
    ]);
  });

  it('passes an unknown skin-tone modifier through as literal text', () => {
    const segments = parseEmojiShortcodes(':thumbsup::skin-tone-2:');

    expect(segments).toEqual([
      { kind: 'emoji', emoji: '👍', shortcode: 'thumbsup' },
      { kind: 'text', value: ':skin-tone-2:' },
    ]);
  });

  it('keeps a literal Unicode skin-tone modifier attached to surrounding text', () => {
    const input = 'manual 👍🏽 then :thumbsup:';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'text', value: 'manual 👍🏽 then ' },
      { kind: 'emoji', emoji: '👍', shortcode: 'thumbsup' },
    ]);
  });

  it('leaves literal ZWJ emoji sequences as text while parsing later shortcodes', () => {
    const input = 'family 👨‍👩‍👧‍👦 :heart:';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'text', value: 'family 👨‍👩‍👧‍👦 ' },
      { kind: 'emoji', emoji: '❤️', shortcode: 'heart' },
    ]);
  });

  it('does not treat a colon-wrapped ZWJ sequence as a shortcode name', () => {
    const input = ':👨‍👩‍👧‍👦:';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([{ kind: 'text', value: input }]);
  });

  it('keeps malformed shortcode boundaries as literal text', () => {
    const input = 'edge :rocket and ::rocket: and :rocket::';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'text', value: 'edge :rocket and :' },
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'text', value: ' and ' },
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'text', value: ':' },
    ]);
  });

  it('treats lone and doubled colons as literal text', () => {
    expect(parseEmojiShortcodes('ratio 3:2 :: end')).toEqual([
      { kind: 'text', value: 'ratio 3:2 :: end' },
    ]);
  });

  it('keeps empty shortcode delimiters literal between known shortcodes', () => {
    const input = ':rocket::::fire:';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'text', value: '::' },
      { kind: 'emoji', emoji: '🔥', shortcode: 'fire' },
    ]);
  });

  it('does not resolve an uppercase shortcode', () => {
    expect(parseEmojiShortcodes(':ROCKET:')).toEqual([
      { kind: 'text', value: ':ROCKET:' },
    ]);
  });

  it('preserves an unknown shortcode with every allowed name character', () => {
    const input = ':abc_123+-: :rocket:';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'text', value: ':abc_123+-: ' },
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
    ]);
  });

  it('does not let a missing close colon consume following unicode text', () => {
    const input = 'start :rocket then 🌊';

    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([{ kind: 'text', value: input }]);
  });

  it('does not promote hostile text adjacent to a real shortcode into unsafe tokens', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const input = `${hostile}:rocket:${hostile}`;
    const segments = parseEmojiShortcodes(input);

    expect(segments).toEqual([
      { kind: 'text', value: hostile },
      { kind: 'emoji', emoji: '🚀', shortcode: 'rocket' },
      { kind: 'text', value: hostile },
    ]);
    expect(kinds(segments)).toEqual(['text', 'emoji', 'text']);
  });

  // --- adversarial: hostile input must yield ONLY inert text, never markup ---
  it('renders a colon-wrapped HTML injection attempt as inert text only', () => {
    const hostile = ':<img src=x onerror=alert(1)>:';
    const segments = parseEmojiShortcodes(hostile);

    // Every segment is text; no emoji token, and the raw string is preserved verbatim.
    expect(kinds(segments)).toEqual(['text']);
    expect(segments.map((s) => (s.kind === 'text' ? s.value : '')).join('')).toBe(hostile);
  });

  it('never produces an emoji token from a script-tag bait payload', () => {
    const hostile = 'x :</span><script>alert(1)</script>: y';
    const segments = parseEmojiShortcodes(hostile);

    expect(segments.every((s) => s.kind === 'text')).toBe(true);
    expect(segments.map((s) => (s.kind === 'text' ? s.value : '')).join('')).toBe(hostile);
  });

  it('keeps shortcode-shaped hostile attributes literal instead of making emoji tokens', () => {
    const hostile = ':img-src-x-onerror-alert-1:';
    const segments = parseEmojiShortcodes(hostile);

    expect(segments).toEqual([{ kind: 'text', value: hostile }]);
  });

  it('does not create shortcode tokens from URL and attribute-like hostile text', () => {
    const hostile = 'href="javascript:alert(1)" data-emoji=":rocket"';
    const segments = parseEmojiShortcodes(hostile);

    expect(segments).toEqual([{ kind: 'text', value: hostile }]);
  });

  it('reconstructs the original string from concatenated segment values/emoji', () => {
    const input = 'ship :rocket: and :sparkles: plus :unknown: tail';
    const segments = parseEmojiShortcodes(input);
    const rebuilt = segments
      .map((s) => (s.kind === 'text' ? s.value : `:${s.shortcode}:`))
      .join('');
    expect(rebuilt).toBe(input);
  });

  it('treats input beyond the scan cap as a single opaque text segment', () => {
    const huge = `:rocket: ${'a'.repeat(9000)}`;
    const segments = parseEmojiShortcodes(huge);
    expect(segments).toEqual([{ kind: 'text', value: huge }]);
  });
});
