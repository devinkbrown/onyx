import { describe, it, expect } from 'vitest';
import {
  classifyUrl,
  classifyMessageEmbeds,
  extractUrls,
  stripNonEmbeddableRegions,
  MAX_EMBEDS_PER_MESSAGE,
  MAX_URL_LENGTH,
} from '@/lib/embeds';

const UPLOADS = { mediaOrigin: 'https://media.example.com' };

// ─────────────────────────────────────────────────────────────────────────────
// extractUrls
// ─────────────────────────────────────────────────────────────────────────────

describe('extractUrls', () => {
  it('extracts a single https URL', () => {
    expect(extractUrls('look at https://example.com/a.png now')).toEqual([
      'https://example.com/a.png',
    ]);
  });

  it('extracts multiple URLs in order', () => {
    expect(extractUrls('https://a.com/x https://b.com/y')).toEqual([
      'https://a.com/x',
      'https://b.com/y',
    ]);
  });

  it('strips trailing sentence punctuation', () => {
    expect(extractUrls('see https://example.com/a.png.')).toEqual([
      'https://example.com/a.png',
    ]);
    expect(extractUrls('really? https://example.com/a.png!?')).toEqual([
      'https://example.com/a.png',
    ]);
  });

  it('strips an unbalanced closing paren', () => {
    expect(extractUrls('(see https://example.com/a.png)')).toEqual([
      'https://example.com/a.png',
    ]);
  });

  it('keeps a balanced closing paren that belongs to the URL', () => {
    expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('does not extract data: URLs', () => {
    expect(extractUrls('data:text/html;base64,PHNjcmlwdD4=')).toEqual([]);
  });

  it('does not extract javascript: URLs', () => {
    expect(extractUrls('javascript:alert(1)')).toEqual([]);
  });

  it('does not extract ftp/ws/file schemes', () => {
    expect(extractUrls('ftp://x.com/a ws://y.com file:///etc/passwd')).toEqual([]);
  });

  it('returns empty for empty or non-URL text', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls('no links here')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyUrl — media types
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyUrl: images', () => {
  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])(
    'classifies .%s as image',
    (ext) => {
      const embed = classifyUrl(`https://cdn.example.com/pic.${ext}`);
      expect(embed).toMatchObject({ kind: 'image', extension: ext });
    },
  );

  it('is case-insensitive on extension', () => {
    expect(classifyUrl('https://x.com/A.PNG')?.kind).toBe('image');
  });

  it('ignores query strings when matching extension', () => {
    expect(classifyUrl('https://x.com/a.png?w=200&h=100')?.kind).toBe('image');
  });

  it('extracts fileName', () => {
    expect(classifyUrl('https://x.com/dir/shot%20one.png')?.fileName).toBe('shot one.png');
  });
});

describe('classifyUrl: video', () => {
  it.each(['mp4', 'webm'])('classifies .%s as video', (ext) => {
    expect(classifyUrl(`https://x.com/clip.${ext}`)?.kind).toBe('video');
  });
});

describe('classifyUrl: audio', () => {
  it.each(['mp3', 'ogg', 'opus', 'm4a', 'flac'])('classifies .%s as audio', (ext) => {
    expect(classifyUrl(`https://x.com/song.${ext}`)?.kind).toBe('audio');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyUrl — uploads service
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyUrl: uploads service', () => {
  it('marks same-origin /uploads media as trusted', () => {
    const embed = classifyUrl('https://media.example.com/uploads/a.png', UPLOADS);
    expect(embed).toMatchObject({ kind: 'image', trusted: true });
  });

  it('treats non-media uploads as file cards', () => {
    const embed = classifyUrl('https://media.example.com/uploads/report.pdf', UPLOADS);
    expect(embed).toMatchObject({
      kind: 'file',
      trusted: true,
      extension: 'pdf',
      fileName: 'report.pdf',
    });
  });

  it('does not trust a different origin with /uploads path', () => {
    const embed = classifyUrl('https://evil.example.com/uploads/x.bin', UPLOADS);
    expect(embed?.kind).toBe('link');
  });

  it('does not trust the right origin outside /uploads', () => {
    const embed = classifyUrl('https://media.example.com/other/x.bin', UPLOADS);
    expect(embed?.kind).toBe('link');
  });

  it('non-media file on a random origin stays a generic link', () => {
    expect(classifyUrl('https://x.com/file.exe')?.kind).toBe('link');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyUrl — YouTube / Vimeo
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyUrl: youtube', () => {
  const ID = 'dQw4w9WgXcQ';

  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ])('classifies %s', (url) => {
    const embed = classifyUrl(url);
    expect(embed).toMatchObject({ kind: 'youtube', videoId: ID });
    expect(embed?.embedUrl).toContain(`https://www.youtube-nocookie.com/embed/${ID}`);
    expect(embed?.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });

  it('rejects malformed video ids', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=short')?.kind).toBe('link');
    expect(classifyUrl('https://youtu.be/../../etc/passwd')?.kind).toBe('link');
    expect(classifyUrl('https://www.youtube.com/watch?v=<script>aaa')?.kind).toBe('link');
  });

  it('rejects unicode-lookalike youtube hostnames (punycode mismatch)', () => {
    // Cyrillic "у" — URL() punycodes this hostname, so it must not match.
    const embed = classifyUrl(`https://уoutube.com/watch?v=${ID}`);
    expect(embed === null || embed.kind === 'link').toBe(true);
  });

  it('rejects youtube.com.evil.com suffix tricks', () => {
    expect(classifyUrl(`https://youtube.com.evil.com/watch?v=${ID}`)?.kind).toBe('link');
  });
});

describe('classifyUrl: vimeo', () => {
  it('classifies a canonical vimeo URL', () => {
    const embed = classifyUrl('https://vimeo.com/123456789');
    expect(embed).toMatchObject({ kind: 'vimeo', videoId: '123456789' });
    expect(embed?.embedUrl).toBe('https://player.vimeo.com/video/123456789?dnt=1&autoplay=1');
  });

  it('classifies player.vimeo.com URLs', () => {
    expect(classifyUrl('https://player.vimeo.com/video/123456789')?.kind).toBe('vimeo');
  });

  it('has no thumbnailUrl (privacy: no metadata fetch)', () => {
    expect(classifyUrl('https://vimeo.com/123456789')?.thumbnailUrl).toBeUndefined();
  });

  it('rejects non-numeric ids', () => {
    expect(classifyUrl('https://vimeo.com/about')?.kind).toBe('link');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyUrl — hostile input
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyUrl: hostile input', () => {
  it('returns null for non-http(s) schemes', () => {
    expect(classifyUrl('javascript:alert(1)')).toBeNull();
    expect(classifyUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
    expect(classifyUrl('vbscript:msgbox(1)')).toBeNull();
    expect(classifyUrl('file:///etc/passwd')).toBeNull();
    expect(classifyUrl('ftp://x.com/a.png')).toBeNull();
  });

  it('returns null for URLs with userinfo', () => {
    expect(classifyUrl('https://user@evil.com/a.png')).toBeNull();
    expect(classifyUrl('https://user:pass@evil.com/a.png')).toBeNull();
    expect(classifyUrl('https://youtube.com@evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('http (non-https) URLs never embed', () => {
    expect(classifyUrl('http://x.com/a.png')?.kind).toBe('link');
    expect(classifyUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')?.kind).toBe('link');
  });

  it('returns null for oversized URLs', () => {
    const huge = 'https://x.com/' + 'a'.repeat(10_000) + '.png';
    expect(huge.length).toBeGreaterThan(MAX_URL_LENGTH);
    expect(classifyUrl(huge)).toBeNull();
  });

  it('returns null for unparseable garbage', () => {
    expect(classifyUrl('https://')).toBeNull();
    expect(classifyUrl('')).toBeNull();
    expect(classifyUrl('not a url')).toBeNull();
  });

  it('survives control characters and null bytes without throwing', () => {
    expect(() => classifyUrl('https://x.com/ a.png')).not.toThrow();
    expect(() => classifyUrl('https://x.com/%00%ff%fe.png')).not.toThrow();
  });

  it('does not classify extension hidden behind %2e tricks as media blindly', () => {
    const embed = classifyUrl('https://x.com/a%2Epng');
    // Whatever the result, it must not throw and must be a safe kind.
    expect(embed === null || ['image', 'link'].includes(embed.kind)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyMessageEmbeds — pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyMessageEmbeds', () => {
  it('returns embeds for media URLs and skips generic links', () => {
    const embeds = classifyMessageEmbeds(
      'pic https://x.com/a.png and site https://example.com/page',
    );
    expect(embeds).toHaveLength(1);
    expect(embeds[0].kind).toBe('image');
  });

  it(`caps at ${MAX_EMBEDS_PER_MESSAGE} embeds`, () => {
    const text = [1, 2, 3, 4, 5].map((i) => `https://x.com/${i}.png`).join(' ');
    expect(classifyMessageEmbeds(text)).toHaveLength(MAX_EMBEDS_PER_MESSAGE);
  });

  it('dedupes identical URLs', () => {
    const embeds = classifyMessageEmbeds(
      'https://x.com/a.png https://x.com/a.png https://x.com/a.png',
    );
    expect(embeds).toHaveLength(1);
  });

  it('ignores URLs inside code fences', () => {
    const text = '```\nhttps://x.com/a.png\n```';
    expect(classifyMessageEmbeds(text)).toHaveLength(0);
  });

  it('ignores URLs inside inline code', () => {
    expect(classifyMessageEmbeds('`https://x.com/a.png`')).toHaveLength(0);
  });

  it('ignores URLs inside spoilers (no reveal-by-embed)', () => {
    expect(classifyMessageEmbeds('||https://x.com/a.png||')).toHaveLength(0);
  });

  it('still embeds URLs outside masked regions', () => {
    const embeds = classifyMessageEmbeds('||secret|| https://x.com/a.png `code`');
    expect(embeds).toHaveLength(1);
  });

  it('is safe on a 10k-character hostile message', () => {
    const text = 'https://x.com/' + 'A'.repeat(10_000) + '.png javascript:alert(1)';
    expect(() => classifyMessageEmbeds(text)).not.toThrow();
    expect(classifyMessageEmbeds(text)).toHaveLength(0);
  });

  it('handles empty and non-string-ish input', () => {
    expect(classifyMessageEmbeds('')).toEqual([]);
  });

  it('mixes kinds while preserving order', () => {
    const embeds = classifyMessageEmbeds(
      'https://x.com/a.png https://youtu.be/dQw4w9WgXcQ https://x.com/s.mp3',
    );
    expect(embeds.map((e) => e.kind)).toEqual(['image', 'youtube', 'audio']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripNonEmbeddableRegions
// ─────────────────────────────────────────────────────────────────────────────

describe('stripNonEmbeddableRegions', () => {
  it('removes fenced code', () => {
    expect(stripNonEmbeddableRegions('a ```js\ncode\n``` b')).not.toContain('code');
  });

  it('removes inline code', () => {
    expect(stripNonEmbeddableRegions('a `inline` b')).not.toContain('inline');
  });

  it('removes spoilers', () => {
    expect(stripNonEmbeddableRegions('a ||hidden|| b')).not.toContain('hidden');
  });

  it('keeps surrounding text', () => {
    const out = stripNonEmbeddableRegions('keep ||x|| this');
    expect(out).toContain('keep');
    expect(out).toContain('this');
  });
});
