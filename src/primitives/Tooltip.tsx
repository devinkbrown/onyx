// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, onCleanup, Show, splitProps, type JSX, type ParentProps } from 'solid-js';

export type TooltipProps = ParentProps<{
  content: JSX.Element;
  id?: string;
  placement?: 'top' | 'bottom';
  openDelay?: number;
  disabled?: boolean;
}>;

let tooltipId = 0;

export function Tooltip(props: TooltipProps) {
  const [local, rest] = splitProps(props, ['content', 'id', 'placement', 'openDelay', 'disabled', 'children']);
  const [open, setOpen] = createSignal(false);
  const instanceId = ++tooltipId;
  const id = () => local.id ?? `onyx-tooltip-${instanceId}`;
  const anchorName = `--onyx-tooltip-anchor-${instanceId}`;
  let triggerRef: HTMLSpanElement | undefined;
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const show = () => {
    if (local.disabled) return;
    clearTimer();
    timer = window.setTimeout(() => setOpen(true), local.openDelay ?? 80);
  };

  const hide = () => {
    clearTimer();
    setOpen(false);
  };

  createEffect(() => {
    const target = triggerRef?.firstElementChild instanceof HTMLElement
      ? triggerRef.firstElementChild
      : triggerRef;

    if (!target) return;
    if (open()) {
      target.setAttribute('aria-describedby', id());
      return;
    }

    target.removeAttribute('aria-describedby');
  });

  onCleanup(clearTimer);

  return (
    <span
      {...rest}
      class="onyx-tooltip"
      data-placement={local.placement ?? 'top'}
      style={{ '--onyx-anchor-name': anchorName }}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusIn={show}
      onFocusOut={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      <span ref={triggerRef} class="onyx-tooltip__trigger">{local.children}</span>
      <Show when={open()}>
        <span id={id()} role="tooltip" class="onyx-tooltip__content">{local.content}</span>
      </Show>
    </span>
  );
}
