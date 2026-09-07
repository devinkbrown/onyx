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
  'summary',
].join(',');

// Sheets and modal dialogs can be layered (for example, Appearance opens its
// theme import Sheet over the Appearance Sheet). Only the most recently opened
// dialog may own document-level keyboard handling; otherwise one Escape event
// reaches every open dialog and closes the entire stack.
type DialogEntry = { owner: symbol; getPanel: () => HTMLElement | undefined; getRoot: () => HTMLElement | undefined };
const dialogFocusStack: DialogEntry[] = [];
const isolatedElements = new Map<HTMLElement, { inert: string | null; ariaHidden: string | null }>();
let scrollLockCount = 0;
let bodyOverflow: string | undefined;
let bodyPaddingRight: string | undefined;

/** True when keyboard ownership belongs to an earlier handler or input method. */
export function keyboardEventIsClaimed(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229;
}

function isTopDialog(owner: symbol): boolean {
  return dialogFocusStack[dialogFocusStack.length - 1]?.owner === owner;
}

function removeDialog(owner: symbol): void {
  const index = dialogFocusStack.findIndex((entry) => entry.owner === owner);
  if (index !== -1) dialogFocusStack.splice(index, 1);
}

function updateIsolation(): void {
  for (let index = dialogFocusStack.length - 1; index >= 0; index -= 1) {
    if (!dialogFocusStack[index]?.getRoot()?.isConnected) dialogFocusStack.splice(index, 1);
  }
  const activeRoots = new Set(dialogFocusStack.map((entry) => entry.getRoot()).filter((root): root is HTMLElement => Boolean(root)));
  const topRoot = dialogFocusStack.at(-1)?.getRoot();
  if (!topRoot) {
    for (const [element, original] of isolatedElements) {
      if (original.inert === null) element.removeAttribute('inert'); else element.setAttribute('inert', original.inert);
      if (original.ariaHidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', original.ariaHidden);
      isolatedElements.delete(element);
    }
    return;
  }
  const targets = topRoot
    ? new Set(Array.from(document.body.children).filter((child): child is HTMLElement => child !== topRoot && !child.contains(topRoot)))
    : new Set<HTMLElement>();
  // A test/app mount can contain both the portal and its launcher. Isolate
  // siblings of the portal branch inside that mount as well.
  let branch: HTMLElement = topRoot;
  while (branch.parentElement && branch.parentElement !== document.body) {
    const parent = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== branch && sibling instanceof HTMLElement) targets.add(sibling);
    }
    branch = parent;
  }
  for (const root of activeRoots) if (root !== topRoot) targets.add(root);

  for (const element of targets) {
    if (!isolatedElements.has(element)) isolatedElements.set(element, { inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') });
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  }
  for (const [element, original] of isolatedElements) {
    if (targets.has(element)) continue;
    if (original.inert === null) element.removeAttribute('inert'); else element.setAttribute('inert', original.inert);
    if (original.ariaHidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', original.ariaHidden);
    isolatedElements.delete(element);
  }
}

function clearIsolation(): void {
  for (const [element, original] of isolatedElements) {
    if (original.inert === null) element.removeAttribute('inert'); else element.setAttribute('inert', original.inert);
    if (original.ariaHidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', original.ariaHidden);
    isolatedElements.delete(element);
  }
}

function lockScroll(): void {
  if (scrollLockCount++ === 0) {
    bodyOverflow = document.body.style.overflow;
    bodyPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
  }
}

function unlockScroll(): void {
  if (--scrollLockCount !== 0) return;
  document.body.style.overflow = bodyOverflow ?? '';
  document.body.style.paddingRight = bodyPaddingRight ?? '';
  bodyOverflow = undefined;
  bodyPaddingRight = undefined;
}

/** Return the controls that participate in this dialog's keyboard boundary. */
export function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => isActuallyFocusable(element, panel));
}

function isActuallyFocusable(element: HTMLElement, panel: HTMLElement): boolean {
  if (element.hasAttribute('disabled') || element.matches(':disabled') || element.tabIndex === -1) return false;
  const closedDetails = element.closest('details:not([open])');
  if (closedDetails && !element.matches('summary')) return false;
  if (element.closest('fieldset:disabled')) return false;

  // Walk the entire candidate ancestry. A control can look locally enabled
  // while its parent subtree is hidden or inert; checking only the candidate
  // lets that control leak into the focus order.
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hasAttribute('hidden')
      || ancestor.hasAttribute('inert')
      || ancestor.getAttribute('aria-hidden') === 'true') return false;

    // These checks are intentionally progressive: jsdom does not calculate
    // layout, while real browsers expose author CSS through computed style.
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    if (ancestor === panel) break;
  }
  return true;
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
  if (keyboardEventIsClaimed(event)) return;
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
  /** Optional durable return target when the active opener will be unmounted. */
  getReturnFocus?: () => HTMLElement | null | undefined;
  /** Secondary return target when the preferred control is removed while open. */
  getReturnFocusFallback?: () => HTMLElement | null | undefined;
  /** Portal root used to isolate this dialog and lower layers from AT/keyboard. */
  getRoot?: () => HTMLElement | undefined;
};

function canRestoreDialogFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element?.isConnected || element.ownerDocument !== document) return false;
  const managed = isolatedElements.get(element) ?? Array.from(isolatedElements.entries()).find(([candidate]) => candidate.contains(element))?.[1];
  if (managed && (managed.inert !== null || managed.ariaHidden !== null)) return false;
  if (!managed && element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.closest('details:not([open])')) return false;
  if (element.hasAttribute('disabled') || element.matches(':disabled')) return false;
  // Restoration targets may intentionally use tabindex="-1" (for example a
  // stable view anchor). focusSafely supplies a temporary programmatic focus
  // target when the element is otherwise not keyboard-tabbable.
  return true;
}

function focusSafely(element: HTMLElement): boolean {
  const hadTabIndex = element.hasAttribute('tabindex');
  const oldTabIndex = element.getAttribute('tabindex');
  if (element.tabIndex < 0) element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
  const focused = document.activeElement === element;
  if (!hadTabIndex) element.removeAttribute('tabindex');
  else if (oldTabIndex !== null) element.setAttribute('tabindex', oldTabIndex);
  return focused;
}

function restoreFocus(element: HTMLElement | null | undefined): void {
  if (canRestoreDialogFocus(element)) {
    if (focusSafely(element)) return;
  }

  // A trigger can disappear without supplying a handoff target. Keep focus in
  // the document rather than leaving it on a detached node or allowing the
  // next Tab to enter the background page.
  const main = document.querySelector<HTMLElement>('main, [role="main"]');
  if (canRestoreDialogFocus(main)) {
    if (focusSafely(main)) return;
  }
  focusSafely(document.body);
}

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
    const previous = options.getReturnFocus?.()
      ?? document.activeElement as HTMLElement | null;
    const returnFallback = options.getReturnFocusFallback?.();
    const initialActive = document.activeElement;
    const getRoot = () => options.getRoot?.() ?? options.getPanel();
    dialogFocusStack.push({ owner, getPanel: options.getPanel, getRoot });
    lockScroll();
    updateIsolation();
    // Portal refs are assigned during the render commit. Waiting one microtask
    // avoids temporarily hiding the entire app when the root is not available
    // yet, while the focus handoff below remains deterministic.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(owner) || keyboardEventIsClaimed(event)) return;
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
    queueMicrotask(() => queueMicrotask(() => {
      updateIsolation();
      if (!isTopDialog(owner)) return;
      const panel = options.getPanel();
      if (panel && (document.activeElement === initialActive || document.activeElement === document.body)) focusFirst(panel);
    }));

    onCleanup(() => {
      const wasTopDialog = isTopDialog(owner);
      const closingRoot = getRoot();
      const focusTarget = returnFallback && previous?.getAttribute('aria-hidden') === 'true'
        ? returnFallback
        : canRestoreDialogFocus(previous) ? previous : returnFallback;
      document.removeEventListener('keydown', handleKeyDown);
      removeDialog(owner);
      unlockScroll();
      if (dialogFocusStack.length === 0) clearIsolation();
      if (wasTopDialog) {
        // Solid removes the portal after this effect cleanup. Restore only
        // after that commit: a single owner and a single completion prevent a
        // late close callback from stealing focus from a newer interaction.
        queueMicrotask(() => {
          updateIsolation();
          const active = document.activeElement as HTMLElement | null;
          // A newer interaction may already have moved focus into the lower
          // dialog. Its owner is now authoritative; never steal that focus.
          if (active === document.body || closingRoot?.contains(active)) {
            restoreFocus(focusTarget);
          }
        });
      } else {
        updateIsolation();
      }
    });
  });
}
