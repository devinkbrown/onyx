/**
 * ShortcutsSheet.tsx - keyboard shortcut reference sheet and pure shortcut data model.
 */

import { For, type JSX } from 'solid-js';
import { SHORTCUTS, type ShortcutGroup as LiveShortcutGroup } from '@/lib/keyboard/useKeyboardShortcuts';
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

const GROUP_ORDER: readonly LiveShortcutGroup[] = ['Palette', 'Navigation', 'Chat', 'View', 'Voice & Video'];

function tokenizeChord(chord: string): string[] {
  if (chord.includes(' then ')) return chord.split(' ');
  const expanded = chord
    .replace('⌘⇧', '⌘+Shift+')
    .replace(/^⌘(?=.)/u, '⌘+');
  return expanded.split('+').filter(Boolean);
}

function tokenizeKeys(keys: string): string[] {
  return keys
    .split(' / ')
    .flatMap((chord, index) => (index === 0 ? tokenizeChord(chord) : ['/', ...tokenizeChord(chord)]));
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = GROUP_ORDER
  .map((group) => ({
    title: group,
    shortcuts: SHORTCUTS
      .filter((shortcut) => shortcut.group === group)
      .map((shortcut) => ({
        label: shortcut.description,
        keys: tokenizeKeys(shortcut.keys),
      })),
  }))
  .filter((group) => group.shortcuts.length > 0);

function groupId(title: string): string {
  return `shortcuts-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

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
            <section class="shortcuts-sheet__group" aria-labelledby={groupId(group.title)}>
              <h3 class="shortcuts-sheet__title" id={groupId(group.title)}>
                {group.title}
              </h3>
              <div
                class="shortcuts-sheet__rows"
                role="list"
                aria-label={`${group.title} shortcuts`}
              >
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
