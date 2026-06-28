/**
 * src/lib/keyboard/useKeyboardShortcuts.test.ts
 *
 * Unit tests for the SHORTCUTS descriptor list and the pure helper logic
 * (group membership, keys coverage). The DOM handler itself is tested by
 * the shell integration test; here we focus on the contract surface.
 */
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, type ShortcutGroup } from './useKeyboardShortcuts';

const ALL_GROUPS: ShortcutGroup[] = ['Navigation', 'Chat', 'View', 'Voice & Video', 'Palette'];

describe('SHORTCUTS descriptor', () => {
  it('is a non-empty array', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty keys and description string', () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry belongs to a valid group', () => {
    for (const s of SHORTCUTS) {
      expect(ALL_GROUPS).toContain(s.group);
    }
  });

  it('includes Cmd/Ctrl+K palette shortcut', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('⌘K'));
    expect(found).toBeDefined();
    expect(found!.group).toBe('Palette');
  });

  it('includes "?" shortcut for help overlay', () => {
    const found = SHORTCUTS.find((s) => s.keys === '?');
    expect(found).toBeDefined();
  });

  it('includes Alt+↑ and Alt+↓ for navigation', () => {
    const up = SHORTCUTS.find((s) => s.keys.includes('Alt+↑'));
    const down = SHORTCUTS.find((s) => s.keys.includes('Alt+↓'));
    expect(up).toBeDefined();
    expect(down).toBeDefined();
    expect(up!.group).toBe('Navigation');
    expect(down!.group).toBe('Navigation');
  });

  it('includes Alt+M for member list toggle', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Alt+M'));
    expect(found).toBeDefined();
    expect(found!.group).toBe('View');
  });

  it('includes Esc shortcut', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Esc'));
    expect(found).toBeDefined();
  });

  it('has no duplicate keys strings', () => {
    const keysSet = new Set(SHORTCUTS.map((s) => s.keys));
    expect(keysSet.size).toBe(SHORTCUTS.length);
  });
});
