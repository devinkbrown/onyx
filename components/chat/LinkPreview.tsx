'use client';

import { useState, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface OGData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  themeColor?: string;
}

interface UnfurlData extends OGData {
  url: string;
}

type Platform =
  | 'youtube'
  | 'vimeo'
  | 'video'
  | 'github'
  | 'spotify'
  | 'twitter'
  | 'twitch'
  | 'generic';

// ── Known sites quick-path ─────────────────────────────────────────────────────

const KNOWN_SITES: Record<string, { name: string; color: string; icon: string }> = {
  'github.com':         { name: 'GitHub',         color: '#1f2328', icon: '⚙' },
  'twitter.com':        { name: 'X/Twitter',       color: '#000',    icon: '𝕏' },
  'x.com':              { name: 'X/Twitter',       color: '#000',    icon: '𝕏' },
  'reddit.com':         { name: 'Reddit',          color: '#ff4500', icon: '🤖' },
  'stackoverflow.com':  { name: 'Stack Overflow',  color: '#f48024', icon: '💬' },
  'npmjs.com':          { name: 'npm',             color: '#cb0000', icon: '📦' },
  'youtube.com':        { name: 'YouTube',         color: '#ff0000', icon: '▶' },
  'youtu.be':           { name: 'YouTube',         color: '#ff0000', icon: '▶' },
  'twitch.tv':          { name: 'Twitch',          color: '#9146ff', icon: '🎮' },
  'crates.io':          { name: 'crates.io',       color: '#f74c00', icon: '📦' },
  'pypi.org':           { name: 'PyPI',            color: '#0073b7', icon: '🐍' },
};

// ── Module-level cache (persists across renders for the session) ───────────────

const unfurlCache = new Map<string, UnfurlData | null>();

// ── Platform detection ─────────────────────────────────────────────────────────

const VIDEO_EXTS = /\.(mp4|webm|mov|ogv)(\?[^\s]*)?$/i;

function detectPlatform(url: string): Platform {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, '');

    if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com') {
      return 'youtube';
    }
    if (host === 'vimeo.com') return 'vimeo';
    if (VIDEO_EXTS.test(pathname)) return 'video';
    if (host === 'github.com') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length === 2) return 'github';
    }
    if (host === 'open.spotify.com') return 'spotify';
    if (host === 'twitter.com' || host === 'x.com') return 'twitter';
    if (host === 'twitch.tv') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length === 1 && parts[0] !== 'clip' && parts[0] !== 'clips') return 'twitch';
    }
  } catch {
    // malformed URL
  }
  return 'generic';
}

// ── URL parsing helpers ────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('?')[0] || null;
    }
    if (parsed.hostname.includes('youtube.com') && parsed.pathname === '/watch') {
      return parsed.searchParams.get('v');
    }
  } catch {
    // malformed URL
  }
  return null;
}

function extractVimeoId(url: string): string | null {
  try {
    const m = url.match(/vimeo\.com\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function extractSpotifyType(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'track')    return 'Track';
    if (parts[0] === 'album')    return 'Album';
    if (parts[0] === 'playlist') return 'Playlist';
    if (parts[0] === 'artist')   return 'Artist';
  } catch {
    // malformed URL
  }
  return 'Music';
}

function extractGithubParts(url: string): { owner: string; repo: string } | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
  } catch {
    // malformed URL
  }
  return null;
}

function extractTwitchChannel(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length > 0) return parts[0];
  } catch {
    // malformed URL
  }
  return '';
}

function getHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function getFaviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${getHostname(url)}&sz=16`;
}

function getVideoFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() ?? url;
  } catch {
    return url;
  }
}

// ── OG fetch ──────────────────────────────────────────────────────────────────

function getMeta(doc: Document, property: string): string | undefined {
  return (
    doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ||
    doc.querySelector(`meta[name="${property}"]`)?.getAttribute('content') ||
    undefined
  );
}

// CORS proxies tried in order; each gets 5 s before we move to the next.
const CORS_PROXIES: Array<(u: string) => { proxyUrl: string; parseJson: (j: unknown) => string | null }> = [
  (u) => ({
    proxyUrl: `https://corsproxy.io/?${encodeURIComponent(u)}`,
    // corsproxy.io returns the raw HTML body directly
    parseJson: (j: unknown) => (typeof j === 'string' ? j : null),
  }),
  (u) => ({
    proxyUrl: `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    // allorigins wraps HTML in { contents }
    parseJson: (j: unknown) => {
      if (j && typeof j === 'object' && 'contents' in j) {
        const c = (j as { contents?: unknown }).contents;
        return typeof c === 'string' ? c : null;
      }
      return null;
    },
  }),
  (u) => ({
    proxyUrl: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    // codetabs returns raw HTML
    parseJson: (j: unknown) => (typeof j === 'string' ? j : null),
  }),
];

async function fetchOG(url: string): Promise<OGData | null> {
  for (const proxyFactory of CORS_PROXIES) {
    const { proxyUrl, parseJson } = proxyFactory(url);
    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;

      // corsproxy.io and codetabs return text/html; allorigins returns JSON
      const contentType = res.headers.get('content-type') ?? '';
      let html: string | null = null;

      if (contentType.includes('application/json')) {
        const json: unknown = await res.json();
        html = parseJson(json);
      } else {
        const text = await res.text();
        // Try parseJson in case the proxy smuggled HTML as a text body
        html = parseJson(text) ?? text;
      }

      if (!html) continue;

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      let image = getMeta(doc, 'og:image');
      if (image && !image.startsWith('http')) {
        try {
          const origin = new URL(url).origin;
          image = image.startsWith('/') ? origin + image : `${origin}/${image}`;
        } catch {
          image = undefined;
        }
      }

      return {
        title:       getMeta(doc, 'og:title')       || doc.title || undefined,
        description: getMeta(doc, 'og:description') || getMeta(doc, 'description') || undefined,
        image,
        siteName:    getMeta(doc, 'og:site_name')   || undefined,
        themeColor:  getMeta(doc, 'theme-color')    || undefined,
        favicon:     getFaviconUrl(url),
      };
    } catch {
      // timeout or network error — try next proxy
    }
  }
  return null;
}

// ── Per-platform heuristic metadata (no fetch required) ───────────────────────

function heuristicData(url: string, platform: Platform): UnfurlData | null {
  const host = getHostname(url);

  // GitHub: parse owner/repo/path from URL
  if (platform === 'github' || host === 'github.com') {
    const parts = (() => {
      try { return new URL(url).pathname.split('/').filter(Boolean); } catch { return [] as string[]; }
    })();
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo  = parts[1];
      const subPath = parts.slice(2).join('/');
      const title = subPath ? `${owner}/${repo} — ${subPath}` : `${owner}/${repo}`;
      return {
        url,
        title,
        siteName: 'GitHub',
        favicon: `https://www.google.com/s2/favicons?domain=github.com&sz=32`,
      };
    }
  }

  // YouTube: derive thumbnail from video ID; title from searchParams
  if (platform === 'youtube') {
    const id = extractYouTubeId(url);
    if (id) {
      let title: string | undefined;
      try {
        const sp = new URL(url).searchParams;
        // v param doesn't give us a title, but let's include the ID as a hint
        title = `YouTube · ${id}`;
      } catch {
        title = 'YouTube';
      }
      return {
        url,
        title,
        siteName: 'YouTube',
        image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        favicon: `https://www.google.com/s2/favicons?domain=youtube.com&sz=32`,
      };
    }
  }

  // Twitter/X: placeholder card without fetch
  if (platform === 'twitter') {
    let username = '';
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      if (parts.length > 0) username = `@${parts[0]}`;
    } catch { /* empty */ }
    return {
      url,
      title: username ? `Post by ${username}` : 'Post on X (Twitter)',
      siteName: 'X (Twitter)',
      favicon: `https://www.google.com/s2/favicons?domain=x.com&sz=32`,
    };
  }

  // Reddit: parse subreddit/post from URL
  if (host === 'reddit.com' || host === 'old.reddit.com' || host === 'www.reddit.com') {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      // /r/subreddit/comments/id/slug
      const sub  = parts[0] === 'r' ? parts[1] : undefined;
      const slug = parts[4] ? parts[4].replace(/_/g, ' ') : undefined;
      const title = slug ? slug : sub ? `r/${sub}` : 'Reddit';
      return {
        url,
        title,
        siteName: sub ? `r/${sub} · Reddit` : 'Reddit',
        favicon: `https://www.google.com/s2/favicons?domain=reddit.com&sz=32`,
      };
    } catch { /* empty */ }
  }

  // Twitch: channel or clip
  if (platform === 'twitch' || host === 'twitch.tv') {
    const channel = extractTwitchChannel(url);
    return {
      url,
      title: channel ? `${channel} on Twitch` : 'Twitch',
      siteName: 'Twitch',
      favicon: `https://www.google.com/s2/favicons?domain=twitch.tv&sz=32`,
    };
  }

  // npm: parse package name from URL
  if (host === 'npmjs.com' || host === 'www.npmjs.com') {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      // /package/name  or  /package/@scope/name
      const pkgIdx = parts.indexOf('package');
      if (pkgIdx !== -1) {
        const pkgName = parts[pkgIdx + 1] === '@'
          ? `@${parts[pkgIdx + 1]}/${parts[pkgIdx + 2]}`
          : parts[pkgIdx + 1];
        if (pkgName) {
          return { url, title: pkgName, siteName: 'npm', favicon: `https://www.google.com/s2/favicons?domain=npmjs.com&sz=32` };
        }
      }
    } catch { /* empty */ }
  }

  // crates.io: parse crate name
  if (host === 'crates.io') {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      // /crates/name
      if (parts[0] === 'crates' && parts[1]) {
        return { url, title: parts[1], siteName: 'crates.io', favicon: `https://www.google.com/s2/favicons?domain=crates.io&sz=32` };
      }
    } catch { /* empty */ }
  }

  // PyPI: parse package name
  if (host === 'pypi.org') {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      // /project/name
      if (parts[0] === 'project' && parts[1]) {
        return { url, title: parts[1], siteName: 'PyPI', favicon: `https://www.google.com/s2/favicons?domain=pypi.org&sz=32` };
      }
    } catch { /* empty */ }
  }

  return null;
}

