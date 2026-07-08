/**
 * src/lib/keyboard/useKeyboardShortcuts.ts
 *
 * Global keyboard shortcut primitive for Onyx.
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
import { openPreferences, preferences, setPreference } from '@/lib/prefs/preferences';
import { toggleFollow } from '@/lib/notifications/followed';

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
    keys: 'N',
    description: 'Jump to next unread channel / DM',
    group: 'Navigation',
  },
  {
    keys: 'G then H',
    description: 'Go to Home',
    group: 'Navigation',
  },
  {
    keys: 'G then D',
    description: 'Focus jump date',
    group: 'Navigation',
  },
  {
    keys: 'U',
    description: 'Follow current channel / DM',
    group: 'Chat',
  },
  {
    keys: 'Alt+M',
    description: 'Toggle member list',
    group: 'View',
  },
  {
    keys: '⌘⇧R / Ctrl+Shift+R',
    description: 'Toggle Reader mode',
    group: 'View',
  },
  {
    keys: '⌘, / Ctrl+,',
    description: 'Open preferences',
    group: 'View',
  },
  {
    keys: 'Enter / Alt+Enter',
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest([
    'button',
    'a[href]',
    'summary',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[aria-controls]',
  ].join(','));
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

function isUnreadTarget(target: { kind: 'channel'; channel: string } | { kind: 'dm'; nick: string }): boolean {
  const state = getState();
  if (target.kind === 'channel') {
    const channel = state.channels.get(target.channel.toLowerCase());
    return (channel?.unread ?? 0) > 0 || (channel?.highlights ?? 0) > 0;
  }
  const dm = state.dms.get(target.nick.toLowerCase());
  return (dm?.unread ?? 0) > 0 || (dm?.highlights ?? 0) > 0;
}

function navigateNextUnread(): void {
  const state = getState();
  const targets = getNavTargets();
  const unreadTargets = targets.filter(isUnreadTarget);
  if (unreadTargets.length === 0) return;

  const current = state.activeView;
  const currentIndex = targets.findIndex((t) =>
    t.kind === 'channel' && current.kind === 'channel'
      ? t.channel === current.channel
      : t.kind === 'dm' && current.kind === 'dm'
        ? t.nick.toLowerCase() === current.nick.toLowerCase()
        : false,
  );
  const next =
    unreadTargets.find((target) => targets.indexOf(target) > currentIndex) ??
    unreadTargets[0];
  if (!next) return;
  state.navigate(next);
}

function toggleActiveFollow(): void {
  const view = getState().activeView;
  if (view.kind === 'channel') {
    toggleFollow(view.channel);
  } else if (view.kind === 'dm') {
    toggleFollow(view.nick);
  }
}

/**
 * Focus the composer textarea in the current conversation (if visible).
 * The composer uses `data-composer-input` to be discoverable.
 */
function focusComposer(): void {
  const el = document.querySelector<HTMLElement>('[data-composer-input]');
  el?.focus();
}

function focusTimeScrubberDate(): void {
  const el = document.querySelector<HTMLElement>('[data-time-scrubber-date]');
  el?.focus();
}

// ── Main hook ─────────────────────────────────────────────────────────────────

const KEY_SEQUENCE_TIMEOUT_MS = 1200;

/**
 * Register global keyboard shortcuts. Call this once inside a SolidJS
 * reactive context (component body or `createRoot`). Cleaned up on unmount.
 */
export function useKeyboardShortcuts(): void {
  // We need spotlight state to implement Esc correctly.
  const spotlight = useSpotlight();
  let pendingPrefix: 'g' | null = null;
  let pendingPrefixTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingPrefix(): void {
    pendingPrefix = null;
    if (pendingPrefixTimer) {
      clearTimeout(pendingPrefixTimer);
      pendingPrefixTimer = null;
    }
  }

  function armPrefix(prefix: 'g'): void {
    clearPendingPrefix();
    pendingPrefix = prefix;
    pendingPrefixTimer = setTimeout(clearPendingPrefix, KEY_SEQUENCE_TIMEOUT_MS);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
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
      clearPendingPrefix();
      event.preventDefault();
      openSpotlight();
      return;
    }

    // ── Cmd/Ctrl+, — preferences panel ─────────────────────────────────────
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === ',') {
      clearPendingPrefix();
      event.preventDefault();
      openPreferences();
      return;
    }

    // ── From here on, shortcuts are suppressed inside editable targets ───────
    if (inEditable) {
      clearPendingPrefix();
      return;
    }

    // ── Cmd/Ctrl+Shift+R — reader mode ─────────────────────────────────────
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r') {
      clearPendingPrefix();
      event.preventDefault();
      setPreference('readerMode', !preferences().readerMode);
      return;
    }

    // ── N — jump to next unread conversation ──────────────────────────────
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
      clearPendingPrefix();
      event.preventDefault();
      navigateNextUnread();
      return;
    }

    // ── G sequences — time-native navigation ─────────────────────────────
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      armPrefix('g');
      return;
    }

    if (pendingPrefix === 'g' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'h') {
        event.preventDefault();
        clearPendingPrefix();
        getState().navigate({ kind: 'home' });
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        clearPendingPrefix();
        focusTimeScrubberDate();
        return;
      }
      clearPendingPrefix();
    }

    // ── U — follow/unfollow current conversation ──────────────────────────
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'u') {
      clearPendingPrefix();
      event.preventDefault();
      toggleActiveFollow();
      return;
    }

    // ── ? (Shift+/) — keyboard shortcuts help ───────────────────────────────
    if (event.key === '?') {
      clearPendingPrefix();
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
      clearPendingPrefix();
      event.preventDefault();
      navigateRelative(-1);
      return;
    }

    if (event.altKey && event.key === 'ArrowDown') {
      clearPendingPrefix();
      event.preventDefault();
      navigateRelative(1);
      return;
    }

    // ── Alt+M — toggle member list ───────────────────────────────────────────
    if (event.altKey && event.key.toLowerCase() === 'm') {
      clearPendingPrefix();
      event.preventDefault();
      getState().toggleMemberList();
      return;
    }

    // ── Enter / Alt+Enter — focus composer ──────────────────────────────────
    if (
      event.key === 'Enter' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !isInteractiveTarget(event.target)
    ) {
      clearPendingPrefix();
      event.preventDefault();
      focusComposer();
      return;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      clearPendingPrefix();
      window.removeEventListener('keydown', handleKeyDown);
    });
  });
}
