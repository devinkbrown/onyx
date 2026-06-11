'use client';

import type { Embed } from '@/lib/embeds';

/**
 * Compact card for non-media uploads-service files: extension chip,
 * filename, size-unknown styling. Opens in a new tab.
 */
export default function FileEmbed({ embed }: { embed: Embed }) {
  const ext = (embed.extension ?? 'file').toUpperCase();

  return (
    <a
      className="embed-file-card"
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="embed-file"
    >
      <span className="embed-file-chip" aria-hidden="true">{ext}</span>
      <span className="embed-file-meta">
        <span className="embed-file-name">{embed.fileName ?? 'file'}</span>
        <span className="embed-file-size">size unknown</span>
      </span>
      <span className="embed-file-arrow" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h7v7" />
          <path d="M13 3L3 13" />
        </svg>
      </span>
    </a>
  );
}
