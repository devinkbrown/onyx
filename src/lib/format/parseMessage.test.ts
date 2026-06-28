/**
 * parseMessage.test.ts — unit tests for the message tokenizer.
 *
 * Covers:
 *   - All token types
 *   - Nesting (bold inside spoiler, etc.)
 *   - Edge cases / adversarial input (unclosed markers, ReDoS candidates)
 *   - Unicode and emoji shortcodes
 *   - URL scanning (trailing punctuation stripped)
 *   - Code blocks with and without language hints
 */

import { describe, expect, it } from 'vitest';
import { parseMessage } from './parseMessage';
import type {
  Token,
  BoldToken,
  ItalicToken,
  StrikeToken,
  SpoilerToken,
  BlockquoteToken,
} from './parseMessage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function only(tokens: Token[], type: Token['type']): Token[] {
  return tokens.filter((t) => t.type === type);
}

function text(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.type === 'text') return t.text;
      return '';
    })
    .join('');
}

// ── Plain text ────────────────────────────────────────────────────────────────

describe('plain text', () => {
  it('returns a single text token for plain input', () => {
    const tokens = parseMessage('hello world');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'text', text: 'hello world' });
  });

  it('returns empty array for empty string', () => {
    expect(parseMessage('')).toHaveLength(0);
  });

  it('preserves unicode characters', () => {
    const tokens = parseMessage('こんにちは 🌊');
    expect(tokens[0]).toMatchObject({ type: 'text', text: 'こんにちは 🌊' });
  });
});

// ── Bold ─────────────────────────────────────────────────────────────────────

describe('bold **...** and __...__', () => {
  it('parses **bold**', () => {
    const tokens = parseMessage('hello **world**!');
    const bolds = only(tokens, 'bold');
    expect(bolds).toHaveLength(1);
    const bold = bolds[0] as BoldToken;
    expect(bold.children).toMatchObject([{ type: 'text', text: 'world' }]);
  });

  it('parses __bold__', () => {
    const tokens = parseMessage('__bold text__');
    const bolds = only(tokens, 'bold');
    expect(bolds).toHaveLength(1);
    const bold = bolds[0] as BoldToken;
    expect(bold.children[0]).toMatchObject({ type: 'text', text: 'bold text' });
  });

  it('unclosed ** renders as literal text', () => {
    const tokens = parseMessage('not **bold');
    expect(only(tokens, 'bold')).toHaveLength(0);
    expect(tokens.map((t) => (t.type === 'text' ? t.text : '')).join('')).toContain('**bold');
  });

  it('empty ** is not bold', () => {
    const tokens = parseMessage('****');
    expect(only(tokens, 'bold')).toHaveLength(0);
  });
});

// ── Italic ────────────────────────────────────────────────────────────────────

describe('italic *...* and _..._', () => {
  it('parses *italic*', () => {
    const tokens = parseMessage('this is *italic* text');
    const italics = only(tokens, 'italic');
    expect(italics).toHaveLength(1);
    const italic = italics[0] as ItalicToken;
    expect(italic.children[0]).toMatchObject({ type: 'text', text: 'italic' });
  });

  it('parses _italic_', () => {
    const tokens = parseMessage('_slanted_');
    const italics = only(tokens, 'italic');
    expect(italics).toHaveLength(1);
  });

  it('unclosed * is literal', () => {
    const tokens = parseMessage('not *italic');
    expect(only(tokens, 'italic')).toHaveLength(0);
  });
});

// ── Strikethrough ─────────────────────────────────────────────────────────────

describe('strikethrough ~~...~~', () => {
  it('parses ~~strike~~', () => {
    const tokens = parseMessage('~~deleted~~');
    const strikes = only(tokens, 'strike');
    expect(strikes).toHaveLength(1);
    const s = strikes[0] as StrikeToken;
    expect(s.children[0]).toMatchObject({ type: 'text', text: 'deleted' });
  });

  it('unclosed ~~ is literal', () => {
    const tokens = parseMessage('~~no close');
    expect(only(tokens, 'strike')).toHaveLength(0);
  });
});

