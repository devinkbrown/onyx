// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, splitProps, type JSX } from 'solid-js';

export type SpinnerProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  label?: string;
  size?: 'sm' | 'md';
};

export function Spinner(props: SpinnerProps) {
  const [local, rest] = splitProps(props, ['label', 'size', 'class']);

  return (
    <span
      {...rest}
      class={['onyx-spinner', `onyx-spinner--${local.size ?? 'md'}`, local.class].filter(Boolean).join(' ')}
      role={local.label ? 'status' : undefined}
      aria-label={local.label}
      aria-hidden={local.label ? undefined : 'true'}
    >
      <span class="onyx-spinner__ring" />
      <Show when={local.label}>
        <span class="onyx-spinner__label">{local.label}</span>
      </Show>
    </span>
  );
}
