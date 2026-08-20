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
 * SOURCE OF TRUTH: single-chord matching uses `matchShortcut` against
 * `shortcutsRegistry.SHORTCUTS`. Sequence chords (G then H/D) and transcript
 * J/K nav live only here because they are not single-key chords. Command
 * palette open (⌘K) is owned by SpotlightProvider so it is intentionally
 * absent from the live handler map.
 *
 * GUARD: shortcuts never fire while an aria-modal dialog owns the keyboard or
 * when focus is inside an editable element (input, textarea, contenteditable,
 * or data-spotlight-ignore). Exceptions: Escape always closes overlays;
 * preferences (⌘,) works from any editable; schedule/attach work from the
 * composer textarea only.
 */

import { onCleanup, onMount } from 'solid-js';
import { getState, selectDeviceMemoryOwner } from '@/lib/store';
import { closeSpotlight, useSpotlight } from '@/chat/spotlight/useSpotlight';
import { openPreferences, preferences, setPreference } from '@/lib/prefs/preferences';
import { toggleFollow } from '@/lib/notifications/followed';
import { openMessageSearch } from '@/shell/search/useMessageSearch';
import {
  formatChordDisplay,
  matchShortcut,
  shortcutById,
  type Shortcut,
} from '@/lib/keyboard/shortcutsRegistry';

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

/** Map registry groups onto help-overlay groups. */
function overlayGroupFor(shortcut: Shortcut): ShortcutGroup {
  switch (shortcut.group) {
    case 'Composing':
      return 'Chat';
    case 'Reading':
      return 'Chat';
    case 'Appearance':
      return 'View';
    case 'Navigation':
      return shortcut.id === 'command.palette' || shortcut.id === 'overlay.close'
        ? 'Palette'
        : shortcut.id === 'keyboard.help' || shortcut.id === 'preferences.open'
          ? 'View'
          : 'Navigation';
    default:
      return 'Navigation';
  }
}

function descriptorFromRegistry(id: string, overrides?: Partial<ShortcutDescriptor>): ShortcutDescriptor {
  const entry = shortcutById(id);
  if (!entry) {
    throw new Error(`shortcutsRegistry is missing id "${id}" required by the live keyboard hook`);
  }
  return {
    keys: formatChordDisplay(entry.chord),
    description: entry.label,
    group: overlayGroupFor(entry),
    ...overrides,
  };
}

/**
 * All registered shortcut descriptors — exported so the help overlay can
 * render them without coupling to implementation details.
 *
 * Single-chord rows are derived from shortcutsRegistry so the help sheet
 * cannot drift from the matcher. Sequence / dual-chord rows that the pure
 * registry cannot express remain hand-listed here.
 */
