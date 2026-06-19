import { createEffect, onCleanup, Show, splitProps, type JSX, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';

export type SheetProps = ParentProps<{
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

function focusFirst(panel: HTMLElement) {
  const first = panel.querySelector<HTMLElement>(focusableSelector);
  (first ?? panel).focus();
}

function trapFocus(event: KeyboardEvent, panel: HTMLElement) {
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);

  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function Sheet(props: SheetProps) {
  const [local, rest] = splitProps(props, ['open', 'title', 'description', 'onOpenChange', 'closeLabel', 'children']);
  const titleId = () => `${local.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'sheet'}-title`;
  const descriptionId = () => local.description ? `${titleId()}-description` : undefined;
  let panelRef: HTMLElement | undefined;

  createEffect(() => {
    if (!local.open) return;

    const previous = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') local.onOpenChange(false);
      if (event.key === 'Tab' && panelRef) trapFocus(event, panelRef);
    };

    document.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => {
      if (panelRef) focusFirst(panelRef);
    });

    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus?.();
    });
  });

  return (
    <Show when={local.open}>
      <Portal>
        <div {...rest} class="ruri-sheet" role="presentation">
          {/* Decorative click-to-dismiss layer — keyboard users dismiss via Esc /
              the labelled close button, so the backdrop stays out of the a11y tree. */}
          <div class="ruri-sheet__backdrop" aria-hidden="true" onClick={() => local.onOpenChange(false)} />
          <aside
            ref={panelRef}
            class="ruri-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId()}
            aria-describedby={descriptionId()}
            tabindex="-1"
          >
            <header class="ruri-sheet__header">
              <div>
                <p class="ruri-sheet__kicker">panel</p>
                <h2 id={titleId()}>{local.title}</h2>
                <Show when={local.description}>
                  <p id={descriptionId()}>{local.description}</p>
                </Show>
              </div>
              <button class="ruri-sheet__close" type="button" aria-label={local.closeLabel ?? 'Close panel'} onClick={() => local.onOpenChange(false)}>×</button>
            </header>
            <div class="ruri-sheet__body">{local.children}</div>
          </aside>
        </div>
      </Portal>
    </Show>
  );
}
