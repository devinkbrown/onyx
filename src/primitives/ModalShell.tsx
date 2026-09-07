// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, createUniqueId, splitProps, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createDialogFocus } from './focusTrap';

export type ModalShellProps = ParentProps<{
  open: boolean;
  title: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  closeLabel?: string;
  returnFocus?: HTMLElement | null | (() => HTMLElement | null | undefined);
  returnFocusFallback?: HTMLElement | null;
}>;

export function ModalShell(props: ModalShellProps) {
  const [local, rest] = splitProps(props, [
    'open',
    'title',
    'description',
    'onOpenChange',
    'closeLabel',
    'returnFocus',
    'returnFocusFallback',
    'children',
  ]);
  const instanceId = createUniqueId();
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;
  let dialogRef: HTMLElement | undefined;
  let rootRef: HTMLDivElement | undefined;

  createDialogFocus({
    isOpen: () => local.open,
    getPanel: () => dialogRef,
    onEscape: () => local.onOpenChange(false),
    getReturnFocus: () => typeof local.returnFocus === 'function' ? local.returnFocus() : local.returnFocus,
    getReturnFocusFallback: () => local.returnFocusFallback,
    getRoot: () => rootRef,
  });

  return (
    <Show when={local.open}>
      <Portal>
        <div ref={(element) => { rootRef = element; }} {...rest} class="onyx-modal" role="presentation">
          {/* Decorative click-to-dismiss layer — keyboard users dismiss via Esc /
              the labelled close button, so the backdrop stays out of the a11y tree. */}
          <div class="onyx-modal__backdrop" aria-hidden="true" onClick={() => local.onOpenChange(false)} />
          <section
            ref={dialogRef}
            class="onyx-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={local.description ? descriptionId : undefined}
            tabindex="-1"
          >
            <header class="onyx-modal__header">
              <div>
                <p class="onyx-modal__kicker">dialog</p>
                <h2 id={titleId}>{local.title}</h2>
                <Show when={local.description}>
                  <p id={descriptionId}>{local.description}</p>
                </Show>
              </div>
              <button class="onyx-modal__close" type="button" aria-label={local.closeLabel ?? 'Close dialog'} onClick={() => local.onOpenChange(false)}>×</button>
            </header>
            <div class="onyx-modal__body">{local.children}</div>
          </section>
        </div>
      </Portal>
    </Show>
  );
}
