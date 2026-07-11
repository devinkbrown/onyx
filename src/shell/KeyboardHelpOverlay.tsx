// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/shell/KeyboardHelpOverlay.tsx
 *
 * "?" (Shift+/) keyboard-shortcuts help overlay.
 *
 * Opens when store.showKeyboardShortcuts is true. Closes on Esc or clicking
 * the backdrop. All shortcuts are sourced from the SHORTCUTS descriptor list
 * in useKeyboardShortcuts.ts so there is a single source of truth.
 *
 * ARIA: role=dialog, aria-modal, aria-labelledby, focus trapped inside,
 *       focus restored to the trigger element on close.
 *
 * SOLID IDIOMS: never destructure props; splitProps; Show; For; onCleanup.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  onCleanup,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { SHORTCUTS, type ShortcutGroup } from '@/lib/keyboard/useKeyboardShortcuts';
import './keyboard-help.css';

// ── Group order & labels ──────────────────────────────────────────────────────

const GROUP_ORDER: ShortcutGroup[] = ['Palette', 'Navigation', 'Chat', 'View', 'Voice & Video'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function tabbables(root: HTMLElement): HTMLElement[] {
  const selectors = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll<HTMLElement>(selectors)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function KeyboardHelpOverlay(): JSX.Element {
  const isOpen = useStore((s) => s.showKeyboardShortcuts);
  let panelRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  let restoreFocusTo: HTMLElement | null = null;

  // Group shortcuts by group, preserving GROUP_ORDER
  const groups = createMemo(() => {
    const map = new Map<ShortcutGroup, typeof SHORTCUTS>();
    for (const s of SHORTCUTS) {
      const bucket = map.get(s.group) ?? [];
      bucket.push(s);
      map.set(s.group, bucket);
    }
    return GROUP_ORDER
      .map((g) => ({ group: g, items: map.get(g) ?? [] }))
      .filter((g) => g.items.length > 0);
  });

  createEffect(() => {
    if (!isOpen()) {
      restoreFocusTo?.focus?.();
      restoreFocusTo = null;
      return;
    }

    restoreFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => closeButtonRef?.focus());
  });

  function close(): void {
    getState().closeKeyboardShortcuts();
  }

  function handleRootKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'Tab' && panelRef) {
      const nodes = tabbables(panelRef);
      if (nodes.length === 0) {
        event.preventDefault();
        panelRef.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  onCleanup(() => {
    if (isOpen()) close();
  });

  return (
    <Show when={isOpen()}>
      {/* Scrim */}
      <div
        class="kbd-help"
        role="presentation"
        onKeyDown={handleRootKeyDown}
      >
        <div
          class="kbd-help__scrim"
          aria-hidden="true"
          onClick={close}
        />

        {/* Dialog panel */}
        <div
          ref={panelRef}
          class="kbd-help__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kbd-help-title"
          tabIndex={-1}
        >
          {/* Header */}
          <div class="kbd-help__header">
            <div class="kbd-help__heading">
              <p class="kbd-help__kicker" aria-hidden="true">reference</p>
              <h2 id="kbd-help-title" class="kbd-help__title">
                Keyboard shortcuts
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              class="kbd-help__close"
              aria-label="Close keyboard shortcuts"
              onClick={close}
            >
              <svg
                viewBox="0 0 14 14"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
              </svg>
            </button>
          </div>

          {/* Shortcut groups */}
          <div class="kbd-help__body">
            <For each={groups()}>
              {(group) => (
                <section class="kbd-help__group" aria-label={group.group}>
                  <h3 class="kbd-help__group-name">{group.group}</h3>
                  <dl class="kbd-help__list">
                    <For each={group.items}>
                      {(shortcut) => (
                        <>
                          <dt class="kbd-help__keys">
                            <For each={shortcut.keys.split(' / ')}>
                              {(chord, idx) => (
                                <>
                                  <Show when={idx() > 0}>
                                    <span class="kbd-help__sep" aria-hidden="true"> / </span>
                                  </Show>
                                  <kbd class="kbd-help__kbd">{chord}</kbd>
                                </>
                              )}
                            </For>
                          </dt>
                          <dd class="kbd-help__desc">{shortcut.description}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </section>
              )}
            </For>
          </div>

          {/* Footer hint */}
          <footer class="kbd-help__footer">
            <span aria-hidden="true">?</span> to toggle this overlay · <span aria-hidden="true">Esc</span> to close
          </footer>
        </div>
      </div>
    </Show>
  );
}

export default KeyboardHelpOverlay;