// ── Inline code ───────────────────────────────────────────────────────────────

describe('inline code `...`', () => {
  it('parses `code`', () => {
    const tokens = parseMessage('run `npm install` first');
    const codes = only(tokens, 'code');
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ type: 'code', text: 'npm install' });
  });

  it('does not parse markup inside inline code', () => {
    const tokens = parseMessage('`**not bold**`');
    expect(only(tokens, 'code')).toHaveLength(1);
    expect(only(tokens, 'bold')).toHaveLength(0);
  });

  it('unclosed backtick is literal', () => {
    const tokens = parseMessage('`unclosed');
    expect(only(tokens, 'code')).toHaveLength(0);
  });
});

// ── Code block ───────────────────────────────────────────────────────────────

describe('code block ```...```', () => {
  it('parses fenced code block with language', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const tokens = parseMessage(input);
    const blocks = only(tokens, 'codeblock');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'codeblock', lang: 'typescript', text: 'const x = 1;' });
  });

  it('parses fenced code block without language', () => {
    const input = '```\nhello\nworld\n```';
    const tokens = parseMessage(input);
    const blocks = only(tokens, 'codeblock');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'codeblock', lang: '', text: 'hello\nworld' });
  });

  it('unclosed code block falls back to literal — no codeblock token produced', () => {
    const input = '```\nno close';
    const tokens = parseMessage(input);
    // No codeblock token because closing ``` was never found
    expect(only(tokens, 'codeblock')).toHaveLength(0);
    // The fallback renders the opening line as inline (backtick chars appear
    // individually since there is no closing backtick on that line).
    // Just verify the body text "no close" is present somewhere.
    const allText = tokens.filter(t => t.type === 'text').map(t => (t as {text: string}).text).join('');
    expect(allText).toContain('no close');
  });
});

// ── Blockquote ────────────────────────────────────────────────────────────────

describe('blockquote > ...', () => {
  it('parses a blockquote line', () => {
    const tokens = parseMessage('> a quoted line');
    const quotes = only(tokens, 'blockquote');
    expect(quotes).toHaveLength(1);
    const q = quotes[0] as BlockquoteToken;
    expect(q.children[0]).toMatchObject({ type: 'text', text: 'a quoted line' });
  });

  it('blockquote only applies at start of line', () => {
    const tokens = parseMessage('not > a quote');
    expect(only(tokens, 'blockquote')).toHaveLength(0);
    const t = tokens.find(x => x.type === 'text') as {text: string} | undefined;
    expect(t?.text).toContain('> a quote');
  });

  it('parses inline markup inside a blockquote', () => {
    const tokens = parseMessage('> **bold** text');
    const quotes = only(tokens, 'blockquote');
    expect(quotes).toHaveLength(1);
    const q = quotes[0] as BlockquoteToken;
    const bolds = q.children.filter(c => c.type === 'bold');
    expect(bolds).toHaveLength(1);
  });

  it('blockquote with no content (bare >)', () => {
    const tokens = parseMessage('>');
    expect(only(tokens, 'blockquote')).toHaveLength(1);
    const q = tokens[0] as BlockquoteToken;
    expect(q.children).toHaveLength(0);
  });
});

// ── Spoiler ───────────────────────────────────────────────────────────────────

describe('spoiler ||...||', () => {
  it('parses ||spoiler||', () => {
    const tokens = parseMessage('||secret content||');
    const spoilers = only(tokens, 'spoiler');
    expect(spoilers).toHaveLength(1);
    const s = spoilers[0] as SpoilerToken;
    expect(s.children[0]).toMatchObject({ type: 'text', text: 'secret content' });
  });

  it('unclosed || is literal', () => {
    const tokens = parseMessage('||no close');
    expect(only(tokens, 'spoiler')).toHaveLength(0);
  });
});

// ── Links ─────────────────────────────────────────────────────────────────────

