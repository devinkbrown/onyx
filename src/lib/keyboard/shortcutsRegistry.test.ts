// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/keyboard/shortcutsRegistry.test.ts
 *
 * Unit tests for the pure shortcut registry matcher.
 */
import { describe, expect, it } from 'vitest';
import {
  formatChordDisplay,
  isTypingTarget,
  matchShortcut,
  shortcutById,
  SHORTCUTS,
  type Shortcut,
} from './shortcutsRegistry';

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

type FakeElement = EventTarget & {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
};

function makeEvent(overrides: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

function makeElement(tagName: string, isContentEditable = false): EventTarget {
  return {
    tagName,
    isContentEditable,
  } as unknown as FakeElement;
}

describe('matchShortcut', () => {
  it('matches command palette with control or meta modifier', () => {
    const controlMatch = matchShortcut(makeEvent({ key: 'k', ctrlKey: true }));
    const metaMatch = matchShortcut(makeEvent({ key: 'k', metaKey: true }));
    const bothModKeysMatch = matchShortcut(makeEvent({ key: 'k', ctrlKey: true, metaKey: true }));

    expect(controlMatch?.id).toBe('command.palette');
    expect(metaMatch?.id).toBe('command.palette');
    expect(bothModKeysMatch?.id).toBe('command.palette');
  });

  it('matches plain Enter for composer focus only when no modifiers are held', () => {
    const plainMatch = matchShortcut(makeEvent({ key: 'Enter' }));
    const modifiedMatch = matchShortcut(makeEvent({ key: 'Enter', ctrlKey: true }));

    expect(plainMatch?.id).toBe('composer.focus');
    expect(modifiedMatch).toBeNull();
  });

  it('matches keyboard help only when shift is held', () => {
    const shiftedMatch = matchShortcut(makeEvent({ key: '?', shiftKey: true }));
    const plainMatch = matchShortcut(makeEvent({ key: '?' }));

    expect(shiftedMatch?.id).toBe('keyboard.help');
    expect(plainMatch).toBeNull();
  });

  it('matches reader mode only with mod and shift', () => {
    const shiftedModMatch = matchShortcut(makeEvent({ key: 'r', ctrlKey: true, shiftKey: true }));
    const plainModMatch = matchShortcut(makeEvent({ key: 'r', ctrlKey: true }));

    expect(shiftedModMatch?.id).toBe('reader.mode.toggle');
    expect(plainModMatch).toBeNull();
  });

  it('matches the plain unread jump shortcut', () => {
    const plainMatch = matchShortcut(makeEvent({ key: 'n' }));
    const modifiedMatch = matchShortcut(makeEvent({ key: 'n', ctrlKey: true }));

    expect(plainMatch?.id).toBe('navigation.unread.next');
    expect(modifiedMatch).toBeNull();
  });

  it('matches mute channel and export transcript chords', () => {
    expect(
      matchShortcut({ key: 'm', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })?.id,
    ).toBe('mute.channel');
    expect(
      matchShortcut({ key: 'e', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true })?.id,
    ).toBe('export.transcript');
    expect(shortcutById('mute.channel')?.label).toMatch(/mute/i);
    expect(shortcutById('export.transcript')?.label).toMatch(/export/i);
  });

  it('matches the plain follow toggle shortcut', () => {
    const plainMatch = matchShortcut(makeEvent({ key: 'u' }));
    const modifiedMatch = matchShortcut(makeEvent({ key: 'u', ctrlKey: true }));

    expect(plainMatch?.id).toBe('conversation.follow.toggle');
    expect(modifiedMatch).toBeNull();
  });

  it('matches composer.schedule with mod+shift+L', () => {
    const match = matchShortcut(makeEvent({ key: 'l', ctrlKey: true, shiftKey: true }));
    const metaMatch = matchShortcut(makeEvent({ key: 'L', metaKey: true, shiftKey: true }));
    const withoutShift = matchShortcut(makeEvent({ key: 'l', ctrlKey: true }));

    expect(match?.id).toBe('composer.schedule');
    expect(metaMatch?.id).toBe('composer.schedule');
    expect(withoutShift).toBeNull();
  });

  it('matches star.channel with mod+B only', () => {
    const match = matchShortcut(makeEvent({ key: 'b', ctrlKey: true }));
    const metaMatch = matchShortcut(makeEvent({ key: 'B', metaKey: true }));
    const withShift = matchShortcut(makeEvent({ key: 'b', ctrlKey: true, shiftKey: true }));
    const plain = matchShortcut(makeEvent({ key: 'b' }));

    expect(match?.id).toBe('star.channel');
    expect(metaMatch?.id).toBe('star.channel');
    expect(withShift).toBeNull();
    expect(plain).toBeNull();
  });

  it('returns null for an unknown key', () => {
    expect(matchShortcut(makeEvent({ key: 'Unidentified' }))).toBeNull();
  });

  it('normalizes key case but still rejects unexpected modifiers', () => {
    expect(matchShortcut(makeEvent({ key: 'K', ctrlKey: true }))?.id).toBe('command.palette');
    expect(matchShortcut(makeEvent({ key: 'K', ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(makeEvent({ key: 'R', metaKey: true, shiftKey: true }))?.id).toBe(
      'reader.mode.toggle',
    );
    expect(matchShortcut(makeEvent({ key: 'R', metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });

  it('keeps the shipped shortcut registry free of chord conflicts', () => {
    const chordKey = (shortcut: Shortcut): string => [
      shortcut.chord.mod === true ? 'mod' : '',
      shortcut.chord.shift === true ? 'shift' : '',
      shortcut.chord.alt === true ? 'alt' : '',
      shortcut.chord.key.toLowerCase(),
    ].filter(Boolean).join('+');

    const seen = new Map<string, string>();
    for (const shortcut of SHORTCUTS) {
      const key = chordKey(shortcut);
      expect(seen.get(key), `${shortcut.id} conflicts with ${seen.get(key)} on ${key}`).toBeUndefined();
      seen.set(key, shortcut.id);
    }
  });

  it('matches case-insensitive conflicting registry entries in first-match order', () => {
    const registry: readonly Shortcut[] = [
      { id: 'lower', chord: { key: 'k', mod: true }, label: 'Lower', group: 'Test' },
      { id: 'upper', chord: { key: 'K', mod: true, shift: false }, label: 'Upper', group: 'Test' },
      { id: 'plain', chord: { key: 'k' }, label: 'Plain', group: 'Test' },
    ];

    expect(matchShortcut(makeEvent({ key: 'K', ctrlKey: true }), registry)?.id).toBe('lower');
    expect(matchShortcut(makeEvent({ key: 'K' }), registry)?.id).toBe('plain');
  });

  it('matches the first shortcut when a caller supplies an intentionally conflicting registry', () => {
    const registry: readonly Shortcut[] = [
      { id: 'first', chord: { key: 'x', mod: true }, label: 'First', group: 'Test' },
      { id: 'second', chord: { key: 'x', mod: true }, label: 'Second', group: 'Test' },
    ];

    expect(matchShortcut(makeEvent({ key: 'x', ctrlKey: true }), registry)?.id).toBe('first');
  });
});

describe('formatChordDisplay', () => {
  it('formats dual platform labels for mod chords', () => {
    expect(formatChordDisplay({ key: 'k', mod: true })).toBe('⌘K / Ctrl+K');
    expect(formatChordDisplay({ key: 'r', mod: true, shift: true })).toBe('⌘⇧R / Ctrl+Shift+R');
    expect(formatChordDisplay({ key: ',', mod: true })).toBe('⌘, / Ctrl+,');
  });

  it('formats alt and plain chords', () => {
    expect(formatChordDisplay({ key: 'ArrowUp', alt: true })).toBe('Alt+↑');
    expect(formatChordDisplay({ key: 'm', alt: true })).toBe('Alt+M');
    expect(formatChordDisplay({ key: 'n' })).toBe('N');
    expect(formatChordDisplay({ key: 'Escape' })).toBe('Esc');
  });
});

describe('shortcutById', () => {
  it('returns the registry entry for a stable id', () => {
    expect(shortcutById('search.open')?.label).toBe('Search messages');
    expect(shortcutById('missing.shortcut')).toBeUndefined();
  });
});

describe('isTypingTarget', () => {
  it('returns true for input textarea and contenteditable targets', () => {
    expect(isTypingTarget(makeElement('input'))).toBe(true);
    expect(isTypingTarget(makeElement('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(makeElement('div', true))).toBe(true);
  });

  it('returns false for div and null targets', () => {
    expect(isTypingTarget(makeElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('treats contenteditable attributes as typing targets even on element-like test doubles', () => {
    const target = {
      tagName: 'section',
      getAttribute: (name: string) => (name === 'contenteditable' ? 'TRUE' : null),
    } as unknown as FakeElement;

    expect(isTypingTarget(target)).toBe(true);
  });

  it('treats an empty contenteditable attribute as editable', () => {
    const target = {
      tagName: 'section',
      getAttribute: (name: string) => (name === 'contenteditable' ? '' : null),
    } as unknown as FakeElement;

    expect(isTypingTarget(target)).toBe(true);
  });

  it('treats plaintext-only contenteditable targets as typing targets', () => {
    const target = {
      tagName: 'section',
      getAttribute: (name: string) => (name === 'contenteditable' ? 'plaintext-only' : null),
    } as unknown as FakeElement;

    expect(isTypingTarget(target)).toBe(true);
  });

  it('does not treat false or inherit contenteditable attributes as editable', () => {
    const falseTarget = {
      tagName: 'section',
      getAttribute: (name: string) => (name === 'contenteditable' ? 'false' : null),
    } as unknown as FakeElement;
    const inheritTarget = {
      tagName: 'section',
      getAttribute: (name: string) => (name === 'contenteditable' ? 'inherit' : null),
    } as unknown as FakeElement;

    expect(isTypingTarget(falseTarget)).toBe(false);
    expect(isTypingTarget(inheritTarget)).toBe(false);
  });

  it('ignores non-string tag names on element-like targets without throwing', () => {
    const target = {
      tagName: 123,
      getAttribute: () => null,
    } as unknown as FakeElement;

    expect(isTypingTarget(target)).toBe(false);
  });
});
