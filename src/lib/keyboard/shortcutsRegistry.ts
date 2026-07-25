// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/keyboard/shortcutsRegistry.ts
 *
 * Pure keyboard shortcut registry and matcher for Onyx.
 */

export interface Chord {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Shortcut {
  id: string;
  chord: Chord;
  label: string;
  group: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'command.palette',
    chord: { key: 'k', mod: true },
    label: 'Open command palette',
    group: 'Navigation',
  },
  {
    id: 'composer.focus',
    chord: { key: 'Enter' },
    label: 'Focus message composer',
    group: 'Composing',
  },
  {
    id: 'overlay.close',
    chord: { key: 'Escape' },
    label: 'Close overlay',
    group: 'Navigation',
  },
  {
    id: 'keyboard.help',
    chord: { key: '?', shift: true },
    label: 'Show keyboard shortcuts',
    group: 'Appearance',
  },
  {
    id: 'navigation.home',
    chord: { key: 'h', mod: true },
    label: 'Go home',
    group: 'Navigation',
  },
  {
    id: 'navigation.channel.next',
    chord: { key: 'ArrowDown', alt: true },
    label: 'Next channel',
    group: 'Navigation',
  },
  {
    id: 'navigation.channel.previous',
    chord: { key: 'ArrowUp', alt: true },
    label: 'Previous channel',
    group: 'Navigation',
  },
  {
    id: 'navigation.unread.next',
    chord: { key: 'n' },
    label: 'Jump to next unread',
    group: 'Navigation',
  },
  {
    id: 'conversation.follow.toggle',
    chord: { key: 'u' },
    label: 'Follow current conversation',
    group: 'Reading',
  },
  {
    id: 'reader.mode.toggle',
    chord: { key: 'r', mod: true, shift: true },
    label: 'Toggle reader mode',
    group: 'Reading',
  },
  {
    id: 'preferences.open',
    chord: { key: ',', mod: true },
    label: 'Open preferences',
    group: 'Appearance',
  },
  {
    id: 'search.open',
    chord: { key: 'f', mod: true },
    label: 'Search messages',
    group: 'Reading',
  },
  {
    id: 'account.open',
    chord: { key: 'a', mod: true, shift: true },
    label: 'Open account',
    group: 'Navigation',
  },
  {
    id: 'members.toggle',
    chord: { key: 'm', alt: true },
    label: 'Toggle member list',
    group: 'Navigation',
  },
  {
    id: 'sidebar.focus',
    chord: { key: 's', alt: true },
    label: 'Focus channel sidebar',
    group: 'Navigation',
  },
  {
    id: 'mark.read',
    chord: { key: 'e', mod: true, shift: true },
    label: 'Mark conversation read',
    group: 'Reading',
  },
  {
    id: 'composer.attach',
    chord: { key: 'u', mod: true, shift: true },
    label: 'Attach a file',
    group: 'Composing',
  },
  {
    id: 'composer.schedule',
    chord: { key: 'l', mod: true, shift: true },
    label: 'Schedule send later',
    group: 'Composing',
  },
  {
    id: 'dnd.toggle',
    chord: { key: 'd', mod: true, shift: true },
    label: 'Toggle do not disturb',
    group: 'Appearance',
  },
  {
    id: 'star.channel',
    chord: { key: 'b', mod: true },
    label: 'Star / unstar channel',
    group: 'Reading',
  },
  {
    id: 'mute.channel',
    chord: { key: 'm', mod: true, shift: true },
    label: 'Mute / unmute channel',
    group: 'Reading',
  },
  {
    id: 'export.transcript',
    chord: { key: 'e', mod: true, alt: true },
    label: 'Export local transcript',
    group: 'Reading',
  },
] as const;

type ElementLikeTarget = EventTarget & {
  tagName?: unknown;
  isContentEditable?: unknown;
  getAttribute?: (name: string) => string | null;
};

function normalizeKey(key: string): string {
  return key.toLowerCase();
}

function hasModifierMatch(expected: boolean | undefined, actual: boolean): boolean {
  return actual === (expected ?? false);
}

function isElementLikeTarget(target: EventTarget | null): target is ElementLikeTarget {
  if (target === null || typeof target !== 'object') return false;
  if (typeof Element !== 'undefined' && target instanceof Element) return true;
  return 'tagName' in target;
}

function hasContentEditableAttribute(target: ElementLikeTarget): boolean {
  const contentEditable = target.getAttribute?.('contenteditable') ?? null;
  const normalized = contentEditable?.toLowerCase();
  return contentEditable === '' || normalized === 'true' || normalized === 'plaintext-only';
}

export function matchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  registry: readonly Shortcut[] = SHORTCUTS,
): Shortcut | null {
  return registry.find((shortcut) => {
    const chord = shortcut.chord;
    const hasMod = event.ctrlKey || event.metaKey;

    return (
      normalizeKey(chord.key) === normalizeKey(event.key) &&
      hasModifierMatch(chord.mod, hasMod) &&
      hasModifierMatch(chord.shift, event.shiftKey) &&
      hasModifierMatch(chord.alt, event.altKey)
    );
  }) ?? null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!isElementLikeTarget(target)) return false;

  const tagName = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    target.isContentEditable === true ||
    hasContentEditableAttribute(target)
  );
}

/**
 * Format a chord for the help overlay.
 * Modifier chords show dual macOS / Windows labels (e.g. "⌘K / Ctrl+K").
 */
export function formatChordDisplay(chord: Chord): string {
  const keyPart = displayKey(chord.key);

  if (chord.mod) {
    const mac = `⌘${chord.shift ? '⇧' : ''}${chord.alt ? '⌥' : ''}${keyPart}`;
    const win: string[] = ['Ctrl'];
    if (chord.shift) win.push('Shift');
    if (chord.alt) win.push('Alt');
    win.push(keyPart);
    return `${mac} / ${win.join('+')}`;
  }

  const parts: string[] = [];
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(keyPart);
  return parts.join('+');
}

function displayKey(key: string): string {
  switch (key) {
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'Escape':
      return 'Esc';
    case 'Enter':
      return 'Enter';
    case ' ':
      return 'Space';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/**
 * Look up a registry entry by stable id.
 */
export function shortcutById(
  id: string,
  registry: readonly Shortcut[] = SHORTCUTS,
): Shortcut | undefined {
  return registry.find((shortcut) => shortcut.id === id);
}
