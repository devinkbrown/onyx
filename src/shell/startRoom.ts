// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * startRoom — focus the existing sidebar "join #room" field.
 *
 * Home's "Start a room" reuses ChannelSidebar's join form and AppShell's rooms
 * collection. No parallel store, no second create-room ritual.
 */

type StartRoomHandler = () => void;

let handler: StartRoomHandler | null = null;

export function registerStartRoomHandler(fn: StartRoomHandler): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

export function requestStartRoom(): void {
  if (handler) {
    handler();
    return;
  }
  focusJoinRoomInput();
}

export function focusJoinRoomInput(): boolean {
  if (typeof document === 'undefined') return false;
  const input = document.getElementById('shell-join-input');
  if (!(input instanceof HTMLInputElement)) return false;
  input.focus();
  input.select();
  return true;
}

/** Test / boundary reset. */
export function resetStartRoomHandlerForTests(): void {
  handler = null;
}
