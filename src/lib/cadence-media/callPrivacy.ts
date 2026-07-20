// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * callPrivacy — pure copy for the in-call Privacy / call-details sheet (R2).
 *
 * Builds on resolveCallSecurity so the sheet and the VoiceBar chip never
 * disagree. A human-comparable group-transcript Privacy Code remains a
 * separate slot; hop-only media never claims end-to-end privacy.
 */

import {
  resolveCallSecurity,
  type CallSecurityAffordance,
  type CallSecurityInput,
  type CallSecurityLevel,
} from './callSecurity';

export interface CallPrivacyDetails {
  readonly level: CallSecurityLevel;
  readonly title: string;
  readonly summary: string;
  /** Whether server operators can access call media content. */
  readonly serverCanAccessMedia: boolean;
  /**
   * Future group-transcript authenticator. Null until a comparable code is
   * implemented — UI must render a reserved empty slot, not invent one.
   */
  readonly epochCode: string | null;
  readonly usesPadlock: boolean;
  readonly affordance: CallSecurityAffordance;
}

/**
 * Resolve Privacy-sheet content for the current call security inputs.
 * Returns null when there is no active call (idle).
 */
export function resolveCallPrivacy(input: CallSecurityInput): CallPrivacyDetails | null {
  const affordance = resolveCallSecurity(input);
  if (!affordance) return null;

  const serverCanAccessMedia =
    affordance.level !== 'e2ee';

  const title = (() => {
    switch (affordance.level) {
      case 'connecting':
        return 'Call privacy';
      case 'hop_protected':
        return 'Call privacy';
      case 'e2ee':
        return 'End-to-end encrypted call';
      case 'e2ee_degraded':
        return 'Call privacy';
      case 'insecure':
        return 'Call not secure';
      case 'stage':
        return 'Stage broadcast';
    }
  })();

  return {
    level: affordance.level,
    title,
    summary: affordance.detail,
    serverCanAccessMedia,
    // E2EE can be active without a human-comparable transcript code. Never
    // display the numeric local epoch as if it authenticated the group.
    epochCode: null,
    usesPadlock: affordance.usesPadlock,
    affordance,
  };
}