describe('URL links', () => {
  it('parses https URL', () => {
    const tokens = parseMessage('check https://example.com out');
    const links = only(tokens, 'link');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ type: 'link', href: 'https://example.com' });
  });

  it('parses http URL', () => {
    const tokens = parseMessage('http://example.com');
    expect(only(tokens, 'link')).toHaveLength(1);
  });

  it('strips trailing period', () => {
    const tokens = parseMessage('see https://example.com.');
    const links = only(tokens, 'link');
    expect(links[0]).toMatchObject({ type: 'link', href: 'https://example.com' });
  });

  it('strips trailing punctuation but not mid-URL commas', () => {
    // A comma mid-URL (with more path after it) is kept — it is part of the URL
    const tokens = parseMessage('at https://example.com,foo');
    const links = only(tokens, 'link');
    expect(links).toHaveLength(1);
    // URL is kept as-is (comma before non-whitespace is not stripped)
    expect((links[0] as {href: string}).href).toBe('https://example.com,foo');
  });

  it('strips trailing comma that ends the URL', () => {
    // A trailing comma at the very end of a URL is stripped
    const tokens = parseMessage('see https://example.com/path,');
    const links = only(tokens, 'link');
    expect(links[0]).toMatchObject({ type: 'link', href: 'https://example.com/path' });
  });

  it('preserves parens in URLs', () => {
    const tokens = parseMessage('https://en.wikipedia.org/wiki/Foo_(bar)');
    const links = only(tokens, 'link');
    expect(links[0]).toMatchObject({ href: 'https://en.wikipedia.org/wiki/Foo_(bar)' });
  });

  it('handles URL with query string', () => {
    const tokens = parseMessage('https://example.com/search?q=foo&bar=1');
    const links = only(tokens, 'link');
    expect(links[0]).toMatchObject({ href: 'https://example.com/search?q=foo&bar=1' });
  });

  it('handles two URLs in one message', () => {
    const tokens = parseMessage('https://a.com and https://b.com');
    expect(only(tokens, 'link')).toHaveLength(2);
  });
});

// ── @mention ─────────────────────────────────────────────────────────────────

describe('@mention', () => {
  it('parses @nick', () => {
    const tokens = parseMessage('hello @alice!');
    const mentions = only(tokens, 'mention');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ type: 'mention', nick: 'alice' });
  });

  it('supports nicks with hyphens and underscores', () => {
    const tokens = parseMessage('@john_doe-42');
    expect(tokens[0]).toMatchObject({ type: 'mention', nick: 'john_doe-42' });
  });

  it('bare @ with no nick is literal', () => {
    const tokens = parseMessage('@ alone');
    expect(only(tokens, 'mention')).toHaveLength(0);
  });

  it('parses multiple mentions', () => {
    const tokens = parseMessage('@alice @bob meet me');
    expect(only(tokens, 'mention')).toHaveLength(2);
  });
});

// ── #channel ─────────────────────────────────────────────────────────────────

describe('#channel', () => {
  it('parses #channel', () => {
    const tokens = parseMessage('join #general please');
    const channels = only(tokens, 'channel');
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ type: 'channel', name: '#general' });
  });

  it('stops at space', () => {
    const tokens = parseMessage('#foo bar');
    expect((tokens[0] as {name?: string}).name).toBe('#foo');
  });

  it('bare # is literal', () => {
    const tokens = parseMessage('# heading');
    // space after # means no channel (scanChannel stops at space)
    expect(only(tokens, 'channel')).toHaveLength(0);
  });
});

// ── :emoji: ───────────────────────────────────────────────────────────────────

