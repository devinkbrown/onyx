'use client';

import { useCallback, useState } from 'react';
import type { Embed } from '@/lib/embeds';
import EmbedError from './EmbedError';

/** Audio file embed — filename header + minimally styled native controls. */
export default function AudioEmbed({ embed }: { embed: Embed }) {
  const [errored, setErrored] = useState(false);
  const onError = useCallback(() => setErrored(true), []);

  if (errored) {
    return <EmbedError label="audio unavailable" />;
  }

  return (
    <span className="embed-audio-card">
      {embed.fileName && <span className="embed-audio-name">{embed.fileName}</span>}
      <audio
        className="embed-audio"
        src={embed.url}
        controls
        preload="metadata"
        onError={onError}
        data-testid="embed-audio"
      />
    </span>
  );
}
