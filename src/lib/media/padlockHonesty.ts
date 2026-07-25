// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * padlockHonesty.ts — Era 3 C7 media E2EE padlock UI truth table.
 *
 * Never show a locked padlock unless media frames are actually authenticated
 * and encrypted end-to-end. Partial / server-relayed-only states render as
 * "relayed" or "unknown", never a false lock.
 */

export type MediaCryptoState =
  | 'encrypted' // Mooring/TSUMUGI session up + MAC verified
  | 'authenticated-only' // MAC present, content not E2E sealed
  | 'relayed' // SFU path without client E2E
  | 'connecting'
  | 'unavailable'
  | 'error';

export type PadlockView = {
  /** Material icon-ish glyph for the chrome. */
  glyph: 'lock' | 'lock-open' | 'shield' | 'help' | 'warn';
  label: string;
  /** True only when the UI may paint a solid "private" lock. */
  honestPrivate: boolean;
  tone: 'private' | 'partial' | 'public' | 'neutral' | 'danger';
};

export function mediaPadlockView(state: MediaCryptoState): PadlockView {
  switch (state) {
    case 'encrypted':
      return {
        glyph: 'lock',
        label: 'End-to-end encrypted media',
        honestPrivate: true,
        tone: 'private',
      };
    case 'authenticated-only':
      return {
        glyph: 'shield',
        label: 'Authenticated media (not end-to-end sealed)',
        honestPrivate: false,
        tone: 'partial',
      };
    case 'relayed':
      return {
        glyph: 'lock-open',
        label: 'Relayed media — server can observe the stream',
        honestPrivate: false,
        tone: 'public',
      };
    case 'connecting':
      return {
        glyph: 'help',
        label: 'Media crypto negotiating…',
        honestPrivate: false,
        tone: 'neutral',
      };
    case 'unavailable':
      return {
        glyph: 'lock-open',
        label: 'Media encryption unavailable',
        honestPrivate: false,
        tone: 'public',
      };
    case 'error':
      return {
        glyph: 'warn',
        label: 'Media crypto error — treat as untrusted',
        honestPrivate: false,
        tone: 'danger',
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/**
 * Map engine flags onto the honesty state. Prefer fail-open (public) when
 * flags disagree rather than claiming privacy.
 */
export function deriveMediaCryptoState(flags: {
  mooringUp?: boolean;
  mediaMacOk?: boolean;
  e2eeSealed?: boolean;
  connecting?: boolean;
  error?: boolean;
}): MediaCryptoState {
  if (flags.error) return 'error';
  if (flags.connecting) return 'connecting';
  if (flags.mooringUp && flags.e2eeSealed && flags.mediaMacOk) return 'encrypted';
  if (flags.mediaMacOk && !flags.e2eeSealed) return 'authenticated-only';
  if (flags.mooringUp === false || flags.e2eeSealed === false) return 'relayed';
  return 'unavailable';
}
