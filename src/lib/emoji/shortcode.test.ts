// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { lookupShortcode, parseEmojiShortcodes, type EmojiSegment } from './shortcode';

function kinds(segments: readonly EmojiSegment[]): string[] {
  return segments.map((segment) => segment.kind);
}

describe('lookupShortcode', () => {
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

  it('treats lone and doubled colons as literal text', () => {
    expect(parseEmojiShortcodes('ratio 3:2 :: end')).toEqual([
      { kind: 'text', value: 'ratio 3:2 :: end' },
    ]);
  });

  it('does not resolve an uppercase shortcode', () => {
    expect(parseEmojiShortcodes(':ROCKET:')).toEqual([
      { kind: 'text', value: ':ROCKET:' },
    ]);
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
