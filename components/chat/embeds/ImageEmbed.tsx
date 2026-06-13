'use client';

import { useCallback, useState } from 'react';
import type { Embed } from '@/lib/embeds';
import ImageLightbox from '@/components/ui/ImageLightbox';
import EmbedError from './EmbedError';

const MAX_BOX_WIDTH = 480;
const MAX_BOX_HEIGHT = 360;
const DEFAULT_RATIO = 16 / 9;

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Image embed with intrinsic-ratio reservation: the frame keeps a 16:9
 * skeleton while loading, then locks to the image's natural ratio capped to
 * the max box — the <img> itself is absolutely positioned so it never pushes
 * layout while decoding.
 */
export default function ImageEmbed({ embed }: { embed: Embed }) {
  const [state, setState] = useState<LoadState>('loading');
  const [ratio, setRatio] = useState<number>(DEFAULT_RATIO);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const onLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setRatio(img.naturalWidth / img.naturalHeight);
    }
    setState('ready');
  }, []);

  const onError = useCallback(() => setState('error'), []);
  const openLightbox = useCallback(() => setLightboxOpen(true), []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  if (state === 'error') {
    return <EmbedError label="image unavailable" />;
  }

  const width = Math.min(MAX_BOX_WIDTH, Math.round(MAX_BOX_HEIGHT * ratio));

  return (
    <>
      <button
        type="button"
        className={`embed-image-frame ${state === 'loading' ? 'embed-image-frame--loading' : ''}`}
        style={{ width: `${width}px`, aspectRatio: `${ratio}` }}
        onClick={openLightbox}
        aria-label={`View image ${embed.fileName ?? ''}`.trim()}
        data-testid="embed-image-frame"
      >
        {state === 'loading' && <span className="embed-shimmer" aria-hidden="true" />}
        { }
        <img
          src={embed.url}
          alt={embed.fileName ?? 'image'}
          className="embed-image-img"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={onError}
          style={{ opacity: state === 'ready' ? 1 : 0 }}
          draggable={false}
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox src={embed.url} alt={embed.fileName ?? ''} onClose={closeLightbox} />
      )}
    </>
  );
}
