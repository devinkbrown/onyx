// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * youNotificationsState — You → Notifications sheet open signal.
 *
 * Presentation-only. Mirrors guestClaimState / preferences open so the You hub
 * can open Notifications without a store.ts rewrite.
 */
import { createSignal, type Accessor } from 'solid-js';

const [open, setOpen] = createSignal(false);

export const isNotificationsOpen: Accessor<boolean> = open;

export function openNotifications(): void {
  setOpen(true);
}

export function closeNotifications(): void {
  setOpen(false);
}

export function setNotificationsOpen(next: boolean): void {
  setOpen(next);
}

/** Test / boundary reset. */
export function resetNotificationsOpenState(): void {
  setOpen(false);
}
