// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, onCleanup, Show, splitProps, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';

export type ModalShellProps = ParentProps<{
  open: boolean;
  title: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  closeLabel?: string;
}>;

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusFirst(dialog: HTMLElement) {
  const first = dialog.querySelector<HTMLElement>(focusableSelector);
  (first ?? dialog).focus();
}

function trapFocus(event: KeyboardEvent, dialog: HTMLElement) {
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);

  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  // Focus may have drifted outside the dialog — e.g. the focused control was
  // removed or disabled and the browser reset activeElement to <body>. Pull it
  // back in so Tab can never traverse the background page. (WCAG 2.4.3)
  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ModalShell(props: ModalShellProps) {
  const [local, rest] = splitProps(props, ['open', 'title', 'description', 'onOpenChange', 'closeLabel', 'children']);
  const titleId = () => `${local.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'modal'}-title`;
  const descriptionId = () => local.description ? `${titleId()}-description` : undefined;
  let dialogRef: HTMLElement | undefined;

  createEffect(() => {
    if (!local.open) return;

    const previous = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') local.onOpenChange(false);
      if (event.key === 'Tab' && dialogRef) trapFocus(event, dialogRef);
    };

    document.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => {
      if (dialogRef) focusFirst(dialogRef);
    });

    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus?.();
    });
  });

  return (
    <Show when={local.open}>
      <Portal>
        <div {...rest} class="onyx-modal" role="presentation">
          {/* Decorative click-to-dismiss layer — keyboard users dismiss via Esc /
              the labelled close button, so the backdrop stays out of the a11y tree. */}
          <div class="onyx-modal__backdrop" aria-hidden="true" onClick={() => local.onOpenChange(false)} />
          <section
            ref={dialogRef}
            class="onyx-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId()}
            aria-describedby={descriptionId()}
            tabindex="-1"
          >
            <header class="onyx-modal__header">
              <div>
                <p class="onyx-modal__kicker">dialog</p>
                <h2 id={titleId()}>{local.title}</h2>
                <Show when={local.description}>
                  <p id={descriptionId()}>{local.description}</p>
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
