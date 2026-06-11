'use client';

import { useOnyxStore } from '@/lib/store';

interface RoleMeta {
  mode: string;
  prefix: string;
  label: string;
  glyph: string;
  tone: 'owner' | 'op' | 'voice' | 'member';
}

interface RoleBadgeProps {
  mode?: string;
  modes?: Set<string>;
  prefix?: string;
  compact?: boolean;
}

function labelFor(prefix: string, mode: string): string {
  if (prefix === '!') return 'Founder';
  if (prefix === '~' || prefix === '.' || mode === 'q' || mode === 'Q') return 'Owner';
  if (prefix === '@' || mode === 'o') return 'Op';
  if (prefix === '+' || mode === 'v') return 'Voice';
  return 'Member';
}

function glyphFor(prefix: string, mode: string): string {
  if (prefix === '!' || prefix === '~' || prefix === '.' || mode === 'q' || mode === 'Q') return '♛';
  if (prefix === '@' || mode === 'o') return '@';
  if (prefix === '+' || mode === 'v') return '+';
  return '•';
}

function toneFor(prefix: string, mode: string): RoleMeta['tone'] {
  if (prefix === '!' || prefix === '~' || prefix === '.' || mode === 'q' || mode === 'Q') return 'owner';
  if (prefix === '@' || mode === 'o') return 'op';
  if (prefix === '+' || mode === 'v') return 'voice';
  return 'member';
}

export function roleMetaFromMode(mode: string, modeToPrefix: Record<string, string>): RoleMeta {
  const prefix = modeToPrefix[mode] ?? '';
  return {
    mode,
    prefix,
    label: labelFor(prefix, mode),
    glyph: glyphFor(prefix, mode),
    tone: toneFor(prefix, mode),
  };
}

export function highestRoleMode(modes: Set<string> | undefined, modeToPrefix: Record<string, string>): string {
  if (!modes) return '';
  for (const mode of Object.keys(modeToPrefix)) {
    if (modes.has(mode)) return mode;
  }
  return '';
}

export function roleGroupLabel(mode: string, modeToPrefix: Record<string, string>): string {
  if (!mode) return 'Members';
  const meta = roleMetaFromMode(mode, modeToPrefix);
  if (meta.prefix === '!') return 'Founders';
  if (meta.tone === 'owner') return 'Owners';
  if (meta.tone === 'op') return 'Operators';
  if (meta.tone === 'voice') return 'Voiced';
  return `${meta.label}s`;
}

export default function RoleBadge({ mode, modes, prefix, compact = false }: RoleBadgeProps) {
  const modeToPrefix = useOnyxStore(s => s.isupportModeToPrefix);
  const prefixToMode = useOnyxStore(s => s.isupportPrefixToMode);
  const resolvedMode = mode ?? (prefix ? prefixToMode[prefix] : '') ?? highestRoleMode(modes, modeToPrefix);
  if (!resolvedMode) return null;

  const meta = roleMetaFromMode(resolvedMode, modeToPrefix);

  return (
    <>
      <span
        className={`role-badge role-badge--${meta.tone}${compact ? ' role-badge--compact' : ''}`}
        aria-label={`${meta.label} role`}
        title={`${meta.label}${meta.prefix ? ` (${meta.prefix})` : ''}`}
        data-testid="role-badge"
      >
        <span className="role-badge-glyph" aria-hidden>{meta.glyph}</span>
        {!compact && <span>{meta.label}</span>}
      </span>
      <style>{`
        .role-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--sp-1, 4px);
          min-height: 20px;
          padding: 2px 7px;
          border: 0;
          border-radius: var(--r-xs, 4px) var(--r-md, 8px) var(--r-xs, 4px) var(--r-sm, 6px);
          background: var(--elev-tint-1, color-mix(in srgb, var(--bg-elevated) 94%, var(--accent) 3%));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.24));
          color: var(--text-secondary);
          font-size: var(--text-2xs, .6875rem);
          font-weight: 800;
          letter-spacing: 0;
          line-height: 1;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .role-badge--compact {
          width: 20px;
          padding: 0;
        }
        .role-badge--owner {
          color: var(--lux, #d8b96a);
          background: color-mix(in srgb, var(--elev-tint-2, var(--bg-float)) 88%, var(--lux, #d8b96a) 12%);
        }
        .role-badge--op {
          color: var(--accent, #6aa8ff);
        }
        .role-badge--voice {
          color: var(--success, #35d07f);
        }
        .role-badge-glyph {
          font-family: var(--font-display), Georgia, serif;
          font-size: 1.05em;
          line-height: 1;
        }
      `}</style>
    </>
  );
}
