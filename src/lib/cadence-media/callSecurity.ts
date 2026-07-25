// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * callSecurity — pure Cadence call security affordance resolver.
 *
 * Cadence media is fail-closed while its client-held group key negotiates.
 * The transport MAC is server-verifiable and therefore never sufficient for
 * a padlock; only the engine's established media E2EE state permits one.
 * Showing a padlock for hop-only crypto is a security bug (over-claims
 * end-to-end privacy). This module is the single source of truth for:
 *
 *   - which icon the VoiceBar security chip may show
 *   - honest user-facing copy for each security level
 *
 * Padlock permission is gated exclusively through `padlockHonesty` (C7):
 * `usesPadlock` is true only when `mediaPadlockView(...).honestPrivate` is true.
 * DOM-free and deterministic so unit tests can lock the fail-closed contract.
 */

import {
  deriveMediaCryptoState,
  mediaPadlockView,
  type PadlockView,
} from '@/lib/media/padlockHonesty';
import type { CallState } from './types';

/** Discrete security levels the call UI can present. */
export type CallSecurityLevel =
  | 'connecting'
  | 'hop_protected'
  | 'e2ee'
  | 'e2ee_degraded'
  | 'insecure'
  | 'stage';

/**
 * Icon semantic for the security chip.
 * `lock` is reserved for true media E2EE — never for hop-only transport.
 */
export type CallSecurityIcon =
  | 'spinner'
  | 'shield'
  | 'lock'
  | 'lock_open'
  | 'warning'
  | 'stage';

/** Resolved, ready-to-render affordance for the VoiceBar chip. */
export interface CallSecurityAffordance {
  readonly level: CallSecurityLevel;
  readonly icon: CallSecurityIcon;
  /** Short chip label (visible text). */
  readonly label: string;
  /** Longer explanation for tooltip / aria-describedby. */
  readonly detail: string;
  /**
   * True only when the affordance uses a padlock (true media E2EE).
   * Always equal to `padlock.honestPrivate` — callers must not invent a
   * padlock when this is false.
   */
  readonly usesPadlock: boolean;
  /**
   * C7 media padlock honesty view for this call. Chip UI may surface
   * `tone` / `glyph` / `honestPrivate` without re-deriving flags.
   */
  readonly padlock: PadlockView;
}

/**
 * Inputs the resolver needs. Optional flags default to "not shipped / unknown"
 * so today's hop-only path needs only `callState`.
 */
export interface CallSecurityInput {
  readonly callState: CallState;
  /**
   * True when client-held media group keys are established for this call.
   */
  readonly mediaE2eeActive?: boolean;
  /**
   * True when the room expects media E2EE but at least one peer cannot
   * participate (mixed-room rollout). Implies not full E2EE.
   */
  readonly mediaE2eeDegraded?: boolean;
  /**
   * Stage / broadcast mode — server may process media; never claim private
   * or E2EE even after hangout E2EE ships.
   */
  readonly stageMode?: boolean;
  /**
   * Transport known insecure or crypto failed closed. Prefer leaving the
   * call over silent plaintext.
   */
  readonly transportInsecure?: boolean;
}

type CallSecurityBase = Omit<CallSecurityAffordance, 'usesPadlock' | 'padlock'>;

const CONNECTING: CallSecurityBase = {
  level: 'connecting',
  icon: 'spinner',
  label: 'Connecting…',
  detail: 'Establishing a protected connection to this server.',
};

const HOP_PROTECTED: CallSecurityBase = {
  level: 'hop_protected',
  icon: 'shield',
  label: 'Protected connection',
  detail:
    'Protected connection — encrypted to this server. Server operators can access call media.',
};

const E2EE: CallSecurityBase = {
  level: 'e2ee',
  icon: 'lock',
  label: 'End-to-end encrypted',
  detail: 'End-to-end encrypted — only people in this call can hear or see.',
};

const E2EE_DEGRADED: CallSecurityBase = {
  level: 'e2ee_degraded',
  icon: 'lock_open',
  label: 'Not end-to-end',
  detail: 'Not end-to-end encrypted while outdated clients are present.',
};

const INSECURE: CallSecurityBase = {
  level: 'insecure',
  icon: 'warning',
  label: 'Not secure',
  detail: 'Call not secure — leave if you expected a protected connection.',
};

