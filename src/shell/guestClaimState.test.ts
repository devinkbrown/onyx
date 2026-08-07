// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach } from 'vitest';
import {
  closeGuestClaimSheet,
  isGuestClaimSheetOpen,
  openGuestClaimSheet,
  resetGuestClaimSheetState,
  setGuestClaimSheetOpenState,
} from './guestClaimState';

beforeEach(() => {
  resetGuestClaimSheetState();
});

describe('guestClaimState', () => {
  it('starts closed', () => {
    expect(isGuestClaimSheetOpen()).toBe(false);
  });

  it('opens and closes the shared sheet signal', () => {
    openGuestClaimSheet();
    expect(isGuestClaimSheetOpen()).toBe(true);
    closeGuestClaimSheet();
    expect(isGuestClaimSheetOpen()).toBe(false);
  });

  it('accepts explicit boolean open state', () => {
    setGuestClaimSheetOpenState(true);
    expect(isGuestClaimSheetOpen()).toBe(true);
    setGuestClaimSheetOpenState(false);
    expect(isGuestClaimSheetOpen()).toBe(false);
  });
});
