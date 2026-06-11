/**
 * embeds.ts — pure URL extraction + classification for rich message embeds.
 *
 * Security posture:
 *  - Only http(s) URLs are ever extracted; only https URLs may become embeds.
 *  - URLs carrying userinfo (user@host / user:pass@host) are rejected outright.
 *  - Hostnames are compared post-parse (URL punycodes unicode lookalikes, so
 *    a Cyrillic "youtube.com" can never match the ASCII allowlist).
 *  - Hard caps: MAX_EMBEDS_PER_MESSAGE embeds, MAX_URL_LENGTH chars per URL.
 *  - URLs inside code fences, inline code, and spoilers never produce embeds.
 *
 * Everything in this module is pure (no DOM, no fetch) so it is fully unit
 * testable and safe to run on hostile input.
 */

export type EmbedKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'youtube'
  | 'vimeo'
  | 'link';

export interface Embed {
  kind: EmbedKind;
  /** Canonical URL (href as parsed). */
  url: string;
  /** Decoded last path segment, for media/file embeds. */
  fileName?: string;
  /** Lowercase extension without the dot, for file embeds. */
  extension?: string;
  /** YouTube/Vimeo video id. */
  videoId?: string;
  /** Privacy-friendly static thumbnail (YouTube only — Vimeo needs an API call, which we refuse to make). */
  thumbnailUrl?: string;
  /** nocookie/dnt iframe src, only loaded after an explicit click. */
  embedUrl?: string;
  /** True when the URL points at our own uploads service. */
  trusted?: boolean;
}

export interface ClassifyOptions {
  /** Override for NEXT_PUBLIC_MEDIA_URL (tests / DI). */
  mediaOrigin?: string;
}

export const MAX_EMBEDS_PER_MESSAGE = 3;
export const MAX_URL_LENGTH = 2048;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'opus', 'm4a', 'flac']);

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const YOUTUBE_SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);
const VIMEO_PLAYER_HOSTS = new Set(['player.vimeo.com']);

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^\d{6,12}$/;

