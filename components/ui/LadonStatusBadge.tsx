'use client';
import { useLadonFlags } from '@/hooks/useLadonMedia';

export default function LadonStatusBadge() {
  const flags = useLadonFlags();
  if (!flags.enabled) return null;

  const features: string[] = [];
  if (flags.e2e) features.push('E2E');
  if (flags.mixer) features.push('mixer');
  if (flags.spatial) features.push('3D');
  if (flags.simulcast) features.push('simulcast');

  const tooltip = [
    `LADON v${flags.version}`,
    flags.codecs.length ? `codecs: ${flags.codecs.join(', ')}` : null,
    flags.max ? `max: ${flags.max} peers` : null,
    features.length ? `features: ${features.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  return (
    <span
      title={tooltip}
      className={`ladon-badge${flags.e2e ? ' ladon-badge--e2e' : ''}`}
      aria-label={`LADON media protocol active${flags.e2e ? ', end-to-end encrypted' : ''}`}
    >
      <span className="ladon-badge-dot" aria-hidden="true" />
      LADON
      {flags.e2e && <span className="ladon-badge-e2e">E2E</span>}
      <style>{`
        .ladon-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 7px; border-radius: 999px; font-size: 11px;
          font-weight: 600; letter-spacing: 0.04em; user-select: none;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          color: var(--text-muted);
          white-space: nowrap;
        }
        .ladon-badge--e2e {
          background: rgba(14,165,233,0.15);
          border-color: rgba(14,165,233,0.35);
          color: var(--accent);
        }
        .ladon-badge-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: currentColor; flex-shrink: 0;
        }
        .ladon-badge-e2e { font-size: 10px; opacity: 0.8; }
      `}</style>
    </span>
  );
}
