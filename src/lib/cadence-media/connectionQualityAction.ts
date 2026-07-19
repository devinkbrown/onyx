// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * connectionQualityAction — pure hysteresis for poor-network soft prompts.
 *
 * Research R6 (onyx-cadence-voice-video-ux): when connection quality is tier 3
 * (Poor) and the local camera is publishing, surface a one-tap "Turn off
 * camera" action. Never flash on brief spikes — require the poor tier to hold
 * for ≥ hysteresisMs before showing, and do not re-show after dismiss until
 * quality recovers then degrades again.
 *
 * DOM-free so unit tests pin the contract without fake timers or engine mocks.
 */

import type { NetworkQualityTier } from './types';

/** Default hold time before a poor-tier soft prompt may appear (research: ≥2–3s). */
export const CQ_ACTION_HYSTERESIS_MS = 2500;

/** Soft action kinds the voice bar may offer for connection quality. */
export type ConnectionQualityActionKind = 'turn_off_camera';

export interface ConnectionQualityActionState {
  /** Tier that has held long enough to be treated as stable. */
  readonly stableTier: NetworkQualityTier | null;
  /** Candidate tier currently being timed for hysteresis. */
  readonly candidateTier: NetworkQualityTier | null;
  /** Epoch ms when the candidate tier was first observed. */
  readonly candidateSinceMs: number;
  /**
   * True after the user dismisses or acts on a poor-network prompt during the
   * current poor stretch. Cleared when quality recovers above Poor.
   */
  readonly promptConsumed: boolean;
  /** Soft prompt currently visible (tier 3 + camera on + hysteresis held). */
  readonly showTurnOffCamera: boolean;
}

export const INITIAL_CONNECTION_QUALITY_ACTION_STATE: Readonly<ConnectionQualityActionState> =
  Object.freeze({
    stableTier: null,
    candidateTier: null,
    candidateSinceMs: 0,
    promptConsumed: false,
    showTurnOffCamera: false,
  });

export interface ConnectionQualityActionInput {
  readonly nowMs: number;
  readonly tier: NetworkQualityTier;
  readonly cameraOn: boolean;
  /** Override hysteresis for tests; production uses CQ_ACTION_HYSTERESIS_MS. */
  readonly hysteresisMs?: number;
}

function resolvePrompt(
  stableTier: NetworkQualityTier | null,
  cameraOn: boolean,
  promptConsumed: boolean,
): boolean {
  return stableTier === 3 && cameraOn && !promptConsumed;
}

/**
 * Advance the soft-prompt state machine with a new quality sample.
 * Pure: returns a new object; never mutates `prev`.
 */
export function advanceConnectionQualityAction(
  prev: ConnectionQualityActionState,
  input: ConnectionQualityActionInput,
): ConnectionQualityActionState {
  const hysteresisMs = input.hysteresisMs ?? CQ_ACTION_HYSTERESIS_MS;
  const tier = input.tier;
  const nowMs = input.nowMs;

  // Recovery above Poor re-arms the prompt for a later degradation.
  let promptConsumed = prev.promptConsumed;
  if (tier < 3) {
    promptConsumed = false;
  }

  let stableTier = prev.stableTier;
  let candidateTier = prev.candidateTier;
  let candidateSinceMs = prev.candidateSinceMs;

  if (stableTier === tier) {
    // Already stable at this tier — keep candidate cleared.
    candidateTier = null;
    candidateSinceMs = 0;
  } else if (candidateTier === tier) {
    if (nowMs - candidateSinceMs >= hysteresisMs) {
      stableTier = tier;
      candidateTier = null;
      candidateSinceMs = 0;
    }
  } else {
    // New candidate (or first sample).
    candidateTier = tier;
    candidateSinceMs = nowMs;
  }

  return {
    stableTier,
    candidateTier,
    candidateSinceMs,
    promptConsumed,
    showTurnOffCamera: resolvePrompt(stableTier, input.cameraOn, promptConsumed),
  };
}

/** Mark the soft prompt consumed (user dismissed or turned camera off). */
export function consumeConnectionQualityAction(
  prev: ConnectionQualityActionState,
): ConnectionQualityActionState {
  if (prev.promptConsumed && !prev.showTurnOffCamera) return prev;
  return {
    ...prev,
    promptConsumed: true,
    showTurnOffCamera: false,
  };
}

/** Human copy for the soft prompt (stable for aria + visible text). */
export function connectionQualityActionCopy(
  kind: ConnectionQualityActionKind,
): { message: string; actionLabel: string; dismissLabel: string } {
  switch (kind) {
    case 'turn_off_camera':
      return {
        message: 'Poor connection — turn off camera to keep audio clear.',
        actionLabel: 'Turn off camera',
        dismissLabel: 'Dismiss connection tip',
      };
  }
}
