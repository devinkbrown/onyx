// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { closeSpotlight, useSpotlight } from '@/chat/spotlight/useSpotlight';
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
    keys: 'J',
    description: 'Move to next message',
    group: 'Chat',
  },
  {
    keys: 'K',
    description: 'Move to previous message',
    group: 'Chat',
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
  const targetKey = next.kind === 'channel' ? next.channel.toLowerCase() : next.nick.toLowerCase();
  // Capture the authoritative boundary before navigate() marks the target read.
  // This turns N into an exact reading handoff instead of merely opening the
  // conversation at its tail.
  const firstUnread = state.firstUnreadId.get(targetKey) ?? null;
  state.navigate(next);
  if (firstUnread) state.focusMessage(firstUnread);
}

function toggleActiveFollow(): void {
  const state = getState();
  const view = state.activeView;
  if (view.kind === 'channel') {
    // Topic filters are conversation boundaries in the Time-Native Venue.
    // Match the visible follow control: U follows the selected topic when one
    // is active, otherwise it follows the room.
    const topic = state.activeChannelTopics.get(view.channel.toLowerCase()) ?? null;
    toggleFollow(view.channel, topic);
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

function messageRows(): HTMLElement[] {
  const feed = document.querySelector<HTMLElement>('.shell-feed');
  const root = feed ?? document;
  return Array.from(root.querySelectorAll<HTMLElement>('[data-message-search-id]'))
    .filter((node) => node.isConnected && !node.hasAttribute('hidden') && node.getAttribute('aria-hidden') !== 'true');
}

function rowMessageId(row: HTMLElement): string | null {
  const id = row.dataset.messageSearchId;
  return id && id.trim() ? id : null;
}

function currentMessageIndex(rows: readonly HTMLElement[]): number {
  const activeRow = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>('[data-message-search-id]')
    : null;
  if (activeRow) {
    const activeIndex = rows.indexOf(activeRow);
    if (activeIndex !== -1) return activeIndex;
  }

  const landingId = getState().timeTravelLandingId;
  if (landingId) {
    const landingIndex = rows.findIndex((row) => rowMessageId(row) === landingId);
    if (landingIndex !== -1) return landingIndex;
  }

  return -1;
}

function focusRelativeMessage(delta: 1 | -1): void {
  const rows = messageRows();
  if (rows.length === 0) return;

  const current = currentMessageIndex(rows);
  const next = current === -1
    ? (delta > 0 ? 0 : rows.length - 1)
    : Math.max(0, Math.min(rows.length - 1, current + delta));
  const row = rows[next];
  if (!row) return;

  const id = rowMessageId(row);
  if (!id) return;
  row.focus({ preventScroll: true });
  getState().focusMessage(id);
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

    // ── J/K — transcript message navigation ──────────────────────────────
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !isInteractiveTarget(event.target)
    ) {
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        clearPendingPrefix();
        event.preventDefault();
        focusRelativeMessage(key === 'j' ? 1 : -1);
        return;
      }
    }

    // ── G sequences — time-native navigation ─────────────────────────────
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      armPrefix('g');
      return;
    }

    if (pendingPrefix === 'g') {
      // A pending sequence only completes on an immediate, UNMODIFIED
      // continuation key (h/d). Guard the actions on the no-modifier check…
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
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
      }
      // …but ANY other intervening event — a modified chord (Ctrl/Alt/Meta/
      // Shift) or a stray key — cancels the sequence. Clear unconditionally
      // (previously this only ran for unmodified keys, so a modified chord
      // left the prefix armed and a later plain "h" wrongly fired). Fall
      // through so the key can still act as its own standalone shortcut.
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
