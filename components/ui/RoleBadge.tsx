import type { CSSProperties } from 'react';

interface PrefixConfig {
  label: string;
  color: string;
  bg: string;
}

/* Ophion PREFIX=(qov).@+  — q='.', o='@', v='+'. */
const PREFIX_CONFIG: Record<string, PrefixConfig> = {
  '.': { label: 'Owner', color: '#e8b84b', bg: 'rgba(232,184,75,0.15)' },  // owner (q)
  '@': { label: 'Op',    color: '#0ea5e9', bg: 'rgba(14,165,233,0.15)' },  // op (o)
  '+': { label: 'Voice', color: '#23a55a', bg: 'rgba(35,165,90,0.15)' },   // voice (v)
};

const BORDER_CONFIG: Record<string, string> = {
  '.': 'rgba(232,184,75,0.35)',
  '@': 'rgba(14,165,233,0.35)',
  '+': 'rgba(35,165,90,0.35)',
};

interface RoleBadgeProps {
  prefix: string;
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  fontFamily: 'inherit',
  fontWeight: 700,
  padding: '2px 7px',
  borderRadius: 4,
  flexShrink: 0,
  lineHeight: 1,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  transition: 'filter 150ms ease',
};

export function RoleBadge({ prefix }: RoleBadgeProps) {
  const config = PREFIX_CONFIG[prefix];
  if (!config) return null;

  return (
    <>
      <span
        className="role-badge"
        aria-label={`${config.label} role`}
        style={{
          ...badgeStyle,
          color: config.color,
          background: config.bg,
          border: `1px solid ${BORDER_CONFIG[prefix] ?? 'transparent'}`,
        }}
      >
        {config.label}
      </span>
      <style>{`
        .role-badge:hover {
          filter: brightness(1.25);
        }
      `}</style>
    </>
  );
}
