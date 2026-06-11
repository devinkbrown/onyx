'use client';

/**
 * Broken-media placeholder — concentric hairline rings, consistent with the
 * EmptyState illustration language. Pure presentational.
 */
export default function EmbedError({ label = 'media unavailable' }: { label?: string }) {
  return (
    <span className="embed-error" role="img" aria-label={label}>
      <span className="embed-error-rings" aria-hidden="true">
        <span className="embed-error-ring embed-error-ring--outer" />
        <span className="embed-error-ring embed-error-ring--mid" />
        <span className="embed-error-ring embed-error-ring--inner" />
      </span>
      <span className="embed-error-label">{label}</span>
    </span>
  );
}
