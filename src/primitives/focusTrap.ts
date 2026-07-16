// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, onCleanup } from 'solid-js';

/**
 * Shared focus model for the modal dialog primitives (Sheet, ModalShell).
 *
 * A single source of truth so the two overlays can never drift apart on the
 * WCAG-critical behaviors: Escape to close (SC 2.1.2 no keyboard trap for the
 * user, SC 2.4.3 focus order), Tab/Shift+Tab wrap inside the panel (SC 2.1.1),
 * initial focus moved into the panel on open, and focus restored to the
 * triggering element on close (SC 2.4.3 Focus Order).
 */

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Sheets and modal dialogs can be layered (for example, Appearance opens its
// theme import Sheet over the Appearance Sheet). Only the most recently opened
// dialog may own document-level keyboard handling; otherwise one Escape event
// reaches every open dialog and closes the entire stack.
const dialogFocusStack: symbol[] = [];

function isTopDialog(owner: symbol): boolean {
  return dialogFocusStack[dialogFocusStack.length - 1] === owner;
}

function removeDialog(owner: symbol): void {
  const index = dialogFocusStack.lastIndexOf(owner);
  if (index !== -1) dialogFocusStack.splice(index, 1);
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('disabled')
      && element.tabIndex !== -1
      && element.closest('[hidden], [inert]') === null);
}

/** Move focus into the panel on open — first focusable, else the panel itself. */
export function focusFirst(panel: HTMLElement): void {
  const first = focusableElements(panel)[0];
  (first ?? panel).focus();
}

/**
 * Keep Tab focus inside `panel`. Wraps last→first (Tab) and first→last
 * (Shift+Tab), and recaptures focus that has drifted onto the background page
 * (e.g. the focused control was removed/disabled and the browser reset
 * activeElement to <body>). (WCAG 2.4.3)
 */
export function trapFocus(event: KeyboardEvent, panel: HTMLElement): void {
  const focusable = focusableElements(panel);

  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (!panel.contains(document.activeElement)) {
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

export type DialogFocusOptions = {
  /** Reactive open state — drives the whole lifecycle. */
  isOpen: () => boolean;
  /** Late-bound panel element (the `ref`), read at event time. */
  getPanel: () => HTMLElement | undefined;
  /** Invoked when Escape is pressed while open. */
  onEscape: () => void;
};

/**
 * Wire the full modal focus lifecycle for a dialog primitive. Must be called
 * from a component body (needs a reactive owner for createEffect/onCleanup).
 *
 * On open: captures the current activeElement (the trigger), installs a
 * document-level keydown handler (Escape → onEscape, Tab → trapFocus), and
 * moves focus into the panel. On close/unmount: removes the handler and
 * restores focus to the captured trigger. (WCAG 2.1.1, 2.1.2, 2.4.3, 2.4.7)
 */
export function createDialogFocus(options: DialogFocusOptions): void {
  createEffect(() => {
    if (!options.isOpen()) return;

    const owner = Symbol('dialog-focus-owner');
    const previous = document.activeElement as HTMLElement | null;
    dialogFocusStack.push(owner);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(owner)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        options.onEscape();
        return;
      }
      const panel = options.getPanel();
      if (event.key === 'Tab' && panel) trapFocus(event, panel);
    };

    document.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => {
      if (!isTopDialog(owner)) return;
      const panel = options.getPanel();
      if (panel) focusFirst(panel);
    });

    onCleanup(() => {
      const wasTopDialog = isTopDialog(owner);
      document.removeEventListener('keydown', handleKeyDown);
      removeDialog(owner);
      if (wasTopDialog) previous?.focus?.();
    });
  });
}