describe(':emoji: shortcodes', () => {
  it('parses :smile:', () => {
    const tokens = parseMessage('hello :smile:');
    const emojis = only(tokens, 'emoji');
    expect(emojis).toHaveLength(1);
    expect(emojis[0]).toMatchObject({ type: 'emoji', shortcode: 'smile' });
  });

  it('parses :+1: (with plus)', () => {
    const tokens = parseMessage(':+1:');
    expect(tokens[0]).toMatchObject({ type: 'emoji', shortcode: '+1' });
  });

  it('unclosed colon is literal', () => {
    const tokens = parseMessage(':unclosed');
    expect(only(tokens, 'emoji')).toHaveLength(0);
  });

  it('empty shortcode ::: is not parsed as emoji', () => {
    const tokens = parseMessage(':::');
    expect(only(tokens, 'emoji')).toHaveLength(0);
  });

  it('very long shortcode is not parsed as emoji', () => {
    const longCode = ':' + 'a'.repeat(65) + ':';
    const tokens = parseMessage(longCode);
    expect(only(tokens, 'emoji')).toHaveLength(0);
  });
});

// ── Nesting ───────────────────────────────────────────────────────────────────

describe('nesting', () => {
  it('bold contains italic', () => {
    // Use unambiguous syntax: bold wraps "hello" and italic wraps "world"
    const tokens = parseMessage('**hello *world* end**');
    const bolds = only(tokens, 'bold') as BoldToken[];
    expect(bolds).toHaveLength(1);
    const italics = bolds[0]!.children.filter(c => c.type === 'italic');
    expect(italics).toHaveLength(1);
  });

  it('spoiler contains mention', () => {
    const tokens = parseMessage('||@secret||');
    const spoilers = only(tokens, 'spoiler') as SpoilerToken[];
    expect(spoilers).toHaveLength(1);
    const mentions = spoilers[0]!.children.filter(c => c.type === 'mention');
    expect(mentions).toHaveLength(1);
  });

  it('bold contains link', () => {
    const tokens = parseMessage('**https://example.com**');
    const bolds = only(tokens, 'bold') as BoldToken[];
    expect(bolds).toHaveLength(1);
    const links = bolds[0]!.children.filter(c => c.type === 'link');
    expect(links).toHaveLength(1);
  });

  it('blockquote contains bold and emoji', () => {
    const tokens = parseMessage('> **bold** :fire:');
    const quotes = only(tokens, 'blockquote') as BlockquoteToken[];
    const bolds = quotes[0]!.children.filter(c => c.type === 'bold');
    const emojis = quotes[0]!.children.filter(c => c.type === 'emoji');
    expect(bolds).toHaveLength(1);
    expect(emojis).toHaveLength(1);
  });
});

// ── Multi-line ────────────────────────────────────────────────────────────────

describe('multi-line messages', () => {
  it('preserves newlines between lines', () => {
    const tokens = parseMessage('line one\nline two');
    const newlines = tokens.filter(t => t.type === 'text' && (t as {text: string}).text === '\n');
    expect(newlines).toHaveLength(1);
  });

  it('mixes blockquote and normal lines', () => {
    const tokens = parseMessage('> quoted\nnormal line');
    expect(only(tokens, 'blockquote')).toHaveLength(1);
    const normal = tokens.filter(t => t.type === 'text' && (t as {text:string}).text === 'normal line');
    expect(normal).toHaveLength(1);
  });
});

// ── Adversarial / edge cases ──────────────────────────────────────────────────

