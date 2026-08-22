// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Consumer copy and list-visibility helpers for Mute / Hide room / Leave room
 * and Close conversation. Presentation + local list-state only — never PART.
 */

export const ROOM_VERB_COPY = {
  mute: {
    label: 'Mute',
    roomLabel: 'Mute room',
    unmuteLabel: 'Unmute room',
    dmLabel: 'Mute conversation',
    dmUnmuteLabel: 'Unmute conversation',
    hint: 'Stay in the room. We will not tap you.',
  },
  hide: {
    label: 'Hide room',
    showLabel: 'Show room',
    hint: 'Stay joined. This room leaves your list until someone mentions you.',
  },
  leave: {
    label: 'Leave room',
    confirm: 'Leave room',
    cancel: 'Stay',
    title: (room: string) => `Leave ${room}?`,
    body: (room: string) => `You will leave ${room}. History stays on this device.`,
  },
  closeConversation: {
    label: 'Close conversation',
    confirm: 'Close conversation',
    cancel: 'Keep it',
    title: 'Close conversation?',
    body: 'This chat leaves Messages. Nothing is deleted on their side.',
  },
} as const;

/** A mention or room-wide ping returns a hidden room to the list. */
export function shouldRevealHiddenRoom(input: {
  isSelf: boolean;
  classifiedHighlight: boolean;
}): boolean {
  return !input.isSelf && input.classifiedHighlight;
}

/** An inbound DM returns a closed conversation to Messages. */
export function shouldReopenClosedConversation(input: {
  isSelf: boolean;
}): boolean {
  return !input.isSelf;
}
