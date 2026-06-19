import { createEffect, createSignal, onCleanup, Show, splitProps, type JSX, type ParentProps } from 'solid-js';

type PopoverElement = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

export type PopoverProps = ParentProps<{
  trigger: JSX.Element;
  id?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: 'bottom' | 'top';
}>;

let popoverId = 0;

export function Popover(props: PopoverProps) {
  const [local, rest] = splitProps(props, ['trigger', 'id', 'open', 'defaultOpen', 'onOpenChange', 'placement', 'children']);
  const [innerOpen, setInnerOpen] = createSignal(local.defaultOpen ?? false);
  const instanceId = ++popoverId;
  const id = local.id ?? `ruri-popover-${instanceId}`;
  const anchorName = `--ruri-popover-anchor-${instanceId}`;
  let panelRef: PopoverElement | undefined;

  const isOpen = () => local.open ?? innerOpen();
  const setOpen = (next: boolean) => {
    if (local.open === undefined) setInnerOpen(next);
    local.onOpenChange?.(next);
  };

  createEffect(() => {
    const panel = panelRef;
    if (!panel) return;

    if (isOpen()) {
      if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover();
      return;
    }

    if (panel.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
  });

  createEffect(() => {
    if (!isOpen()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <span {...rest} class="ruri-popover" data-placement={local.placement ?? 'bottom'} style={{ '--ruri-anchor-name': anchorName }}>
      <button
        type="button"
        class="ruri-popover__trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen()}
        aria-controls={id}
        onClick={() => setOpen(!isOpen())}
      >
        {local.trigger}
      </button>
      <div
        ref={(element) => {
          panelRef = element;
          // Progressive enhancement: only opt into the native Popover API where the
          // browser implements it. Otherwise the panel's visibility is driven by
          // `hidden` + <Show>, so it still works (and stays testable under jsdom).
          if (typeof (element as PopoverElement).showPopover === 'function') {
            element.setAttribute('popover', 'auto');
          }
        }}
        id={id}
        role="dialog"
        class="ruri-popover__panel"
        hidden={!isOpen()}
      >
        <Show when={isOpen()}>{local.children}</Show>
      </div>
    </span>
  );
}
