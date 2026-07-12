// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseEmojiShortcodes, type EmojiSegment } from './shortcode';

function renderSegments(segments: readonly EmojiSegment[]): HTMLDivElement {
  const root = document.createElement('div');

  for (const segment of segments) {
    if (segment.kind === 'text') {
      root.append(document.createTextNode(segment.value));
      continue;
    }

    const emoji = document.createElement('span');
    emoji.setAttribute('role', 'img');
    emoji.setAttribute('aria-label', `:${segment.shortcode}:`);
    emoji.textContent = segment.emoji;
    root.append(emoji);
  }

  return root;
}

function shortcodeRoundTrip(segments: readonly EmojiSegment[]): string {
  return segments
    .map((segment) => (segment.kind === 'text' ? segment.value : `:${segment.shortcode}:`))
    .join('');
}

describe('parseEmojiShortcodes adversarial render contracts', () => {
  it('renders hostile markup as text nodes while known shortcodes become explicit emoji nodes', () => {
    const prefix = '<img src=x onerror=alert(1)>';
    const suffix = '<svg><script>alert(1)</script></svg>';
    const input = `${prefix}:rocket:${suffix}`;

    const segments = parseEmojiShortcodes(input);
    const root = renderSegments(segments);
    const emojis = root.querySelectorAll('[role="img"]');

    expect(shortcodeRoundTrip(segments)).toBe(input);
    expect(root.querySelector('img, svg, script')).toBeNull();
    expect(root.textContent).toBe(`${prefix}🚀${suffix}`);
    expect(root.innerHTML).toContain('&lt;img');
    expect(root.innerHTML).toContain('&lt;svg&gt;');
    expect(emojis).toHaveLength(1);
    expect(emojis[0]!.textContent).toBe('🚀');
    expect(emojis[0]!.getAttribute('aria-label')).toBe(':rocket:');
  });

  it('keeps colon-wrapped active-content payloads as a single inert renderable text node', () => {
    const input = ':<script>alert(1)</script>:';

    const segments = parseEmojiShortcodes(input);
    const root = renderSegments(segments);

    expect(segments).toEqual([{ kind: 'text', value: input }]);
    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild).toBeInstanceOf(Text);
    expect(root.querySelector('[role="img"], script')).toBeNull();
    expect(root.textContent).toBe(input);
  });

  it.each([
    ['light', ':skin-tone-2:'],
    ['medium-light', ':skin-tone-3:'],
    ['medium', ':skin-tone-4:'],
    ['medium-dark', ':skin-tone-5:'],
    ['dark', ':skin-tone-6:'],
  ])('does not merge a trailing %s skin-tone shortcode into a picker emoji', (_label, tone) => {
    const input = `before :thumbsup:${tone} after`;

    const segments = parseEmojiShortcodes(input);
    const root = renderSegments(segments);
    const emojis = root.querySelectorAll('[role="img"]');

    expect(shortcodeRoundTrip(segments)).toBe(input);
    expect(segments).toEqual([
      { kind: 'text', value: 'before ' },
      { kind: 'emoji', emoji: '👍', shortcode: 'thumbsup' },
      { kind: 'text', value: `${tone} after` },
    ]);
    expect(emojis).toHaveLength(1);
    expect(root.textContent).toBe(`before 👍${tone} after`);
  });

  it.each(['🏻', '🏼', '🏽', '🏾', '🏿'])(
    'preserves literal Unicode skin-tone modifier %s as text instead of inventing an emoji segment',
    (modifier) => {
      const tonedThumb = `👍${modifier}`;
      const input = `${tonedThumb} then :thumbsup:`;

      const segments = parseEmojiShortcodes(input);
      const root = renderSegments(segments);

      expect(segments).toEqual([
        { kind: 'text', value: `${tonedThumb} then ` },
        { kind: 'emoji', emoji: '👍', shortcode: 'thumbsup' },
      ]);
      expect(root.querySelectorAll('[role="img"]')).toHaveLength(1);
      expect(root.textContent).toBe(`${tonedThumb} then 👍`);
    },
  );

  it('keeps interleaved skin-tone modifiers literal without blocking later valid shortcodes', () => {
    const input = ':skin-tone-2::thumbsup::skin-tone-6::fire:';

    const segments = parseEmojiShortcodes(input);
    const root = renderSegments(segments);

    expect(shortcodeRoundTrip(segments)).toBe(input);
    expect(segments).toEqual([
      { kind: 'text', value: ':skin-tone-2:' },
      { kind: 'emoji', emoji: '👍', shortcode: 'thumbsup' },
      { kind: 'text', value: ':skin-tone-6:' },
      { kind: 'emoji', emoji: '🔥', shortcode: 'fire' },
    ]);
    expect(Array.from(root.querySelectorAll('[role="img"]')).map((node) => node.textContent)).toEqual([
      '👍',
      '🔥',
    ]);
    expect(root.textContent).toBe(':skin-tone-2:👍:skin-tone-6:🔥');
  });
});
