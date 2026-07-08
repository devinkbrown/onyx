/**
 * src/lib/keyboard/shortcutsRegistry.test.ts
 *
 * Unit tests for the pure shortcut registry matcher.
 */
import { describe, expect, it } from 'vitest';
import { isTypingTarget, matchShortcut } from './shortcutsRegistry';

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

type FakeElement = EventTarget & {
  tagName: string;
  isContentEditable?: boolean;
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

    expect(controlMatch?.id).toBe('command.palette');
    expect(metaMatch?.id).toBe('command.palette');
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

  it('matches the plain follow toggle shortcut', () => {
    const plainMatch = matchShortcut(makeEvent({ key: 'u' }));
    const modifiedMatch = matchShortcut(makeEvent({ key: 'u', ctrlKey: true }));

    expect(plainMatch?.id).toBe('conversation.follow.toggle');
    expect(modifiedMatch).toBeNull();
  });

  it('returns null for an unknown key', () => {
    expect(matchShortcut(makeEvent({ key: 'Unidentified' }))).toBeNull();
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
});
