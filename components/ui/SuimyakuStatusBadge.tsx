'use client';
import { useSuimyakuFlags } from '@/hooks/useSuimyakuMedia';

export default function SuimyakuStatusBadge() {
  const flags = useSuimyakuFlags();
  if (!flags.enabled) return null;

  const features: string[] = [];
  if (flags.e2e) features.push('E2E');
  if (flags.mixer) features.push('mixer');
  if (flags.spatial) features.push('3D');
  if (flags.simulcast) features.push('simulcast');

  const tooltip = [
    `SUIMYAKU v${flags.version}`,
    flags.codecs.length ? `codecs: ${flags.codecs.join(', ')}` : null,
    flags.max ? `max: ${flags.max} peers` : null,
    features.length ? `features: ${features.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  return (
    <span
      title={tooltip}
      className={`suimyaku-badge${flags.e2e ? ' suimyaku-badge--e2e' : ''}`}
      aria-label={`SUIMYAKU media protocol active${flags.e2e ? ', end-to-end encrypted' : ''}`}
    >
      <span className="suimyaku-badge-dot" aria-hidden="true" />
      SUIMYAKU
      {flags.e2e && <span className="suimyaku-badge-e2e">E2E</span>}
      <style>{`
        .suimyaku-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 7px; border-radius: var(--r-full, 999px); font-size: var(--text-2xs, 11px);
          font-weight: 600; letter-spacing: 0.04em; user-select: none;
          background: var(--elev-tint-1, rgba(255,255,255,0.06));
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.12));
          color: var(--text-muted);
          white-space: nowrap;
        }
        .suimyaku-badge--e2e {
          background: var(--accent-subtle, rgba(14,165,233,0.15));
          border-color: var(--accent-border, rgba(14,165,233,0.35));
          color: var(--accent);
        }
        .suimyaku-badge-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: currentColor; flex-shrink: 0;
        }
        .suimyaku-badge-e2e { font-size: 10px; opacity: 0.8; }
      `}</style>
    </span>
  );
}
