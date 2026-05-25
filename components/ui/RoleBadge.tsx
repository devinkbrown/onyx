import type { CSSProperties } from 'react';

interface PrefixConfig {
  label: string;
  color: string;
  bg: string;
}

/* Ophion PREFIX=(qov).@+  — q='.', o='@', v='+'. */
const PREFIX_CONFIG: Record<string, PrefixConfig> = {
  '.': { label: '.', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },  // owner (q)
  '@': { label: '@', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },  // op (o)
  '+': { label: '+', color: '#34d399', bg: 'rgba(52,211,153,0.15)' },  // voice (v)
};

interface RoleBadgeProps {
  prefix: string;
}

const badgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 600,
  paddingInline: 5,
  paddingBlock: 2,
  borderRadius: 3,
  flexShrink: 0,
  lineHeight: 1,
};

export function RoleBadge({ prefix }: RoleBadgeProps) {
  const config = PREFIX_CONFIG[prefix];
  if (!config) return null;

  return (
    <span
      aria-label={`${prefix} role`}
      style={{
        ...badgeStyle,
        color: config.color,
        background: config.bg,
      }}
    >
      {config.label}
    </span>
  );
}
