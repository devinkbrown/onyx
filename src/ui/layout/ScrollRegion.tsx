// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  joinLayoutClass,
  resolveLayoutAs,
  type LayoutAs,
} from './Frame';

const NAMED_TAGS = new Set<LayoutAs>([
  'section',
  'article',
  'aside',
  'main',
  'nav',
  'header',
  'footer',
  'form',
]);

function namedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type ScrollRegionProps = JSX.HTMLAttributes<HTMLElement> & {
  as?: LayoutAs;
  label?: string;
  labelledBy?: string;
};

export function ScrollRegion(props: ScrollRegionProps) {
  const [local, rest] = splitProps(props, [
    'as',
    'label',
    'labelledBy',
    'class',
    'children',
    'role',
    'tabIndex',
  ]);

  const tag = createMemo(() => resolveLayoutAs(local.as));
  const label = createMemo(() => namedText(local.label));
  const labelledBy = createMemo(() => namedText(local.labelledBy));
  const named = createMemo(() => Boolean(label() || labelledBy()));
  const className = createMemo(() => joinLayoutClass('ui-layout', 'ui-scroll', local.class));
  const role = createMemo(() => {
    if (local.role !== undefined) return local.role;
    if (named() && !NAMED_TAGS.has(tag())) return 'region';
    return undefined;
  });
  const tabIndex = createMemo(() => {
    if (local.tabIndex !== undefined) return local.tabIndex;
    return named() ? 0 : undefined;
  });

  return (
    <Dynamic
      component={tag()}
      {...rest}
      class={className()}
      data-ui="scroll"
      role={role()}
      tabIndex={tabIndex()}
      aria-label={label()}
      aria-labelledby={labelledBy()}
    >
      {local.children}
    </Dynamic>
  );
}
