'use client';

import type { Embed } from '@/lib/embeds';
import ImageEmbed from './embeds/ImageEmbed';
import VideoEmbed from './embeds/VideoEmbed';
import AudioEmbed from './embeds/AudioEmbed';
import FileEmbed from './embeds/FileEmbed';
import PlayerEmbed from './embeds/PlayerEmbed';

interface Props {
  embed: Embed;
}

function EmbedBody({ embed }: Props) {
  switch (embed.kind) {
    case 'image':
      return <ImageEmbed embed={embed} />;
    case 'video':
      return <VideoEmbed embed={embed} />;
    case 'audio':
      return <AudioEmbed embed={embed} />;
    case 'file':
      return <FileEmbed embed={embed} />;
    case 'youtube':
    case 'vimeo':
      return <PlayerEmbed embed={embed} />;
    default:
      return null;
  }
}

/**
 * Lacquered embed card rendered below message text. One style tag for the
 * whole embed family; children are presentational only.
 */
export default function MessageEmbed({ embed }: Props) {
  if (embed.kind === 'link') return null;

  return (
    <span className="msg-embed-card" data-embed-kind={embed.kind} data-testid="msg-embed">
      <EmbedBody embed={embed} />
      <style>{embedStyles}</style>
    </span>
  );
}

const embedStyles = `
  .msg-embed-card {
    display: block;
    position: relative;
    margin-top: var(--sp-2, 8px);
    max-width: 480px;
    border-radius: var(--r-lg, 12px);
    background: var(--elev-tint-1, var(--bg-elevated, #132131));
    box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
                var(--elev-shadow-1, 0 8px 24px rgba(0,0,0,.28));
    border: 1px solid var(--border-subtle, rgba(255,255,255,.08));
    overflow: hidden;
    transition: border-color var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
  }
  .msg-embed-card:hover {
    border-color: color-mix(in srgb, var(--lux, #d8b96a) 36%, transparent);
  }

  /* ── image ─────────────────────────────────────────────────────────── */
  .embed-image-frame {
    display: block;
    position: relative;
    max-width: 100%;
    max-height: 360px;
    padding: 0;
    border: none;
    background: var(--bg-deep, #07111d);
    cursor: zoom-in;
    overflow: hidden;
  }
  .embed-image-frame:focus-visible {
    outline: 2px solid var(--accent, #0ea5e9);
    outline-offset: -2px;
  }
  .embed-image-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: opacity var(--t-surface, 220ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
  }

  /* skeleton shimmer while loading */
  .embed-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      105deg,
      transparent 30%,
      color-mix(in srgb, var(--text-primary, #dce8f4) 6%, transparent) 50%,
      transparent 70%
    );
    background-size: 220% 100%;
    animation: embed-shimmer-sweep 1.8s var(--ease-out, ease-out) infinite;
  }
  @keyframes embed-shimmer-sweep {
    from { background-position: 160% 0; }
    to   { background-position: -60% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .embed-shimmer { animation: none; }
    .embed-image-img { transition: none; }
  }

  /* ── video ─────────────────────────────────────────────────────────── */
  .embed-video-frame { display: block; background: var(--bg-deep, #07111d); }
  .embed-video {
    display: block;
    width: 100%;
    max-height: 360px;
    background: var(--bg-deep, #07111d);
  }

  /* ── audio ─────────────────────────────────────────────────────────── */
  .embed-audio-card {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2, 8px);
    padding: var(--sp-3, 12px);
  }
  .embed-audio-name {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-xs, .75rem);
    color: var(--text-secondary, #9db8cc);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .embed-audio {
    display: block;
    width: 100%;
    height: 36px;
  }

  /* ── file card ─────────────────────────────────────────────────────── */
  .embed-file-card {
    display: flex;
    align-items: center;
    gap: var(--sp-3, 12px);
    padding: var(--sp-3, 12px);
    text-decoration: none;
    color: inherit;
  }
  .embed-file-chip {
    flex-shrink: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-2xs, .6875rem);
    font-weight: 700;
    letter-spacing: .06em;
    color: var(--lux, #d8b96a);
    border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 28%, transparent);
    border-radius: var(--r-xs, 4px);
    padding: 3px 8px;
    line-height: 1.4;
  }
  .embed-file-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .embed-file-name {
    font-size: var(--text-sm, .8125rem);
    color: var(--text-primary, #dce8f4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .embed-file-size {
    font-size: var(--text-2xs, .6875rem);
    color: var(--text-muted, #7aa8c4);
    font-style: italic;
    opacity: .75;
  }
  .embed-file-arrow {
    flex-shrink: 0;
    color: var(--text-muted, #7aa8c4);
    transition: color var(--t-control, 150ms) var(--ease-out, ease-out);
  }
  .embed-file-card:hover .embed-file-arrow { color: var(--lux, #d8b96a); }
  .embed-file-card:focus-visible {
    outline: 2px solid var(--accent, #0ea5e9);
    outline-offset: -2px;
    border-radius: var(--r-lg, 12px);
  }

  /* ── youtube / vimeo player ────────────────────────────────────────── */
  .embed-player-frame {
    display: block;
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: none;
    background: var(--bg-deep, #07111d);
    overflow: hidden;
  }
  .embed-player-frame--poster { cursor: pointer; }
  .embed-player-frame--poster:focus-visible {
    outline: 2px solid var(--accent, #0ea5e9);
    outline-offset: -2px;
  }
  .embed-player-thumb,
  .embed-player-void {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .embed-player-void {
    background:
      radial-gradient(120% 90% at 50% 10%,
        color-mix(in srgb, var(--accent, #0ea5e9) 8%, transparent),
        transparent 60%),
      var(--bg-deep, #07111d);
  }
  .embed-player-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(2,6,12,.55), transparent 55%);
  }
  .embed-player-play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    color: var(--text-primary, #dce8f4);
    background: var(--scrim, rgba(2,6,12,.65));
    border: 1px solid color-mix(in srgb, var(--lux, #d8b96a) 32%, transparent);
    backdrop-filter: blur(6px);
    transition: transform var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
                border-color var(--t-control, 150ms) var(--ease-out, ease-out);
  }
  .embed-player-frame--poster:hover .embed-player-play {
    transform: translate(-50%, -50%) scale(1.06);
    border-color: color-mix(in srgb, var(--lux, #d8b96a) 60%, transparent);
  }
  .embed-player-site {
    position: absolute;
    left: var(--sp-3, 12px);
    bottom: var(--sp-2, 8px);
    font-size: var(--text-2xs, .6875rem);
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--text-secondary, #9db8cc);
  }
  .embed-player-iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .embed-player-play { transition: none; }
  }

  /* ── broken-media placeholder (concentric hairlines, EmptyState language) ── */
  .embed-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2, 8px);
    padding: var(--sp-5, 20px) var(--sp-4, 16px);
  }
  .embed-error-rings {
    position: relative;
    width: 56px;
    height: 56px;
  }
  .embed-error-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1px solid var(--border-subtle, rgba(255,255,255,.08));
  }
  .embed-error-ring--outer { width: 56px; height: 56px; opacity: .5; }
  .embed-error-ring--mid   { width: 38px; height: 38px; opacity: .75; }
  .embed-error-ring--inner {
    width: 20px; height: 20px;
    border-color: color-mix(in srgb, var(--lux, #d8b96a) 30%, transparent);
  }
  .embed-error-label {
    font-size: var(--text-2xs, .6875rem);
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--text-muted, #7aa8c4);
  }
`;
