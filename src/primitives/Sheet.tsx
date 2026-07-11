// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, splitProps, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createDialogFocus } from './focusTrap';

export type SheetProps = ParentProps<{
  open: boolean;
  title: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  closeLabel?: string;
}>;

export function Sheet(props: SheetProps) {
  const [local, rest] = splitProps(props, ['open', 'title', 'description', 'onOpenChange', 'closeLabel', 'children']);
  const titleId = () => `${local.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'sheet'}-title`;
  const descriptionId = () => local.description ? `${titleId()}-description` : undefined;
  let panelRef: HTMLElement | undefined;

  createDialogFocus({
    isOpen: () => local.open,
    getPanel: () => panelRef,
    onEscape: () => local.onOpenChange(false),
  });

  return (
    <Show when={local.open}>
      <Portal>
        <div {...rest} class="onyx-sheet" role="presentation">
          {/* Decorative click-to-dismiss layer — keyboard users dismiss via Esc /
              the labelled close button, so the backdrop stays out of the a11y tree. */}
          <div class="onyx-sheet__backdrop" aria-hidden="true" onClick={() => local.onOpenChange(false)} />
          <aside
            ref={panelRef}
            class="onyx-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId()}
            aria-describedby={descriptionId()}
            tabindex="-1"
          >
            <header class="onyx-sheet__header">
              <div>
                <p class="onyx-sheet__kicker">panel</p>
                <h2 id={titleId()}>{local.title}</h2>
                <Show when={local.description}>
                  <p id={descriptionId()}>{local.description}</p>
                </Show>
              </div>
              <button class="onyx-sheet__close" type="button" aria-label={local.closeLabel ?? 'Close panel'} onClick={() => local.onOpenChange(false)}>×</button>
            </header>
            <div class="onyx-sheet__body">{local.children}</div>
          </aside>
        </div>
      </Portal>
    </Show>
  );
}
