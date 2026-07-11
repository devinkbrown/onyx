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
