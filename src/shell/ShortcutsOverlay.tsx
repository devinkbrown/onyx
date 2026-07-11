// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/shell/ShortcutsOverlay.tsx
 *
 * Keyboard-shortcuts help overlay (discoverability). Lists every registered
 * shortcut, grouped by category, each with its key chord(s) and description.
 * Opened with "?" through the global keyboard system (which drives
 * store.showKeyboardShortcuts); AppShell reads that flag via useStore and hands
 * it here as `open`, so this component owns no store state of its own.
 *
 * SINGLE SOURCE OF TRUTH: rendered FROM the SHORTCUTS descriptor list in
 * src/lib/keyboard/useKeyboardShortcuts.ts — the purpose-built, comprehensive
 * list that mirrors the real key handlers (J/K, G-then-H, Alt+M, Alt+↑/↓, …).
 * No shortcut list is hand-maintained here, so the help can never drift from
 * the handlers.
 *
 * ACCESSIBILITY: reuses the ModalShell primitive, which supplies role=dialog +
 * aria-modal + aria-labelledby, the Tab focus-trap, Escape-to-close, and
 * focus-restore to the trigger (src/primitives/focusTrap.ts). The dialog entry
 * animation lives in the primitive's stylesheet and is disabled under
 * prefers-reduced-motion; this component adds no motion of its own.
 *
 * SOLID IDIOMS: component runs once; never destructure props; derive nothing
 * reactive (the shortcut list is a static module constant); lists via <For>.
 */

import { For, Show, type JSX } from 'solid-js';
import { ModalShell } from '@/primitives';
import { SHORTCUTS, type ShortcutGroup } from '@/lib/keyboard/useKeyboardShortcuts';
import './shortcuts-overlay.css';

// ── Group order & derivation ──────────────────────────────────────────────────

/** Display order for the categories; groups with no shortcuts are dropped. */
const GROUP_ORDER: readonly ShortcutGroup[] = [
  'Palette',
  'Navigation',
  'Chat',
  'View',
  'Voice & Video',
];

interface ShortcutRow {
  /** Alternative chords for one action, e.g. ['⌘K', 'Ctrl+K']. */
  readonly chords: readonly string[];
  readonly description: string;
}

interface ShortcutGroupView {
  readonly group: ShortcutGroup;
  readonly rows: readonly ShortcutRow[];
}

/** Split a display key string like "⌘K / Ctrl+K" into its alternative chords. */
function chordAlternatives(keys: string): string[] {
  return keys.split(' / ');
}

/**
 * Bucket the registry into ordered groups. Computed once at module load — the
 * SHORTCUTS descriptor list is a static constant, so there is nothing reactive
 * to memoize.
 */
const SHORTCUT_GROUPS: readonly ShortcutGroupView[] = (() => {
  const byGroup = new Map<ShortcutGroup, ShortcutRow[]>();
  for (const shortcut of SHORTCUTS) {
    const bucket = byGroup.get(shortcut.group) ?? [];
    bucket.push({ chords: chordAlternatives(shortcut.keys), description: shortcut.description });
    byGroup.set(shortcut.group, bucket);
  }
  return GROUP_ORDER
    .map((group) => ({ group, rows: byGroup.get(group) ?? [] }))
    .filter((view) => view.rows.length > 0);
})();

function groupHeadingId(group: string): string {
  const slug = group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `shortcuts-overlay-${slug || 'group'}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay(props: ShortcutsOverlayProps): JSX.Element {
  return (
    <ModalShell
      open={props.open}
      title="Keyboard shortcuts"
      description="A quick reference for moving through Onyx without leaving the keyboard."
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      closeLabel="Close keyboard shortcuts"
    >
      <div class="shortcuts-overlay" data-testid="shortcuts-overlay">
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <section class="shortcuts-overlay__group" aria-labelledby={groupHeadingId(group.group)}>
              <h3 id={groupHeadingId(group.group)} class="shortcuts-overlay__group-name">
                {group.group}
              </h3>
              <div
                class="shortcuts-overlay__rows"
                role="list"
                aria-label={`${group.group} shortcuts`}
              >
                <For each={group.rows}>
                  {(row) => (
                    <div class="shortcuts-overlay__row" role="listitem">
                      <span class="shortcuts-overlay__desc">{row.description}</span>
                      <span class="shortcuts-overlay__keys">
                        <For each={row.chords}>
                          {(chord, index) => (
                            <>
                              <Show when={index() > 0}>
                                <span class="shortcuts-overlay__sep" aria-hidden="true">or</span>
                              </Show>
                              <kbd class="shortcuts-overlay__kbd">{chord}</kbd>
                            </>
                          )}
                        </For>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </ModalShell>
  );
}

export default ShortcutsOverlay;
