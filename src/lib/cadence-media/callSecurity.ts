// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * callSecurity — pure Cadence call security affordance resolver.
 *
 * Cadence media today is hop-protected (DTLS-SRTP / native MAC / server-held
 * group material). True media E2EE (SFrame + MLS) is planned, not shipped.
 * Showing a padlock for hop-only crypto is a security bug (over-claims
 * end-to-end privacy). This module is the single source of truth for:
 *
 *   - which icon the VoiceBar security chip may show
 *   - honest user-facing copy for each security level
 *
 * DOM-free and deterministic so unit tests can lock the fail-closed contract:
 * `usesPadlock` is true only when media E2EE is actually established.
 */

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
   * Callers must not invent a padlock when this is false.
   */
  readonly usesPadlock: boolean;
}

/**
 * Inputs the resolver needs. Optional flags default to "not shipped / unknown"
 * so today's hop-only path needs only `callState`.
 */
export interface CallSecurityInput {
  readonly callState: CallState;
  /**
   * True when SFrame/MLS media keys are established for this call.
   * Not shipped for Cadence voice/video today — leave unset/false.
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

const CONNECTING: CallSecurityAffordance = {
  level: 'connecting',
  icon: 'spinner',
  label: 'Connecting…',
  detail: 'Establishing a protected connection to this server.',
  usesPadlock: false,
};

const HOP_PROTECTED: CallSecurityAffordance = {
  level: 'hop_protected',
  icon: 'shield',
  label: 'Protected connection',
  detail:
    'Protected connection — encrypted to this server. Server operators can access call media.',
  usesPadlock: false,
};

const E2EE: CallSecurityAffordance = {
  level: 'e2ee',
  icon: 'lock',
  label: 'End-to-end encrypted',
  detail: 'End-to-end encrypted — only people in this call can hear or see.',
  usesPadlock: true,
};

const E2EE_DEGRADED: CallSecurityAffordance = {
  level: 'e2ee_degraded',
  icon: 'lock_open',
  label: 'Not end-to-end',
  detail: 'Not end-to-end encrypted while outdated clients are present.',
  usesPadlock: false,
};

const INSECURE: CallSecurityAffordance = {
  level: 'insecure',
  icon: 'warning',
  label: 'Not secure',
  detail: 'Call not secure — leave if you expected a protected connection.',
  usesPadlock: false,
};

const STAGE: CallSecurityAffordance = {
  level: 'stage',
  icon: 'stage',
  label: 'Stage broadcast',
  detail: 'Stage — broadcast mode. Not a private call.',
  usesPadlock: false,
};

/**
 * Resolve the security chip for the current call.
 *
 * Returns `null` when no call surface is active (`idle`) so the bar can omit
 * the chip entirely. Priority (highest first):
 *   1. stage mode (never lock / never private claim)
 *   2. transport insecure
 *   3. E2EE degraded (mixed room)
 *   4. media E2EE established (padlock allowed)
 *   5. connecting (ringing)
 *   6. hop protected (in_call default today)
 */
export function resolveCallSecurity(
  input: CallSecurityInput,
): CallSecurityAffordance | null {
  const { callState } = input;
  if (callState === 'idle') return null;

  // Stage is a separate trust model — never promote to padlock.
  if (input.stageMode) return STAGE;

  if (input.transportInsecure) return INSECURE;

  // Degraded E2EE (partial room) is not full E2EE — no closed padlock.
  if (input.mediaE2eeDegraded) return E2EE_DEGRADED;

  // True media E2EE only when explicitly established.
  if (input.mediaE2eeActive) return E2EE;

  if (callState === 'ringing_out' || callState === 'ringing_in') {
    return CONNECTING;
  }

  // in_call without media E2EE: hop crypto only → shield, never padlock.
  return HOP_PROTECTED;
}

/** True when the resolved affordance may render a padlock glyph. */
export function callSecurityUsesPadlock(
  affordance: CallSecurityAffordance | null,
): boolean {
  return affordance?.usesPadlock === true;
}
