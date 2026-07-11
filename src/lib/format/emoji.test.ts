// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { EMOJI_MAP, lookupEmoji } from './emoji';

describe('lookupEmoji', () => {
  it('maps common chat shortcodes to unicode emoji', () => {
    const shortcodes = ['smile', 'thumbsup', '+1', 'heart', 'rocket'];

    const emojis = shortcodes.map((shortcode) => lookupEmoji(shortcode));

    expect(emojis).toEqual(['😊', '👍', '👍', '❤️', '🚀']);
  });

  it('returns null for an unknown shortcode', () => {
    const emoji = lookupEmoji('does_not_exist');

    expect(emoji).toBeNull();
  });

  it('returns null for an empty shortcode', () => {
    const emoji = lookupEmoji('');

    expect(emoji).toBeNull();
  });

  it('treats wrapped shortcode text as a literal missing key', () => {
    const emoji = lookupEmoji(':smile:');

    expect(emoji).toBeNull();
  });

  it('is case-sensitive for shortcode keys', () => {
    const emoji = lookupEmoji('SMILE');

    expect(emoji).toBeNull();
  });

  it('exposes the same unicode mapping through EMOJI_MAP', () => {
    const emoji = EMOJI_MAP.fire;

    expect(emoji).toBe('🔥');
  });

  it('leaves missing map keys undefined', () => {
    const emoji = EMOJI_MAP.missing_key;

    expect(emoji).toBeUndefined();
  });

  it('returns null for inherited Object.prototype keys, not the inherited value', () => {
    // parseMessage tokenizes `:constructor:`, `:toString:`, `:__proto__:` etc. as
    // emoji shortcodes ([\w\-+], length <= 64) straight from untrusted IRC content.
    // A naive `EMOJI_MAP[shortcode]` returns the inherited prototype member for these
    // keys (a Function/Object, never undefined), which then renders as a non-emoji.
    const prototypeKeys = [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      '__proto__',
      '__defineGetter__',
    ];

    const results = prototypeKeys.map((shortcode) => lookupEmoji(shortcode));

    expect(results).toEqual(prototypeKeys.map(() => null));
  });
});