export const SHORTCUTS: ShortcutDescriptor[] = [
  descriptorFromRegistry('command.palette', {
    keys: '⌘K / Ctrl+K',
    description: 'Open command palette',
    group: 'Palette',
  }),
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
  descriptorFromRegistry('overlay.close', {
    keys: 'Esc',
    description: 'Close palette / overlay',
    group: 'Palette',
  }),
  descriptorFromRegistry('navigation.channel.previous', {
    keys: 'Alt+↑',
    description: 'Previous room / DM',
    group: 'Navigation',
  }),
  descriptorFromRegistry('navigation.channel.next', {
    keys: 'Alt+↓',
    description: 'Next room / DM',
    group: 'Navigation',
  }),
  descriptorFromRegistry('navigation.unread.next', {
    keys: 'N',
    description: 'Jump to next unread room / DM',
    group: 'Navigation',
  }),
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
    description: 'Open jump-to-date',
    group: 'Navigation',
  },
  descriptorFromRegistry('conversation.follow.toggle', {
    keys: 'U',
    description: 'Follow current room / DM',
    group: 'Chat',
  }),
  descriptorFromRegistry('members.toggle', {
    keys: 'Alt+M',
    description: 'Toggle member list',
    group: 'View',
  }),
  descriptorFromRegistry('sidebar.focus', {
    description: 'Focus room sidebar',
    group: 'View',
  }),
  descriptorFromRegistry('reader.mode.toggle', {
    keys: '⌘⇧R / Ctrl+Shift+R',
    description: 'Toggle Reader mode',
    group: 'View',
  }),
  descriptorFromRegistry('preferences.open', {
    keys: '⌘, / Ctrl+,',
    description: 'Open preferences',
    group: 'View',
  }),
  descriptorFromRegistry('search.open', {
    description: 'Search messages',
    group: 'Chat',
  }),
  descriptorFromRegistry('account.open', {
    description: 'Open account',
    group: 'Navigation',
  }),
  descriptorFromRegistry('mark.read', {
    description: 'Mark conversation read',
    group: 'Chat',
  }),
  descriptorFromRegistry('star.channel', {
    description: 'Star / unstar room',
    group: 'Chat',
  }),
  descriptorFromRegistry('dnd.toggle', {
    description: 'Toggle do not disturb',
    group: 'View',
  }),
  descriptorFromRegistry('mute.channel', {
    description: 'Mute / unmute room',
    group: 'Chat',
  }),
  descriptorFromRegistry('export.transcript', {
    description: 'Export local transcript',
    group: 'Chat',
  }),
  descriptorFromRegistry('composer.attach', {
    description: 'Attach a file',
    group: 'Chat',
  }),
  descriptorFromRegistry('composer.schedule', {
    description: 'Schedule message to send later',
    group: 'Chat',
  }),
  descriptorFromRegistry('composer.focus', {
    keys: 'Enter / Alt+Enter',
    description: 'Focus message composer',
    group: 'Chat',
  }),
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
  const owner = selectDeviceMemoryOwner(state);
  if (!owner) return;
  const view = state.activeView;
  if (view.kind === 'channel') {
    // Topic filters are conversation boundaries in the Time-Native Venue.
    // Match the visible follow control: U follows the selected topic when one
    // is active, otherwise it follows the room.
    const topic = state.activeChannelTopics.get(view.channel.toLowerCase()) ?? null;
    toggleFollow(view.channel, topic, owner);
  } else if (view.kind === 'dm') {
    toggleFollow(view.nick, null, owner);
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

/** Open the discoverable Jump-to-date sheet (Era 1 A3); fall back to scrubber date. */
function openJumpToDate(): void {
  getState().openJumpToDate();
  // Sync fallback for power users when the scrubber is already mounted
  // (covers unit tests and scrubber-visible rooms). Prefer the sheet field
  // once the portal mounts on the next microtask.
  focusTimeScrubberDate();
  queueMicrotask(() => {
    document.querySelector<HTMLElement>('[data-jump-to-date-input]')?.focus();
  });
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

function toggleKeyboardHelp(): void {
  const state = getState();
  if (state.showKeyboardShortcuts) {
    state.closeKeyboardShortcuts();
  } else {
    state.openKeyboardShortcuts();
  }
}

function markActiveRead(): void {
  const state = getState();
  const view = state.activeView;
  if (view.kind === 'channel') {
    state.markRead(view.channel);
    state.markChannelRead(view.channel);
  } else if (view.kind === 'dm') {
    state.markRead(view.nick);
  }
}

function toggleActiveStar(): void {
  const state = getState();
  if (state.activeView.kind !== 'channel') return;
  const channel = state.activeView.channel;
  const key = channel.toLowerCase();
  if (state.starredChannels.has(key) || state.starredChannels.has(channel)) {
    state.unstarChannel(channel);
  } else {
    state.starChannel(channel);
  }
}

function toggleDnd(): void {
  const state = getState();
  state.setDndEnabled(!state.dndEnabled);
}

function toggleActiveMute(): void {
  const state = getState();
  if (state.activeView.kind !== 'channel') return;
  const channel = state.activeView.channel;
  // muteChannel maps to notify level 'none'; unmute restores 'all'.
  const level = state.channelNotify.get(channel.toLowerCase());
  if (level === 'none') state.unmuteChannel(channel);
  else state.muteChannel(channel);
}

function exportActiveTranscript(): void {
  const state = getState();
  const view = state.activeView;
  const target = view.kind === 'channel'
    ? view.channel
    : view.kind === 'dm'
      ? view.nick
      : null;
  if (!target) return;
  const key = target.toLowerCase();
  const messages = view.kind === 'channel'
    ? (state.channels.get(key)?.messages ?? [])
    : (state.dms.get(key)?.messages ?? []);
  void import('@/lib/export/conversationExport').then(({
    buildConversationExport,
    downloadConversationExport,
  }) => {
    const doc = buildConversationExport({
      target,
      messages,
      network: state.networkName,
      ourNick: state.ourNick,
    });
    const ok = downloadConversationExport(doc, 'txt');
    state.addToast({
      variant: ok ? 'success' : 'warning',
      title: ok ? 'Export started' : 'Export failed',
      description: ok
        ? `${doc.messageCount} local message${doc.messageCount === 1 ? '' : 's'} (this device only).`
        : 'Could not build a downloadable transcript.',
    });
  });
}

function focusSidebar(): void {
  const active = document.querySelector<HTMLElement>(
    '[data-sidebar-item][aria-current="page"]',
  );
  const el = active ?? document.querySelector<HTMLElement>('[data-sidebar-item]');
  el?.focus();
}

function isComposerInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('[data-composer-input]')
    || !!target.closest('[data-composer-input]');
}

/** Click a discoverable composer control; returns whether the click ran. */
function clickComposerControl(selector: string): boolean {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

// ── Registry-backed live handlers ─────────────────────────────────────────────
//
// Ids intentionally NOT wired here:
//   - command.palette  → SpotlightProvider (⌘K / Ctrl+K + "/")
//   - navigation.home  → G then H sequence (mod+H collides with browser History)
//
// keyboard.help is also reachable via a bare "?" special-case so synthetic
// tests that omit shiftKey still open the overlay (browsers send key="?").

type ShortcutHandler = (event: KeyboardEvent) => boolean;

const REGISTRY_HANDLERS: Readonly<Record<string, ShortcutHandler>> = {
  'overlay.close': () => {
    // Escape is handled before the dispatcher so modal/spotlight ordering is
    // preserved; this entry exists so matchShortcut remains complete.
    return false;
  },
  'preferences.open': () => {
    openPreferences();
    return true;
  },
  'reader.mode.toggle': () => {
    setPreference('readerMode', !preferences().readerMode);
    return true;
  },
  'navigation.unread.next': () => {
    navigateNextUnread();
    return true;
  },
  'conversation.follow.toggle': () => {
    toggleActiveFollow();
    return true;
  },
  'keyboard.help': () => {
    toggleKeyboardHelp();
    return true;
  },
  'navigation.channel.previous': () => {
    navigateRelative(-1);
    return true;
  },
  'navigation.channel.next': () => {
    navigateRelative(1);
    return true;
  },
  'members.toggle': () => {
    getState().toggleMemberList();
    return true;
  },
  'sidebar.focus': () => {
    focusSidebar();
    return true;
  },
  'composer.focus': (event) => {
    if (isInteractiveTarget(event.target)) return false;
    focusComposer();
    return true;
  },
  'search.open': () => {
    openMessageSearch();
    return true;
  },
  'account.open': () => {
    getState().openAccount();
    return true;
  },
  'mark.read': () => {
    markActiveRead();
    return true;
  },
  'star.channel': () => {
    toggleActiveStar();
    return true;
  },
  'dnd.toggle': () => {
    toggleDnd();
    return true;
  },
  'mute.channel': () => {
    toggleActiveMute();
    return true;
  },
  'export.transcript': () => {
    exportActiveTranscript();
    return true;
  },
  'composer.attach': () => clickComposerControl('button[aria-label="Attach files"]'),
  // Prefer the stable data hook the composer already exposes.
  'composer.schedule': () => clickComposerControl('[data-composer-schedule]'),
};

/** Registry ids that may fire while focus is inside an editable field. */
const EDITABLE_ALLOWED_IDS = new Set(['preferences.open', 'overlay.close']);

/**
 * Composer-local chords that must remain available while the message box is
 * focused (schedule send later is only useful mid-compose).
 */
const COMPOSER_EDITABLE_ALLOWED_IDS = new Set(['composer.schedule', 'composer.attach']);

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

    // IME candidate selection owns every key while composition is active.
    // Without this guard, ordinary composition keystrokes such as N/J/K/G can
    // navigate the app, toggle follows, or close an overlay out from under the
    // candidate window. `keyCode === 229` covers engines that do not reliably
    // expose `isComposing` on the terminal keydown event.
    if (event.isComposing || event.keyCode === 229) {
      clearPendingPrefix();
      return;
    }
    const inEditable = isEditableTarget(event.target);
    const matched = matchShortcut(event);

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

    // Modal-local controls own the keyboard until the dialog closes. Keep this
    // after Escape so the existing overlay close ordering remains intact, and
    // discard a sequence that may have been armed before the modal opened.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
      clearPendingPrefix();
      return;
    }

    // ── Preferences — allowed from editable targets ────────────────────────
    if (matched?.id === 'preferences.open') {
      clearPendingPrefix();
      event.preventDefault();
      openPreferences();
      return;
    }

    // ── Composer-local chords (schedule / attach) from the message box ─────
    if (
      matched &&
      COMPOSER_EDITABLE_ALLOWED_IDS.has(matched.id) &&
      isComposerInputTarget(event.target)
    ) {
      const handler = REGISTRY_HANDLERS[matched.id];
      clearPendingPrefix();
      if (handler?.(event)) {
        event.preventDefault();
      }
      return;
    }

    // ── From here on, shortcuts are suppressed inside editable targets ───────
    if (inEditable) {
      clearPendingPrefix();
      return;
    }

    // ── J/K — transcript message navigation (not a registry chord) ────────
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

    // ── G sequences — time-native navigation (not single chords) ──────────
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
          openJumpToDate();
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

    // ── Bare "?" — help overlay (shift optional for synthetic events) ─────
    if (event.key === '?') {
      clearPendingPrefix();
      event.preventDefault();
      toggleKeyboardHelp();
      return;
    }

    // ── Alt+Enter — dual of plain Enter for composer focus ────────────────
    if (
      event.key === 'Enter' &&
      event.altKey &&
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

    // ── Registry dispatch for remaining single-chord shortcuts ────────────
    if (matched && !EDITABLE_ALLOWED_IDS.has(matched.id)) {
      const handler = REGISTRY_HANDLERS[matched.id];
      if (handler) {
        clearPendingPrefix();
        if (handler(event)) {
          event.preventDefault();
        }
        return;
      }
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
