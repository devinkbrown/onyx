// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ShortcutsSheet.test.ts - DOM-free assertions for the shortcuts data model.
 */

import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '@/lib/keyboard/useKeyboardShortcuts';
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

  it('documents reader mode with a modified shortcut', () => {
    const shortcuts = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);
    const readerShortcut = shortcuts.find((shortcut) => shortcut.label === 'Toggle Reader mode');

    expect(readerShortcut).toBeDefined();
    expect(readerShortcut!.keys).toContain('Shift');
    expect(readerShortcut!.keys).toContain('R');
  });

  it('documents next unread and follow as separate reading shortcuts', () => {
    const shortcuts = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);

    expect(shortcuts.find((shortcut) => shortcut.label === 'Jump to next unread channel / DM')?.keys).toEqual(['N']);
    expect(shortcuts.find((shortcut) => shortcut.label === 'Follow current channel / DM')?.keys).toEqual(['U']);
  });

  it('mirrors every live global shortcut descriptor', () => {
    const rendered = SHORTCUT_GROUPS.flatMap((group) => (
      group.shortcuts.map((shortcut) => `${group.title}:${shortcut.label}`)
    ));

    for (const shortcut of SHORTCUTS) {
      expect(rendered).toContain(`${shortcut.group}:${shortcut.description}`);
    }
  });
});
