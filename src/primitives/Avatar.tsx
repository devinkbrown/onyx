import { createMemo, splitProps, type JSX } from 'solid-js';

export type AvatarProps = JSX.HTMLAttributes<HTMLDivElement> & {
  name: string;
  owner?: boolean;
  size?: 'sm' | 'md';
};

const swatches = [
  ['linear-gradient(135deg, var(--lapis-deep), var(--stone-3))', 'var(--washi)'],
  ['linear-gradient(135deg, var(--stone-3), var(--stone-2))', 'var(--lapis-bright)'],
  ['linear-gradient(135deg, var(--stone-2), var(--lapis-deep))', 'var(--washi)'],
  ['linear-gradient(135deg, var(--ink), var(--stone-3))', 'var(--washi-dim)'],
  ['linear-gradient(135deg, var(--stone), var(--stone-2))', 'var(--washi)'],
];

function hashName(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export function Avatar(props: AvatarProps) {
  const [local, rest] = splitProps(props, ['name', 'owner', 'size', 'class']);
  const swatch = createMemo(() => swatches[hashName(local.name) % swatches.length] ?? swatches[0]);

  return (
    <div
      {...rest}
      class={[
        'ruri-avatar',
        `ruri-avatar--${local.size ?? 'md'}`,
        local.owner ? 'ruri-avatar--owner' : undefined,
        local.class,
      ].filter(Boolean).join(' ')}
      role="img"
      aria-label={local.owner ? `${local.name}, owner` : local.name}
      style={{ '--ruri-avatar-bg': swatch()?.[0], '--ruri-avatar-fg': swatch()?.[1] }}
    >
      <span>{initials(local.name)}</span>
    </div>
  );
}