describe('adversarial inputs', () => {
  it('handles very long plain text without hanging (bounded)', () => {
    const long = 'a'.repeat(5000);
    const start = Date.now();
    const tokens = parseMessage(long);
    const elapsed = Date.now() - start;
    // Should parse well under 100ms even for 5k chars (capped at 4k actually)
    expect(elapsed).toBeLessThan(200);
    // Result should exist
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('handles deeply nested unclosed markers without hanging', () => {
    // Potential ReDoS: many unclosed markers
    const input = '**'.repeat(50) + 'text' + '**'.repeat(50);
    const start = Date.now();
    parseMessage(input);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('handles a message with many URLs without quadratic scan', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://example${i}.com`).join(' ');
    const start = Date.now();
    const tokens = parseMessage(urls);
    expect(Date.now() - start).toBeLessThan(200);
    expect(only(tokens, 'link')).toHaveLength(20);
  });

  it('handles alternating colons without going quadratic', () => {
    const input = ':'.repeat(200);
    const start = Date.now();
    parseMessage(input);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('empty markers are not parsed as tokens', () => {
    expect(only(parseMessage('****'), 'bold')).toHaveLength(0);
    expect(only(parseMessage('__'), 'bold')).toHaveLength(0);
    expect(only(parseMessage('~~'), 'strike')).toHaveLength(0);
    expect(only(parseMessage('||'), 'spoiler')).toHaveLength(0);
  });

  it('handles null bytes and control chars gracefully', () => {
    const input = 'hello\x00\x01\x02world';
    const tokens = parseMessage(input);
    // Should not throw; text content should include them as-is
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('caps input at MAX_LENGTH silently', () => {
    const huge = 'x'.repeat(10_000);
    const tokens = parseMessage(huge);
    // Result text should be capped
    const totalLen = tokens.reduce((sum, t) => {
      if (t.type === 'text') return sum + (t as {text:string}).text.length;
      return sum;
    }, 0);
    expect(totalLen).toBeLessThanOrEqual(4_000);
  });
});

// ── Complex real-world messages ───────────────────────────────────────────────

describe('complex real-world messages', () => {
  it('parses a message with mixed inline tokens', () => {
    const msg = 'hey @alice, check **this** out at https://example.com :fire:';
    const tokens = parseMessage(msg);
    expect(only(tokens, 'mention')).toHaveLength(1);
    expect(only(tokens, 'bold')).toHaveLength(1);
    expect(only(tokens, 'link')).toHaveLength(1);
    expect(only(tokens, 'emoji')).toHaveLength(1);
  });

  it('parses a code snippet with explanation', () => {
    const msg = 'Use `const x = 1` or:\n```js\nconst x = 1;\n```\n:+1:';
    const tokens = parseMessage(msg);
    expect(only(tokens, 'code')).toHaveLength(1);
    expect(only(tokens, 'codeblock')).toHaveLength(1);
    expect(only(tokens, 'emoji')).toHaveLength(1);
  });

  it('handles a message that looks like IRC action text', () => {
    const msg = '* alice waves at everyone';
    const tokens = parseMessage(msg);
    // * at start should be italic only if closed — here it is not
    expect(only(tokens, 'italic')).toHaveLength(0);
    expect(tokens[0]).toMatchObject({ type: 'text' });
  });
});

// ── IRC / mIRC formatting ──────────────────────────────────────────────────────

describe('IRC control codes', () => {
  it('leaves plain messages free of styled tokens', () => {
    const tokens = parseMessage('just plain text');
    expect(only(tokens, 'styled')).toHaveLength(0);
    expect(tokens[0]).toMatchObject({ type: 'text', text: 'just plain text' });
  });

  it('wraps a bold run in a styled token', () => {
    const tokens = parseMessage('\x02bold\x02 normal');
    const styled = only(tokens, 'styled');
    expect(styled).toHaveLength(1);
    expect(styled[0]).toMatchObject({ type: 'styled', style: { bold: true } });
  });

  it('carries the colour onto a styled run', () => {
    const tokens = parseMessage('\x034alert');
    const styled = only(tokens, 'styled') as Array<{ style: { fg?: string } }>;
    expect(styled).toHaveLength(1);
    expect(styled[0]!.style.fg).toBe('#ff0000');
  });

  it('strips control bytes from the rendered text', () => {
    const tokens = parseMessage('\x034\x02red bold\x0f');
    // No raw control bytes should survive in any text token.
    const raw = JSON.stringify(tokens);
    expect(raw).not.toMatch(/[\x02\x03\x04\x0f\x16\x1d\x1e\x1f]/);
  });

  it('still detects links inside a coloured run', () => {
    const tokens = parseMessage('\x0312https://example.com\x03');
    const styled = only(tokens, 'styled') as Array<{ children: Array<{ type: string }> }>;
    expect(styled).toHaveLength(1);
    expect(styled[0]!.children.some((c) => c.type === 'link')).toBe(true);
  });
});