const STAGE: CallSecurityBase = {
  level: 'stage',
  icon: 'stage',
  label: 'Stage broadcast',
  detail: 'Stage — broadcast mode. Not a private call.',
};

/**
 * Map call-level security inputs onto media crypto flags for the C7 honesty
 * table. Prefer fail-open (no private claim) when flags disagree.
 *
 * Stage / insecure / connecting always refuse a closed padlock. Full media
 * E2EE is claimed only when the engine reports active E2EE and the room is
 * not degraded.
 */
export function mediaCryptoFlagsFromCall(input: CallSecurityInput): {
  mooringUp?: boolean;
  mediaMacOk?: boolean;
  e2eeSealed?: boolean;
  connecting?: boolean;
  error?: boolean;
} {
  if (input.transportInsecure) return { error: true };
  if (input.callState === 'ringing_out' || input.callState === 'ringing_in') {
    return { connecting: true };
  }
  // Stage / broadcast is server-processed — never sealed for padlock purposes.
  if (input.stageMode) {
    return { mooringUp: false, e2eeSealed: false };
  }
  // Mixed-room: path may authenticate but content is not fully E2E sealed.
  if (input.mediaE2eeDegraded) {
    return { mediaMacOk: true, e2eeSealed: false };
  }
  if (input.mediaE2eeActive) {
    return { mooringUp: true, e2eeSealed: true, mediaMacOk: true };
  }
  // Hop-only: SFU path without client E2E.
  return { mooringUp: false, e2eeSealed: false };
}

/** C7 honesty view for the current call security inputs. */
export function mediaPadlockForCall(input: CallSecurityInput): PadlockView {
  return mediaPadlockView(deriveMediaCryptoState(mediaCryptoFlagsFromCall(input)));
}

/**
 * Attach the C7 padlock gate onto a level/icon/label base.
 * Closed padlock (`usesPadlock`) only when honesty says `honestPrivate`.
 * If honesty refuses privacy but the base still asked for a lock icon,
 * force an open lock so the UI cannot paint a false closed padlock.
 */
function withPadlockHonesty(
  base: CallSecurityBase,
  padlock: PadlockView,
): CallSecurityAffordance {
  const usesPadlock = padlock.honestPrivate;
  const icon: CallSecurityIcon =
    usesPadlock
      ? 'lock'
      : base.icon === 'lock'
        ? 'lock_open'
        : base.icon;
  return {
    ...base,
    icon,
    usesPadlock,
    padlock,
  };
}

/**
 * Resolve the security chip for the current call.
 *
 * Returns `null` when no call surface is active (`idle`) so the bar can omit
 * the chip entirely. Priority (highest first):
 *   1. stage mode (never lock / never private claim)
 *   2. transport insecure
 *   3. E2EE degraded (mixed room)
 *   4. media E2EE established (padlock allowed only via C7 honesty)
 *   5. connecting (ringing)
 *   6. hop protected (in_call default today)
 */
export function resolveCallSecurity(
  input: CallSecurityInput,
): CallSecurityAffordance | null {
  const { callState } = input;
  if (callState === 'idle') return null;

  const padlock = mediaPadlockForCall(input);

  // Stage is a separate trust model — never promote to padlock.
  if (input.stageMode) return withPadlockHonesty(STAGE, padlock);

  if (input.transportInsecure) return withPadlockHonesty(INSECURE, padlock);

  // Degraded E2EE (partial room) is not full E2EE — no closed padlock.
  if (input.mediaE2eeDegraded) return withPadlockHonesty(E2EE_DEGRADED, padlock);

  // True media E2EE only when explicitly established AND honesty agrees.
  if (input.mediaE2eeActive) return withPadlockHonesty(E2EE, padlock);

  if (callState === 'ringing_out' || callState === 'ringing_in') {
    return withPadlockHonesty(CONNECTING, padlock);
  }

  // in_call without media E2EE: hop crypto only → shield, never padlock.
  return withPadlockHonesty(HOP_PROTECTED, padlock);
}

/** True when the resolved affordance may render a padlock glyph. */
export function callSecurityUsesPadlock(
  affordance: CallSecurityAffordance | null,
): boolean {
  return affordance?.usesPadlock === true;
}
