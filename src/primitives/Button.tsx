import { Show, splitProps, type JSX } from 'solid-js';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
};

function classes(variant: ButtonVariant | undefined, size: ButtonSize | undefined, className: string | undefined) {
  return [
    'ruri-button',
    `ruri-button--${variant ?? 'primary'}`,
    `ruri-button--${size ?? 'md'}`,
    className,
  ].filter(Boolean).join(' ');
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'href', 'class', 'children', 'disabled', 'onClick', 'onKeyDown', 'type']);

  const clickIfKeyboard = (event: KeyboardEvent) => {
    if (local.disabled) {
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      (event.currentTarget as HTMLButtonElement | HTMLAnchorElement).click();
    }
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLButtonElement | HTMLAnchorElement, KeyboardEvent> = (event) => {
    if (typeof local.onKeyDown === 'function') local.onKeyDown(event as never);
    if (event.defaultPrevented) return;
    clickIfKeyboard(event);
  };

  const handleClick: JSX.EventHandlerUnion<HTMLButtonElement | HTMLAnchorElement, MouseEvent> = (event) => {
    if (local.disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (typeof local.onClick === 'function') local.onClick(event as never);
  };

  return (
    <Show
      when={local.href}
      fallback={
        <button
          {...(rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>)}
          type={local.type ?? 'button'}
          class={classes(local.variant, local.size, local.class)}
          disabled={local.disabled}
          onClick={handleClick as JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>}
          onKeyDown={handleKeyDown as JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent>}
        >
          {local.children}
        </button>
      }
    >
      {(href) => (
        <a
          {...(rest as JSX.AnchorHTMLAttributes<HTMLAnchorElement>)}
          href={local.disabled ? undefined : href()}
          class={classes(local.variant, local.size, local.class)}
          aria-disabled={local.disabled ? 'true' : undefined}
          tabIndex={local.disabled ? -1 : rest.tabIndex}
          onClick={handleClick as JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>}
          onKeyDown={handleKeyDown as JSX.EventHandlerUnion<HTMLAnchorElement, KeyboardEvent>}
        >
          {local.children}
        </a>
      )}
    </Show>
  );
}