// ── Minimal domain fallback card (shown when all fetches fail) ─────────────────

function minimalFallback(url: string): UnfurlData {
  const domain = getHostname(url);
  const known = KNOWN_SITES[domain];
  return {
    url,
    siteName: known?.name ?? domain,
    favicon:  `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
  };
}

async function unfurlUrl(url: string): Promise<UnfurlData | null> {
  if (unfurlCache.has(url)) return unfurlCache.get(url)!;

  const platform = detectPlatform(url);

  // Video files — no OG needed
  if (platform === 'video') {
    const data: UnfurlData = { url, title: getVideoFilename(url) };
    unfurlCache.set(url, data);
    return data;
  }

  // Vimeo: branded card, no OEmbed (static export constraint)
  if (platform === 'vimeo') {
    const vimeoId = extractVimeoId(url);
    const data: UnfurlData = {
      url,
      title:    vimeoId ? `Vimeo video ${vimeoId}` : 'Vimeo',
      siteName: 'Vimeo',
      favicon:  'https://www.google.com/s2/favicons?domain=vimeo.com&sz=16',
    };
    unfurlCache.set(url, data);
    return data;
  }

  // Derive heuristic data immediately (no network required).
  // For YouTube we always have a thumbnail from heuristics; we still attempt OG
  // fetch to get the real title and replace the placeholder.
  const heuristic = heuristicData(url, platform);

  // YouTube: use heuristic thumbnail + try to upgrade title via OG fetch
  if (platform === 'youtube') {
    const base = heuristic ?? { url, siteName: 'YouTube', favicon: getFaviconUrl(url) };
    const og = await fetchOG(url);
    const data: UnfurlData = {
      ...base,
      title:       og?.title       ?? base.title,
      description: og?.description ?? base.description,
      // Keep heuristic thumbnail (reliable) unless OG provides one
      image:       base.image      ?? og?.image,
    };
    unfurlCache.set(url, data);
    return data;
  }

  // For Twitter/X, Reddit, Twitch, GitHub, npm, crates.io, PyPI:
  // Show heuristic card immediately, then try to enrich via OG fetch.
  if (heuristic) {
    const og = await fetchOG(url);
    const data: UnfurlData = og
      ? { ...heuristic, ...og, url, favicon: heuristic.favicon ?? og.favicon }
      : heuristic;
    unfurlCache.set(url, data);
    return data;
  }

  // Generic: try OG fetch; if all proxies fail, show minimal domain card.
  const og = await fetchOG(url);
  if (og) {
    const data: UnfurlData = { url, ...og };
    unfurlCache.set(url, data);
    return data;
  }

  // All proxies failed — never show nothing. Return minimal domain card.
  const data = minimalFallback(url);
  unfurlCache.set(url, data);
  return data;
}

// ── Dismiss button ─────────────────────────────────────────────────────────────

interface DismissProps { onDismiss: () => void; }
function DismissBtn({ onDismiss }: DismissProps) {
  return (
    <button className="lp-dismiss" onClick={onDismiss} aria-label="Dismiss preview" title="Dismiss">
      <CloseIcon />
    </button>
  );
}

// ── Shared card shell ──────────────────────────────────────────────────────────

interface CardProps {
  accentClass: string;
  accentColor?: string;
  label: string;
  children: React.ReactNode;
  onDismiss: () => void;
}
function Card({ accentClass, accentColor, label, children, onDismiss }: CardProps) {
  return (
    <div className="lp-wrap animate-lp" aria-label={label}>
      <div
        className={`lp-accent-bar ${accentClass}`}
        style={accentColor ? { background: accentColor } : undefined}
      />
      <div className="lp-inner">
        {children}
      </div>
      <DismissBtn onDismiss={onDismiss} />
      <style>{styles}</style>
    </div>
  );
}

// ── Platform renderers ─────────────────────────────────────────────────────────

interface RendererProps {
  url: string;
  ogData: UnfurlData;
  onDismiss: () => void;
}

// YouTube ──────────────────────────────────────────────────────────────────────
function YouTubeCard({ url, ogData, onDismiss }: RendererProps) {
  const youtubeId = extractYouTubeId(url);
  const thumb = youtubeId
    ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
    : ogData.image;

  return (
    <div className="lp-yt-card animate-lp" aria-label="YouTube video preview">
      {thumb && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-yt-hero"
          aria-label="Watch on YouTube"
        >
          <img src={thumb} alt="YouTube thumbnail" className="lp-yt-hero-img" loading="lazy" />
          <div className="lp-yt-play-overlay" aria-hidden>
            <PlayIcon />
          </div>
          <div className="lp-yt-badge" aria-hidden>
            <YouTubeIcon />
          </div>
        </a>
      )}
      <div className="lp-yt-meta">
        <div className="lp-site lp-site--yt">
          <YouTubeIcon />
          <span>YouTube</span>
          <span className="lp-site-arrow">↗</span>
        </div>
        {ogData.title && <div className="lp-title">{ogData.title}</div>}
        {ogData.description && <div className="lp-desc">{ogData.description}</div>}
      </div>
      <DismissBtn onDismiss={onDismiss} />
      <style>{styles}</style>
    </div>
  );
}

// Vimeo ────────────────────────────────────────────────────────────────────────
function VimeoCard({ url, ogData, onDismiss }: RendererProps) {
  const vimeoId = extractVimeoId(url);
  return (
    <Card accentClass="lp-accent-bar--vm" label="Vimeo video preview" onDismiss={onDismiss}>
      <div className="lp-text-col">
        <div className="lp-site">
          <VimeoIcon />
          <span>Vimeo</span>
          {vimeoId && <span className="lp-muted">#{vimeoId}</span>}
          <span className="lp-site-arrow">↗</span>
        </div>
        {ogData.title && <div className="lp-title">{ogData.title}</div>}
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-domain">
          vimeo.com
        </a>
      </div>
    </Card>
  );
}

// Video file ───────────────────────────────────────────────────────────────────
function VideoCard({ url, onDismiss }: RendererProps) {
  const filename = getVideoFilename(url);
  return (
    <div className="lp-video-card animate-lp" aria-label="Video embed">
      <video
        src={url}
        controls
        muted
        preload="metadata"
        className="lp-video-player"
        aria-label={filename}
      />
      <div className="lp-video-label">
        <span className="lp-muted">{filename}</span>
      </div>
      <DismissBtn onDismiss={onDismiss} />
      <style>{styles}</style>
    </div>
  );
}

// GitHub ───────────────────────────────────────────────────────────────────────
function GitHubCard({ url, ogData, onDismiss }: RendererProps) {
  const ghParts = extractGithubParts(url);
  const repoLabel = ghParts ? `${ghParts.owner}/${ghParts.repo}` : ogData.title;
  const desc = ogData.description || '';

  return (
    <Card accentClass="lp-accent-bar--gh" label="GitHub repository preview" onDismiss={onDismiss}>
      <div className="lp-text-col">
        <div className="lp-site">
          <GitHubIcon />
          <span>GitHub</span>
          <span className="lp-site-arrow">↗</span>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-title lp-title--link">
          {repoLabel}
        </a>
        {desc && <div className="lp-desc">{desc}</div>}
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-domain">
          github.com
        </a>
      </div>
      {ogData.image && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-thumb-anchor"
          aria-label="Open repository"
          tabIndex={-1}
        >
          <img
            src={ogData.image}
            alt=""
            className="lp-thumb"
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }}
          />
        </a>
      )}
    </Card>
  );
}

// Spotify ──────────────────────────────────────────────────────────────────────
function SpotifyCard({ url, ogData, onDismiss }: RendererProps) {
  const kind = extractSpotifyType(url);

  return (
    <Card accentClass="lp-accent-bar--sp" label="Spotify preview" onDismiss={onDismiss}>
      <div className="lp-text-col">
        <div className="lp-site">
          <SpotifyIcon />
          <span>Spotify · {kind}</span>
          <span className="lp-site-arrow">↗</span>
        </div>
        {ogData.title && <div className="lp-title">{ogData.title}</div>}
        {ogData.description && <div className="lp-desc">{ogData.description}</div>}
        <div className="lp-sp-wave" aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} className="lp-sp-bar" style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }} />
          ))}
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-cta lp-cta--sp">
          Listen on Spotify
        </a>
      </div>
      {ogData.image && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-thumb-anchor"
          aria-label="Open on Spotify"
          tabIndex={-1}
        >
          <img
            src={ogData.image}
            alt=""
            className="lp-thumb"
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }}
          />
        </a>
      )}
    </Card>
  );
}

// Twitter/X ────────────────────────────────────────────────────────────────────
function TwitterCard({ url, ogData, onDismiss }: RendererProps) {
  let username = '';
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length > 0) username = `@${parts[0]}`;
  } catch {
    // malformed URL
  }

  return (
    <Card accentClass="lp-accent-bar--tw" label="X (Twitter) post preview" onDismiss={onDismiss}>
      <div className="lp-text-col">
        <div className="lp-site">
          <XIcon />
          <span>X (Twitter){username ? ` · ${username}` : ''}</span>
          <span className="lp-site-arrow">↗</span>
        </div>
        {ogData.title && <div className="lp-title">{ogData.title}</div>}
        {ogData.description && <div className="lp-desc">{ogData.description}</div>}
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-domain">
          {new URL(url).hostname}
        </a>
      </div>
      {ogData.image && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-thumb-anchor"
          aria-label="Open post"
          tabIndex={-1}
        >
          <img
            src={ogData.image}
            alt=""
            className="lp-thumb"
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }}
          />
        </a>
      )}
    </Card>
  );
}

// Twitch ───────────────────────────────────────────────────────────────────────
function TwitchCard({ url, ogData, onDismiss }: RendererProps) {
  const channel = extractTwitchChannel(url);
  const isLive = ogData.description?.toLowerCase().includes('live') ||
                 ogData.title?.toLowerCase().includes('live') ||
                 false;

  return (
    <Card accentClass="lp-accent-bar--tc" label="Twitch channel preview" onDismiss={onDismiss}>
      <div className="lp-text-col">
        <div className="lp-site">
          <TwitchIcon />
          <span>Twitch{channel ? ` · ${channel}` : ''}</span>
          {isLive && <span className="lp-live-badge">LIVE</span>}
          <span className="lp-site-arrow">↗</span>
        </div>
        {ogData.title && <div className="lp-title">{ogData.title}</div>}
        {ogData.description && <div className="lp-desc">{ogData.description}</div>}
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-domain">
          twitch.tv
        </a>
      </div>
      {ogData.image && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-thumb-anchor"
          aria-label="Open channel"
          tabIndex={-1}
        >
          <img
            src={ogData.image}
            alt=""
            className="lp-thumb"
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }}
          />
        </a>
      )}
    </Card>
  );
}

// Generic ──────────────────────────────────────────────────────────────────────
function GenericCard({ url, ogData, onDismiss }: RendererProps) {
  const domain = getHostname(url);
  const known = KNOWN_SITES[domain];
  // Use OG theme color if available, otherwise known-site color, otherwise accent
  const accentColor = ogData.themeColor ?? known?.color ?? undefined;
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const siteName = ogData.siteName ?? known?.name ?? domain;

  return (
    <Card accentClass="" accentColor={accentColor} label="Link preview" onDismiss={onDismiss}>
      <div className="lp-text-col">
        <div className="lp-site">
          <img src={favicon} alt="" className="lp-favicon" width={16} height={16} />
          <span>{siteName}</span>
          <span className="lp-site-arrow lp-site-arrow--domain" title={url}>↗</span>
        </div>
        {ogData.title ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="lp-title lp-title--link">
            {ogData.title}
          </a>
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer" className="lp-title lp-title--link">
            {domain}
          </a>
        )}
        {ogData.description && <div className="lp-desc">{ogData.description}</div>}
        <a href={url} target="_blank" rel="noopener noreferrer" className="lp-domain">
          {domain}
        </a>
      </div>
      {ogData.image && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-thumb-anchor"
          aria-label="Open link"
          tabIndex={-1}
        >
          <img
            src={ogData.image}
            alt=""
            className="lp-thumb"
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = 'none'; }}
          />
        </a>
      )}
    </Card>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

interface Props {
  url: string;
}

type LoadState = 'loading' | 'ready' | 'empty';

export default function LinkPreview({ url }: Props) {
  const [data, setData]           = useState<UnfurlData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [dismissed, setDismissed] = useState(false);

  const platform = detectPlatform(url);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadState('loading');
    setDismissed(false);

    // Video files render immediately without any fetch
    if (platform === 'video') {
      if (!cancelled) {
        setData({ url, title: getVideoFilename(url) });
        setLoadState('ready');
      }
      return;
    }

    // Show optimistic heuristic data immediately while the OG fetch runs.
    // heuristicData() is synchronous and covers GitHub, YouTube, Twitter,
    // Reddit, Twitch, npm, crates.io, PyPI plus KNOWN_SITES fallback.
    if (!unfurlCache.has(url)) {
      const optimistic = heuristicData(url, platform) ?? (() => {
        const host = getHostname(url);
        const known = KNOWN_SITES[host];
        return known
          ? { url, siteName: known.name, favicon: getFaviconUrl(url) }
          : null;
      })();
      if (optimistic) {
        setData(optimistic);
        setLoadState('ready');
      }
    }

    unfurlUrl(url).then(result => {
      if (cancelled) return;
      setData(result);
      // unfurlUrl always returns at least a minimal domain card (never null for
      // non-video URLs), so 'empty' only fires if result itself is falsy.
      setLoadState(result && (result.title || result.description || result.image || result.siteName) ? 'ready' : 'empty');
    });

    return () => { cancelled = true; };
  }, [url, platform]);

  if (dismissed || loadState === 'empty') return null;

  // ── Shimmer skeleton ───────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="lp-wrap lp-skeleton" aria-hidden>
        <div className="lp-accent-bar" />
        <div className="lp-inner">
          <div className="lp-text-col">
            <div className="sk-line sk-site"  />
            <div className="sk-line sk-title" />
            <div className="sk-line sk-desc"  />
          </div>
          <div className="lp-thumb-skeleton" />
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!data) return null;

  const dismiss = () => setDismissed(true);

  // Video files: render inline
  if (platform === 'video') {
    return <VideoCard url={url} ogData={data} onDismiss={dismiss} />;
  }

  switch (platform) {
    case 'youtube': return <YouTubeCard url={url} ogData={data} onDismiss={dismiss} />;
    case 'vimeo':   return <VimeoCard   url={url} ogData={data} onDismiss={dismiss} />;
    case 'github':  return <GitHubCard  url={url} ogData={data} onDismiss={dismiss} />;
    case 'spotify': return <SpotifyCard url={url} ogData={data} onDismiss={dismiss} />;
    case 'twitter': return <TwitterCard url={url} ogData={data} onDismiss={dismiss} />;
    case 'twitch':  return <TwitchCard  url={url} ogData={data} onDismiss={dismiss} />;
    default:        return <GenericCard url={url} ogData={data} onDismiss={dismiss} />;
  }
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M1.4 1.4a.67.67 0 0 1 .95 0L6 5.05l3.65-3.65a.67.67 0 1 1 .95.95L6.95 6l3.65 3.65a.67.67 0 1 1-.95.95L6 6.95 2.35 10.6a.67.67 0 1 1-.95-.95L5.05 6 1.4 2.35a.67.67 0 0 1 0-.95z"/>
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="rgba(0,0,0,0.55)" />
      <circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <path d="M16 12.5l14 7.5-14 7.5V12.5z" fill="#fff" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#ff0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8z"/>
      <path fill="#fff" d="M9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/>
    </svg>
  );
}

function VimeoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#1ab7ea" d="M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197c1.185-1.044 2.351-2.084 3.501-3.128C5.08 2.701 6.266 1.984 7.055 1.91c1.867-.18 3.016 1.1 3.447 3.838.465 2.953.789 4.789.971 5.507.539 2.45 1.131 3.674 1.776 3.674.502 0 1.256-.796 2.265-2.385 1.004-1.589 1.54-2.797 1.612-3.628.144-1.371-.395-2.061-1.614-2.061-.574 0-1.167.121-1.777.391 1.186-3.868 3.434-5.757 6.762-5.637 2.473.06 3.628 1.664 3.48 4.807z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.3-3.2-.1-.3-.6-1.5.1-3.2 0 0 1.1-.3 3.5 1.3a12 12 0 0 1 6.4 0c2.4-1.6 3.5-1.3 3.5-1.3.7 1.7.2 2.9.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"/>
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1db954"/>
      <path fill="#fff" d="M17.9 10.9c-3.1-1.8-8.1-2-11-.9-.5.1-.9-.2-1-.6-.1-.5.2-.9.6-1 3.3-1.2 8.8-1 12.3 1 .4.2.6.8.4 1.2-.3.5-.8.6-1.3.3zm-.1 2.9c-.3.4-.8.5-1.2.3-2.6-1.6-6.5-2-9.6-1.1-.4.1-.9-.1-1-.6-.1-.4.1-.9.6-1 3.5-1 7.9-.5 10.8 1.2.5.3.6.8.4 1.2zm-1.3 2.8c-.2.3-.6.4-1 .2-2.2-1.3-5-1.6-8.3-.9-.3.1-.6-.1-.7-.4-.1-.3.1-.7.4-.7 3.6-.8 6.7-.4 9.2 1 .3.2.4.6.4.8z"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.738l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

function TwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#9146ff" d="M2.1 0L.6 4v16.5h5.4V24l4-3.5h3l5.7-5.7V0H2.1zm18.6 13.8l-3 3H14l-3 3v-3H5.7V2.1h15v11.7z"/>
      <path fill="#9146ff" d="M14.1 5.4h2.1v6.3h-2.1zm-5.7 0H10.5v6.3H8.4z"/>
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = `
  /* ── Base card ─────────────────────────────────────────────────── */
  .lp-wrap {
    position: relative;
    display: flex;
    margin-top: 6px;
    max-width: 480px;
    background: var(--bg-elevated);
    border-radius: 0 var(--r-lg, 8px) var(--r-lg, 8px) 0;
    overflow: hidden;
    cursor: default;
    transition: background var(--t-fast);
  }
  .lp-wrap:hover { background: var(--bg-float); }

  .lp-skeleton { cursor: default; }
  .lp-skeleton:hover { background: var(--bg-elevated); }

  /* Accent bar */
  .lp-accent-bar {
    width: 4px;
    flex-shrink: 0;
    background: var(--accent);
    border-radius: 0;
  }
  .lp-accent-bar--yt { background: #ff0000; }
  .lp-accent-bar--gh { background: #6e7681; }
  .lp-accent-bar--sp { background: #1db954; }
  .lp-accent-bar--tw { background: #000; }
  .lp-accent-bar--tc { background: #9146ff; }
  .lp-accent-bar--vm { background: #1ab7ea; }

  /* Inner layout */
  .lp-inner {
    display: flex;
    flex: 1;
    min-width: 0;
    padding: 9px 12px;
    gap: 10px;
    align-items: flex-start;
  }

  .lp-text-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  /* Site label row */
  .lp-site {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .lp-site--yt { color: #ff0000; }

  .lp-site-arrow {
    font-size: 10px;
    opacity: 0.6;
    margin-left: auto;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .lp-site-arrow--domain { cursor: pointer; }

  .lp-muted {
    font-weight: 400;
    opacity: 0.6;
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
  }

  .lp-favicon {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    flex-shrink: 0;
    object-fit: contain;
  }

  /* LIVE badge */
  .lp-live-badge {
    display: inline-flex;
    align-items: center;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #fff;
    background: #9146ff;
    border-radius: 3px;
    padding: 1px 5px;
    line-height: 1.6;
  }

  /* Title */
  .lp-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .lp-title--link {
    text-decoration: none;
    cursor: pointer;
  }
  .lp-title--link:hover { text-decoration: underline; color: var(--accent-hover, var(--accent)); }

  /* Description */
  .lp-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Domain link */
  .lp-domain {
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
    margin-top: 2px;
  }
  .lp-domain:hover { text-decoration: underline; }

  /* CTA buttons */
  .lp-cta {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
    padding: 3px 8px;
    border-radius: 4px;
    margin-top: 4px;
    width: fit-content;
    transition: opacity 0.15s;
  }
  .lp-cta:hover { opacity: 0.82; }
  .lp-cta--yt  { color: #fff; background: #ff0000; }
  .lp-cta--sp  { color: #fff; background: #1db954; }

  /* Standard thumbnail */
  .lp-thumb-anchor {
    flex-shrink: 0;
    display: block;
    width: 90px;
    height: 90px;
    border-radius: var(--r-sm, 4px);
    overflow: hidden;
    background: var(--bg-deep);
    text-decoration: none;
  }
  .lp-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* ── YouTube hero card ─────────────────────────────────────────── */
  .lp-yt-card {
    position: relative;
    display: flex;
    flex-direction: column;
    margin-top: 6px;
    max-width: 400px;
    background: var(--bg-elevated);
    border-radius: var(--r-lg, 8px);
    overflow: hidden;
    cursor: default;
    transition: background var(--t-fast);
    border: 1px solid rgba(255,255,255,0.06);
  }
  .lp-yt-card:hover { background: var(--bg-float); }

  .lp-yt-hero {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    position: relative;
    text-decoration: none;
    background: var(--bg-deep);
  }

  .lp-yt-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: filter 0.18s;
  }
  .lp-yt-hero:hover .lp-yt-hero-img { filter: brightness(1.08); }

  .lp-yt-play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    transition: opacity 0.18s;
  }
  .lp-yt-hero:hover .lp-yt-play-overlay svg { transform: scale(1.1); }
  .lp-yt-play-overlay svg { transition: transform 0.18s; }

  .lp-yt-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    pointer-events: none;
  }

  .lp-yt-meta {
    padding: 8px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  /* ── Video player card ─────────────────────────────────────────── */
  .lp-video-card {
    position: relative;
    margin-top: 6px;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .lp-video-player {
    width: 100%;
    max-width: 480px;
    border-radius: var(--r-lg, 8px);
    display: block;
    background: var(--bg-deep);
    outline: none;
  }

  .lp-video-label {
    font-size: 11px;
    padding: 2px 4px;
    color: var(--text-muted);
  }

  /* Spotify waveform decoration */
  .lp-sp-wave {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 18px;
    margin-top: 4px;
  }
  .lp-sp-bar {
    width: 2px;
    border-radius: 1px;
    background: #1db954;
    opacity: 0.7;
    animation: lp-sp-pulse 1.2s ease-in-out infinite alternate;
  }
  .lp-sp-bar:nth-child(odd)  { height: 10px; }
  .lp-sp-bar:nth-child(even) { height: 16px; }
  .lp-sp-bar:nth-child(3n)   { height: 8px;  }
  @keyframes lp-sp-pulse {
    from { opacity: 0.3; transform: scaleY(0.6); }
    to   { opacity: 0.9; transform: scaleY(1); }
  }

  /* Dismiss button */
  .lp-dismiss {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: var(--text-muted);
    border-radius: var(--r-xs, 3px);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--t-fast, 150ms), color var(--t-fast, 150ms), background var(--t-fast, 150ms);
    padding: 0;
    z-index: 1;
  }
  .lp-wrap:hover .lp-dismiss,
  .lp-yt-card:hover .lp-dismiss,
  .lp-video-card:hover .lp-dismiss { opacity: 1; }
  .lp-dismiss:hover {
    color: var(--danger, #ef4444);
    background: rgba(239,68,68,0.12);
    opacity: 1;
  }

  /* Shimmer skeleton lines */
  .sk-line {
    height: 10px;
    border-radius: var(--r-xs, 3px);
    background: var(--bg-float);
    animation: lp-shimmer 1.5s ease-in-out infinite;
  }
  .sk-site  { width: 60px;  height: 9px;  }
  .sk-title { width: 200px; height: 13px; margin-top: 2px; }
  .sk-desc  { width: 160px; height: 9px;  }

  .lp-thumb-skeleton {
    width: 90px;
    height: 90px;
    border-radius: var(--r-sm, 4px);
    flex-shrink: 0;
    background: var(--bg-float);
    animation: lp-shimmer 1.5s ease-in-out infinite;
    animation-delay: 0.2s;
  }

  @keyframes lp-shimmer {
    0%   { opacity: 1; }
    50%  { opacity: 0.4; }
    100% { opacity: 1; }
  }

  /* Entrance animation */
  @keyframes lp-fade-in {
    from { opacity: 0; transform: translateY(3px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .animate-lp { animation: lp-fade-in 0.18s ease-out; }
`;
