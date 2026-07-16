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
  let describedTarget: HTMLElement | undefined;
  let describedId: string | undefined;

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

  const removeTooltipDescription = (): void => {
    if (!describedTarget || !describedId) return;
    const remaining = (describedTarget.getAttribute('aria-describedby') ?? '')
      .split(/\s+/u)
      .filter((token) => token && token !== describedId);
    if (remaining.length > 0) describedTarget.setAttribute('aria-describedby', remaining.join(' '));
    else describedTarget.removeAttribute('aria-describedby');
    describedTarget = undefined;
    describedId = undefined;
  };

  createEffect(() => {
    const target = triggerRef?.firstElementChild instanceof HTMLElement
      ? triggerRef.firstElementChild
      : triggerRef;
    const tooltipId = id();

    removeTooltipDescription();

    if (!target || !open()) return;

    const ids = new Set((target.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(Boolean));
    ids.add(tooltipId);
    target.setAttribute('aria-describedby', [...ids].join(' '));
    describedTarget = target;
    describedId = tooltipId;
  });

  onCleanup(() => {
    clearTimer();
    removeTooltipDescription();
  });

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
