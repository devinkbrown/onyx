'use client';

import { useCallback, useState } from 'react';
import type { Embed } from '@/lib/embeds';

/**
 * Privacy-friendly YouTube/Vimeo embed: nothing third-party loads until the
 * user clicks play. YouTube shows a static i.ytimg.com thumbnail (no-referrer,
 * lazy); Vimeo gets a dark placeholder because its thumbnails require an API
 * round-trip we refuse to make. The click swaps in the nocookie/dnt iframe.
 */
export default function PlayerEmbed({ embed }: { embed: Embed }) {
  const [activated, setActivated] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);

  const activate = useCallback(() => setActivated(true), []);
  const onThumbError = useCallback(() => setThumbBroken(true), []);

  const siteName = embed.kind === 'youtube' ? 'YouTube' : 'Vimeo';

  if (activated && embed.embedUrl) {
    return (
      <span className="embed-player-frame embed-player-frame--live">
        <iframe
          className="embed-player-iframe"
          src={embed.embedUrl}
          title={`${siteName} video ${embed.videoId ?? ''}`.trim()}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="no-referrer"
          data-testid="embed-player-iframe"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      className="embed-player-frame embed-player-frame--poster"
      onClick={activate}
      aria-label={`Play ${siteName} video`}
      data-testid="embed-player-poster"
    >
      {embed.thumbnailUrl && !thumbBroken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={embed.thumbnailUrl}
          alt=""
          className="embed-player-thumb"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={onThumbError}
          draggable={false}
        />
      ) : (
        <span className="embed-player-void" aria-hidden="true" />
      )}
      <span className="embed-player-scrim" aria-hidden="true" />
      <span className="embed-player-play" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6 4.2v11.6c0 .9 1 1.45 1.77.97l9.04-5.8a1.15 1.15 0 0 0 0-1.94L7.77 3.23A1.15 1.15 0 0 0 6 4.2z" />
        </svg>
      </span>
      <span className="embed-player-site">{siteName}</span>
    </button>
  );
}
