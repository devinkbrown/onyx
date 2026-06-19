import { Show, splitProps, type JSX } from 'solid-js';
import { Tooltip } from './Tooltip';

export type IconButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tooltip?: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'primary' | 'danger';
};

function iconButtonClass(variant: IconButtonProps['variant'], size: IconButtonProps['size'], className: string | undefined) {
  return [
    'ruri-icon-button',
    `ruri-icon-button--${variant ?? 'ghost'}`,
    `ruri-icon-button--${size ?? 'md'}`,
    className,
  ].filter(Boolean).join(' ');
}

function BareIconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ['label', 'tooltip', 'size', 'variant', 'class', 'children', 'type']);

  return (
    <button
      {...rest}
      type={local.type ?? 'button'}
      class={iconButtonClass(local.variant, local.size, local.class)}
      aria-label={local.label}
    >
      <span class="ruri-icon-button__glyph" aria-hidden="true">{local.children}</span>
    </button>
  );
}

export function IconButton(props: IconButtonProps) {
  return (
    <Show when={props.tooltip} fallback={<BareIconButton {...props} />}>
      {(tooltip) => (
        <Tooltip content={tooltip()}>
          <BareIconButton {...props} />
        </Tooltip>
      )}
    </Show>
  );
}
