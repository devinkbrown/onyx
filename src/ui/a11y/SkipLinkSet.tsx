// SPDX-License-Identifier: AGPL-3.0-or-later
import { For, Show, createMemo, type JSX } from 'solid-js';

/**
 * Ordered skip destinations for later strangler wiring.
 * Native hash links only — no focus manager and no host DOM globals.
 */
export const DEFAULT_SKIP_LINK_SET_LABEL = 'Skip links';

export type SkipLinkTarget = {
  readonly id: string;
  readonly label: string;
  /** When false the destination is omitted. Missing means include. */
  readonly when?: boolean;
};

export type NormalizedSkipTarget = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
};

export type SkipLinkSetProps = {
  targets?: readonly SkipLinkTarget[] | null;
  /** Accessible name for the skip landmark. */
  label?: string;
  class?: string;
  /** Token or chrome class applied to each skip link. */
  linkClass?: string;
};

export function normalizeSkipTargetId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const id = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
  if (id.length === 0) return undefined;
  if (/\s/.test(id)) return undefined;
  if (/[#/?]/.test(id)) return undefined;
  return id;
}

export function isValidSkipTargetId(value: unknown): boolean {
  return normalizeSkipTargetId(value) !== undefined;
}

export function normalizeSkipTargets(
  targets: readonly SkipLinkTarget[] | null | undefined,
): NormalizedSkipTarget[] {
  if (!Array.isArray(targets)) return [];

  const seen = new Set<string>();
  const items: NormalizedSkipTarget[] = [];

  for (const target of targets) {
    if (!target || target.when === false) continue;
    const id = normalizeSkipTargetId(target.id);
    if (id === undefined || seen.has(id)) continue;
    const label = typeof target.label === 'string' ? target.label.trim().replace(/\s+/g, ' ') : '';
    if (label.length === 0) continue;
    seen.add(id);
    items.push({ id, label, href: `#${id}` });
  }

  return items;
}

export function SkipLinkSet(props: SkipLinkSetProps): JSX.Element {
  const items = createMemo(() => normalizeSkipTargets(props.targets));
  const className = createMemo(() => props.class);
  const linkClass = createMemo(() => props.linkClass);
  const label = createMemo(() => {
    const named = typeof props.label === 'string' ? props.label.trim() : '';
    return named.length > 0 ? named : DEFAULT_SKIP_LINK_SET_LABEL;
  });

  return (
    <Show when={items().length > 0}>
      <nav data-ui="skip-link-set" class={className()} aria-label={label()}>
        <ol>
          <For each={items()}>
            {(item) => (
              <li>
                <a data-ui="skip-link" class={linkClass()} href={item.href}>
                  {item.label}
                </a>
              </li>
            )}
          </For>
        </ol>
      </nav>
    </Show>
  );
}
