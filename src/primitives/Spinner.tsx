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
      class={['ruri-spinner', `ruri-spinner--${local.size ?? 'md'}`, local.class].filter(Boolean).join(' ')}
      role={local.label ? 'status' : undefined}
      aria-label={local.label}
      aria-hidden={local.label ? undefined : 'true'}
    >
      <span class="ruri-spinner__ring" />
      <Show when={local.label}>
        <span class="ruri-spinner__label">{local.label}</span>
      </Show>
    </span>
  );
}
