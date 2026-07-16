// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, onCleanup, Show, splitProps, untrack, type JSX, type ParentProps } from 'solid-js';
import { keyboardEventIsClaimed } from './focusTrap';

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
  let descriptionOwned = false;
  let hovered = false;
  let focusWithin = false;
  let escapeDismissed = false;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const hide = () => {
    clearTimer();
    setOpen(false);
  };

  const hasIntent = (): boolean => hovered || focusWithin;

  const scheduleShow = (): void => {
    if (local.disabled || escapeDismissed || open() || timer !== undefined || !hasIntent()) return;
    const scheduledTarget = descriptionTarget();
    timer = window.setTimeout(() => {
      timer = undefined;
      if (
        disposed ||
        untrack(() => Boolean(local.disabled)) ||
        escapeDismissed ||
        !hasIntent() ||
        !triggerRef?.isConnected ||
        !scheduledTarget?.isConnected ||
        descriptionTarget() !== scheduledTarget
      ) return;
      setOpen(true);
    }, Math.max(0, local.openDelay ?? 80));
  };

  const reconcileIntent = (): void => {
    if (!hasIntent()) {
      escapeDismissed = false;
      hide();
      return;
    }
    if (local.disabled || escapeDismissed) {
      clearTimer();
      if (local.disabled) setOpen(false);
      return;
    }
    scheduleShow();
  };

  const dismissWithEscape = (): void => {
    escapeDismissed = true;
    hide();
  };

  const descriptionTarget = (): HTMLElement | undefined => {
    const interactive = triggerRef?.querySelector<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (interactive) return interactive;
    return triggerRef?.firstElementChild instanceof HTMLElement ? triggerRef.firstElementChild : triggerRef;
  };

  const removeTooltipDescription = (): void => {
    if (!describedTarget || !describedId) return;
    if (descriptionOwned) {
      const remaining = (describedTarget.getAttribute('aria-describedby') ?? '')
        .split(/\s+/u)
        .filter((token) => token && token !== describedId);
      if (remaining.length > 0) describedTarget.setAttribute('aria-describedby', remaining.join(' '));
      else describedTarget.removeAttribute('aria-describedby');
    }
    describedTarget = undefined;
    describedId = undefined;
    descriptionOwned = false;
  };

  createEffect(() => {
    const target = descriptionTarget();
    const tooltipId = id();

    removeTooltipDescription();

    if (!target || !open()) return;

    const ids = new Set((target.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(Boolean));
    descriptionOwned = !ids.has(tooltipId);
    ids.add(tooltipId);
    target.setAttribute('aria-describedby', [...ids].join(' '));
    describedTarget = target;
    describedId = tooltipId;
  });

  createEffect(() => {
    if (local.disabled) {
      hide();
      return;
    }
    if (hasIntent()) scheduleShow();
  });

  createEffect(() => {
    if (!open()) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (keyboardEventIsClaimed(event)) return;
      if (event.key === 'Escape') dismissWithEscape();
    };
    document.addEventListener('keydown', handleEscape);
    onCleanup(() => document.removeEventListener('keydown', handleEscape));
  });

  onCleanup(() => {
    disposed = true;
    clearTimer();
    removeTooltipDescription();
  });

  return (
    <span
      {...rest}
      class="onyx-tooltip"
      data-placement={local.placement ?? 'top'}
      style={{ '--onyx-anchor-name': anchorName }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        hovered = true;
        reconcileIntent();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') return;
        hovered = false;
        reconcileIntent();
      }}
      onFocusIn={() => {
        focusWithin = true;
        reconcileIntent();
      }}
      onFocusOut={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        focusWithin = false;
        reconcileIntent();
      }}
    >
      <span ref={triggerRef} class="onyx-tooltip__trigger">{local.children}</span>
      <Show when={open()}>
        <span id={id()} role="tooltip" class="onyx-tooltip__content">{local.content}</span>
      </Show>
    </span>
  );
}
