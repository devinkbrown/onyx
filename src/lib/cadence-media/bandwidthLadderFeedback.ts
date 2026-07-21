// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * bandwidthLadderFeedback — pure hysteresis for adaptive-quality UI notices.
 *
 * Research R3 (onyx-cadence-voice-video-ux): when the bandwidth ladder drops
 * quality (network tier worsens into Fair/Poor), surface a calm one-shot
 * notice: "Lowering video quality to keep audio clear." Never flash on brief
 * spikes; never re-spam during the same poor stretch; re-arm only after
 * recovery to a better stable tier.
 *
 * DOM-free so unit tests pin the contract without engine mocks.
 */

import type { NetworkQualityTier } from './types';

/** Default hold time before a tier is treated as stable (matches CQ soft-prompt). */
export const BANDWIDTH_LADDER_HYSTERESIS_MS = 2500;

/** Soft notice kinds the voice UI may toast for ladder changes. */
export type BandwidthLadderNoticeKind = 'lowering' | 'audio_priority';

export interface BandwidthLadderFeedbackState {
  /** Tier that has held long enough to be treated as stable. */
  readonly stableTier: NetworkQualityTier | null;
  /** Candidate tier currently being timed for hysteresis. */
  readonly candidateTier: NetworkQualityTier | null;
  /** Epoch ms when the candidate tier was first observed. */
  readonly candidateSinceMs: number;
  /**
   * Worst tier already announced during the current degradation stretch.
   * Cleared when quality recovers above the last-announced floor.
   */
  readonly announcedThroughTier: NetworkQualityTier | null;
  /** Notice ready to surface once (cleared by consume). */
  readonly pendingNotice: BandwidthLadderNoticeKind | null;
}

export const INITIAL_BANDWIDTH_LADDER_FEEDBACK_STATE: Readonly<BandwidthLadderFeedbackState> =
  Object.freeze({
    stableTier: null,
    candidateTier: null,
    candidateSinceMs: 0,
    announcedThroughTier: null,
    pendingNotice: null,
  });

export interface BandwidthLadderFeedbackInput {
  readonly nowMs: number;
  readonly tier: NetworkQualityTier;
  /** Override hysteresis for tests; production uses BANDWIDTH_LADDER_HYSTERESIS_MS. */
  readonly hysteresisMs?: number;
}

/**
 * Decide whether a newly-stable worse tier deserves a soft notice.
 * Mild Good (0→1) is silent; Fair/Poor ladder steps speak once.
 */
function noticeForDegradation(
  from: NetworkQualityTier | null,
  to: NetworkQualityTier,
  announcedThrough: NetworkQualityTier | null,
): BandwidthLadderNoticeKind | null {
  if (from === null) return null;
  if (to <= from) return null;
  // Already announced this depth (or worse) in the current stretch.
  if (announcedThrough !== null && to <= announcedThrough) return null;
  if (to >= 3) return 'audio_priority';
  if (to >= 2) return 'lowering';
  return null;
}

/**
 * Advance the ladder-feedback state machine with a new quality sample.
 * Pure: returns a new object; never mutates `prev`.
 */
export function advanceBandwidthLadderFeedback(
  prev: BandwidthLadderFeedbackState,
  input: BandwidthLadderFeedbackInput,
): BandwidthLadderFeedbackState {
  const hysteresisMs = input.hysteresisMs ?? BANDWIDTH_LADDER_HYSTERESIS_MS;
  const tier = input.tier;
  const nowMs = input.nowMs;

  let stableTier = prev.stableTier;
  let candidateTier = prev.candidateTier;
  let candidateSinceMs = prev.candidateSinceMs;
  let announcedThroughTier = prev.announcedThroughTier;
  // Pending is one-shot — only set on a newly-stable degradation this tick.
  let pendingNotice: BandwidthLadderNoticeKind | null = null;

  // Recovery above the last-announced floor re-arms future notices.
  if (announcedThroughTier !== null && tier < announcedThroughTier) {
    // Only clear the arm once the *stable* tier recovers; candidate recovery
    // alone is handled after hysteresis settles.
  }

  if (stableTier === tier) {
    candidateTier = null;
    candidateSinceMs = 0;
  } else if (candidateTier === tier) {
    if (nowMs - candidateSinceMs >= hysteresisMs) {
      const previousStable = stableTier;
      stableTier = tier;
      candidateTier = null;
      candidateSinceMs = 0;

      // Re-arm when the newly stable tier is better than what we last announced.
      if (
        announcedThroughTier !== null
        && stableTier < announcedThroughTier
      ) {
        announcedThroughTier = null;
      }

      const notice = noticeForDegradation(
        previousStable,
        stableTier,
        announcedThroughTier,
      );
      if (notice) {
        pendingNotice = notice;
        announcedThroughTier = stableTier;
      }
    }
  } else {
    candidateTier = tier;
    candidateSinceMs = nowMs;
  }

  return {
    stableTier,
    candidateTier,
    candidateSinceMs,
    announcedThroughTier,
    pendingNotice,
  };
}

/** Clear a pending notice after the UI has surfaced it (toast/banner). */
export function consumeBandwidthLadderNotice(
  prev: BandwidthLadderFeedbackState,
): BandwidthLadderFeedbackState {
  if (prev.pendingNotice === null) return prev;
  return { ...prev, pendingNotice: null };
}

/** Human copy for ladder notices (stable for aria + toast text). */
export function bandwidthLadderNoticeCopy(
  kind: BandwidthLadderNoticeKind,
): { title: string; description: string } {
  switch (kind) {
    case 'lowering':
      return {
        title: 'Adjusting video quality',
        description: 'Lowering video quality to keep audio clear.',
      };
    case 'audio_priority':
      return {
        title: 'Protecting audio',
        description: 'Connection is weak — reducing video to keep audio clear.',
      };
  }
}
