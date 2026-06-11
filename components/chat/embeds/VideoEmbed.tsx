'use client';

import { useCallback, useState } from 'react';
import type { Embed } from '@/lib/embeds';
import EmbedError from './EmbedError';

/** Direct video file embed — native controls, metadata-only preload. */
export default function VideoEmbed({ embed }: { embed: Embed }) {
  const [errored, setErrored] = useState(false);
  const onError = useCallback(() => setErrored(true), []);

  if (errored) {
    return <EmbedError label="video unavailable" />;
  }

  return (
    <span className="embed-video-frame">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="embed-video"
        src={embed.url}
        controls
        preload="metadata"
        playsInline
        onError={onError}
        data-testid="embed-video"
      />
    </span>
  );
}
