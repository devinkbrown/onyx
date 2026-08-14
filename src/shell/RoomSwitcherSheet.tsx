// SPDX-License-Identifier: AGPL-3.0-or-later
/** Mobile wrapper for the existing room/message collection. AppShell owns open
 * state and focus restoration; this component owns only sheet semantics. */
import { Show, splitProps, type JSX } from 'solid-js';

export type RoomSwitcherSheetProps = {
  open: boolean;
  mode: 'rooms' | 'messages';
  onDismiss: () => void;
  sheetRef?: (element: HTMLDivElement) => void;
  children: JSX.Element;
};

export function RoomSwitcherSheet(props: RoomSwitcherSheetProps): JSX.Element {
  const [local] = splitProps(props, ['open', 'mode', 'onDismiss', 'sheetRef', 'children']);
  return (
    <>
    <Show when={local.open}>
      <div class="shell-sidebar-backdrop" aria-hidden="true" onClick={() => local.onDismiss()} />
    </Show>
    <div
      ref={local.sheetRef}
      class={`shell-sidebar-slot${local.open ? ' shell-sidebar--mobile-open' : ''}`}
      role={local.open ? 'dialog' : undefined}
      aria-modal={local.open ? 'true' : undefined}
      aria-label={local.open ? `${local.mode === 'rooms' ? 'Room' : 'Inbox'} switcher` : undefined}
      tabindex={local.open ? -1 : undefined}
      data-room-switcher-sheet
    >
      <Show when={local.open}>
        <div class="shell-room-switcher-sheet__bar">
          <p>{local.mode === 'rooms' ? 'Choose a room' : 'Choose a conversation'}</p>
          <button type="button" onClick={() => local.onDismiss()} aria-label="Close switcher" title="Close switcher">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </Show>
      {local.children}
    </div>
    </>
  );
}
