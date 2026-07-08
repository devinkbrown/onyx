/**
 * ShortcutsSheet.test.ts - DOM-free assertions for the shortcuts data model.
 */

import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from './ShortcutsSheet';

describe('SHORTCUT_GROUPS', () => {
  it('defines non-empty shortcut groups with labelled key sequences', () => {
    const groups = SHORTCUT_GROUPS;

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.title.trim().length).toBeGreaterThan(0);
      expect(group.shortcuts.length).toBeGreaterThan(0);

      for (const shortcut of group.shortcuts) {
        expect(shortcut.label.trim().length).toBeGreaterThan(0);
        expect(shortcut.keys.length).toBeGreaterThan(0);
        expect(shortcut.keys.every((key) => key.trim().length > 0)).toBe(true);
      }
    }
  });

  it('includes a command-palette shortcut using K', () => {
    const shortcuts = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);
    const commandPaletteShortcut = shortcuts.find((shortcut) => (
      shortcut.label.toLowerCase().includes('command palette') && shortcut.keys.includes('K')
    ));

    expect(commandPaletteShortcut).toBeDefined();
  });
});
