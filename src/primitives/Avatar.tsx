// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, splitProps, type JSX } from 'solid-js';

export type AvatarProps = JSX.HTMLAttributes<HTMLDivElement> & {
  name: string;
  owner?: boolean;
  size?: 'sm' | 'md';
};

const swatches = [
  ['linear-gradient(135deg, var(--lapis-deep), var(--stone-3))', 'var(--paper)'],
  ['linear-gradient(135deg, var(--stone-3), var(--stone-2))', 'var(--lapis-bright)'],
  ['linear-gradient(135deg, var(--stone-2), var(--lapis-deep))', 'var(--paper)'],
  ['linear-gradient(135deg, var(--ink), var(--stone-3))', 'var(--paper-dim)'],
  ['linear-gradient(135deg, var(--stone), var(--stone-2))', 'var(--paper)'],
];

/** Exact first-party service identity only — not bots, Announce, or similar names. */
function isOnyxOsService(name: string) {
  return name.trim().toLowerCase() === 'onyxos';
}

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

function serviceAriaLabel(owner?: boolean) {
  return owner ? 'OnyxOS, Onyx service, owner' : 'OnyxOS, Onyx service';
}

/** Compact decorative network mark — wrapper carries the accessible name. */
function OnyxOsServiceMark() {
  return (
    <svg
      class="onyx-avatar__service-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 3.2 19.2 7.4v9.2L12 20.8 4.8 16.6V7.4L12 3.2Zm0 2.35L6.7 8.55v6.9L12 18.45l5.3-3v-6.9L12 5.55Z"
        opacity="0.92"
      />
      <circle cx="12" cy="12" r="2.15" fill="currentColor" />
      <circle cx="12" cy="5.9" r="1.15" fill="currentColor" />
      <circle cx="17.35" cy="15.1" r="1.15" fill="currentColor" />
      <circle cx="6.65" cy="15.1" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function Avatar(props: AvatarProps) {
  const [local, rest] = splitProps(props, ['name', 'owner', 'size', 'class']);
  const service = createMemo(() => isOnyxOsService(local.name));
  const swatch = createMemo(() => {
    if (service()) return undefined;
    return swatches[hashName(local.name) % swatches.length] ?? swatches[0];
  });

  const ariaLabel = createMemo(() => {
    if (service()) return serviceAriaLabel(local.owner);
    return local.owner ? `${local.name}, owner` : local.name;
  });

  return (
    <div
      {...rest}
      class={[
        'onyx-avatar',
        `onyx-avatar--${local.size ?? 'md'}`,
        service() ? 'onyx-avatar--service' : undefined,
        local.owner ? 'onyx-avatar--owner' : undefined,
        local.class,
      ].filter(Boolean).join(' ')}
      role="img"
      aria-label={ariaLabel()}
      style={
        service()
          ? undefined
          : { '--onyx-avatar-bg': swatch()?.[0], '--onyx-avatar-fg': swatch()?.[1] }
      }
    >
      {service() ? <OnyxOsServiceMark /> : <span>{initials(local.name)}</span>}
    </div>
  );
}
