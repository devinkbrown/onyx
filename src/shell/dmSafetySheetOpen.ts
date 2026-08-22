// SPDX-License-Identifier: AGPL-3.0-or-later
/** Header Verify → existing DmSafetySheet. Registration lives with the sheet. */

let openImpl: (() => void) | null = null;

export function registerDmSafetySheetOpener(open: (() => void) | null): void {
  openImpl = open;
}

export function openDmSafetySheet(): void {
  openImpl?.();
}
