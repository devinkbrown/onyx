// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/shell/ShortcutsOverlay.test.tsx
 *
 * Behaviour of the keyboard-shortcuts help overlay:
 *  - opens on the "?" trigger key (through the global keyboard system + store)
 *  - lists every registered shortcut grouped by category, derived from the
 *    SHORTCUTS registry (no hand-maintained duplicate)
 *  - Escape closes the overlay AND restores focus to the trigger element
 *  - the dialog appears/disappears reactively as `open` changes
 */

import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '@/lib/store/store';
import { useStore, getState } from '@/lib/store';
import { useKeyboardShortcuts } from '@/lib/keyboard/useKeyboardShortcuts';
import { SHORTCUTS } from '@/lib/keyboard/useKeyboardShortcuts';
import { ShortcutsOverlay } from './ShortcutsOverlay';

const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));
const initialState = store.getInitialState();

/** Mirrors AppShell: read the store flag via useStore, drive the overlay. */
function TriggerHarness() {
  const show = useStore((s) => s.showKeyboardShortcuts);
  useKeyboardShortcuts();
  return <ShortcutsOverlay open={show()} onClose={() => getState().closeKeyboardShortcuts()} />;
}

describe('ShortcutsOverlay', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
  });

  it('is closed (no dialog) when open is false', () => {
    render(() => <ShortcutsOverlay open={false} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on the "?" trigger key', async () => {
    render(() => <TriggerHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: '?' });
    await tick();

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('lists every registered shortcut grouped by category derived from the registry', () => {
    render(() => <ShortcutsOverlay open onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });

    // Only categories that actually have shortcuts are shown, in order.
    const presentGroups = [...new Set(SHORTCUTS.map((s) => s.group))];
    for (const group of presentGroups) {
      expect(within(dialog).getByRole('heading', { name: group, level: 3 })).toBeTruthy();
    }
    // 'Voice & Video' has no registered shortcuts, so its heading is dropped.
    expect(within(dialog).queryByRole('heading', { name: 'Voice & Video' })).toBeNull();

    // Every descriptor description is rendered — proves the list is derived
    // from the registry rather than hand-maintained.
    for (const shortcut of SHORTCUTS) {
      expect(within(dialog).getByText(shortcut.description)).toBeTruthy();
    }

    // A multi-chord entry ("⌘K / Ctrl+K") renders each alternative as its own kbd.
    expect(within(dialog).getByText('⌘K')).toBeTruthy();
    expect(within(dialog).getByText('Ctrl+K')).toBeTruthy();
  });

  it('appears and disappears reactively as open changes', async () => {
    const [open, setOpen] = createSignal(false);
    render(() => <ShortcutsOverlay open={open()} onClose={() => setOpen(false)} />);

    expect(screen.queryByRole('dialog')).toBeNull();

    setOpen(true);
    await tick();
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();

    setOpen(false);
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape and restores focus to the triggering element', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open shortcuts
          </button>
          <ShortcutsOverlay open={open()} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(() => <Harness />);
    const trigger = screen.getByRole('button', { name: 'Open shortcuts' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await tick();
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
