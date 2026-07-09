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
  panelLabel?: string;
}>;

let popoverId = 0;

export function Popover(props: PopoverProps) {
  const [local, rest] = splitProps(props, ['trigger', 'id', 'open', 'defaultOpen', 'onOpenChange', 'placement', 'panelLabel', 'children']);
  const [innerOpen, setInnerOpen] = createSignal(local.defaultOpen ?? false);
  const instanceId = ++popoverId;
  const id = () => local.id ?? `onyx-popover-${instanceId}`;
  const anchorName = `--onyx-popover-anchor-${instanceId}`;
  let panelRef: PopoverElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

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

  // Position the panel relative to its trigger, clamped to the viewport. The
  // panel is in the top layer (native popover="auto"), where CSS anchor
  // positioning is unreliable and unsupported in Firefox/Safari — it was landing
  // at left:0 then shifting half off-screen. Measure and place it ourselves;
  // phones keep the CSS bottom-sheet (primitives.css), so we clear inline pos there.
  const positionPanel = (): void => {
    const panel = panelRef;
    const trigger = triggerRef;
    if (!panel || !trigger || typeof window === 'undefined') return;
    const mobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 560px)').matches;
    if (mobile) {
      for (const p of ['position', 'left', 'top', 'transform']) panel.style.removeProperty(p);
      return;
    }
    const t = trigger.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = t.left + t.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, vw - pw - margin));
    const placeTop = (local.placement ?? 'bottom') === 'top';
    let top = placeTop ? t.top - ph - 10 : t.bottom + 10;
    if (placeTop && top < margin) top = t.bottom + 10; // no room above → flip down
    if (!placeTop && top + ph > vh - margin) top = t.top - ph - 10; // flip up
    top = Math.max(margin, Math.min(top, vh - ph - margin));
    panel.style.position = 'fixed';
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.transform = 'none';
  };

  createEffect(() => {
    if (!isOpen() || typeof window === 'undefined') return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
    // Deferred one-shot DOM measurement — deliberately untracked; the effect
    // re-runs on isOpen() and the resize/scroll listeners cover the rest.
    // eslint-disable-next-line solid/reactivity
    raf(() => positionPanel());
    const reflow = () => positionPanel();
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    onCleanup(() => {
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    });
  });

  return (
    <span {...rest} class="onyx-popover" data-placement={local.placement ?? 'bottom'} style={{ '--onyx-anchor-name': anchorName }}>
      <button
        ref={triggerRef}
        type="button"
        class="onyx-popover__trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen()}
        aria-controls={id()}
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
        id={id()}
        role="dialog"
        aria-label={local.panelLabel}
        class="onyx-popover__panel"
        hidden={!isOpen()}
      >
        <Show when={isOpen()}>{local.children}</Show>
      </div>
    </span>
  );
}
