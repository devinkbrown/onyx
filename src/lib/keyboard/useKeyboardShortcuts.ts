/**
 * src/lib/keyboard/useKeyboardShortcuts.ts
 *
 * Global keyboard shortcut primitive for Ruri.
 *
 * Usage (inside a SolidJS component or `createRoot`):
 *
 *   useKeyboardShortcuts();
 *
 * This registers a single `keydown` listener on `window` and dispatches to
 * the individual shortcut handlers. The listener is removed automatically via
 * `onCleanup` when the owning component unmounts.
 *
 * GUARD: shortcuts never fire when focus is inside an editable element
 * (input, textarea, contenteditable, or data-spotlight-ignore). The one
 * exception is Escape, which always closes overlays.
 */

import { onCleanup, onMount } from 'solid-js';
import { getState } from '@/lib/store';
import { openSpotlight, closeSpotlight, useSpotlight } from '@/chat/spotlight/useSpotlight';

// ── Shortcut definitions ──────────────────────────────────────────────────────

/**
 * Descriptor for a single keyboard shortcut, used by the help overlay.
 */
export type ShortcutDescriptor = {
  /** Display label (e.g. "⌘K / Ctrl+K") */
  keys: string;
  /** Human-readable action description */
  description: string;
  /** Category group shown in the help overlay */
  group: ShortcutGroup;
};

export type ShortcutGroup =
  | 'Navigation'
  | 'Chat'
  | 'View'
  | 'Voice & Video'
  | 'Palette';

/**
 * All registered shortcut descriptors — exported so the help overlay can
 * render them without coupling to implementation details.
 */
export const SHORTCUTS: ShortcutDescriptor[] = [
  {
    keys: '⌘K / Ctrl+K',
    description: 'Open command palette',
    group: 'Palette',
  },
  {
    keys: '/',
    description: 'Open command palette (when not typing)',
    group: 'Palette',
  },
  {
    keys: '?',
    description: 'Show keyboard shortcuts',
    group: 'Palette',
  },
  {
    keys: 'Esc',
    description: 'Close palette / overlay',
    group: 'Palette',
  },
  {
    keys: 'Alt+↑',
    description: 'Previous channel / DM',
    group: 'Navigation',
  },
  {
    keys: 'Alt+↓',
    description: 'Next channel / DM',
    group: 'Navigation',
  },
  {
    keys: 'Alt+M',
    description: 'Toggle member list',
    group: 'View',
  },
  {
    keys: 'Alt+Enter',
    description: 'Focus message composer',
    group: 'Chat',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-spotlight-ignore]')) return true;

  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  );
}

/**
 * Collect all navigable targets (channels then DMs) in sidebar order.
 * Returns an array of `ActiveView`-compatible objects.
 */
function getNavTargets(): Array<{ kind: 'channel'; channel: string } | { kind: 'dm'; nick: string }> {
  const state = getState();
  const channels = Array.from(state.channels.keys()).map((ch) => ({
    kind: 'channel' as const,
    channel: ch,
  }));
  const dms = Array.from(state.dms.keys()).map((nick) => ({
    kind: 'dm' as const,
    nick,
  }));
  return [...channels, ...dms];
}

/**
 * Navigate to the channel/DM offset `delta` positions from the current one.
 * Wraps around.
 */
function navigateRelative(delta: number): void {
  const state = getState();
  const targets = getNavTargets();
  if (targets.length === 0) return;

  const current = state.activeView;
  const currentIndex = targets.findIndex((t) =>
    t.kind === 'channel' && current.kind === 'channel'
      ? t.channel === current.channel
      : t.kind === 'dm' && current.kind === 'dm'
        ? t.nick === current.nick
        : false,
  );

  const next = (currentIndex + delta + targets.length) % targets.length;
  const target = targets[next];
  if (!target) return;
  state.navigate(target);
}

/**
 * Focus the composer textarea in the current conversation (if visible).
 * The composer uses `data-composer-input` to be discoverable.
 */
function focusComposer(): void {
  const el = document.querySelector<HTMLElement>('[data-composer-input]');
  el?.focus();
}

// ── Main hook ─────────────────────────────────────────────────────────────────

/**
 * Register global keyboard shortcuts. Call this once inside a SolidJS
 * reactive context (component body or `createRoot`). Cleaned up on unmount.
 */
export function useKeyboardShortcuts(): void {
  // We need spotlight state to implement Esc correctly.
  const spotlight = useSpotlight();

  function handleKeyDown(event: KeyboardEvent): void {
    const inEditable = isEditableTarget(event.target);

    // ── Escape — always close overlays regardless of focus ──────────────────
    if (event.key === 'Escape') {
      if (spotlight.isOpen()) {
        event.preventDefault();
        closeSpotlight();
      } else {
        // Close keyboard shortcuts help if open
        const state = getState();
        if (state.showKeyboardShortcuts) {
          event.preventDefault();
          state.closeKeyboardShortcuts();
        }
      }
      return;
    }

    // ── Cmd/Ctrl+K — command palette ────────────────────────────────────────
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSpotlight();
      return;
    }

    // ── From here on, shortcuts are suppressed inside editable targets ───────
    if (inEditable) return;

    // ── ? (Shift+/) — keyboard shortcuts help ───────────────────────────────
    if (event.key === '?') {
      event.preventDefault();
      const state = getState();
      if (state.showKeyboardShortcuts) {
        state.closeKeyboardShortcuts();
      } else {
        state.openKeyboardShortcuts();
      }
      return;
    }

    // ── Alt+↑ / Alt+↓ — channel navigation ──────────────────────────────────
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      navigateRelative(-1);
      return;
    }

    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      navigateRelative(1);
      return;
    }

    // ── Alt+M — toggle member list ───────────────────────────────────────────
    if (event.altKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      getState().toggleMemberList();
      return;
    }

    // ── Alt+Enter — focus composer ───────────────────────────────────────────
    if (event.altKey && event.key === 'Enter') {
      event.preventDefault();
      focusComposer();
      return;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });
}