// Only http(s) tokens are ever considered. data:, javascript:, etc. never match.
const URL_TOKEN_RE = /https?:\/\/[^\s<>"'`\\]+/gi;

// Regions whose URLs must never embed: fenced code, inline code, spoilers.
const CODE_FENCE_RE = /```[^\n`]*\n[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const SPOILER_RE = /\|\|[\s\S]+?\|\|/g;

/** Strip trailing punctuation that is almost certainly sentence chrome. */
function trimTrailingPunctuation(raw: string): string {
  let url = raw.replace(/[.,!?;:'"»›〉》】〕)\]}]+$/u, (match) => {
    // Keep balanced closing parens/brackets that belong to the URL
    // (common with Wikipedia-style links).
    let keep = '';
    for (const ch of match) {
      const open = ch === ')' ? '(' : ch === ']' ? '[' : ch === '}' ? '{' : null;
      if (open) {
        const opens = countChar(raw, open);
        const closes = countChar(raw, ch);
        if (closes <= opens) {
          keep += ch;
          continue;
        }
      }
      break;
    }
    return keep;
  });
  // Strip a dangling open paren artifact like "(https://..." captured fully.
  if (url.endsWith('(')) url = url.slice(0, -1);
  return url;
}

function countChar(haystack: string, needle: string): number {
  let n = 0;
  for (const ch of haystack) if (ch === needle) n += 1;
  return n;
}

/** Remove code fences, inline code, and spoiler spans before URL extraction. */
export function stripNonEmbeddableRegions(text: string): string {
  return text
    .replace(CODE_FENCE_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(SPOILER_RE, ' ');
}

/** Extract candidate http(s) URLs from message text. Pure; never throws. */
export function extractUrls(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out: string[] = [];
  URL_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_TOKEN_RE.exec(text)) !== null) {
    const trimmed = trimTrailingPunctuation(match[0]);
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function lastPathSegment(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function pathExtension(pathname: string): string | null {
  const segment = pathname.split('/').pop() ?? '';
  const dot = segment.lastIndexOf('.');
  if (dot <= 0 || dot === segment.length - 1) return null;
  const ext = segment.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

function mediaKindForExtension(ext: string | null): EmbedKind | null {
  if (!ext) return null;
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
}

function parseUploadsOrigin(mediaOrigin: string | undefined): string | null {
  if (!mediaOrigin) return null;
  try {
    return new URL(mediaOrigin).origin;
  } catch {
    return null;
  }
}

function classifyYoutube(parsed: URL): Embed | null {
  let id: string | null = null;
  const host = parsed.hostname.toLowerCase();

  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    id = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const path = parsed.pathname;
    if (path === '/watch') {
      id = parsed.searchParams.get('v');
    } else {
      const shortForm = path.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
      id = shortForm ? shortForm[1] : null;
    }
  } else {
    return null;
  }

  if (!id || !YOUTUBE_ID_RE.test(id)) return null;
  return {
    kind: 'youtube',
    url: parsed.href,
    videoId: id,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
  };
}

function classifyVimeo(parsed: URL): Embed | null {
  const host = parsed.hostname.toLowerCase();
  let id: string | null = null;

  if (VIMEO_PLAYER_HOSTS.has(host)) {
    const match = parsed.pathname.match(/^\/video\/(\d+)/);
    id = match ? match[1] : null;
  } else if (VIMEO_HOSTS.has(host)) {
    id = parsed.pathname.split('/').filter(Boolean).find((seg) => /^\d+$/.test(seg)) ?? null;
  } else {
    return null;
  }

  if (!id || !VIMEO_ID_RE.test(id)) return null;
  return {
    kind: 'vimeo',
    url: parsed.href,
    videoId: id,
    embedUrl: `https://player.vimeo.com/video/${id}?dnt=1&autoplay=1`,
  };
}

/**
 * Classify a single URL. Returns null when the URL must not be surfaced at
 * all (unparseable, hostile, oversized, userinfo, non-http scheme).
 * Returns kind 'link' for URLs that are fine as anchors but get no embed.
 */
export function classifyUrl(raw: string, opts?: ClassifyOptions): Embed | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  // Strict scheme allowlist.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  // Reject userinfo entirely — classic phishing / confusion vector.
  if (parsed.username !== '' || parsed.password !== '') return null;

  if (parsed.hostname.length === 0) return null;

  // Embeds are https-only; plain http stays a generic link.
  if (parsed.protocol !== 'https:') {
    return { kind: 'link', url: parsed.href };
  }

  const youtube = classifyYoutube(parsed);
  if (youtube) return youtube;

  const vimeo = classifyVimeo(parsed);
  if (vimeo) return vimeo;

  const ext = pathExtension(parsed.pathname);
  const mediaKind = mediaKindForExtension(ext);

  const uploadsOrigin = parseUploadsOrigin(
    opts?.mediaOrigin ?? process.env.NEXT_PUBLIC_MEDIA_URL,
  );
  const isUploads =
    uploadsOrigin !== null &&
    parsed.origin === uploadsOrigin &&
    parsed.pathname.startsWith('/uploads/');

  if (mediaKind) {
    return {
      kind: mediaKind,
      url: parsed.href,
      fileName: lastPathSegment(parsed.pathname),
      extension: ext ?? undefined,
      trusted: isUploads || undefined,
    };
  }

  if (isUploads) {
    // Non-media file hosted on our own uploads service → compact file card.
    return {
      kind: 'file',
      url: parsed.href,
      fileName: lastPathSegment(parsed.pathname) || 'file',
      extension: ext ?? undefined,
      trusted: true,
    };
  }

  return { kind: 'link', url: parsed.href };
}

/**
 * Full pipeline: strip non-embeddable regions, extract, classify, drop
 * generic links, dedupe, and cap at MAX_EMBEDS_PER_MESSAGE.
 */
export function classifyMessageEmbeds(text: string, opts?: ClassifyOptions): Embed[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const urls = extractUrls(stripNonEmbeddableRegions(text));
  const seen = new Set<string>();
  const embeds: Embed[] = [];

  for (const url of urls) {
    if (embeds.length >= MAX_EMBEDS_PER_MESSAGE) break;
    const embed = classifyUrl(url, opts);
    if (!embed || embed.kind === 'link') continue;
    if (seen.has(embed.url)) continue;
    seen.add(embed.url);
    embeds.push(embed);
  }

  return embeds;
}
