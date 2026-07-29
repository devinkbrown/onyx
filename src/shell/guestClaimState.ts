// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * guestClaimState — shared UI signal for the guest claim Sheet.
 *
 * Presentation-only. Opens the same in-session claim Sheet from the compact
 * chip and from Account without disconnecting or touching store.ts.
 * Durable dismissal of the chip still lives in GuestClaimPrompt (per-owner
 * localStorage); this module only controls sheet open/close.
 */
import { createSignal } from 'solid-js';

const [guestClaimSheetOpen, setGuestClaimSheetOpen] = createSignal(false);

/** Reactive read — call inside JSX / createMemo / effects. */
export function isGuestClaimSheetOpen(): boolean {
  return guestClaimSheetOpen();
}

export function openGuestClaimSheet(): void {
  setGuestClaimSheetOpen(true);
}

export function closeGuestClaimSheet(): void {
  setGuestClaimSheetOpen(false);
}

export function setGuestClaimSheetOpenState(open: boolean): void {
  setGuestClaimSheetOpen(open);
}

/** Test / boundary reset — does not touch dismissal storage. */
export function resetGuestClaimSheetState(): void {
  setGuestClaimSheetOpen(false);
}
