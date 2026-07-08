/**
 * ShortcutsSheet.tsx - keyboard shortcut reference sheet and pure shortcut data model.
 */

import { For, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import './ShortcutsSheet.css';

export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { label: 'Go to Home', keys: ['g', 'then', 'h'] },
      { label: 'Next channel', keys: ['Alt', 'ArrowDown'] },
      { label: 'Previous channel', keys: ['Alt', 'ArrowUp'] },
      { label: 'Jump to date', keys: ['g', 'then', 'd'] },
    ],
  },
  {
    title: 'Composing',
    shortcuts: [
      { label: 'Focus composer', keys: ['Enter'] },
      { label: 'Send message', keys: ['Ctrl', 'Enter'] },
      { label: 'Insert a new line', keys: ['Shift', 'Enter'] },
      { label: 'Open command palette', keys: ['Ctrl', 'K'] },
      { label: 'Open command palette', keys: ['⌘', 'K'] },
    ],
  },
  {
    title: 'Reading',
    shortcuts: [
      { label: 'Close sheet or menu', keys: ['Esc'] },
      { label: 'Search current channel', keys: ['Ctrl', 'F'] },
      { label: 'Search current channel', keys: ['⌘', 'F'] },
      { label: 'Jump to unread', keys: ['u'] },
    ],
  },
  {
    title: 'Appearance',
    shortcuts: [
      { label: 'Toggle Reader mode', keys: ['r'] },
      { label: 'Open preferences', keys: ['Ctrl', ','] },
      { label: 'Open preferences', keys: ['⌘', ','] },
    ],
  },
];

export function ShortcutsSheet(props: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <Sheet
      open={props.open}
      title="Keyboard shortcuts"
      description="A quick reference for moving through Onyx without leaving the keyboard."
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      closeLabel="Close shortcuts"
    >
      <div class="shortcuts-sheet" data-testid="shortcuts-sheet">
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <section class="shortcuts-sheet__group" aria-labelledby={`shortcuts-${group.title.toLowerCase()}`}>
              <h3 class="shortcuts-sheet__title" id={`shortcuts-${group.title.toLowerCase()}`}>
                {group.title}
              </h3>
              <div class="shortcuts-sheet__rows" role="list">
                <For each={group.shortcuts}>
                  {(shortcut) => (
                    <div class="shortcuts-sheet__row" role="listitem">
                      <span class="shortcuts-sheet__label">{shortcut.label}</span>
                      <span class="shortcuts-sheet__keys" aria-label={shortcut.keys.join(' ')}>
                        <For each={shortcut.keys}>
                          {(key) => <kbd class="shortcuts-sheet__key">{key}</kbd>}
                        </For>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </Sheet>
  );
}
